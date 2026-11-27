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
const schema = { latest: json("site/schema/v1.json"), v10: json("site/schema/v1.0.json"), v11: json("site/schema/v1.1.json"), v12: json("site/schema/v1.2.json"), v13: json("site/schema/v1.3.json") };
const errorsOf = h => C.validate(h).errors;
const expectError = (h, re) => { const e = errorsOf(h); assert.ok(e.some(x => re.test(x)), "expected an error matching " + re + ", got:\n" + e.join("\n")); };

test("the 1.0 sample still passes, with no warnings", () => {
  assert.deepEqual(C.validate(sample()), { errors: [], warnings: [] });
});
test("the 1.0 sample is valid against the newest schema and every frozen copy", () => {
  for (const [name, s] of Object.entries(schema)) assert.deepEqual(check(s, sample()), [], name);
});
test("the 1.0 sample's gap count is unchanged", () => {
  assert.equal(C.gapCounts(sample()).todo, 7);
});

test("the no-overlap EA example passes, with no warnings", () => {
  assert.deepEqual(C.validate(ea()), { errors: [], warnings: [] });
});
test("the EA example is valid against the newest schema and the frozen 1.2 schema", () => {
  assert.deepEqual(check(schema.latest, ea()), []);
  assert.deepEqual(check(schema.v12, ea()), []);
  // without its 1.2 fields it is a valid 1.1 file
  const h = ea(); delete h.role; delete h.asNeeded; h.recurring.forEach(r => delete r.area); h.handover = "1.1";
  h.sections = h.sections.filter(s => !["handover-role", "handover-as-needed"].includes(s.id)); h.rendered = h.rendered.filter(id => !["handover-role", "handover-as-needed"].includes(id));
  assert.deepEqual(check(schema.v11, h), []);
  assert.deepEqual(C.validate(h), { errors: [], warnings: [] });
});
test("the frozen 1.1 schema rejects the 1.2 example, as it should", () => {
  assert.ok(check(schema.v11, ea()).length > 0);
});
test("the frozen 1.0 schema rejects the 1.1 example, as it should", () => {
  assert.ok(check(schema.v10, ea()).length > 0);
});
test("the EA example is the no-overlap reference case and uses every 1.1 and 1.2 field", () => {
  const h = ea();
  assert.equal(C.overlap(h.plan), false);
  const topLevel = ["audience", "profile", "people", "stakeholders", "plan", "asks", "gaps", "inProgress", "rules", "decisions", "risks", "systems", "documents", "decide", "finalCheck", "signoff", "followUps", "catchUps", "history", "rendered"];
  for (const k of topLevel) assert.ok(h[k] !== undefined, k);
  // every property defined for a 1.1 object appears somewhere in the example
  const seen = new Set();
  (function walk(v) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const k of Object.keys(v)) { seen.add(k); walk(v[k]); } })(h);
  const defs = ["person", "stakeholder", "plan", "step", "ask", "gap", "inProgress", "rule", "decision", "risk", "system", "document", "decide", "card", "finalCheck", "signoff", "followUp", "catchUp", "historyEntry", "closed", "checks", "money", "jobRole", "asNeeded"];
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
  assert.deepEqual(c.byArea, { path: 1, systems: 1, asNeeded: 1 });
  assert.equal(c.openItems, 1);
  assert.equal(c.blocking, 1);
  const h = ea(); h.stakeholders[0].involve = "TODO: when to involve Ravi"; h.asks[0].default = "Stands {TODO: confirm}";
  h.role.travel = "TODO: how often Dana's trips need the assistant"; h.recurring[0].area = "TODO: which area";
  assert.deepEqual(C.gapCounts(h).byArea, { path: 1, systems: 1, asNeeded: 1, stakeholders: 1, asks: 1, role: 1, recurring: 1 });
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
  let h = sample(); h.handover = "1.4"; h.somethingNew = true; h.recurring[0].alsoNew = 1;
  let v = C.validate(h); assert.deepEqual(v.errors, []); assert.ok(v.warnings.length === 2, v.warnings.join("\n"));
  h = ea(); h.handover = "1.0"; v = C.validate(h); assert.deepEqual(v.errors, []); assert.ok(v.warnings.some(w => /says "1\.0" but uses 1\.2 fields\. Set it to "1\.2"/.test(w)));
  h = ea(); h.handover = "1.1"; v = C.validate(h); assert.deepEqual(v.errors, []); assert.deepEqual(v.warnings, ['handover: the file says "1.1" but uses 1.2 fields. Set it to "1.2"']);
  h = ea(); delete h.role; delete h.asNeeded; h.recurring.forEach(r => delete r.area); h.handover = "1.0"; assert.ok(C.validate(h).warnings.some(w => /says "1\.0" but uses 1\.1 fields/.test(w)));
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
  assert.match(out, /valid handover 1\.2 .* 3 TODO gap\(s\) still to fill \(path 1, systems 1, asNeeded 1\); 1 open item\(s\) on the gaps list, 1 blocking work/);
  const old = execFileSync(process.execPath, [cli, "check", path.join(root, "site/examples/sample.handover")], { encoding: "utf8" });
  assert.match(old, /valid handover 1\.0 .* 7 TODO gap\(s\)/);
});

test("the AI prompt's example file is a valid 1.3 file", () => {
  const text = fs.readFileSync(path.join(root, "site/prompt.md"), "utf8");
  const h = JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(h.handover, "1.3");
  assert.ok(h.role && h.asNeeded && h.recurring.every(r => r.area), "the prompt shows the 1.2 fields");
  assert.ok(h.recurring.some(r => r.lead), "the prompt shows a lead time");
  const v = C.validate(h);
  assert.deepEqual(v.errors, []); assert.deepEqual(v.warnings, []);
  assert.deepEqual(check(schema.latest, h), []);
});

