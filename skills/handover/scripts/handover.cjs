#!/usr/bin/env node
// Command-line tools for handover files (.handover, format 1.x). Needs only Node 16+.
//
//   node handover.cjs check <file>             validate; exit 1 with path-precise errors
//   node handover.cjs gaps <file>              list every TODO gap and where it is
//   node handover.cjs due <file> [YYYY-MM-DD] [--days N]
//                                              what is overdue, due and coming up
//   node handover.cjs summary <file>           counts of stages, tasks, duties, questions, sections, gaps
//   node handover.cjs strip <file> [out] [--profile newcomer|record] [--audience role,role]
//                                              export for sharing: newcomer (default) drops progress,
//                                              process state and anything the audience may not see
//   node handover.cjs render <file> [out]      write the sections for 1.0 readers again from the 1.1 data
//   node handover.cjs export <file> [out] [--items jobs,tasks] [--format pdf|docx|xlsx|md|html] [--title "…"]
//                                              chosen items as a document; the format defaults to out's extension
//   node handover.cjs report <file> [out] [--kind jd|working|jobs|needs] [--since YYYY-MM-DD] [--format pdf|docx|md|html]
//                                              a document for the principal; jd (the default) is a job description
//   node handover.cjs merge <file> <other> [out]
//                                              merge the progress in <other> into <file>
"use strict";
const fs = require("fs");
const path = require("path");
const C = require("./core.js");

