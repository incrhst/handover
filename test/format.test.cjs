// Tests for the handover format: node --test test/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const C = require("../app/web/core.js");
const { check } = require("./minischema.cjs");

const root = path.join(__dirname, "..");
const json = f => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const sample = () => json("site/examples/sample.handover");
const ea = () => json("site/examples/ea-no-overlap.handover");
const schema = { latest: json("site/schema/v1.json"), v10: json("site/schema/v1.0.json"), v11: json("site/schema/v1.1.json") };
const errorsOf = h => C.validate(h).errors;
const expectError = (h, re) => { const e = errorsOf(h); assert.ok(e.some(x => re.test(x)), "expected an error matching " + re + ", got:\n" + e.join("\n")); };

test("the 1.0 sample still passes, with no warnings", () => {
  assert.deepEqual(C.validate(sample()), { errors: [], warnings: [] });
});
test("the 1.0 sample is valid against the newest schema and both frozen copies", () => {
  for (const [name, s] of Object.entries(schema)) assert.deepEqual(check(s, sample()), [], name);
});
test("the 1.0 sample's gap count is unchanged", () => {
  assert.equal(C.gapCounts(sample()).todo, 7);
});

test("the no-overlap EA example passes, with no warnings", () => {
  assert.deepEqual(C.validate(ea()), { errors: [], warnings: [] });
});
test("the EA example is valid against the newest schema and the frozen 1.1 schema", () => {
  assert.deepEqual(check(schema.latest, ea()), []);
  assert.deepEqual(check(schema.v11, ea()), []);
});
test("the frozen 1.0 schema rejects the 1.1 example, as it should", () => {
  assert.ok(check(schema.v10, ea()).length > 0);
});
test("the EA example is the no-overlap reference case and uses every 1.1 field", () => {
  const h = ea();
  assert.equal(C.overlap(h.plan), false);
  const topLevel = ["audience", "profile", "people", "stakeholders", "plan", "asks", "gaps", "inProgress", "rules", "decisions", "risks", "systems", "documents", "decide", "finalCheck", "signoff", "followUps", "catchUps", "history", "rendered"];
  for (const k of topLevel) assert.ok(h[k] !== undefined, k);
  // every property defined for a 1.1 object appears somewhere in the example
  const seen = new Set();
  (function walk(v) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const k of Object.keys(v)) { seen.add(k); walk(v[k]); } })(h);
  const defs = ["person", "stakeholder", "plan", "step", "ask", "gap", "inProgress", "rule", "decision", "risk", "system", "document", "decide", "card", "finalCheck", "signoff", "followUp", "catchUp", "historyEntry", "closed", "checks", "money"];
  for (const d of defs) for (const k of Object.keys(schema.latest.$defs[d].properties)) assert.ok(seen.has(k), `${d}.${k} is not used in the example`);
  assert.ok(seen.has("hours") && seen.has("paid"), "from.hours and from.paid");
  // a recurring risk with an exact day
  const r = h.risks.find(x => x.recurring && x.list === "weekly");
  assert.ok(r, "a weekly risk linked to a recurring duty");
  assert.equal(h.recurring.find(x => x.id === r.recurring).every, "week");
  // at least one TODO gap
  assert.ok(C.gapCounts(h).todo >= 1);
});
test("every 1.1 schema object allows x- fields and rejects unknown ones", () => {
  for (const [name, d] of Object.entries(schema.latest.$defs)) if (d.type === "object") {
    assert.equal(d.additionalProperties, false, name);
    assert.deepEqual(d.patternProperties, { "^x-": true }, name);
  }
});

test("gap counts cover the new fields and skip the sections written for 1.0 readers", () => {
  const c = C.gapCounts(ea());
  assert.deepEqual(c.byArea, { path: 1, systems: 1 });
  assert.equal(c.openItems, 1);
  assert.equal(c.blocking, 1);
  const h = ea(); h.stakeholders[0].involve = "TODO: when to involve Ravi"; h.asks[0].default = "Stands {TODO: confirm}";
  assert.deepEqual(C.gapCounts(h).byArea, { path: 1, systems: 1, stakeholders: 1, asks: 1 });
});