test("items export: kinds, single items, privacy and closed items", () => {
  const h = ea();
  const kinds = C.exportKinds(h);
  assert.deepEqual(kinds.map(k => k.key), ["overview", "people", "jobs", "tasks", "stakeholders", "decide", "systems", "documents", "rules", "decisions", "risks", "inProgress", "gaps", "sections", "questions", "steps", "asks", "finalCheck", "signoff"]);
  assert.equal(kinds.find(k => k.key === "jobs").count, h.recurring.length + h.asNeeded.length);
  const md = C.docMarkdown(C.itemsDocument(h, {kinds: ["jobs", "tasks"], title: "Jobs and tasks", date: "2026-11-27"}));
  assert.match(md, /^# Jobs and tasks\n/);
  assert.match(md, /### Every week\n\n- \*\*Submit Dana's expense claims for approval\*\*\n  - Every Thursday · 11:00 · Expenses · High risk/);
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
  const n = h.recurring.length + h.asNeeded.length;
  assert.equal((jobs.match(/<row /g) || []).length, n + 1);
  assert.ok(jobs.includes(">How often<") && jobs.includes(">Every Thursday<") && jobs.includes(">11:00<") && jobs.includes(">As needed<") && jobs.includes(">Expenses<"));
  assert.match(jobs, new RegExp('<autoFilter ref="A1:G' + (n + 1) + '"/>'));
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
  assert.deepEqual(closed.history.slice(-1)[0], {id: "close-2026-11-27", at: "2026-11-27T10:00:00Z", source: "app", role: "incoming", text: "Closed gap " + g.id + " in the app: fixed."});
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

test("editing the handover dates, with the first day unknown", () => {
  const h = ea(), o = {role: "outgoing", date: "2026-09-01"};
  assert.deepEqual(C.planValues(h), {track: h.plan.track || "light", prepStart: h.plan.prepStart, lastDay: h.plan.lastDay, firstDay: "2026-10-05"});
  assert.equal(C.planValues({handover: "1.1"}), null);
  const base = C.planValues(h);
  // Nobody hired yet: the first day can be left empty, and the handover runs with no overlap
  const r = C.editPlan(h, Object.assign({}, base, {firstDay: ""}), o);
  assert.equal(r.h.plan.firstDay, undefined);
  assert.equal("firstDay" in r.h.plan, false);
  assert.deepEqual(r.changed, ["the first day (now not known)"]);
  assert.equal(C.overlap(r.h.plan), false);
  assert.match(r.h.history[r.h.history.length - 1].text, /Edited the handover dates in the app: the first day \(now not known\)\./);
  assert.deepEqual(C.validate(r.h).errors, []);
  assert.deepEqual(check(schema.latest, r.h), []);
  assert.equal(h.plan.firstDay, "2026-10-05", "the original is untouched");
  assert.equal(r.h.plan.steps.length, h.plan.steps.length, "the steps stay");
  // Setting a first day before the last day makes it an overlap
  const r2 = C.editPlan(r.h, Object.assign({}, base, {firstDay: "2026-09-21"}), o);
  assert.equal(r2.h.plan.firstDay, "2026-09-21");
  assert.equal(C.overlap(r2.h.plan), true);
  assert.deepEqual(r2.changed, ["the first day"]);
  // Light is the default track, so choosing it on a file that names none changes nothing
  const nt = ea(); delete nt.plan.track;
  assert.throws(() => C.editPlan(nt, Object.assign({}, C.planValues(nt)), o), /Nothing has changed/);
  const full = C.editPlan(nt, Object.assign({}, C.planValues(nt), {track: "full"}), o);
  assert.equal(full.h.plan.track, "full");
  // The dates must make sense
  assert.throws(() => C.editPlan(h, Object.assign({}, base, {lastDay: ""}), o), e => e.field === "lastDay");
  assert.throws(() => C.editPlan(h, Object.assign({}, base, {prepStart: "2026-10-01"}), o), e => e.field === "prepStart" && /on or before the last day/.test(e.message));
  assert.throws(() => C.editPlan(h, Object.assign({}, base, {firstDay: "2026-01-01"}), o), e => e.field === "firstDay");
  assert.throws(() => C.editPlan(h, Object.assign({}, base, {firstDay: "next spring"}), o), e => e.field === "firstDay" && /a date like/.test(e.message));
  assert.throws(() => C.editPlan({handover: "1.1"}, base, o), /no handover plan/);
  // The overview says "Not known yet" when the incoming assistant is named, "Not hired yet" when nobody is
  const first = x => C.itemsDocument(x, {kinds: ["overview"], date: "2026-09-01"}).parts[0].groups.flatMap(g => g.items).find(i => i.id === "d-first");
  assert.deepEqual([first(r.h).title, first(r.h).meta[0]], ["Marcus Hale's first day", "Not known yet"]);
  const nobody = JSON.parse(JSON.stringify(r.h)); nobody.people = nobody.people.filter(p => !p.roles.includes("incoming"));
  assert.deepEqual([first(nobody).title, first(nobody).meta[0]], ["First day", "Not hired yet"]);
});

test("editing records, first-weeks tasks and regular jobs in the app", () => {
  const h = ea(), at = "2026-11-27T10:00:00Z", o = () => ({role: "incoming", date: "2026-11-27", at});
  // Saving any item as it is changes nothing, in both examples
  for (const f of [h, sample()]) for (const list of ["inProgress", "gaps", "rules", "decisions", "risks", "systems", "documents", "decide", "path", "recurring"]) {
    const items = list === "path" ? (f.path || []).flatMap(s => s.tasks) : list === "decide" ? (f.decide ? f.decide.cards : []) : f[list] || [];
    for (const it of items) assert.throws(() => C.editItem(f, list, it.id, C.editValues(f, list, it.id), o()), /Nothing has changed/, list + " " + it.id);
  }
  // A thing in progress: new date and owner; id, provenance and closure are kept, the AI-draft mark goes
  const ip = h.inProgress.find(x => !x.closed), v = C.editValues(h, "inProgress", ip.id);
  const before = Object.assign({}, h.inProgress.find(x => x.id === ip.id));
  v.due = "2026-12-18"; v.owner = "outgoing";
  const src = C.addItem(h, "inProgress", {text: "x"}, o()).h; src.inProgress = src.inProgress.map(x => x.id === ip.id ? Object.assign({}, x, {aiDrafted: true}) : x);
  const r = C.editItem(src, "inProgress", ip.id, v, o());
  const after = r.h.inProgress.find(x => x.id === ip.id);
  assert.deepEqual(r.changed, (before.owner === "outgoing" ? [] : ["who owns it now"]).concat(before.due === "2026-12-18" ? [] : ["due"]));
  assert.equal(after.due, "2026-12-18"); assert.equal(after.owner, "outgoing");
  assert.equal(after.added, before.added); assert.equal(after.aiDrafted, undefined, "a person has checked it");
  assert.match(r.h.history.slice(-1)[0].text, new RegExp("^Edited thing in progress " + ip.id + " in the app: .*due\\.$"));
  assert.equal(r.h.history.slice(-1)[0].id, "edit-2026-11-27"); assert.equal(r.h.updated, "2026-11-27");
  assert.deepEqual(C.validate(r.h).errors, []); assert.deepEqual(check(schema.latest, r.h), []);
  // Clearing an optional field removes it
  const v2 = C.editValues(r.h, "inProgress", ip.id); v2.due = "";
  assert.equal(C.editItem(r.h, "inProgress", ip.id, v2, o()).h.inProgress.find(x => x.id === ip.id).due, undefined);
  // A regular job (format 1.0): its schedule fields follow how often it happens, and the 1.0 file stays valid
  const s = sample(), job = s.recurring.find(x => x.every === "quarter");
  let jv = C.editValues(s, "recurring", job.id);
  assert.deepEqual([jv.day, jv.monthOfQuarter], [String(job.day), String(job.monthOfQuarter)]);
  jv.every = "week"; jv.on = ["thu", "mon"]; jv.time = "08:30";
  let j = C.editItem(s, "recurring", job.id, jv, o());
  const nj = j.h.recurring.find(x => x.id === job.id);
  assert.deepEqual([nj.every, nj.on, nj.day, nj.monthOfQuarter, nj.time], ["week", ["mon", "thu"], undefined, undefined, "08:30"]);
  assert.equal(j.h.history, undefined, "1.0 files have no history");
  assert.deepEqual(C.validate(j.h).errors, []); assert.deepEqual(check(schema.v10, j.h), []);
  jv = C.editValues(j.h, "recurring", job.id); jv.on = ["fri"];
  assert.equal(C.editItem(j.h, "recurring", job.id, jv, o()).h.recurring.find(x => x.id === job.id).on, "fri", "one day is stored as a string");
  jv.every = "month"; jv.day = "last";
  assert.equal(C.editItem(j.h, "recurring", job.id, jv, o()).h.recurring.find(x => x.id === job.id).day, "last");
  jv.every = "quarter"; jv.day = "15"; jv.monthOfQuarter = "3";
  const q = C.editItem(j.h, "recurring", job.id, jv, o()).h.recurring.find(x => x.id === job.id);
  assert.deepEqual([q.day, q.monthOfQuarter], [15, 3]);
  // A first-weeks task keeps its id, so its tick stays
  const t = s.path[0].tasks[0], tv = C.editValues(s, "path", t.id); tv.text = "Get access to every system"; tv.detail = "Start with the password manager folder.";
  const pt = C.editItem(s, "path", t.id, tv, o()).h.path[0].tasks[0];
  assert.deepEqual(pt, {id: t.id, text: "Get access to every system", detail: "Start with the password manager folder."});
  // Missing, wrong and secret values are refused, with the field named
  const fails = (f, list, id, change, field) => assert.throws(() => C.editItem(f, list, id, Object.assign(C.editValues(f, list, id), change), o()), e => e.field === field);
  fails(s, "path", t.id, {text: " "}, "text");
  fails(s, "recurring", job.id, {every: "year"}, "date");
  fails(s, "recurring", job.id, {every: "year", date: "31-12"}, "date");
  fails(s, "recurring", job.id, {day: "32"}, "day");
  fails(s, "recurring", job.id, {time: "9am"}, "time");
  fails(s, "recurring", job.id, {detail: "The portal PIN is 4471"}, "detail");
  const sys = h.systems[0];
  fails(h, "systems", sys.id, {credentialLocation: "password: Hunter22x"}, "credentialLocation");
  fails(h, "documents", h.documents[0].id, {url: "", location: ""}, "url");
  assert.throws(() => C.editItem(s, "gaps", "x", {text: "y"}, o()), /format 1\.0/);
  assert.throws(() => C.editItem(h, "gaps", "no-such-gap", {text: "y"}, o()), /isn't in the file/);
});

test("reports for the principal: summaries say only what the file shows", () => {
  const h = ea(), o = {date: "2026-11-27"};
  const w = C.principalReport(h, "working", o);
  assert.equal(w.title, "What we're working on");
  assert.match(w.subtitle, /for Dana Whitfield/);
  const ip = h.inProgress.filter(x => !x.closed);
  assert.match(w.intro[0], new RegExp("^" + ip.length + " things are under way"));
  assert.deepEqual(w.parts.map(p => p.title).slice(0, 1), ["Under way"]);
  // A thing with no date is reported as such, not as covered
  const nodate = JSON.parse(JSON.stringify(h)); delete nodate.inProgress.find(x => !x.closed).due;
  assert.match(C.principalReport(nodate, "working", o).intro[0], /of them (has|have) an owner and a date; the table shows what the others still need/);
  // Finished lately: a gap closed yesterday shows; one handed to the principal goes to "What needs you" instead
  const g = h.gaps.find(x => !x.closed);
  const fixed = C.closeItem(h, "gaps", g.id, {how: "fixed", date: "2026-11-26", at: "2026-11-26T09:00:00Z"});
  const w2 = C.principalReport(fixed, "working", o);
  assert.ok(w2.parts.some(p => /^Finished since/.test(p.title) && p.groups[0].items.some(i => i.title === g.text)));
  assert.match(w2.intro.join(" "), /Nothing about the role is still unknown|still being found out/);
  const handed = C.closeItem(h, "gaps", g.id, {how: "principal", date: "2026-11-26", at: "2026-11-26T09:00:00Z"});
  assert.ok(C.principalReport(handed, "needs", o).parts.find(p => p.title === "Handed to you").groups[0].items.some(i => i.title === g.text));

  const j = C.principalReport(h, "jobs", o);
  assert.match(j.intro[0], new RegExp("^Marcus does " + h.recurring.length + " regular jobs for you"));
  assert.match(j.intro[2], /^You confirmed this/);
  assert.ok(j.parts.find(p => p.title === "Who decides what").groups.some(g => g.title === "Always you"));

  // What needs you: an open question, the unconfirmed board, and no step that only repeats the question
  const b = JSON.parse(JSON.stringify(h)); b.asks[0].status = "sent"; delete b.asks[0].answered; b.decide.confirmed = false; delete b.decide.confirmedAt;
  const st = b.plan.steps.find(s => s.role === "principal" && s.ask === b.asks[0].id); if (st) st.status = "open";
  const n = C.principalReport(b, "needs", o);
  assert.match(n.intro[0], /^Waiting for you: 1 question to answer/);
  assert.match(n.intro[0], /the who-decides board to confirm/);
  assert.ok(n.parts.some(p => p.title === "Please confirm who decides what"));
  if (st) assert.ok(!n.parts.some(p => p.title === "Your steps in the handover" && p.groups[0].items.some(i => i.id === st.id)));
  const none = JSON.parse(JSON.stringify(h)); none.gaps = []; none.asks.forEach(a => { a.status = "confirmed"; });
  assert.equal(C.principalReport(none, "needs", o).intro[0], "Nothing is waiting for you right now.");

  // Items the principal may not see are left out; items shared with the principal stay
  const v = JSON.parse(JSON.stringify(h)); delete v.audience;
  v.inProgress.push({id: "private-one", text: "Private to the assistants", visibleTo: ["outgoing", "incoming"]}, {id: "shared-one", text: "Shared with Dana", visibleTo: ["incoming", "principal"]});
  const vt = C.principalReport(v, "working", o).parts[0].groups[0].items.map(i => i.id);
  assert.ok(!vt.includes("private-one")); assert.ok(vt.includes("shared-one"));

  // Every format carries the summary
  assert.ok(C.docMarkdown(j).includes(j.intro[0]));
  assert.ok(C.docHtml(j).includes('class="summary"') && C.docHtml(j).includes(j.intro[1]));
  assert.ok(j.figures.length >= 1 && j.figures.every(f => f.value && f.label));
  const unzipNames = buf => { const names = []; const b = Buffer.from(buf); for (let i = 0; i + 4 < b.length; i++) if (b.readUInt32LE(i) === 0x04034b50){ const n = b.readUInt16LE(i + 26); names.push(b.slice(i + 30, i + 30 + n).toString()); } return names; };
  assert.ok(unzipNames(C.docDocx(j)).includes("word/footer1.xml"), "reports get a footer with page numbers");
  assert.ok(!unzipNames(C.docDocx(C.itemsDocument(h, {kinds: ["jobs"]}))).includes("word/footer1.xml"), "plain exports are unchanged");
  assert.match(C.docPdf(j), /^%PDF-1\.4/);
  assert.ok(C.docDocx(j).length > 1000);
  assert.throws(() => C.principalReport(h, "gossip", o), /No report/);
});

/* ================= 1.2: the role, areas of work and jobs done as needed ================= */
const strip12 = h => { delete h.role; delete h.asNeeded; h.recurring.forEach(r => delete r.area); h.handover = "1.1";
  h.sections = h.sections.filter(s => !["handover-role", "handover-as-needed"].includes(s.id)); h.rendered = h.rendered.filter(id => !["handover-role", "handover-as-needed"].includes(id)); return h; };

test("1.2: the role, areas and jobs done as needed are checked", () => {
  let h = ea(); h.role.pay = "USD 3,000 a month"; expectError(h, /^role\.pay: not a known field/);
  h = ea(); h.role.skills = " "; expectError(h, /^role\.skills: must be non-empty text/);
  h = ea(); h.recurring[0].area = ""; expectError(h, /^recurring\[0\]\.area: must be non-empty text/);
  h = ea(); h.asNeeded.push({id: h.asNeeded[0].id, text: "Again"}); expectError(h, /asNeeded\[3\]\.id: "meeting-requests" is used twice in asNeeded/);
  h = ea(); delete h.asNeeded[0].text; expectError(h, /^asNeeded\[0\]\.text: required/);
  h = ea(); h.asNeeded[0].see = "no-such-section"; expectError(h, /^asNeeded\[0\]\.see: no section has id "no-such-section"/);
  h = ea(); h.asNeeded[0].every = "week"; expectError(h, /^asNeeded\[0\]\.every: not a known field/);
  // jobs done as needed never reach the daily list
  h = ea(); const sc = C.schedule(h, {}, "2026-11-27"), ids = new Set(h.asNeeded.map(a => a.id));
  for (const k of ["overdue", "due", "next", "later"]) assert.ok(sc[k].every(o => !ids.has(o.r.id)), k);
  // a newcomer copy keeps them, as content
  const n = C.exportProfile(ea(), "newcomer");
  assert.deepEqual(n.asNeeded, ea().asNeeded); assert.deepEqual(n.role, ea().role);
  assert.deepEqual(C.validate(n).errors, []); assert.deepEqual(check(schema.latest, n), []);
});

test("1.2: older readers get the role and the jobs done as needed as sections", () => {
  const s = C.renderSections(ea()), role = s.find(x => x.id === "handover-role"), as = s.find(x => x.id === "handover-as-needed");
  assert.match(role.body, /^Runs Dana Whitfield's desk/);
  assert.match(role.body, /\| Location \| Head office, in person \|/);
  assert.match(role.body, /### What good looks like/);
  assert.match(as.body, /\| Draft visa invitation letters for overseas guests \| When an overseas guest is invited \| Travel \|/);
  assert.ok(!C.renderSections(strip12(ea())).some(x => /^handover-(role|as-needed)$/.test(x.id)));
});

test("editing an area or a job done as needed raises the version to match", () => {
  const o = {role: "incoming", date: "2026-11-27", at: "2026-11-27T10:00:00Z"};
  const h = strip12(ea()), v = C.editValues(h, "recurring", "inbox");
  const res = C.editItem(h, "recurring", "inbox", Object.assign({}, v, {area: "Diary and correspondence"}), o);
  assert.deepEqual(res.changed, ["the area"]);
  assert.equal(res.h.handover, "1.2");
  assert.deepEqual(C.validate(res.h), {errors: [], warnings: []}); assert.deepEqual(check(schema.latest, res.h), []);
  assert.equal(res.h.history.slice(-1)[0].text, "Edited regular job inbox in the app: the area.");
  // a 1.0 file too
  const s = sample(), r0 = s.recurring[0], s2 = C.editItem(s, "recurring", r0.id, Object.assign({}, C.editValues(s, "recurring", r0.id), {area: "Finance"}), o).h;
  assert.equal(s2.handover, "1.2"); assert.deepEqual(C.validate(s2).warnings, []);
  // a job done as needed
  const e = ea(), a = C.editValues(e, "asNeeded", "book-travel");
  assert.deepEqual(Object.keys(a), ["text", "area", "when", "detail"]);
  const r = C.editItem(e, "asNeeded", "book-travel", Object.assign({}, a, {when: "When a trip is planned"}), o);
  assert.deepEqual(r.changed, ["when it comes up"]);
  assert.equal(r.h.asNeeded.find(x => x.id === "book-travel").when, "When a trip is planned");
  assert.equal(r.h.history.slice(-1)[0].text, "Edited job done as needed book-travel in the app: when it comes up.");
  assert.throws(() => C.editItem(e, "asNeeded", "book-travel", Object.assign({}, a, {detail: "The portal PIN is 4471"}), o), err => err.field === "detail");
  const cleared = C.editItem(e, "asNeeded", "book-travel", Object.assign({}, a, {when: ""}), o).h.asNeeded.find(x => x.id === "book-travel");
  assert.ok(!("when" in cleared)); assert.equal(C.whenNeeded(cleared), "As needed");
});

test("adding and deleting jobs done as needed", () => {
  const o = {role: "incoming", date: "2026-11-27", at: "2026-11-27T10:00:00Z"};
  const e = ea(), n = e.asNeeded.length;
  const add = C.addItem(e, "asNeeded", {text: "Book meeting rooms", area: "Diary and correspondence", when: "When Dana hosts a meeting"}, o);
  assert.equal(add.id, "book-meeting-rooms");
  assert.deepEqual(add.h.asNeeded[n], {id: "book-meeting-rooms", text: "Book meeting rooms", area: "Diary and correspondence", when: "When Dana hosts a meeting"});
  assert.equal(add.h.history.slice(-1)[0].text, "Added job done as needed book-meeting-rooms in the app.");
  assert.deepEqual(C.validate(add.h), {errors: [], warnings: []}); assert.deepEqual(check(schema.latest, add.h), []);
  assert.deepEqual(C.withRendered(add.h), add.h, "the sections for older readers follow");
  assert.equal(C.addItem(add.h, "asNeeded", {text: "Book meeting rooms"}, o).id, "book-meeting-rooms-2");
  assert.throws(() => C.addItem(e, "asNeeded", {area: "Office"}, o), err => err.field === "text");
  assert.throws(() => C.addItem(e, "asNeeded", {text: "Pay the florist", detail: "Card 4111 1111 1111 1111"}, o), err => err.field === "detail");
  // a 1.0 file can take one, and becomes 1.2
  const s = C.addItem(sample(), "asNeeded", {text: "Order stationery"}, o).h;
  assert.equal(s.handover, "1.2"); assert.deepEqual(C.validate(s), {errors: [], warnings: []}); assert.deepEqual(check(schema.v12, s), []);
  // deleting
  const d = C.deleteItem(add.h, "asNeeded", "book-meeting-rooms", o);
  assert.equal(d.asNeeded.length, n);
  assert.equal(d.history.slice(-1)[0].text, "Deleted job done as needed book-meeting-rooms in the app: Book meeting rooms.");
  assert.deepEqual(C.validate(d), {errors: [], warnings: []}); assert.deepEqual(C.withRendered(d), d);
  assert.throws(() => C.deleteItem(d, "asNeeded", "book-meeting-rooms", o), /isn't in the file/);
  assert.throws(() => C.deleteItem(e, "risks", e.risks[0].id, o), /Close it instead/);
  assert.throws(() => C.deleteItem(e, "recurring", "inbox", o), /can't be deleted/);
  // the last one leaves no empty list behind
  let one = C.addItem(sample(), "asNeeded", {text: "Order stationery"}, o).h;
  one = C.deleteItem(one, "asNeeded", "order-stationery", o);
  assert.ok(!("asNeeded" in one)); assert.deepEqual(C.validate(one).errors, []);
});

test("editing the role", () => {
  const o = {role: "outgoing", date: "2026-11-27", at: "2026-11-27T10:00:00Z"};
  const e = ea(), v = C.roleValues(e);
  assert.deepEqual(Object.keys(v), ["organisation", "purpose", "location", "hours", "travel", "manages", "skills", "measures"]);
  assert.deepEqual(C.roleFields.map(d => d.k), Object.keys(v));
  const r = C.editRole(e, Object.assign({}, v, {travel: "Rarely", manages: ""}), o);
  assert.deepEqual(r.changed, ["the travel", "who it manages"]);
  assert.equal(r.h.role.travel, "Rarely"); assert.ok(!("manages" in r.h.role));
  assert.equal(r.h.history.slice(-1)[0].text, "Edited the role in the app: the travel and who it manages.");
  assert.deepEqual(C.validate(r.h), {errors: [], warnings: []}); assert.deepEqual(check(schema.latest, r.h), []);
  assert.deepEqual(C.withRendered(r.h), r.h, "the role section for older readers follows");
  assert.throws(() => C.editRole(e, v, o), /Nothing has changed/);
  assert.throws(() => C.editRole(e, Object.assign({}, v, {hours: "Weekdays; salary GBP 40,000"}), o), err => err.field === "hours" && /pay/.test(err.message));
  assert.throws(() => C.editRole(e, Object.assign({}, v, {skills: "- Knows the vault password is hunter2"}), o), err => err.field === "skills");
  // spending limits are not pay
  assert.equal(C.editRole(e, Object.assign({}, v, {measures: "- Expenses under USD 500 approved the same day"}), o).h.role.measures, "- Expenses under USD 500 approved the same day");
  // x- fields stay; an empty form removes the role
  const x = ea(); x.role["x-grade"] = "B";
  assert.equal(C.editRole(x, Object.assign({}, C.roleValues(x), {travel: "Rarely"}), o).h.role["x-grade"], "B");
  const gone = C.editRole(e, {}, o).h;
  assert.ok(!("role" in gone)); assert.deepEqual(C.validate(gone).errors, []);
  // a 1.0 file can be given a role, and becomes 1.2
  const s = C.editRole(sample(), {purpose: "Keeps the office running.", hours: "Weekdays 9:00 to 5:30"}, o).h;
  assert.equal(s.handover, "1.2"); assert.deepEqual(s.role, {purpose: "Keeps the office running.", hours: "Weekdays 9:00 to 5:30"});
  assert.deepEqual(C.validate(s), {errors: [], warnings: []}); assert.deepEqual(check(schema.v12, s), []);
});

test("combined reports: several reports as parts of one document", () => {
  const h = ea(), o = {date: "2026-11-27"};
  // One report on its own is exactly the single report
  assert.deepEqual(C.principalReports(h, ["needs"], o), C.principalReport(h, "needs", o));
  // Several: in the menu's order, whatever order they were asked in
  const d = C.principalReports(h, ["needs", "working", "jobs"], Object.assign({title: "  Friday   update "}, o));
  assert.deepEqual(d.reports, ["working", "jobs", "needs"]);
  assert.equal(d.title, "Friday update");
  // With no title, it says where the handover is: counting down to the last day, then the incoming assistant's weeks
  assert.equal(C.principalReports(h, ["working", "jobs"], o).title, "Handover update: Marcus's week 8");
  const T = d => C.reportTitle(h, d);
  assert.deepEqual(["2026-09-01", "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-05", "2026-10-11", "2026-10-12"].map(T),
    ["Handover update: 24 days to Priya's last day", "Handover update: 1 day to Priya's last day", "Handover update: Priya's last day",
     "Handover update: week 1 since Priya left", "Handover update: Marcus's week 1", "Handover update: Marcus's week 1", "Handover update: Marcus's week 2"]);
  const ov = JSON.parse(JSON.stringify(h)); ov.plan.firstDay = "2026-09-14";
  assert.equal(C.reportTitle(ov, "2026-09-16"), "Handover update: 9 days to Priya's last day", "overlapping: the countdown comes first");
  // The cover counts the days to (or since) the handover and gives its date
  const F = d => C.principalReports(h, ["working", "needs"], {date: d}).figures.map(f => [f.value, f.label, f.tone]);
  assert.deepEqual(F("2026-09-01"), [["24", "Days to Priya's last day", "neutral"], ["Fri 25 Sept", "Handover day", "neutral"]]);
  assert.deepEqual(F("2026-09-24")[0], ["1", "Day to Priya's last day", "warn"], "the last week stands out");
  assert.deepEqual(F("2026-09-25")[0], ["Today", "Priya's last day", "warn"]);
  assert.deepEqual(F("2026-11-27")[0], ["63", "Days since Priya's last day", "ok"]);
  assert.match(C.docMarkdown(C.principalReports(h, ["working", "needs"], {date: "2026-09-01"})), /\*\*24\*\* Days to Priya's last day · \*\*Fri 25 Sept\*\* Handover day/);
  assert.equal(C.reportTitle(ov, "2026-10-01"), "Handover update: Marcus's week 3");
  const np = JSON.parse(JSON.stringify(h)); delete np.plan;
  assert.deepEqual(["2026-11-27", "2021-01-03", "2026-12-31"].map(d => C.reportTitle(np, d)), ["Handover update: week 48, 2026", "Handover update: week 53, 2020", "Handover update: week 53, 2026"], "no plan: the ISO week");
  assert.deepEqual(C.principalReports(np, ["working", "needs"], o).figures, [], "no handover date, no countdown");
  // An assistant with no name is spelled out as a role; the outgoing one is credited only until their last day
  const ni = JSON.parse(JSON.stringify(h)); ni.people = ni.people.filter(p => !p.roles.includes("incoming"));
  assert.equal(C.reportTitle(ni, "2026-10-12"), "Handover update: Incoming Assistant's week 2");
  assert.match(C.principalReport(ni, "jobs", {date: "2026-10-12"}).intro[0], /^Incoming Assistant does 6 regular jobs/);
  assert.match(C.principalReport(ni, "jobs", {date: "2026-09-01"}).intro[0], /^Priya does 6 regular jobs/, "before the last day, the outgoing assistant still does them");
  assert.ok(C.principalReport(ni, "working", {date: "2026-10-12"}).parts[0].groups[0].items.every(it => it.cells[0] !== "Incoming assistant"), "owners are spelled out too");
  const no = JSON.parse(JSON.stringify(h)); no.people = no.people.filter(p => !p.roles.includes("outgoing"));
  assert.equal(C.reportTitle(no, "2026-09-01"), "Handover update: 24 days to Outgoing Assistant's last day");
  assert.equal(d.preparedFor, "Dana Whitfield");
  assert.deepEqual(d.chapters.map(c => c.title), C.reports.filter(r => r.key !== "jd").map(r => r.title));
  // Each part is the single report, figures, summary and sections unchanged
  for (const c of d.chapters){
    const one = C.principalReport(h, c.key, o);
    assert.deepEqual([c.figures, c.intro, c.parts], [one.figures, one.intro, one.parts], c.key);
  }
  assert.equal(d.parts.length, d.chapters.reduce((n, c) => n + c.parts.length, 0));
  // The overview gives each part's first summary line, and nothing else
  assert.deepEqual(d.intro, d.chapters.map((c, i) => "**" + (i + 1) + ". " + c.title + ".** " + c.intro[0]));
  // Every format draws the parts; sections are numbered right through
  const md = C.docMarkdown(d);
  assert.match(md, /^# Friday update/);
  assert.deepEqual(md.match(/^## Part \d: .*/gm), ["## Part 1: What we're working on", "## Part 2: The assistant's jobs", "## Part 3: What needs you"]);
  const html = C.docHtml(d);
  assert.equal((html.match(/class="partno"/g) || []).length, 3);
  assert.ok(html.includes('<span class="num">' + String(d.parts.length).padStart(2, "0") + "</span>"), "section numbers carry on across parts");
  const pdf = C.docPdf(d);
  assert.ok(pdf.startsWith("%PDF-1.4") && pdf.includes("(PART 3 OF 3)"));
  const docx = Buffer.from(C.docDocx(d)).toString("latin1");
  assert.equal((docx.match(/w:type="page"/g) || []).length, 2, "parts 2 and 3 start on a new page in Word");
  // The job description can go in too, with its own filtering
  const withJd = C.principalReports(h, ["jobs", "jd"], o);
  assert.deepEqual(withJd.chapters[1].parts, C.principalReport(h, "jd", o).parts);
  // Asking for nothing, or for a report that doesn't exist, is refused
  assert.throws(() => C.principalReports(h, [], o), /at least one/);
  assert.throws(() => C.principalReports(h, ["working", "gossip"], o), /No report called gossip/);
  // The skill's command takes several kinds
  const out = execFileSync(process.execPath, [path.join(root, "skills/handover/scripts/handover.cjs"), "report", path.join(root, "site/examples/ea-no-overlap.handover"), "--kind", "working,needs", "--title", "Friday update"]).toString();
  assert.match(out, /^# Friday update[\s\S]*## Part 2: What needs you/);
});

test("job description: only what the file shows, grouped by area, nothing restricted", () => {
  const o = {date: "2026-11-27"}, h = ea();
  assert.ok(C.reports.some(r => r.key === "jd" && r.title === "Job description"));
  const d = C.principalReport(h, "jd", o);
  assert.equal(d.title, h.title); assert.equal(d.name, "Job description"); assert.equal(d.kicker, "Example Holdings");
  assert.equal(d.role, "Job description · Reports to Dana Whitfield");
  assert.equal(d.introLabel, "Purpose of the role"); assert.match(d.intro[0], /^Runs Dana Whitfield's desk/);
  assert.deepEqual(d.figures, []);
  assert.deepEqual(d.parts.map(p => p.title), ["About the role", "Diary and correspondence", "Expenses", "Board", "Travel", "Authority and limits",
    "When something comes up", "Working relationships", "Systems used", "Skills and experience the work calls for", "What good looks like"]);
  const part = t => d.parts.find(p => p.title === t), items = t => part(t).groups.flatMap(g => g.items);
  assert.deepEqual(items("About the role").map(i => [i.title, i.cells[0]]), [["Reports to", "Dana Whitfield"], ["Location", "Head office, in person"],
    ["Hours", "Weekdays 8:00 to 5:00, with some evening events"], ["Travel", "Rarely: Dana travels, and the desk runs from the office"], ["Manages", "No direct reports. Books the company driver for Dana"]]);
  // regular jobs first, then the ones done as needed; a larger area holds its parts
  assert.deepEqual(items("Diary and correspondence").map(i => i.id), ["inbox", "diary-review", "meeting-requests"]);
  assert.deepEqual(items("Diary and correspondence").map(i => i.cells[0]), ["Weekdays, 08:00", "Every Friday, 15:00", "When a request comes in"]);
  assert.deepEqual(part("Board").groups.map(g => g.title), ["Board meetings", "AGM"]);
  // details join the duty; a gap stays in the handover
  assert.equal(items("Expenses")[0].title, "Submit Dana's expense claims for approval. Finance pays claims submitted by Thursday noon in the same week. Miss it and Dana's card statement goes unpaid for a week.");
  assert.equal(items("Travel").find(i => i.id === "visa-letters").title, "Draft visa invitation letters for overseas guests");
  // the who-decides board in the third person
  assert.deepEqual(part("Authority and limits").groups.map(g => g.title), ["Decides alone", "Checks with Dana first", "Always goes to Dana"]);
  // nothing marked for some people only, no contacts, nothing closed
  const all = JSON.stringify(d);
  assert.ok(!items("Working relationships").some(i => i.id === "partner"), "Sam's card is for some roles only");
  assert.ok(!/Ext\. 2210|protected contacts file/.test(all), "no contact details");
  const v = ea(); v.rules.push({id: "private-rule", text: "Private to the assistants", visibleTo: ["outgoing", "owner"]}); v.systems[0].closed = {how: "dropped", at: "2026-11-20T09:00:00Z"};
  const dv = C.principalReport(v, "jd", o);
  assert.ok(!JSON.stringify(dv).includes("Private to the assistants")); assert.ok(!dv.parts.find(p => p.title === "Systems used").groups[0].items.some(i => i.id === v.systems[0].id));
  // without areas: by how often; without a role or a principal: no purpose, no reporting line
  const f = strip12(ea()); f.asNeeded = [{id: "letters", text: "Draft employment letters"}]; f.handover = "1.2";
  f.people = f.people.filter(p => !p.roles.includes("principal"));
  const df = C.principalReport(f, "jd", o);
  assert.deepEqual(df.parts.slice(0, 2).map(p => p.title), ["Regular duties", "Done as needed"]);
  assert.deepEqual(df.parts[0].groups.map(g => g.title), ["Every day", "Every week", "Every month", "Every quarter", "Every year"]);
  assert.deepEqual(df.parts[1].groups[0].items[0].cells, ["As needed"]);
  assert.ok(!df.parts.some(p => p.title === "About the role")); assert.deepEqual(df.intro, []); assert.equal(df.kicker, "Job description");
  assert.ok(df.parts.find(p => p.title === "Authority and limits").groups.some(g => g.title === "Checks with the principal first"));
  // every format
  const md = C.docMarkdown(d);
  assert.match(md, /^# Executive assistant to the CEO\n\n\*Example Holdings · Job description · Reports to Dana Whitfield · Friday, 27 November 2026\*\n\n## Purpose of the role\n\nRuns Dana/);
  assert.ok(md.includes("- Triage Dana's inbox and flag anything for today *(Weekdays, 08:00)*"));
  assert.ok(!md.includes("### Skills and experience the work calls for"), "no heading twice");
  const html = C.docHtml(d);
  assert.ok(html.includes(">Purpose of the role<") && html.includes(">Example Holdings<"));
  assert.match(C.docPdf(d, {timezone: h.timezone}), /^%PDF-1\.4/);
  assert.ok(C.docDocx(d).length > 1000);
});

/* Transition kit: one self-contained HTML file (core.transitionKit) */
const viewer = () => fs.readFileSync(path.join(root, "app/web/index.html"), "utf8");
const scriptsOf = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(m => ({attrs: m[1], body: m[2]}));
test("transition kit: self-contained, with no external URLs in any tag", () => {
  const html = C.transitionKit(ea(), {viewer: viewer(), date: "2026-11-27"});
  assert.match(html, /^<!doctype html>/i);
  const tags = html.match(/<(?:script|link|img|iframe|a|source|video|audio|embed|object|form)\b[^>]*>/gi) || [];
  tags.forEach(t => assert.ok(!/\b(?:src|href|action|data)\s*=\s*["']?(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(t), "external URL in " + t));
  assert.ok(!/<link\b/i.test(html), "no linked stylesheets");
  assert.ok(!/@import|url\(\s*["']?(?:https?:)?\/\//i.test(html), "no CSS that loads from the web");
  assert.ok(!html.includes('<script src="core.js">'), "core.js is inlined");
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'">/);
  const scripts = scriptsOf(html);
  assert.deepEqual(scripts.map(s => s.attrs.trim()), ["", 'type="application/json" id="handover-kit"', ""]);
  scripts.filter(s => !s.attrs.trim()).forEach(s => assert.doesNotThrow(() => new Function(s.body), "inline script parses"));
});
test("transition kit: the data block round-trips, newcomer by default", () => {
  const h = ea(), kit = C.readKit(C.transitionKit(h, {viewer: viewer(), date: "2026-11-27"}));
  assert.equal(kit.kit, 1); assert.equal(kit.made, "2026-11-27"); assert.equal(kit.profile, "newcomer");
  assert.deepEqual(kit.handover, C.exportProfile(h, "newcomer"));
  assert.deepEqual(C.validate(kit.handover).errors, []);
  const rec = C.readKit(C.transitionKit(h, {viewer: viewer(), profile: "record"}));
  assert.deepEqual(rec.handover, C.exportProfile(h, "record"));
  // a 1.0 file goes in as its content
  const s = sample(); s.progress = {tasks: {x: "2026-01-01T00:00:00Z"}, recurring: {}};
  assert.deepEqual(C.readKit(C.transitionKit(s, {viewer: viewer()})).handover, C.contentOnly(s));
  // text that looks like markup can't end the data block early
  const t = ea(); t.summary = "Ends here </script><script>alert(1)</script> <!-- and   here";
  const tk = C.transitionKit(t, {viewer: viewer()});
  assert.equal(scriptsOf(tk).length, 3);
  assert.equal(C.readKit(tk).handover.summary, t.summary);
  assert.throws(() => C.transitionKit(ea(), {}), /viewer/);
  assert.throws(() => C.transitionKit(ea(), {viewer: viewer(), profile: "everyone"}), /profile/);
});
test("transition kit: nothing the audience may not see", () => {
  const h = ea();
  h.rules.push({id: "principal-only", text: "Kept only for the principal: the board seating plan", visibleTo: ["principal"]});
  const newcomer = C.transitionKit(h, {viewer: viewer()});
  ["Sam Whitfield", "evenings-line", "Profile correction: Dana reads WhatsApp", "principal-only", "board seating plan"].forEach(s => assert.ok(!newcomer.includes(s), "newcomer kit has " + s));
  assert.ok(!/"progress"|"history"|"plan"/.test(JSON.stringify(C.readKit(newcomer).handover)), "no process state in a newcomer kit");
  const record = C.transitionKit(h, {viewer: viewer(), profile: "record"});
  assert.ok(record.includes("Sam Whitfield") && record.includes("evenings-line"), "the record keeps what its audience may see");
  assert.ok(!record.includes("board seating plan"), "but not what only someone else may see");
});
test("the kit command writes a kit the format accepts", () => {
  const out = execFileSync("node", [path.join(root, "skills/handover/scripts/handover.cjs"), "kit", path.join(root, "site/examples/ea-no-overlap.handover")], {encoding: "utf8", maxBuffer: 1 << 26});
  const kit = C.readKit(out);
  assert.equal(kit.profile, "newcomer");
  assert.deepEqual(C.validate(kit.handover).errors, []);
  assert.ok(!out.includes("Sam Whitfield"));
});

/* ================= 1.3: lead time on regular jobs ================= */
const vehicle = () => ({handover: "1.3", id: "fleet", title: "Fleet handover", timezone: "America/Jamaica", recurring: [
  {id: "van-registration", text: "Renew the van's registration and fitness", area: "Vehicles", every: "year", date: "03-15", lead: 90},
  {id: "van-insurance", text: "Renew the van's insurance", area: "Vehicles", every: "year", date: "03-15", lead: 30},
  {id: "payroll", text: "Run payroll", every: "month", day: 25}]});

test("1.3: a lead time is checked, and needs format 1.3", () => {
  assert.deepEqual(C.validate(vehicle()), {errors: [], warnings: []});
  assert.deepEqual(check(schema.latest, vehicle()), []); assert.deepEqual(check(schema.v13, vehicle()), []);
  assert.ok(check(schema.v12, vehicle()).length, "the frozen 1.2 schema rejects lead");
  assert.equal(C.usesMinor(vehicle()), 3);
  let h = vehicle(); h.handover = "1.2";
  assert.deepEqual(C.validate(h).warnings, ['handover: the file says "1.2" but uses 1.3 fields. Set it to "1.3"']);
  for (const bad of [0, 367, 1.5, "90"]) { h = vehicle(); h.recurring[0].lead = bad; expectError(h, /recurring\[0\]\.lead: must be a whole number of days, 1 to 366/); }
  h = vehicle(); h.recurring[2].lead = 28;
  assert.match(C.validate(h).warnings.join("\n"), /recurring\[2\]\.lead: 28 days ahead reaches back past the previous occurrence/);
  h = vehicle(); h.recurring.push({id: "post", text: "Open the post", every: "weekday", lead: 2});
  assert.match(C.validate(h).warnings.join("\n"), /recurring\[3\]\.lead: a lead time has no effect on a job done every day or weekday/);
  h = vehicle(); h.recurring.push({id: "flowers", text: "Order the flowers", every: "week", on: ["mon", "thu"], lead: 3});
  assert.match(C.validate(h).warnings.join("\n"), /about every 3 days/);
});

test("1.3: a job goes on the list its lead time before its date and stays until it is done", () => {
  const h = vehicle(), p = {firstSeen: "2026-12-01"};
  const at = d => C.schedule(h, p, d), ids = l => l.map(o => o.r.id);
  // a week before the registration's start day: in Next 7 days, by its start day
  let sc = at("2026-12-10");
  assert.deepEqual(sc.start, []);
  assert.deepEqual(sc.next.map(o => [o.r.id, o.starts, o.date]), [["van-registration", "2026-12-15", "2027-03-15"]]);
  assert.deepEqual(sc.later.filter(o => o.starts).map(o => [o.r.id, o.starts]), [["van-insurance", "2027-02-13"]]);
  // the start day: 90 days ahead
  sc = at("2026-12-15");
  assert.deepEqual(sc.start.map(o => [o.r.id, o.date, o.starts, o.daysLeft, o.done]), [["van-registration", "2027-03-15", "2026-12-15", 90, false]]);
  assert.deepEqual(sc.next, []);
  // both under way, most urgent first; the insurance from 30 days ahead
  sc = at("2027-02-13");
  assert.deepEqual(sc.start.map(o => [o.r.id, o.daysLeft]), [["van-registration", 30], ["van-insurance", 30]]);
  // ticking it ahead of time marks the due date's occurrence done
  const done = C.schedule(h, {firstSeen: "2026-12-01", recurring: {"van-registration@2027-03-15": "2027-02-01T10:00:00-05:00"}}, "2027-02-13");
  assert.deepEqual(done.start.map(o => [o.r.id, o.done]), [["van-registration", true], ["van-insurance", false]]);
  // on the date it is due, and after it, overdue unless done
  assert.deepEqual(ids(at("2027-03-15").due), ["van-registration", "van-insurance"]);
  assert.deepEqual(ids(at("2027-03-16").overdue).filter(id => id !== "payroll"), ["van-registration", "van-insurance"]);
  const after = C.schedule(h, {firstSeen: "2026-12-01", recurring: {"van-registration@2027-03-15": "2027-02-01T10:00:00-05:00"}}, "2027-03-16");
  assert.deepEqual(ids(after.overdue).filter(id => id !== "payroll"), ["van-insurance"]);
  // a job without a lead time is unchanged
  assert.deepEqual(at("2026-12-20").next.map(o => [o.r.id, o.date, o.starts]), [["payroll", "2026-12-25", undefined]]);
});

test("1.3: the lead time shows with how often a job happens, and can be edited", () => {
  assert.equal(C.cadence(vehicle().recurring[0]), "Every year, 15 Mar, starting 90 days before");
  assert.equal(C.cadence({every: "week", on: "fri", lead: 14}), "Every Friday, starting 2 weeks before");
  assert.equal(C.cadence({every: "month", day: 1, lead: 1}), "Monthly, the 1st, starting 1 day before");
  // a 1.2 file given a lead time in the app becomes 1.3, and keeps its progress keys
  const h = ea(), id = h.recurring.find(r => r.every === "month").id;
  const v = C.editValues(h, "recurring", id); v.lead = "10";
  const res = C.editItem(h, "recurring", id, v, {role: "incoming", date: "2026-11-27"});
  assert.equal(res.h.handover, "1.3"); assert.deepEqual(res.changed, ["the lead time"]);
  assert.equal(res.h.recurring.find(r => r.id === id).lead, 10);
  assert.deepEqual(C.validate(res.h), {errors: [], warnings: []});
  assert.equal(C.editValues(res.h, "recurring", id).lead, "10");
  for (const bad of ["0", "abc", "400", "2.5"]) { const w = Object.assign({}, v, {lead: bad}); assert.throws(() => C.editItem(h, "recurring", id, w, {}), /Lead time in days/); }
  // emptying it removes it
  const back = C.editItem(res.h, "recurring", id, Object.assign({}, v, {lead: ""}), {date: "2026-11-27"});
  assert.equal(back.h.recurring.find(r => r.id === id).lead, undefined);
  // a daily job's form has no lead time
  assert.equal(C.fieldApplies(C.editFields("recurring").find(d => d.k === "lead"), {every: "day"}), false);
});

test("1.3: the CLI lists what to start now and when the work starts", () => {
  const f = path.join(require("os").tmpdir(), "fleet-" + process.pid + ".handover");
  fs.writeFileSync(f, JSON.stringify(vehicle()));
  try {
    const out = execFileSync(process.execPath, [path.join(root, "skills/handover/scripts/handover.cjs"), "due", f, "2027-02-10", "--days", "5"], {encoding: "utf8"});
    assert.match(out, /Start now:\n  Mon 15 Mar  Renew the van's registration and fitness  \(due in 33 days, on the list since Tue 15 Dec\)/);
    assert.match(out, /Next 5 days:\n  Sat 13 Feb  Start: Renew the van's insurance  \(due Mon 15 Mar\)/);
  } finally { fs.unlinkSync(f); }
});

/* Reminders (the Mac app posts these as notifications) */
const desk = () => ({handover: "1.3", id: "desk", title: "Front desk", timezone: "America/Jamaica", settings: {dailyExportTime: "07:30"}, recurring: [
  {id: "post", text: "Open the **post**", every: "weekday", time: "09:00"},
  {id: "petty", text: "Count the petty cash", every: "week", on: "fri", time: "16:00", detail: "Use the blue tin.\nLog it in the book."},
  {id: "rates", text: "Pay the rates", every: "month", day: 1},
  {id: "van-insurance", text: "Renew the van's insurance", every: "year", date: "12-10", lead: 30}],
  inProgress: [{id: "boiler", text: "Get the boiler serviced", due: "2026-12-01"}, {id: "old", text: "Closed already", due: "2026-11-01", closed: {how: "done"}}]});
const jam = (date, time) => Date.parse(date + "T" + time + ":00-05:00");

test("reminders: a morning summary of what's to do, and each timed job at its time, in the handover's zone", () => {
  const r = C.reminders(desk(), {firstSeen: "2026-11-25"}, jam("2026-11-27", "06:00"), {days: 3});   // a Friday
  assert.deepEqual(r.map(x => [x.id, new Date(x.at).toISOString()]), [
    ["summary.2026-11-27", "2026-11-27T12:30:00.000Z"],
    ["job.post@2026-11-27", "2026-11-27T14:00:00.000Z"],
    ["job.petty@2026-11-27", "2026-11-27T21:00:00.000Z"],
    ["summary.2026-11-28", "2026-11-28T12:30:00.000Z"],
    ["summary.2026-11-29", "2026-11-29T12:30:00.000Z"]]);
  const [sum, post, petty] = r;
  assert.equal(sum.title, "Front desk");
  assert.equal(sum.subtitle, "4 things to do today");
  assert.equal(sum.body, "Due: Open the post (09:00), Count the petty cash (16:00)\nOverdue: Open the post\nUnder way: Renew the van's insurance (13 days left)");
  assert.deepEqual([post.kind, post.key, post.date, post.title, post.subtitle, post.body], ["job", "post@2026-11-27", "2026-11-27", "Open the post", "Front desk", "Due at 09:00"]);
  assert.equal(petty.body, "Due at 16:00. Use the blue tin.");
  // the weekend: nothing due, but the lead-time job and the overdue post are still there
  assert.equal(r[3].body, "Overdue: Open the post, Count the petty cash\nUnder way: Renew the van's insurance (12 days left)");
});

test("reminders: ticks, the time of day and the settings decide what is left", () => {
  const h = desk(), now = jam("2026-11-30", "10:00");   // Monday, after the summary and the post
  const p = {firstSeen: "2026-11-25", recurring: {"post@2026-11-27": "x", "petty@2026-11-27": "x", "van-insurance@2026-12-10": "x"}};
  const r = C.reminders(h, p, now, {days: 2});
  assert.deepEqual(r.map(x => x.id), ["summary.2026-12-01", "job.post@2026-12-01"]);
  assert.equal(r[0].body, "Due: Pay the rates, Open the post (09:00)\nOverdue: Open the post\nIn progress: Get the boiler serviced");
  // ticked today's post: no reminder for it, and tomorrow's summary drops it from overdue
  p.recurring["post@2026-11-30"] = "x"; p.recurring["post@2026-12-01"] = "x";
  assert.deepEqual(C.reminders(h, p, now, {days: 2}).map(x => [x.id, x.body]), [["summary.2026-12-01", "Due: Pay the rates\nIn progress: Get the boiler serviced"]]);
  // overdue work in progress says so
  assert.match(C.reminders(h, p, jam("2026-12-01", "10:00"), {days: 2})[0].body, /In progress: Get the boiler serviced \(overdue\)/);
  // turned off, one kind at a time
  assert.deepEqual(C.reminders(desk(), {firstSeen: "2026-11-25"}, jam("2026-11-27", "06:00"), {days: 3, morning: false}).map(x => x.kind), ["job", "job"]);
  assert.deepEqual(C.reminders(desk(), {firstSeen: "2026-11-25"}, jam("2026-11-27", "06:00"), {days: 3, jobs: false}).map(x => x.kind), ["summary", "summary", "summary"]);
  // a day with nothing to do has no summary; with no setting the summary is at 07:00; the schedule reaches two weeks ahead
  const quiet = {handover: "1.0", id: "q", title: "Quiet", timezone: "Europe/London", recurring: [{id: "a", text: "A", every: "week", on: "mon"}]};
  assert.deepEqual(C.reminders(quiet, {}, Date.parse("2026-07-05T00:00:00Z")).map(x => [x.id, new Date(x.at).toISOString()]),
    [["summary.2026-07-06", "2026-07-06T06:00:00.000Z"], ["summary.2026-07-13", "2026-07-13T06:00:00.000Z"]]);
  assert.equal(C.reminders(quiet, {}, Date.parse("2026-07-07T00:00:00Z")).map(x => x.id).join(), "summary.2026-07-13,summary.2026-07-20");
  // never more than the limit, and only whole days: Monday's summary fits but its post doesn't, so Monday goes
  const full = C.reminders(desk(), {}, jam("2026-11-27", "06:00"), {limit: 6});
  assert.deepEqual(full.map(x => x.id), ["summary.2026-11-27", "job.post@2026-11-27", "job.petty@2026-11-27", "summary.2026-11-28", "summary.2026-11-29"]);
  assert.equal(C.reminders(desk(), {}, jam("2026-11-27", "06:00"), {days: 30, limit: 7}).length, 7);
  // two weeks of a busy desk fit under the default limit
  const two = C.reminders(desk(), {}, jam("2026-11-27", "06:00"));
  assert.ok(two.length <= 60);
  assert.equal(two[two.length - 1].date, "2026-12-10");
  // a single day with more than the limit still schedules the earliest
  assert.equal(C.reminders(desk(), {}, jam("2026-11-27", "06:00"), {limit: 1}).length, 1);
});

test("reminders: a wall-clock time becomes the right instant either side of a clock change", () => {
  assert.equal(new Date(C.zoneTime("2026-07-01", "09:00", "Europe/London")).toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(new Date(C.zoneTime("2026-01-15", "09:00", "Europe/London")).toISOString(), "2026-01-15T09:00:00.000Z");
  assert.equal(new Date(C.zoneTime("2026-11-02", "07:00", "America/New_York")).toISOString(), "2026-11-02T12:00:00.000Z");
  assert.equal(new Date(C.zoneTime("2026-10-30", "07:00", "America/New_York")).toISOString(), "2026-10-30T11:00:00.000Z");
});

test("reminders: the jobs ticked since a day, so a reminder put off for later can be dropped", () => {
  const p = {recurring: {"post@2026-11-26": "x", "post@2026-11-27": "x", "petty@2026-11-27": "x", "van-insurance@2026-12-10": "x", "old@2026-11-01": "x", "gone@2026-11-28": ""}};
  assert.deepEqual(C.ticksSince(p, "2026-11-27"), ["petty@2026-11-27", "post@2026-11-27", "van-insurance@2026-12-10"]);
  assert.deepEqual(C.ticksSince({}, "2026-11-27"), []);
  assert.deepEqual(C.ticksSince(undefined, "2026-11-27"), []);
});
