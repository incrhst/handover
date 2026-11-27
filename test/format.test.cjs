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
  assert.deepEqual(kinds.slice(0, 2).map(k => k.key), ["jobs", "tasks"]);
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
  assert.deepEqual(C.exportKinds(h).map(k => k.key), ["jobs", "tasks", "questions"]);
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