test("ids must be unique within each new list", () => {
  const lists = [["people", h => h.people], ["stakeholders", h => h.stakeholders], ["plan.steps", h => h.plan.steps], ["asks", h => h.asks],
    ["gaps", h => h.gaps], ["inProgress", h => h.inProgress], ["rules", h => h.rules], ["decisions", h => h.decisions], ["risks", h => h.risks],
    ["systems", h => h.systems], ["documents", h => h.documents], ["decide.cards", h => h.decide.cards], ["finalCheck", h => h.finalCheck],
    ["signoff.notes", h => h.signoff.notes], ["followUps", h => h.followUps], ["catchUps", h => h.catchUps], ["history", h => h.history]];
  for (const [name, get] of lists) {
    const h = ea(), l = get(h);
    if (name === "people") { l.push({ id: l[0].id, name: "Someone else", roles: ["facilitator"] }); l.splice(3, 1); }
    else l.push(JSON.parse(JSON.stringify(l[l.length - 1])));
    expectError(h, new RegExp("^" + name.replace(".", "\\.") + "\\[\\d+\\]\\.id: .* is used twice"));
  }
});
test("ids follow the id pattern", () => {
  const h = ea(); h.rules[0].id = "Chair Calls"; expectError(h, /^rules\[0\]\.id: must be an id/);
});

test("every cross-reference must resolve", () => {
  let h = ea(); h.risks[0].recurring = "no-such-duty"; expectError(h, /risks\[0\]\.recurring: no recurring duty has id "no-such-duty"/);
  h = ea(); h.plan.steps.find(s => s.ask).ask = "limits"; h.asks = h.asks.filter(a => a.id !== "limits"); expectError(h, /\.ask: no ask has id "limits"/);
  h = ea(); h.decide.cards.find(c => c.approver && c.approver.stakeholder).approver.stakeholder = "nobody"; expectError(h, /approver\.stakeholder: no stakeholder has id "nobody"/);
  h = ea(); h.rendered.push("missing-section"); expectError(h, /rendered\[\d+\]: no section has id "missing-section"/);
  h = ea(); delete h.asks; expectError(h, /\.ask: no ask has id .* \(the file has no asks\)/);
});

test("1.1 rules: reasons, corrections, failing checks, documents, roles, approvers", () => {
  let h = ea(); delete h.plan.steps.find(s => s.status === "na").reason; expectError(h, /reason: required when status is na/);
  h = ea(); delete h.asks.find(a => a.status === "corrected").correction; expectError(h, /correction: required when status is corrected/);
  h = ea(); const f = h.finalCheck.find(x => x.result === "fail"); delete f.owner; delete f.due; expectError(h, /owner: required when the check fails/); expectError(h, /due: required when the check fails/);
  h = ea(); delete h.documents.find(d => d.type === "protected").location; expectError(h, /needs a url, or a location/);
  h = ea(); h.people[1].roles.push("principal"); expectError(h, /"principal" is already held by/);
  h = ea(); h.decide.cards.find(c => c.approver).approver = { role: "principal", stakeholder: "cfo" }; expectError(h, /approver: give either a role or a stakeholder/);
  h = ea(); h.gaps[0].closed.how = "done"; expectError(h, /gaps\[0\]\.closed\.how: a gaps item closes as fixed, answered, principal/);
  h = ea(); h.plan.steps[0].status = "finished"; expectError(h, /status: must be one of open, done, na/);
  h = ea(); h.decide.cards[1].limit.currency = "usd"; expectError(h, /currency: must be a three-letter currency code/);
  h = ea(); delete h.plan.lastDay; expectError(h, /plan\.lastDay: required/);
});

test("visibility: nothing the audience may not see", () => {
  let h = ea(); delete h.audience; expectError(h, /visibleTo: the file has no audience/); expectError(h, /contactVisibleTo: the file has no audience/);
  h = ea(); h.audience = ["outgoing", "incoming"]; expectError(h, /stakeholders\[5\]\.visibleTo: the audience includes incoming/);
});

