#!/usr/bin/env node
// Command-line tools for handover files (.handover, format 1.x). Needs only Node 16+.
//
//   node handover.cjs check <file>             validate; exit 1 with path-precise errors
//   node handover.cjs gaps <file>              list every TODO gap and where it is
//   node handover.cjs due <file> [YYYY-MM-DD] [--days N]
//                                              what is overdue, due and coming up
//   node handover.cjs summary <file>           counts of stages, tasks, duties, questions, sections, gaps
//   node handover.cjs strip <file> [out]       remove progress, for sharing with someone new
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

// Every markdown field, with a readable location
function textFields(h) {
  const out = [];
  const add = (where, v) => { if (typeof v === "string") out.push([where, v]); };
  add("summary", h.summary);
  (h.path || []).forEach((s, i) => {
    add(`path[${i}] "${s.title}" summary`, s.summary);
    if (s.tip) add(`path[${i}] "${s.title}" tip`, s.tip.text);
    (s.tasks || []).forEach((t, j) => { add(`path[${i}].tasks[${j}] (${t.id}) text`, t.text); add(`path[${i}].tasks[${j}] (${t.id}) detail`, t.detail); });
  });
  (h.recurring || []).forEach((r, i) => { add(`recurring[${i}] (${r.id}) text`, r.text); add(`recurring[${i}] (${r.id}) detail`, r.detail); });
  (h.questions || []).forEach((q, i) => add(`questions[${i}] "${q.q}"`, q.a));
  (h.sections || []).forEach((s, i) => add(`sections[${i}] (${s.id}) body`, s.body));
  return out;
}
function gaps(h) {
  const found = [];
  for (const [where, text] of textFields(h)) {
    for (const line of text.split("\n")) {
      for (const m of line.matchAll(/\{TODO:\s*([^}]*)\}/g)) found.push([where, m[1].trim() || "(no description)"]);
      // A cell or line that starts with TODO:
      for (const cell of line.split("|")) { const m = cell.trim().match(/^TODO:\s*(.*)$/); if (m) found.push([where, m[1].trim() || "(no description)"]); }
      if (!line.includes("|")) { const m = line.match(/(?:^|\s)TODO:\s*(.*)$/); if (m && !/^\s*TODO:/.test(line) && !/\{TODO:/.test(line)) found.push([where, m[1].trim()]); }
    }
  }
  return found;
}

const [cmd, ...args] = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };

switch (cmd) {
  case "check": {
    const h = read(args[0]);
    const v = requireValid(h, args[0]);
    v.warnings.forEach(w => console.error("warning: " + w));
    const g = gaps(h).length;
    console.log(`${args[0]}: valid handover ${h.handover} "${h.title}"` + (g ? `, ${g} gap(s) still to fill` : ", no gaps"));
    break;
  }
  case "gaps": {
    const h = read(args[0]);
    const g = gaps(h);
    if (!g.length) { console.log("No gaps."); break; }
    g.forEach(([where, what]) => console.log(`- ${where}: ${what}`));
    console.log(`${g.length} gap(s).`);
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
      stages: (h.path || []).length, tasks, recurring: (h.recurring || []).length,
      questions: (h.questions || []).length, sections: (h.sections || []).length,
      gaps: gaps(h).length, hasProgress: !!h.progress,
      cadences: (h.recurring || []).reduce((o, r) => (o[r.every] = (o[r.every] || 0) + 1, o), {})
    }, null, 2));
    break;
  }
  case "strip": {
    const h = read(args[0]); requireValid(h, args[0]);
    write(C.contentOnly(h), args[1]);
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
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 12).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(cmd ? 2 : 0);
}
