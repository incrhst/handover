// Tests for the MCP server (skills/handover/scripts/mcp-server.cjs): node --test test/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const C = require("../app/web/core.js");

const root = path.join(__dirname, "..");
const server = path.join(root, "skills/handover/scripts/mcp-server.cjs");
const EA = "example-holdings-ea-to-ceo", STUDIO = "example-studio-ops-lead";

/* A data folder laid out as the app keeps it, holding the given examples */
const made = [];
test.after(() => made.forEach(d => fs.rmSync(d, { recursive: true, force: true })));
function folder(examples = ["ea-no-overlap", "sample"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handover-mcp-"));
  made.push(dir);
  fs.mkdirSync(path.join(dir, "handovers"));
  examples.forEach(name => {
    const text = fs.readFileSync(path.join(root, "site/examples", name + ".handover"), "utf8");
    fs.writeFileSync(path.join(dir, "handovers", JSON.parse(text).id + ".handover"), text);
  });
  return dir;
}
/* Send messages to a fresh server over stdio; returns its replies by id (notifications get none) */
function session(dir, messages, env = {}) {
  const input = messages.map((m, i) => JSON.stringify(Object.assign({ jsonrpc: "2.0" }, m.method.startsWith("notifications/") ? {} : { id: m.id || i + 1 }, m)) + "\n").join("");
  const r = spawnSync(process.execPath, [server], { input, encoding: "utf8", env: Object.assign({}, process.env, { HANDOVER_DATA: dir, HANDOVER_BUNDLE_ID: "none", HANDOVER_READER: "tester" }, env) });
  assert.equal(r.status, 0, r.stderr);
  const replies = r.stdout.split("\n").filter(Boolean).map(l => JSON.parse(l));
  return { replies, byId: Object.fromEntries(replies.map(x => [x.id, x])) };
}
const call = (name, args = {}) => ({ method: "tools/call", params: { name, arguments: args } });
/* One tool call: {text, error, json} */
function tool(dir, name, args, env) {
  const res = session(dir, [call(name, args)], env).byId[1].result;
  let json; try { json = JSON.parse(res.content[0].text); } catch (e) { /* plain text */ }
  return { text: res.content[0].text, error: !!res.isError, json };
}
const read = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, "handovers", id + ".handover"), "utf8"));
const lastChange = h => h.history[h.history.length - 1];