test("versions: newer minors warn, a 1.0 file using 1.1 fields warns, 1.0 stays strict", () => {
  let h = sample(); h.handover = "1.2"; h.somethingNew = true; h.recurring[0].alsoNew = 1;
  let v = C.validate(h); assert.deepEqual(v.errors, []); assert.ok(v.warnings.length === 2, v.warnings.join("\n"));
  h = ea(); h.handover = "1.0"; v = C.validate(h); assert.deepEqual(v.errors, []); assert.ok(v.warnings.some(w => /says "1\.0" but uses 1\.1 fields/.test(w)));
  h = sample(); h.somethingNew = true; expectError(h, /^somethingNew: not a known field/);
  h = ea(); h.plan.unknown = 1; expectError(h, /^plan\.unknown: not a known field/);
  h = ea(); h.plan["x-desk-mode"] = "no-overlap"; assert.deepEqual(errorsOf(h), []);
  h = sample(); h.handover = "2.0"; expectError(h, /reads format version 1\.x/);
});

test("newcomer profile: knowledge only, nothing restricted, nothing about the process", () => {
  const out = C.exportProfile(ea(), "newcomer");
  assert.deepEqual(C.validate(out), { errors: [], warnings: [] });
  assert.deepEqual(check(schema.latest, out), []);
  assert.equal(out.profile, "newcomer"); assert.deepEqual(out.audience, ["incoming"]);
  for (const k of ["progress", "plan", "asks", "finalCheck", "signoff", "followUps", "catchUps", "history"]) assert.equal(out[k], undefined, k);
  const text = JSON.stringify(out);
  for (const k of ["visibleTo", "contactVisibleTo", "aiDrafted", "addedBy", "\"added\"", "\"closed\"", "\"paid\""]) assert.ok(!text.includes(k), k);
  assert.ok(!text.includes("Sam Whitfield"), "restricted stakeholder left out, rendered sections included");
  assert.equal(out.stakeholders.find(s => s.id === "chair").contact, undefined, "restricted contact left out");
  assert.ok(out.gaps.every(g => !g.closed) && out.gaps.length === 1);
  assert.deepEqual(out.rendered.filter(id => !out.sections.some(s => s.id === id)), []);
});
test("record profile for another audience leaves out what they may not see", () => {
  const out = C.exportProfile(ea(), "record", ["incoming"]);
  assert.deepEqual(errorsOf(out), []);
  assert.ok(out.plan && out.asks && out.history, "process state kept");
  assert.ok(!JSON.stringify(out).includes("Sam Whitfield"));
  assert.ok(!out.gaps.some(g => g.id === "evenings-line"), "principal-only gap left out");
  assert.ok(out.gaps.some(g => g.closed), "closed items kept in the record");
});
test("rendering for 1.0 readers is stable and replaces only the rendered sections", () => {
  const h = ea(), once = C.withRendered(h), twice = C.withRendered(once);
  assert.deepEqual(twice, once);
  assert.deepEqual(once, h, "the example's rendered sections are up to date (run: handover.cjs render)");
  assert.ok(once.sections.some(s => s.id === "how-dana-works"), "authored sections kept");
});

test("worked-out values: overlap, phases, gates and minutes", () => {
  assert.equal(C.overlap({ prepStart: "2026-01-05", firstDay: "2026-01-20", lastDay: "2026-01-30" }), true);
  assert.equal(C.overlap({ prepStart: "2026-01-05", lastDay: "2026-01-30" }), false);
  assert.equal(C.phaseLabel("shadow", false), "Incoming starts");
  assert.equal(C.phaseLabel("swap", true), "Swap");
  const h = ea(); assert.equal(C.gates(h).sign.met, true);
  h.plan.steps.find(s => s.gate === "ready").status = "open"; assert.equal(C.gates(h).ready.met, false);
  assert.equal(C.askMinutes(ea()), 80);
});