function die(msg) { console.error(msg); process.exit(2); }
function read(file) {
  if (!file) die("Give a file path.");
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { die("Can't read " + file + ": " + e.message); }
  text = text.replace(/^﻿/, "").trim();
  const fence = text.match(/^```[a-z]*\s*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1];
  try { return JSON.parse(text); } catch (e) { console.error(file + " is not valid JSON: " + e.message); process.exit(1); }
}
function write(obj, out) {
  const text = JSON.stringify(obj, null, 2) + "\n";
  if (out) { fs.writeFileSync(out, text); console.error("Wrote " + out); } else process.stdout.write(text);
}
function requireValid(h, file) {
  const v = C.validate(h);
  if (v.errors.length) { console.error(file + ": " + v.errors.length + " problem(s)"); v.errors.forEach(e => console.error("  - " + e)); process.exit(1); }
  return v;
}

// TODO gaps in every text field, 1.1 objects included: [where, what]
function gaps(h) { return C.findGaps(h).map(g => [g.where, g.what]); }
function gapLine(h) {
  const c = C.gapCounts(h);
  const parts = [c.todo ? `${c.todo} TODO gap(s) still to fill (${Object.keys(c.byArea).map(k => k + " " + c.byArea[k]).join(", ")})` : "no TODO gaps"];
  if (h.gaps) parts.push(`${c.openItems} open item(s) on the gaps list` + (c.blocking ? `, ${c.blocking} blocking work` : ""));
  return parts.join("; ");
}

const [cmd, ...args] = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };

switch (cmd) {
  case "check": {
    const h = read(args[0]);
    const v = requireValid(h, args[0]);
    v.warnings.forEach(w => console.error("warning: " + w));
    console.log(`${args[0]}: valid handover ${h.handover} "${h.title}", ${gapLine(h)}`);
    break;
  }
  case "gaps": {
    const h = read(args[0]);
    const g = gaps(h);
    g.forEach(([where, what]) => console.log(`- ${where}: ${what}`));
    console.log(g.length ? `${g.length} TODO gap(s).` : "No TODO gaps.");
    const open = (h.gaps || []).filter(x => !x.closed);
    if (open.length) { console.log(`\nOpen on the gaps list:`); open.forEach(x => console.log(`- ${x.id}${x.blocks ? " (blocks work)" : ""}: ${x.text}`)); }
    break;
  }
  case "due": {
    const days = parseInt(flag("--days", "7"), 10);
    const h = read(args[0]); requireValid(h, args[0]);
    const today = args[1] || C.zoneParts(h.timezone).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) die("Date must be YYYY-MM-DD");
    const sc = C.schedule(h, h.progress || {firstSeen: today}, today);
    const line = o => `  ${C.nice(o.date)}  ${o.r.text}${o.r.time ? " · " + o.r.time : ""}  [${C.cadence(o.r)}]`;
    console.log(`${h.title} · ${C.nice(today, "long")}${h.timezone ? " (" + h.timezone + ")" : ""}`);
    if (sc.overdue.length) { console.log("\nOverdue:"); sc.overdue.forEach(o => console.log(line(o))); }
    console.log("\nToday:"); if (sc.due.length) sc.due.forEach(o => console.log(line(o))); else console.log("  Nothing due.");
    const upcoming = [];
    for (let i = 1; i <= days; i++) { const d = C.addDays(today, i); (h.recurring || []).forEach(r => { if (C.occursOn(r, d)) upcoming.push({r, date: d}); }); }
    console.log(`\nNext ${days} days:`); if (upcoming.length) upcoming.forEach(o => console.log(line(o))); else console.log("  Nothing.");
    break;
  }
  case "summary": {
    const h = read(args[0]); requireValid(h, args[0]);
    const tasks = (h.path || []).reduce((n, s) => n + s.tasks.length, 0);
    console.log(JSON.stringify({
      id: h.id, title: h.title, version: h.handover,
      stages: (h.path || []).length, tasks, recurring: (h.recurring || []).length, asNeeded: (h.asNeeded || []).length,
      areas: [...new Set((h.recurring || []).concat(h.asNeeded || []).map(j => j.area).filter(Boolean))],
      role: h.role ? Object.keys(h.role).filter(k => k.indexOf("x-") !== 0) : undefined,
      questions: (h.questions || []).length, sections: (h.sections || []).length,
      gaps: gaps(h).length, hasProgress: !!h.progress,
      ...(h.handover !== "1.0" || h.plan ? {
        profile: h.profile, audience: h.audience,
        people: (h.people || []).length, stakeholders: (h.stakeholders || []).length,
        overlap: h.plan ? C.overlap(h.plan) : undefined,
        steps: h.plan && h.plan.steps ? h.plan.steps.reduce((o, x) => (o[x.status] = (o[x.status] || 0) + 1, o), {}) : undefined,
        gates: h.plan ? Object.fromEntries(Object.entries(C.gates(h)).map(([k, g]) => [k, g.met ? "met" : g.left + " step(s) left"])) : undefined,
        asks: h.asks ? h.asks.reduce((o, a) => (o[a.status] = (o[a.status] || 0) + 1, o), {}) : undefined,
        askMinutes: h.asks ? C.askMinutes(h) : undefined,
        records: Object.fromEntries(["gaps", "inProgress", "rules", "decisions", "risks", "systems", "documents"].filter(k => h[k]).map(k => [k, { open: h[k].filter(x => !x.closed).length, closed: h[k].filter(x => x.closed).length }])),
        openGapItems: C.gapCounts(h).openItems
      } : {}),
      cadences: (h.recurring || []).reduce((o, r) => (o[r.every] = (o[r.every] || 0) + 1, o), {})
    }, null, 2));
    break;
  }
  case "strip": {
    const profile = flag("--profile", "newcomer"), aud = flag("--audience", "");
    const h = read(args[0]); requireValid(h, args[0]);
    if (h.handover === "1.0" && !aud && profile === "newcomer") { write(C.contentOnly(h), args[1]); break; }
    let out;
    try { out = C.exportProfile(h, profile, aud ? aud.split(",").map(s => s.trim()) : undefined); } catch (e) { die(e.message); }
    const v = C.validate(out);
    if (v.errors.length) { console.error("The exported file would not be valid:"); v.errors.forEach(e => console.error("  - " + e)); process.exit(1); }
    write(out, args[1]);
    break;
  }
  case "render": {
    const h = read(args[0]); requireValid(h, args[0]);
    write(C.withRendered(h), args[1]);
    break;
  }
  case "export": {
    const kinds = flag("--items", "jobs,tasks").split(",").map(s => s.trim()).filter(Boolean);
    let format = flag("--format", ""); const title = flag("--title", "");
    const h = read(args[0]); requireValid(h, args[0]);
    const known = C.exportKinds(h, {closed: true, private: true}).map(k => k.key);
    const bad = kinds.filter(k => known.indexOf(k) < 0);
    if (bad.length) die(`Nothing to export for: ${bad.join(", ")}. This file has: ${known.join(", ") || "nothing"}.`);
    if (!format) format = args[1] ? path.extname(args[1]).slice(1).toLowerCase() || "md" : "md";
    const FORMATS = ["pdf", "docx", "xlsx", "md", "html"];
    if (FORMATS.indexOf(format) < 0) die("--format is one of " + FORMATS.join(", "));
    if ((format === "docx" || format === "xlsx") && !args[1]) die(`Give an output file for ${format}, e.g. items.${format}`);
    const doc = C.itemsDocument(h, {kinds, title: title || undefined, date: C.zoneParts(h.timezone).date});
    const out = {pdf: () => C.docPdf(doc, {timezone: h.timezone}), docx: () => Buffer.from(C.docDocx(doc)), xlsx: () => Buffer.from(C.docXlsx(doc)), md: () => C.docMarkdown(doc), html: () => C.docHtml(doc)}[format]();
    if (args[1]) { fs.writeFileSync(args[1], out); console.error("Wrote " + args[1]); } else process.stdout.write(out);
    break;
  }
  case "report": {
    const kind = flag("--kind", "jd"), since = flag("--since", undefined);
    let format = flag("--format", "");
    const h = read(args[0]); requireValid(h, args[0]);
    const kinds = C.reports.map(r => r.key);
    if (kinds.indexOf(kind) < 0) die("--kind is one of " + kinds.join(", "));
    if (!format) format = args[1] ? path.extname(args[1]).slice(1).toLowerCase() || "md" : "md";
    const FORMATS = ["pdf", "docx", "md", "html"];
    if (FORMATS.indexOf(format) < 0) die("--format is one of " + FORMATS.join(", "));
    if (format === "docx" && !args[1]) die("Give an output file for docx, e.g. job-description.docx");
    const doc = C.principalReport(h, kind, {date: C.zoneParts(h.timezone).date, since});
    const out = {pdf: () => C.docPdf(doc, {timezone: h.timezone}), docx: () => Buffer.from(C.docDocx(doc)), md: () => C.docMarkdown(doc), html: () => C.docHtml(doc)}[format]();
    if (args[1]) { fs.writeFileSync(args[1], out); console.error("Wrote " + args[1]); } else process.stdout.write(out);
    break;
  }
  case "merge": {
    const a = read(args[0]), b = read(args[1]);
    requireValid(a, args[0]); requireValid(b, args[1]);
    if (a.id !== b.id) die(`Different handovers: "${a.id}" and "${b.id}". Progress only merges between versions of the same id.`);
    const state = JSON.parse(JSON.stringify(a.progress || {tasks: {}, recurring: {}, notes: ""}));
    C.mergeProgress(state, b.progress);
    state.updated = new Date().toISOString();
    write(Object.assign({}, a, {progress: state}), args[2]);
    break;
  }
  default:
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 18).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(cmd ? 2 : 0);
}
