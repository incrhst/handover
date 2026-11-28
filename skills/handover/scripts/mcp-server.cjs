#!/usr/bin/env node
// An MCP server for the handovers in the Handover app's data folder, so Claude (Claude Desktop,
// Claude Code) or any other MCP client can read what's due, search the reference and fill gaps.
// It speaks MCP over stdio and needs only Node 16+ and core.js next to it. Nothing leaves the Mac.
//
//   node mcp-server.cjs
//
// The data folder is $HANDOVER_DATA, else the one chosen in the app's Settings, else ~/Documents/Handover.
// Changes go into handovers/<id>.handover the way a second person on a shared folder would make them:
// the open app sees the file change and merges it in. Each one is in the change log as made by an AI
// assistant, and new or edited records are marked "AI draft" for a person to check. Ticks stay in the app.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const C = require("./core.js");

const VERSION = "1.0.0";
// The app's settings (data folder, whose ticks, the handover open last). "none" ignores them, as the tests do.
const BUNDLE = process.env.HANDOVER_BUNDLE_ID || "com.incrementic.handover";
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/* ================= The data folder, as the app keeps it ================= */
// A setting left empty in Claude Desktop can arrive as the literal placeholder
const given = v => typeof v === "string" && v.trim() && v.indexOf("${") < 0 ? v.trim() : "";
function appDefault(key) {
  if (process.platform !== "darwin" || BUNDLE === "none") return "";
  try { return execFileSync("defaults", ["read", BUNDLE, key], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim(); } catch (e) { return ""; }
}
function expand(p) { return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p; }
function dataRoot() { return expand(given(process.env.HANDOVER_DATA) || appDefault("dataFolder") || path.join(os.homedir(), "Documents", "Handover")); }
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Whose ticks to read: the same name the app uses on this Mac
function reader() {
  const set = given(process.env.HANDOVER_READER) || appDefault("reader");
  if (ID.test(set)) return set;
  const raw = os.userInfo().username.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return ID.test(raw) ? raw : "me";
}
const handoversDir = () => path.join(dataRoot(), "handovers");
const fileOf = id => path.join(handoversDir(), id + ".handover");

function parse(text, where) {
  text = String(text).replace(/^﻿/, "").trim();
  const fence = text.match(/^```[a-z]*\s*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1];
  try { return JSON.parse(text); } catch (e) { throw new Error(where + " is not valid JSON: " + e.message); }
}
function library() {
  let names = [];
  try { names = fs.readdirSync(handoversDir()); } catch (e) { return []; }
  return names.filter(n => n.endsWith(".handover") && ID.test(n.slice(0, -9))).map(n => {
    const id = n.slice(0, -9);
    try { return { id, h: parse(fs.readFileSync(fileOf(id), "utf8"), n) }; } catch (e) { return { id, error: e.message }; }
  }).sort((a, b) => String(a.h ? a.h.title : a.id).localeCompare(String(b.h ? b.h.title : b.id)));
}
/* Which handover: the one asked for, else the only one, else the one last open in the app */
function pick(id) {
  const all = library().filter(x => x.h);
  const ids = all.map(x => x.id).join(", ") || "none";
  if (id) {
    if (!ID.test(id)) throw new Error("A handover id is lowercase letters, digits and hyphens. The handovers are: " + ids + ".");
    if (!fs.existsSync(fileOf(id))) throw new Error("No handover with the id " + id + " in " + handoversDir() + ". The handovers are: " + ids + ".");
    return id;
  }
  if (all.length === 1) return all[0].id;
  if (!all.length) throw new Error("There are no handovers in " + handoversDir() + " yet. Open a .handover file in the Handover app first.");
  const last = appDefault("lastHandover");
  if (last && all.some(x => x.id === last)) return last;
  throw new Error("There is more than one handover; say which: " + ids + ".");
}
function load(id) { return parse(fs.readFileSync(fileOf(id), "utf8"), id + ".handover"); }
function progressOf(id, h) {
  const dir = path.join(dataRoot(), "progress");
  for (const f of [path.join(dir, id + "." + reader() + ".json"), path.join(dir, id + ".json")]) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { /* try the next */ }
  }
  return h.progress || {};
}
const todayIn = h => C.zoneParts(h.timezone).date;

/* Change a handover: read it, apply change(h) -> {h, ...}, check the result is valid, and write it only if
   the file still holds what was read (otherwise read it again and redo the change). Same text format as the app. */
function update(id, change) {
  const file = fileOf(id);
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = fs.readFileSync(file, "utf8");
    const h = parse(before, id + ".handover");
    const result = change(h);
    const v = C.validate(result.h);
    if (v.errors.length) throw new Error("That change would leave the file invalid, so nothing was saved:\n- " + v.errors.join("\n- "));
    if (fs.readFileSync(file, "utf8") !== before) continue;
    const tmp = path.join(path.dirname(file), "." + id + ".handover." + process.pid + ".tmp");
    fs.writeFileSync(tmp, JSON.stringify(result.h, null, 2) + "\n");
    fs.renameSync(tmp, file);
    return result;
  }
  throw new Error("The file kept changing while saving (it is being edited elsewhere). Try again.");
}
const aiStamp = h => ({ source: "ai", date: todayIn(h) });

/* ================= What the tools return ================= */
function job(o) {
  const r = o.r, out = { id: r.id, job: r.text, date: o.date, cadence: C.cadence(r) };
  if (r.time) out.time = r.time;
  if (r.area) out.area = r.area;
  if (o.starts) out.onTheListSince = o.starts;
  if (o.daysLeft !== undefined) out.daysLeft = o.daysLeft;
  if (r.detail) out.detail = r.detail;
  return out;
}
function today(h, progress, date, days) {
  const sc = C.schedule(h, Object.assign({ firstSeen: date }, progress), date);
  // One entry per job, with every date it falls on (or its work starts on) in the coming days
  const upcoming = [];
  (h.recurring || []).forEach(r => {
    const dates = [];
    for (let i = 1; i <= days; i++) {
      const d = C.addDays(date, i);
      if (r.lead) { const due = C.addDays(d, r.lead); if (C.occursOn(r, due)) dates.push({ startOn: d, due }); }
      else if (C.occursOn(r, d)) dates.push(d);
    }
    if (!dates.length) return;
    const o = { id: r.id, job: r.text, cadence: C.cadence(r) };
    if (r.time) o.time = r.time;
    if (r.area) o.area = r.area;
    o[r.lead ? "workStarts" : "dates"] = dates;
    upcoming.push(o);
  });
  const ticks = progress.tasks || {}, firstWeeks = [];
  for (const s of h.path || []) {
    const open = (s.tasks || []).filter(t => !ticks[t.id]);
    if (open.length) { firstWeeks.push({ stage: s.title, open: open.map(t => ({ id: t.id, task: t.text, detail: t.detail })), done: s.tasks.length - open.length, of: s.tasks.length }); break; }
  }
  const out = { handover: h.title, date, timezone: h.timezone || undefined,
    overdue: sc.overdue.map(job), startNow: sc.start.filter(o => !o.done).map(job), dueToday: sc.due.map(o => Object.assign(job(o), { done: !!(progress.recurring || {})[o.r.id + "@" + date] })),
    ["next" + days + "Days"]: upcoming, firstWeeks: firstWeeks[0] || "All first-weeks tasks are ticked." };
  const g = C.gapCounts(h);
  if (g.todo || g.openItems) out.gaps = g.todo + " TODO gap(s) to fill, " + g.openItems + " open item(s) on the gaps list" + (g.blocking ? ", " + g.blocking + " blocking work" : "");
  return out;
}
function overview(h) {
  const parts = Object.keys(h).filter(k => k !== "progress" && k.indexOf("x-") !== 0 && h[k] !== undefined);
  const count = k => Array.isArray(h[k]) ? h[k].length : undefined;
  const records = {};
  ["gaps", "inProgress", "rules", "decisions", "risks", "systems", "documents"].forEach(k => { if (h[k]) records[k] = { open: h[k].filter(x => !x.closed).length, closed: h[k].filter(x => x.closed).length }; });
  if (h.decide && h.decide.cards) records.decide = { open: h.decide.cards.filter(x => !x.closed).length, closed: h.decide.cards.filter(x => x.closed).length };
  return {
    id: h.id, title: h.title, format: h.handover, timezone: h.timezone, updated: h.updated, summary: h.summary,
    role: h.role, plan: h.plan ? { prepStart: h.plan.prepStart, lastDay: h.plan.lastDay, firstDay: h.plan.firstDay, track: h.plan.track } : undefined,
    counts: { stages: count("path"), tasks: (h.path || []).reduce((n, s) => n + (s.tasks || []).length, 0), recurring: count("recurring"), asNeeded: count("asNeeded"), questions: count("questions"), sections: count("sections"), people: count("people"), stakeholders: count("stakeholders") },
    records, gaps: C.gapCounts(h),
    parts: parts, hint: "Call get_handover with parts, e.g. [\"recurring\", \"sections\"], for the items themselves."
  };
}
function search(h, query, limit) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new Error("Give some words to search for.");
  const hits = [];
  const consider = (where, text) => {
    const hay = text.toLowerCase();
    if (!terms.every(t => hay.indexOf(t) > -1)) return;
    const at = Math.max(0, hay.indexOf(terms[0]) - 80);
    hits.push({ where, text: (at ? "…" : "") + text.slice(at, at + 400) + (text.length > at + 400 ? "…" : "") });
  };
  // What people wrote, not the bookkeeping (who added it and when, who may see it)
  const META = /\.(added|addedBy|aiDrafted|visibleTo|contactVisibleTo|at|sent|answered|closed\.\w+)$/;
  C.textFields(h).filter(f => !META.test(f.where)).forEach(f => consider(f.where, f.text));
  (h.questions || []).forEach((q, i) => consider("questions[" + i + "] question", q.q + "\nAnswer: " + q.a));
  (h.sections || []).forEach((s, i) => consider("sections[" + i + "] (" + s.id + ") title", s.title || ""));
  const seen = new Set();
  const unique = hits.filter(x => !seen.has(x.where + x.text) && seen.add(x.where + x.text));
  return { query, found: unique.length, results: unique.slice(0, limit) };
}
function gapsOf(h) {
  return {
    todo: C.gapList(h).map(g => ({ key: g.key, where: g.label, what: g.what, line: g.line.trim() })),
    openOnGapsList: (h.gaps || []).filter(x => !x.closed).map(x => ({ id: x.id, text: x.text, blocks: !!x.blocks })),
    hint: "Fill a TODO gap with fill_gap and its key. Close an item on the gaps list with close_item (list \"gaps\")."
  };
}
function fieldsHelp(defs) {
  return defs.map(d => d.k + (d.req ? " (required)" : "") + ": " + (Array.isArray(d.t) ? d.t.map(x => x[0]).join(" | ") : d.t === "md" ? "text" : d.t === "bool" ? "true/false" : d.t) +
    (d.when ? " [only when " + d.when.k + " is " + d.when.is.join("/") + "]" : "")).join("; ");
}
function friendly(e) { return (e.field ? e.field + ": " : "") + e.message; }
function asText(v) { return typeof v === "string" ? v : JSON.stringify(v, (k, x) => x === undefined ? undefined : x, 2); }

/* ================= The tools ================= */
const HANDOVER = { type: "string", description: "The handover's id, from list_handovers. Leave it out when there is only one, or to use the one open in the app." };
const ADD_LISTS = Object.keys(C.addFields), EDIT_LISTS = ["path", "recurring", "asNeeded"].concat(Object.keys(C.addFields).filter(k => k !== "asNeeded")), CLOSE_LISTS = Object.keys(C.closeHow);
const REPORT_KINDS = C.reports.map(r => r.key);
const RO = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const tools = [
  { name: "list_handovers", title: "List handovers", annotations: RO,
    description: "The handovers in the Handover app's data folder, with how many gaps and open records each has. Start here.",
    inputSchema: { type: "object", properties: {} },
    run() {
      const all = library();
      return { dataFolder: dataRoot(), openInApp: appDefault("lastHandover") || undefined, handovers: all.map(x => x.h ? { id: x.id, title: x.h.title, format: x.h.handover, updated: x.h.updated, gaps: C.gapCounts(x.h) } : { id: x.id, error: x.error }) };
    } },
  { name: "get_today", title: "What's due", annotations: RO,
    description: "What to do now: overdue jobs, jobs whose lead time has started, jobs due today, the next days, and the open tasks of the current first-weeks stage. Uses the ticks made in the app on this Mac.",
    inputSchema: { type: "object", properties: { handover: HANDOVER, date: { type: "string", description: "YYYY-MM-DD; today in the handover's time zone if left out" }, days: { type: "integer", minimum: 1, maximum: 60, description: "How many days ahead to look (default 7)" } } },
    run(a) {
      const id = pick(a.handover), h = load(id), date = a.date || todayIn(h);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date is YYYY-MM-DD");
      return today(h, progressOf(id, h), date, a.days || 7);
    } },
  { name: "get_handover", title: "Read a handover", annotations: RO,
    description: "Read a handover, or chosen parts of it. Without parts: an overview (title, role, plan dates, counts, which parts the file has). With parts: those parts of the file as JSON, e.g. path (first weeks), recurring (regular jobs), asNeeded, questions, sections (the reference), people, stakeholders, plan, asks, gaps, inProgress, rules, decisions, risks, systems, documents, decide, history.",
    inputSchema: { type: "object", properties: { handover: HANDOVER, parts: { type: "array", items: { type: "string" }, description: "Top-level parts to return" } } },
    run(a) {
      const h = load(pick(a.handover));
      if (!a.parts || !a.parts.length) return overview(h);
      const out = {}, missing = [];
      a.parts.forEach(p => { if (p === "progress") return; if (h[p] === undefined) missing.push(p); else out[p] = h[p]; });
      if (missing.length) out.notInThisFile = missing;
      return out;
    } },
  { name: "search", title: "Search a handover", annotations: RO,
    description: "Find where something is written in a handover: the reference, answers to questions, tasks, jobs and records. Every word must appear.",
    inputSchema: { type: "object", required: ["query"], properties: { handover: HANDOVER, query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, description: "Most results to return (default 15)" } } },
    run(a) { return search(load(pick(a.handover)), a.query, a.limit || 15); } },
  { name: "list_gaps", title: "List gaps", annotations: RO,
    description: "What the handover still doesn't say: each {TODO: …} gap with the key fill_gap needs, and the open items on the gaps list.",
    inputSchema: { type: "object", properties: { handover: HANDOVER } },
    run(a) { return gapsOf(load(pick(a.handover))); } },
  { name: "make_report", title: "Report for the principal", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "A short report for the principal, worked out from the file and leaving out anything they may not see: " + C.reports.map(r => r.key + " (" + r.title + ")").join(", ") + ". Several kinds make one combined document. Returns Markdown; with save_to it also saves a PDF, Word, Markdown or HTML file.",
    inputSchema: { type: "object", properties: { handover: HANDOVER, kinds: { type: "array", items: { type: "string", enum: REPORT_KINDS }, description: "Default [\"jd\"]" }, title: { type: "string" }, since: { type: "string", description: "YYYY-MM-DD: what's been finished since this date" }, save_to: { type: "string", description: "An absolute path ending in .pdf, .docx, .md or .html. Won't overwrite a file." } } },
    run(a) {
      const h = load(pick(a.handover)), kinds = a.kinds && a.kinds.length ? a.kinds : ["jd"];
      if (kinds.some(k => REPORT_KINDS.indexOf(k) < 0)) throw new Error("kinds are " + REPORT_KINDS.join(", "));
      const doc = C.principalReports(h, kinds, { date: todayIn(h), since: a.since, title: a.title });
      const md = C.docMarkdown(doc);
      if (!a.save_to) return md;
      const out = expand(a.save_to), ext = path.extname(out).slice(1).toLowerCase();
      if (!path.isAbsolute(out)) throw new Error("save_to must be an absolute path.");
      if (["pdf", "docx", "md", "html"].indexOf(ext) < 0) throw new Error("save_to ends in .pdf, .docx, .md or .html");
      if (fs.existsSync(out)) throw new Error(out + " already exists. Choose another name.");
      const body = { pdf: () => C.docPdf(doc, { timezone: h.timezone }), docx: () => Buffer.from(C.docDocx(doc)), md: () => md, html: () => C.docHtml(doc) }[ext]();
      fs.writeFileSync(out, body);
      return "Saved " + out + "\n\n" + md;
    } },
  { name: "fill_gap", title: "Fill a gap", annotations: WRITE,
    description: "Replace one {TODO: …} gap with what's missing (one line). Get the key from list_gaps. Refuses passwords, PINs, codes, keys and card or bank numbers: write where they are kept and who grants access instead.",
    inputSchema: { type: "object", required: ["key", "text"], properties: { handover: HANDOVER, key: { type: "string" }, text: { type: "string" } } },
    run(a) {
      const id = pick(a.handover);
      update(id, h => {
        if (!C.gapList(h).some(g => g.key === a.key)) throw new Error("No gap with the key " + a.key + ". Call list_gaps for the current keys: they change as gaps are filled.");
        return C.fillGaps(h, { [a.key]: a.text }, aiStamp(h));
      });
      return "Filled the gap in " + id + ". It is in the change log as made by an AI assistant.";
    } },
  { name: "add_record", title: "Add a record", annotations: WRITE,
    description: "Record something new, marked as an AI draft for a person to check. Lists and their fields: " + ADD_LISTS.map(l => l + " { " + fieldsHelp(C.addFields[l]) + " }").join(". ") + ". Never passwords, PINs, codes, keys or card or bank numbers.",
    inputSchema: { type: "object", required: ["list", "fields"], properties: { handover: HANDOVER, list: { type: "string", enum: ADD_LISTS }, fields: { type: "object", description: "Field values, by the names above" } } },
    run(a) {
      const id = pick(a.handover);
      const r = update(id, h => C.addItem(h, a.list, a.fields || {}, aiStamp(h)));
      return "Added " + a.list + " item " + r.id + " to " + id + ", marked as an AI draft.";
    } },
  { name: "edit_item", title: "Edit an item", annotations: WRITE,
    description: "Correct an item: a first-weeks task (path), a regular job (recurring), a job done as needed (asNeeded) or a record (" + EDIT_LISTS.slice(3).join(", ") + "). Give only the fields to change; null or \"\" clears one. Keeps its id, ticks and history. Regular job fields: " + fieldsHelp(C.editFields("recurring")) + ".",
    inputSchema: { type: "object", required: ["list", "id", "fields"], properties: { handover: HANDOVER, list: { type: "string", enum: EDIT_LISTS }, id: { type: "string" }, fields: { type: "object" } } },
    run(a) {
      const id = pick(a.handover);
      const r = update(id, h => {
        const was = C.editValues(h, a.list, a.id);
        if (!was) throw new Error("No " + a.list + " item with the id " + a.id + ".");
        const values = Object.assign({}, was);
        Object.keys(a.fields || {}).forEach(k => { values[k] = a.fields[k] === null ? "" : a.fields[k]; });
        return C.editItem(h, a.list, a.id, values, aiStamp(h));
      });
      return "Changed " + r.changed.join(", ") + " of " + a.list + " item " + a.id + " in " + id + ".";
    } },
  { name: "close_item", title: "Close a record", annotations: WRITE,
    description: "Mark a record fixed, done, answered, handed to the principal or no longer needed. Ways to close each list: " + CLOSE_LISTS.map(l => l + ": " + C.closeHow[l].join("/")).join("; ") + ". fix says what was done (one line, never a secret).",
    inputSchema: { type: "object", required: ["list", "id", "how"], properties: { handover: HANDOVER, list: { type: "string", enum: CLOSE_LISTS }, id: { type: "string" }, how: { type: "string", enum: Object.keys(C.closeLabel) }, fix: { type: "string" } } },
    run(a) {
      const id = pick(a.handover);
      update(id, h => ({ h: C.closeItem(h, a.list, a.id, Object.assign({ how: a.how, fix: a.fix }, aiStamp(h))) }));
      return "Closed " + a.list + " item " + a.id + " in " + id + " (" + C.closeLabel[a.how].toLowerCase() + ").";
    } },
  { name: "reopen_item", title: "Reopen a record", annotations: WRITE,
    description: "Undo close_item: the record is open again.",
    inputSchema: { type: "object", required: ["list", "id"], properties: { handover: HANDOVER, list: { type: "string", enum: CLOSE_LISTS }, id: { type: "string" } } },
    run(a) {
      const id = pick(a.handover);
      update(id, h => ({ h: C.reopenItem(h, a.list, a.id, aiStamp(h)) }));
      return "Reopened " + a.list + " item " + a.id + " in " + id + ".";
    } }
];

const INSTRUCTIONS = "These tools read and change the handovers in the Handover Mac app. A handover is one role being passed from an outgoing person to an incoming one: a first-weeks path, regular jobs, a reference and records. Start with list_handovers, then get_today for what to do now. " +
  "Every change is saved to the file and logged as made by an AI assistant, and records you add or edit show as AI drafts; tell the person what you changed. " +
  "Never put passwords, PINs, codes, keys or card or bank numbers in a handover: say where they are kept and who grants access. Ticking jobs and tasks off stays with the person, in the app.";

/* ================= MCP over stdio: one JSON-RPC message per line ================= */
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function handle(msg) {
  const { id, method, params } = msg;
  const reply = result => { if (id !== undefined) send({ jsonrpc: "2.0", id, result }); };
  const fail = (code, message) => { if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code, message } }); };
  switch (method) {
    case "initialize": {
      const asked = params && params.protocolVersion;
      return reply({ protocolVersion: PROTOCOLS.indexOf(asked) > -1 ? asked : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: "handover", title: "Handover", version: VERSION }, instructions: INSTRUCTIONS });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: tools.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });
    case "tools/call": {
      const tool = tools.find(t => t.name === (params && params.name));
      if (!tool) return fail(-32602, "Unknown tool: " + (params && params.name));
      try { return reply({ content: [{ type: "text", text: asText(tool.run((params && params.arguments) || {})) }] }); }
      catch (e) { return reply({ content: [{ type: "text", text: friendly(e) }], isError: true }); }
    }
    default:
      if (method && method.indexOf("notifications/") === 0) return;
      return fail(-32601, "Method not found: " + method);
  }
}

if (require.main === module) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) > -1) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
      (Array.isArray(msg) ? msg : [msg]).forEach(m => { try { handle(m); } catch (e) { if (m && m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: e.message } }); } });
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
module.exports = { tools, handle };