test("the CLI check reports TODO gaps by area and open gap items", () => {
  const cli = path.join(root, "skills/handover/scripts/handover.cjs");
  const out = execFileSync(process.execPath, [cli, "check", path.join(root, "site/examples/ea-no-overlap.handover")], { encoding: "utf8" });
  assert.match(out, /valid handover 1\.1 .* 2 TODO gap\(s\) still to fill \(path 1, systems 1\); 1 open item\(s\) on the gaps list, 1 blocking work/);
  const old = execFileSync(process.execPath, [cli, "check", path.join(root, "site/examples/sample.handover")], { encoding: "utf8" });
  assert.match(old, /valid handover 1\.0 .* 7 TODO gap\(s\)/);
});

test("the AI prompt's example file is a valid 1.1 file", () => {
  const text = fs.readFileSync(path.join(root, "site/prompt.md"), "utf8");
  const h = JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(h.handover, "1.1");
  const v = C.validate(h);
  assert.deepEqual(v.errors, []); assert.deepEqual(v.warnings, []);
  assert.deepEqual(check(schema.latest, h), []);
});

test("items export: kinds, single items, privacy and closed items", () => {
  const h = ea();
  const kinds = C.exportKinds(h);
  assert.deepEqual(kinds.map(k => k.key), ["overview", "people", "jobs", "tasks", "stakeholders", "decide", "systems", "documents", "rules", "decisions", "risks", "inProgress", "gaps", "sections", "questions", "steps", "asks", "finalCheck", "signoff"]);
  assert.equal(kinds.find(k => k.key === "jobs").count, h.recurring.length);
  const md = C.docMarkdown(C.itemsDocument(h, {kinds: ["jobs", "tasks"], title: "Jobs and tasks", date: "2026-11-27"}));
  assert.match(md, /^# Jobs and tasks\n/);
  assert.match(md, /### Every week\n\n- \*\*Submit Dana's expense claims for approval\*\*\n  - Every Thursday · 11:00 · High risk/);
  assert.doesNotMatch(md, /\]\(#/, "links into the handover are reduced to their text");
  assert.doesNotMatch(md, /\*\*\*\*/, "titles that are already bold are not wrapped again");
  const only = C.itemsDocument(h, {kinds: ["jobs"], only: {jobs: ["expense-approvals"]}});
  assert.equal(only.parts[0].groups.length, 1);
  assert.deepEqual(only.parts[0].groups[0].items.map(i => i.id), ["expense-approvals"]);
  const restricted = h.stakeholders.find(s => s.visibleTo);
  const people = C.docMarkdown(C.itemsDocument(h, {kinds: ["stakeholders"]}));
  assert.ok(!people.includes(restricted.name), "items only some people may see are left out by default");
  assert.ok(C.docMarkdown(C.itemsDocument(h, {kinds: ["stakeholders"], private: true})).includes(restricted.name));
  const closedGap = h.gaps.find(g => g.closed);
  assert.ok(!C.docMarkdown(C.itemsDocument(h, {kinds: ["gaps"]})).includes(closedGap.text));
  assert.ok(C.docMarkdown(C.itemsDocument(h, {kinds: ["gaps"], closed: true})).includes(closedGap.text));
  const html = C.docHtml(C.itemsDocument(h, {kinds: ["documents"]}));
  assert.match(html, /^<!doctype html>/); assert.match(html, /<a href="https:\/\//);
  assert.doesNotMatch(html, /<script/i);
});

test("items export works on a 1.0 file", () => {
  const h = sample();
  assert.deepEqual(C.exportKinds(h).map(k => k.key), ["overview", "jobs", "tasks", "sections", "questions"]);
  const md = C.docMarkdown(C.itemsDocument(h, {kinds: ["jobs", "tasks", "questions"]}));
  assert.ok(md.includes("## Jobs") && md.includes("## First-weeks tasks") && md.includes("## Questions and answers"));
});

/* Reads a stored (uncompressed) zip and checks each entry's CRC */
function unzipStored(bytes) {
  const buf = Buffer.from(bytes), files = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), crc = buf.readUInt32LE(i + 14), size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    assert.equal(method, 0);
    const name = buf.slice(i + 30, i + 30 + nlen).toString("utf8"), data = buf.slice(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    assert.equal(require("zlib").crc32 ? require("zlib").crc32(data) : crc, crc, "CRC of " + name);
    files[name] = data.toString("utf8");
    i += 30 + nlen + xlen + size;
  }
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, "end of central directory");
  assert.equal(buf.readUInt16LE(buf.length - 12), Object.keys(files).length);
  return files;
}

test("PDF export: ASCII only, valid cross-references, paged with footers", () => {
  const h = ea(), doc = C.itemsDocument(h, {kinds: ["jobs", "tasks", "steps", "risks"], title: "Jobs (and tasks) \\ ‘quoted’ – é"});
  const pdf = C.docPdf(doc, {timezone: h.timezone});
  assert.match(pdf, /^%PDF-1\.4\n/); assert.match(pdf, /%%EOF\n$/);
  assert.doesNotMatch(pdf, /[^\x00-\x7f]/, "plain ASCII, so it travels as a string");
  const startxref = +pdf.match(/startxref\n(\d+)/)[1];
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");
  const offsets = pdf.slice(startxref).split("\n").filter(l => / 00000 n $/.test(l)).map(l => +l.slice(0, 10));
  offsets.forEach((o, k) => assert.equal(pdf.slice(o, o + String(k + 1).length + 6), (k + 1) + " 0 obj"));
  const pages = (pdf.match(/\/Type \/Page /g) || []).length;
  assert.ok(pages > 1); assert.ok(pdf.includes("1 of " + pages));
  assert.ok(pdf.includes("/MediaBox [0 0 612 792]"), "Letter paper for an American timezone");
  assert.ok(C.docPdf(doc, {timezone: "Europe/London"}).includes("/MediaBox [0 0 595.28 841.89]"), "A4 elsewhere");
  assert.ok(pdf.includes("(Jobs \\(and tasks\\) \\\\ \\221quoted\\222 \\226 \\351)"), "brackets, backslashes and WinAnsi characters escaped");
});

test("Word export is a valid package with styles, bullets and external links", () => {
  const files = unzipStored(C.docDocx(C.itemsDocument(ea(), {kinds: ["jobs", "documents"], title: "Jobs & documents"})));
  ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/_rels/document.xml.rels", "docProps/core.xml"].forEach(n => assert.ok(files[n], n));
  const d = files["word/document.xml"];
  assert.ok(d.includes("Jobs &amp; documents")); assert.ok(d.includes("Submit Dana&apos;s") || d.includes("Submit Dana's"));
  const ids = [...d.matchAll(/r:id="(rIdL\d+)"/g)].map(m => m[1]);
  assert.ok(ids.length > 0);
  ids.forEach(id => assert.match(files["word/_rels/document.xml.rels"], new RegExp('Id="' + id + '"[^>]*TargetMode="External"')));
  assert.doesNotMatch(d, /\*\*/, "Markdown bold becomes Word bold");
});

test("Excel export has a sheet per kind, a header row and one row per item", () => {
  const h = ea(), files = unzipStored(C.docXlsx(C.itemsDocument(h, {kinds: ["jobs", "decide"]})));
  const wb = files["xl/workbook.xml"];
  assert.deepEqual([...wb.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]), ["Jobs", "Who decides what"]);
  const jobs = files["xl/worksheets/sheet1.xml"];
  assert.equal((jobs.match(/<row /g) || []).length, h.recurring.length + 1);
  assert.ok(jobs.includes(">How often<") && jobs.includes(">Every Thursday<") && jobs.includes(">11:00<"));
  assert.match(jobs, /<autoFilter ref="A1:F7"\/>/);
});

test("components export: overview, people, reference sections, asks, final check and sign-off", () => {
  const h = ea(), kinds = ["overview", "people", "sections", "asks", "finalCheck", "signoff"];
  const doc = C.itemsDocument(h, {kinds, date: "2026-11-27"});
  assert.deepEqual(doc.parts.map(p => p.key), kinds);
  const md = C.docMarkdown(doc);
  assert.match(md, /### About this handover\n\nHow to run Dana Whitfield's desk/);
  assert.ok(md.includes("Marcus Hale's first day") && md.includes("No overlap"));
  assert.ok(!md.includes("### People\n"), "sections written for 1.0 readers are left out: the structured parts cover them");
  assert.match(md, /### Confidentiality\n\n- Board papers/);
  assert.ok(md.includes("> **Warning:** Never forward a board pack"));
  assert.ok(md.includes("**Profile check**") && md.includes("**Recurring work**"));
  const asks = doc.parts.find(p => p.key === "asks").groups[0].items;
  assert.equal(asks.length, h.asks.length);
  const so = doc.parts.find(p => p.key === "signoff");
  assert.ok(so.groups[0].items.some(i => i.title === "Record frozen"));
});

test("reference sections keep their headings, lists, notes and tables in every format", () => {
  const h = sample(), sec = h.sections.find(s => /\n\|/.test(s.body));
  const blocks = C.parseBlocks(sec.body), table = blocks.find(b => b.t === "table");
  assert.ok(table && table.head.length > 1 && table.rows.length > 0);
  const doc = C.itemsDocument(h, {kinds: ["sections"], only: {sections: [sec.id]}});
  assert.deepEqual(doc.parts[0].groups[0].items.map(i => i.id), [sec.id]);
  const md = C.docMarkdown(doc);
  assert.ok(md.includes("| " + table.head.join(" | ") + " |"), "Markdown tables keep their header");
  assert.match(C.docHtml(doc), new RegExp("<th>" + table.head[0] + "</th>"));
  const d = unzipStored(C.docDocx(doc))["word/document.xml"];
  assert.ok(d.includes("<w:tbl>") && d.includes("<w:tblHeader/>"));
  const pdf = C.docPdf(doc);
  assert.ok(pdf.includes(" re f"), "the PDF header row is shaded");
  assert.ok(pdf.includes("(" + table.head[0] + ")"));
  const cell = unzipStored(C.docXlsx(doc))["xl/worksheets/sheet1.xml"];
  assert.ok(cell.includes(table.head[0] + ": "), "a spreadsheet cell gets the table as labelled lines");
  assert.equal(C.blocksText("1. One\n2. Two\n\n!> Careful"), "1. One\n2. Two\nWarning: Careful");
  const ordered = unzipStored(C.docDocx(C.itemsDocument({...h, sections: [{id: "x", title: "X", body: "1. a\n2. b\n\ntext\n\n1. c"}]}, {kinds: ["sections"]})));
  assert.equal((ordered["word/numbering.xml"].match(/<w:startOverride/g) || []).length, 2, "each numbered list starts at 1");
});

test("filling gaps: each gap is addressed exactly, the file stays valid and history records it", () => {
  const h = sample(), list = C.gapList(h);
  assert.equal(list.length, C.findGaps(h).length);
  const log = list.filter(g => g.label === "Reference › Decision log");
  assert.deepEqual(log.map(g => g.what), ["date", "decision", "reason"]);
  const q = list.find(g => g.path[0] === "questions");
  const r = C.fillGaps(h, {[log[1].key]: "Moved payroll | to the 25th", [q.key]: "Finance"}, {date: "2026-11-27"});
  assert.equal(r.filled, 2);
  const body = r.h.sections.find(s => s.title === "Decision log").body;
  assert.ok(body.includes("| TODO: date | Moved payroll / to the 25th | TODO: reason |"), "a table cell keeps its pipes");
  assert.ok(r.h.questions[0].a.endsWith("in the folder Finance"));
  assert.equal(r.h.updated, "2026-11-27");
  assert.equal(r.h.history, undefined, "1.0 files get no history");
  assert.deepEqual(C.validate(r.h).errors, []);
  assert.equal(C.gapList(r.h).length, list.length - 2);
  assert.equal(h.questions[0].a.includes("Finance"), false, "the original is not changed");

  const ea11 = ea(), g = C.gapList(ea11)[0];
  const r2 = C.fillGaps(ea11, {[g.key]: "Kim, Ravi's assistant"}, {date: "2026-11-27", at: "2026-11-27T10:00:00Z"});
  const last = r2.h.history[r2.h.history.length - 1];
  assert.deepEqual(last, {id: "fill-2026-11-27", at: "2026-11-27T10:00:00Z", source: "app", text: "Filled 1 gap in the app: First weeks."});
  assert.deepEqual(C.validate(r2.h).errors, []); assert.deepEqual(check(schema.latest, r2.h), []);
  assert.throws(() => C.fillGaps(ea11, {}), /Nothing to fill/);
});

test("filling gaps refuses secrets (spec section 2)", () => {
  const h = sample(), g = C.gapList(h)[0];
  ["password: Hunter2!", "PIN is 4471", "4111 1111 1111 1111", "sk-live_abcdefghijklmnopqrstuv", "ghp_abcdefghijklmnopqrstuvwxyz0123", "GB82 WEST 1234 5698 7654 32", "aB3dE5fG7hJ9kL1mN3pQ5rS7"].forEach(v => {
    assert.ok(C.secretReason(v), v);
    assert.throws(() => C.fillGaps(h, {[g.key]: v}), e => e.key === g.key && /MUST NOT/.test(e.message), v);
  });
  ["In the shared password manager, Finance folder", "Ask Ravi for the PIN reset form", "+1 876 555 0100", "https://example.com/docs/Payroll-2026", "Helen Ortiz, helen.ortiz@example.com"].forEach(v => assert.equal(C.secretReason(v), "", v));
});

test("closing and reopening records (spec section 11)", () => {
  const h = ea(), g = h.gaps.find(x => !x.closed && x.blocks);
  const closed = C.closeItem(h, "gaps", g.id, {how: "fixed", by: "incoming", fix: "Agency added Marcus as a booker", date: "2026-11-27", at: "2026-11-27T10:00:00Z"});
  assert.deepEqual(closed.gaps.find(x => x.id === g.id).closed, {how: "fixed", at: "2026-11-27T10:00:00Z", by: "incoming", fix: "Agency added Marcus as a booker"});
  assert.deepEqual(closed.history.slice(-1)[0], {id: "close-2026-11-27", at: "2026-11-27T10:00:00Z", source: "app", text: "Closed gap " + g.id + " in the app: fixed."});
  assert.equal(closed.updated, "2026-11-27");
  assert.deepEqual(C.validate(closed).errors, []); assert.deepEqual(check(schema.latest, closed), []);
  assert.ok(!g.closed, "the original is not changed");
  assert.equal((C.exportProfile(closed, "newcomer").gaps || []).some(x => x.id === g.id), false, "closed items leave the newcomer copy");

  const again = C.reopenItem(closed, "gaps", g.id, {date: "2026-11-27", at: "2026-11-27T10:05:00Z"});
  assert.equal(again.gaps.find(x => x.id === g.id).closed, undefined);
  assert.equal(again.history.slice(-1)[0].id, "reopen-2026-11-27");
  assert.deepEqual(C.validate(again).errors, []);

  assert.throws(() => C.closeItem(h, "inProgress", h.inProgress[0].id, {how: "fixed"}), /done, no longer applies/, "each list closes only the ways the spec allows");
  assert.throws(() => C.closeItem(h, "gaps", g.id, {how: "fixed", fix: "PIN is 4471"}), /MUST NOT/);
  assert.throws(() => C.closeItem(closed, "gaps", g.id, {how: "fixed"}), /already closed/);
  assert.throws(() => C.reopenItem(h, "gaps", g.id), /already open/);
  assert.throws(() => C.closeItem(h, "gaps", "no-such-id", {how: "fixed"}), /isn't in the file/);
  const card = h.decide.cards[0], dropped = C.closeItem(h, "decide", card.id, {how: "dropped"});
  assert.equal(dropped.decide.cards[0].closed.how, "dropped"); assert.deepEqual(C.validate(dropped).errors, []);
});

test("adding records in the app (spec section 11)", () => {
  const h = ea(), at = "2026-11-27T10:00:00Z", o = () => ({role: "incoming", date: "2026-11-27", at});
  const r = C.addItem(h, "risks", {text: "Visa renewals for the principal", list: "occasional", severity: "high", treatment: ""}, o());
  assert.equal(r.id, "visa-renewals-for-the-principal");
  assert.deepEqual(r.h.risks.slice(-1)[0], {id: r.id, text: "Visa renewals for the principal", list: "occasional", severity: "high", added: at, addedBy: "incoming"});
  assert.deepEqual(r.h.history.slice(-1)[0], {id: "add-2026-11-27", at, source: "app", text: "Added risk " + r.id + " in the app.", role: "incoming"});
  assert.equal(r.h.updated, "2026-11-27");
  assert.deepEqual(C.validate(r.h).errors, []); assert.deepEqual(check(schema.latest, r.h), []);
  assert.equal(h.risks.length + 1, r.h.risks.length, "the original is left alone");
  // A second item with the same words gets its own id, and the history id stays unique
  const r2 = C.addItem(r.h, "risks", {text: "Visa renewals for the principal", list: "spof"}, o());
  assert.equal(r2.id, "visa-renewals-for-the-principal-2");
  assert.equal(r2.h.history.slice(-1)[0].id, "add-2026-11-27-2");
  // Every kind of record, plus a who-decides card
  let x = r2.h;
  [["inProgress", {text: "Renew the parking permit", owner: "incoming", due: "2026-12-10"}], ["gaps", {text: "Who signs off the **Q1** offsite budget", blocks: true}],
   ["rules", {text: "If the CEO is travelling, then confirm cars the day before", situation: "Principal travelling"}], ["decisions", {text: "Use the new caterer", reason: "Cheaper\nand closer", date: "2026-11-20"}],
   ["systems", {name: "Bank portal", purpose: "Paying suppliers", credentialLocation: "Team password manager, Finance folder", grantedBy: "Ravi in Finance"}],
   ["documents", {title: "Travel guide", location: "Shared drive, EA folder; Priya holds it", type: "guide", status: "draft", owner: "incoming"}],
   ["decide", {text: "Booking travel under USD 500", column: "alone"}]].forEach(([list, values]) => { x = C.addItem(x, list, values, o()).h; });
  assert.deepEqual(C.validate(x).errors, []); assert.deepEqual(check(schema.latest, x), []);
  assert.equal(x.gaps.slice(-1)[0].blocks, true);
  assert.equal(x.decisions.slice(-1)[0].reason, "Cheaper\nand closer", "several-line fields keep their lines");
  assert.equal(x.decide.cards.slice(-1)[0].column, "alone");
  // The newcomer copy keeps open records and drops who added them
  const n = C.exportProfile(x, "newcomer");
  assert.equal(n.systems.slice(-1)[0].added, undefined);
  // Missing, wrong and secret values are refused, with the field named
  const fails = (list, values, field) => assert.throws(() => C.addItem(h, list, values, o()), e => e.field === field);
  fails("gaps", {text: "  "}, "text");
  fails("risks", {text: "x"}, "list");
  fails("risks", {text: "x", list: "sometimes"}, "list");
  fails("inProgress", {text: "x", owner: "boss"}, "owner");
  fails("inProgress", {text: "x", due: "next week"}, "due");
  fails("documents", {title: "Guide"}, "url");
  fails("systems", {name: "Bank portal", credentialLocation: "password: Hunter22x"}, "credentialLocation");
  fails("gaps", {text: "Card 4111 1111 1111 1111 for the agency"}, "text");
  fails("documents", {title: "Guide", url: "https://x.test/?token=" + "Ab3".repeat(9)}, "url");
  assert.throws(() => C.addItem(h, "people", {}, o()), /can't be added/);
  assert.throws(() => C.addItem(json("site/examples/sample.handover"), "gaps", {text: "x"}, o()), /format 1\.0/);
});
