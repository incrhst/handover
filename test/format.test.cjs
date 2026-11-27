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