test("initialize agrees a protocol version, lists the tools, and answers nothing to notifications", () => {
  const dir = folder();
  const { replies, byId } = session(dir, [
    { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { method: "notifications/initialized" },
    { id: 2, method: "tools/list" },
    { id: 3, method: "initialize", params: { protocolVersion: "1999-01-01" } },
    { id: 4, method: "nonsense" },
    { id: 5, method: "ping" }
  ]);
  assert.equal(replies.length, 5);
  assert.equal(byId[1].result.protocolVersion, "2025-06-18");
  assert.equal(byId[1].result.serverInfo.name, "handover");
  assert.match(byId[1].result.instructions, /passwords/);
  assert.equal(byId[3].result.protocolVersion, "2025-11-25");
  assert.equal(byId[4].error.code, -32601);
  assert.deepEqual(byId[5].result, {});
  const tools = byId[2].result.tools;
  assert.deepEqual(tools.map(t => t.name), ["list_handovers", "get_today", "get_handover", "search", "list_gaps", "make_report", "fill_gap", "add_record", "edit_item", "close_item", "reopen_item"]);
  tools.forEach(t => { assert.equal(t.inputSchema.type, "object", t.name); assert.equal(typeof t.annotations.readOnlyHint, "boolean", t.name); });
  assert.deepEqual(tools.filter(t => t.annotations.readOnlyHint).map(t => t.name), ["list_handovers", "get_today", "get_handover", "search", "list_gaps"]);
});

test("the server answers when another script loads it, as Claude Desktop's Node does", () => {
  const dir = folder(["ea-no-overlap"]);
  const input = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n";
  const r = spawnSync(process.execPath, ["-e", "require(process.argv[1])", server], { input, encoding: "utf8", timeout: 10000, env: Object.assign({}, process.env, { HANDOVER_DATA: dir, HANDOVER_BUNDLE_ID: "none" }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout.trim()).result.serverInfo.name, "handover");
  assert.match(r.stderr, /Handover MCP server .*, data folder /, "says on stderr that it started, for the client's log");
});

test("list_handovers lists the folder, and a call without an id says which handovers there are", () => {
  const dir = folder();
  const list = tool(dir, "list_handovers").json;
  assert.equal(list.dataFolder, dir);
  assert.deepEqual(list.handovers.map(x => x.id).sort(), [EA, STUDIO].sort());
  const none = tool(dir, "get_today");
  assert.ok(none.error);
  assert.match(none.text, /more than one handover/);
  assert.match(none.text, new RegExp(EA));
  assert.ok(!tool(folder(["ea-no-overlap"]), "get_today").error, "with only one handover, the id can be left out");
  const bad = tool(dir, "get_today", { handover: "../etc" });
  assert.ok(bad.error);
});

test("get_today lists the jobs for a date, once per job, and leaves out the tasks ticked in the app", () => {
  const dir = folder(["ea-no-overlap"]);
  const before = tool(dir, "get_today", { date: "2026-12-01", days: 7 }).json;
  assert.equal(before.date, "2026-12-01");
  const ids = before.next7Days.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, "each job once");
  assert.ok(before.next7Days.find(x => x.id === "inbox").dates.length >= 4);
  const first = before.firstWeeks.open[0].id;
  fs.mkdirSync(path.join(dir, "progress"));
  fs.writeFileSync(path.join(dir, "progress", EA + ".tester.json"), JSON.stringify({ firstSeen: "2026-11-01", tasks: { [first]: "2026-11-02T09:00:00Z" }, recurring: {} }));
  const after = tool(dir, "get_today", { date: "2026-12-01" }).json;
  assert.ok(!after.firstWeeks.open.some(t => t.id === first));
  assert.equal(after.firstWeeks.done, before.firstWeeks.done + 1);
});

test("get_handover gives an overview, or the parts asked for, never the progress", () => {
  const dir = folder(["ea-no-overlap"]);
  const o = tool(dir, "get_handover").json;
  assert.equal(o.id, EA);
  assert.ok(o.parts.includes("recurring"));
  assert.ok(o.records.risks.open > 0);
  const p = tool(dir, "get_handover", { parts: ["rules", "progress", "nothing-here"] }).json;
  assert.equal(p.rules.length, read(dir, EA).rules.length);
  assert.equal(p.progress, undefined);
  assert.deepEqual(p.notInThisFile, ["nothing-here"]);
});

test("search finds what people wrote, not the bookkeeping", () => {
  const dir = folder(["ea-no-overlap"]);
  const r = tool(dir, "search", { query: "flight cancelled" }).json;
  assert.ok(r.found > 0);
  assert.ok(r.results.some(x => /flight/i.test(x.text)));
  assert.ok(!tool(dir, "search", { query: "travel" }).json.results.some(x => /\.added$/.test(x.where)));
  assert.ok(tool(dir, "search", { query: "" }).error);
});

test("fill_gap fills one gap, logs it as an AI change, and saves the file as the app does", () => {
  const dir = folder(["ea-no-overlap"]);
  const gaps = tool(dir, "list_gaps").json;
  const gap = gaps.todo.find(g => g.key.startsWith("systems."));
  const r = tool(dir, "fill_gap", { key: gap.key, text: "IT grants editor access; Joy approves" });
  assert.ok(!r.error, r.text);
  const h = read(dir, EA);
  assert.deepEqual(C.validate(h).errors, []);
  assert.equal(C.gapCounts(h).todo, gaps.todo.length - 1);
  assert.equal(lastChange(h).source, "ai");
  assert.match(lastChange(h).text, /by an AI assistant/);
  const text = fs.readFileSync(path.join(dir, "handovers", EA + ".handover"), "utf8");
  assert.equal(text, JSON.stringify(h, null, 2) + "\n");
  assert.deepEqual(fs.readdirSync(path.join(dir, "handovers")), [EA + ".handover"], "no temporary file left behind");
  const stale = tool(dir, "fill_gap", { key: gap.key, text: "again" });
  assert.ok(stale.error);
  assert.match(stale.text, /list_gaps/);
});

test("the server refuses secrets and leaves the file as it was", () => {
  const dir = folder(["ea-no-overlap"]);
  const was = fs.readFileSync(path.join(dir, "handovers", EA + ".handover"), "utf8");
  const key = tool(dir, "list_gaps").json.todo[0].key;
  const a = tool(dir, "fill_gap", { key, text: "password: Tr0ub4dor&3" });
  assert.ok(a.error); assert.match(a.text, /password/i);
  const b = tool(dir, "add_record", { list: "systems", fields: { name: "Bank", credentialLocation: "card 4111 1111 1111 1111" } });
  assert.ok(b.error); assert.match(b.text, /card number/);
  assert.equal(fs.readFileSync(path.join(dir, "handovers", EA + ".handover"), "utf8"), was);
});

test("add_record adds an AI draft; edit_item changes only the fields given", () => {
  const dir = folder(["ea-no-overlap"]);
  const added = tool(dir, "add_record", { list: "rules", fields: { text: "If the CEO's car is late, call the driver first", situation: "Principal travelling" } });
  assert.ok(!added.error, added.text);
  let h = read(dir, EA);
  const rule = h.rules[h.rules.length - 1];
  assert.equal(rule.aiDrafted, true);
  assert.ok(rule.added);
  assert.equal(lastChange(h).source, "ai");
  assert.match(lastChange(h).text, /^Added rule .* by an AI assistant\.$/);

  const job = h.recurring.find(r => r.id === "diary-review");
  const edited = tool(dir, "edit_item", { list: "recurring", id: "diary-review", fields: { time: "16:30" } });
  assert.ok(!edited.error, edited.text);
  h = read(dir, EA);
  const now = h.recurring.find(r => r.id === "diary-review");
  assert.equal(now.time, "16:30");
  assert.equal(now.text, job.text);
  assert.equal(now.every, job.every);
  assert.match(edited.text, /time/);

  const sys = tool(dir, "edit_item", { list: "systems", id: "diary", fields: { purpose: "The CEO's calendar" } });
  assert.ok(!sys.error, sys.text);
  assert.equal(read(dir, EA).systems.find(s => s.id === "diary").aiDrafted, true, "an AI edit is marked for a person to check");
  assert.ok(tool(dir, "edit_item", { list: "systems", id: "no-such", fields: { purpose: "x" } }).error);
});

test("close_item and reopen_item close and reopen a record", () => {
  const dir = folder(["ea-no-overlap"]);
  const c = tool(dir, "close_item", { list: "gaps", id: "travel-booking", how: "fixed", fix: "IT added booking rights on 28 Nov" });
  assert.ok(!c.error, c.text);
  let item = read(dir, EA).gaps.find(g => g.id === "travel-booking");
  assert.equal(item.closed.how, "fixed");
  assert.ok(tool(dir, "close_item", { list: "gaps", id: "travel-booking", how: "fixed" }).error, "already closed");
  assert.ok(!tool(dir, "reopen_item", { list: "gaps", id: "travel-booking" }).error);
  item = read(dir, EA).gaps.find(g => g.id === "travel-booking");
  assert.equal(item.closed, undefined);
  assert.equal(lastChange(read(dir, EA)).source, "ai");
});

test("make_report returns Markdown, and saves a file without overwriting one", () => {
  const dir = folder(["ea-no-overlap"]);
  const md = tool(dir, "make_report", { kinds: ["jd"] });
  assert.ok(!md.error, md.text);
  assert.match(md.text, /^# /m);
  const out = path.join(dir, "jd.md");
  assert.ok(!tool(dir, "make_report", { kinds: ["working", "needs"], save_to: out }).error);
  assert.ok(fs.statSync(out).size > 100);
  assert.ok(tool(dir, "make_report", { save_to: out }).error, "won't overwrite");
  assert.ok(tool(dir, "make_report", { save_to: "relative.md" }).error);
  assert.ok(tool(dir, "make_report", { kinds: ["nope"] }).error);
});

test("a format 1.0 file can be read but has no records to add", () => {
  const dir = folder(["sample"]);
  assert.ok(!tool(dir, "get_today").error);
  const r = tool(dir, "add_record", { list: "rules", fields: { text: "x" } });
  assert.ok(r.error); assert.match(r.text, /1\.0/);
});

test("changes made in the app are still logged as the app's", () => {
  const h = JSON.parse(fs.readFileSync(path.join(root, "site/examples/ea-no-overlap.handover"), "utf8"));
  const r = C.addItem(h, "rules", { text: "A rule" }, { date: "2026-11-28" });
  const rec = r.h.rules.find(x => x.id === r.id);
  assert.equal(rec.aiDrafted, undefined);
  assert.equal(lastChange(r.h).source, "app");
  assert.match(lastChange(r.h).text, /in the app/);
  const e = C.editItem(h, "systems", "diary", Object.assign(C.editValues(h, "systems", "diary"), { purpose: "Calendar" }), {});
  assert.equal(e.h.systems.find(s => s.id === "diary").aiDrafted, undefined);
});

test("the extension bundle's manifest lists every tool the server has", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "app/mcp/manifest.json"), "utf8"));
  assert.equal(m.server.entry_point, "server/mcp-server.cjs");
  assert.equal(m.tools, "__TOOLS__", "filled in by scripts/build-mcpb.sh from the server");
  assert.ok(m.compatibility.platforms.includes("darwin"));
});
