// Tests for merging two copies of a handover changed apart (a shared folder): node --test test/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../app/web/core.js");

const ea = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "site/examples/ea-no-overlap.handover"), "utf8"));
const valid = h => assert.deepEqual(C.validate(h).errors, []);
const ids = list => list.map(x => x.id);
const gap = (h, id) => h.gaps.find(x => x.id === id);
const day = "2026-11-27";

test("two identical copies merge to the same content with nothing to report", () => {
  const r = C.mergeHandover(ea(), ea(), ea());
  assert.deepEqual(r.conflicts, []); assert.deepEqual(r.renamed, []);
  assert.deepEqual(r.h, C.withRendered(ea()));
});

test("a change made only on the other Mac is taken", () => {
  const base = ea(), theirs = C.closeItem(base, "gaps", "travel-booking", {how: "fixed", fix: "Template is in the shared drive", date: day, at: day + "T09:00:00Z"});
  const r = C.mergeHandover(base, base, theirs);
  assert.equal(gap(r.h, "travel-booking").closed.how, "fixed");
  assert.deepEqual(r.conflicts, []);
  valid(r.h);
});

test("records added on both sides are both kept, and both change-log entries survive", () => {
  const base = ea();
  const mine = C.addItem(base, "gaps", {text: "Who orders the board lunch"}, {role: "incoming", date: day, at: day + "T09:00:00Z"});
  const theirs = C.addItem(base, "rules", {text: "Never book Friday afternoons"}, {role: "outgoing", date: day, at: day + "T10:00:00Z"});
  const r = C.mergeHandover(base, mine.h, theirs.h);
  assert.ok(gap(r.h, mine.id), "my gap is there");
  assert.ok(r.h.rules.some(x => x.id === theirs.id), "their rule is there");
  assert.equal(r.h.history.length, base.history.length + 2);
  assert.equal(new Set(ids(r.h.history)).size, r.h.history.length, "change-log ids stay unique");
  valid(r.h);
});

test("the change log stays in time order after a merge", () => {
  const base = ea();
  const mine = C.addItem(base, "gaps", {text: "Later one"}, {date: day, at: day + "T15:00:00Z"}).h;
  const theirs = C.addItem(base, "gaps", {text: "Earlier one"}, {date: day, at: day + "T08:00:00Z"}).h;
  const at = C.mergeHandover(base, mine, theirs).h.history.map(x => x.at);
  assert.deepEqual(at, at.slice().sort());
});

test("different changes to the same item are combined field by field", () => {
  const base = ea();
  const mine = C.editItem(base, "gaps", "travel-booking", {text: "Travel booking: who has the account", blocks: false}, {date: day}).h;
  const theirs = C.closeItem(base, "gaps", "travel-booking", {how: "fixed", fix: "Found it", date: day, at: day + "T11:00:00Z"});
  const r = C.mergeHandover(base, mine, theirs);
  const g = gap(r.h, "travel-booking");
  assert.equal(g.text, "Travel booking: who has the account");
  assert.equal(g.closed.how, "fixed");
  valid(r.h);
});

test("when both change the same field, mine is kept and the field is reported", () => {
  const base = ea();
  const mine = C.editItem(base, "gaps", "travel-booking", {text: "Mine"}, {date: day}).h;
  const theirs = C.editItem(base, "gaps", "travel-booking", {text: "Theirs"}, {date: day}).h;
  const r = C.mergeHandover(base, mine, theirs);
  assert.equal(gap(r.h, "travel-booking").text, "Mine");
  assert.ok(r.conflicts.includes("gaps › travel-booking › text"), r.conflicts.join("\n"));
});

test("reopening on one Mac removes the close, if the other Mac left it alone", () => {
  const base = C.closeItem(ea(), "gaps", "travel-booking", {how: "fixed", fix: "Found it", date: day, at: day + "T11:00:00Z"});
  const mine = C.reopenItem(base, "gaps", "travel-booking", {date: day});
  const r = C.mergeHandover(base, mine, base);
  assert.equal(gap(r.h, "travel-booking").closed, undefined);
});

test("an item removed on one side stays removed unless the other side changed it", () => {
  const base = ea(), theirs = ea();
  theirs.gaps = theirs.gaps.filter(x => x.id !== "evenings-line");
  assert.equal(gap(C.mergeHandover(base, base, theirs).h, "evenings-line"), undefined);
  const mine = C.editItem(base, "gaps", "evenings-line", {text: "Evenings line: still needed"}, {date: day}).h;
  assert.equal(gap(C.mergeHandover(base, mine, theirs).h, "evenings-line").text, "Evenings line: still needed");
});

test("two different items added under the same id are both kept, and mine gets a new id", () => {
  const base = ea();
  const mine = C.addItem(base, "gaps", {text: "Board pack"}, {date: day, at: day + "T09:00:00Z"});
  const theirs = C.addItem(base, "gaps", {text: "Board pack"}, {date: day, at: day + "T10:30:00Z"});
  assert.equal(mine.id, theirs.id, "the app picked the same id on both Macs");
  const r = C.mergeHandover(base, mine.h, theirs.h);
  const added = r.h.gaps.filter(x => x.text === "Board pack");
  assert.equal(added.length, 2);
  assert.ok(r.renamed.some(x => x.from === mine.id && x.where === "gaps"));
  assert.equal(new Set(ids(r.h.gaps)).size, r.h.gaps.length);
  valid(r.h);
});

test("an item I added goes after the item before it in my copy", () => {
  const base = ea(), mine = ea();
  const at = mine.gaps.findIndex(x => x.id === "travel-booking");
  mine.gaps.splice(at + 1, 0, {id: "new-one", text: "New", added: day + "T09:00:00Z"});
  const r = C.mergeHandover(base, mine, base);
  const g = ids(r.h.gaps);
  assert.equal(g[g.indexOf("travel-booking") + 1], "new-one");
});

test("with no common copy, nothing counts as removed", () => {
  const mine = ea(), theirs = ea();
  mine.gaps = mine.gaps.slice(1);
  const r = C.mergeHandover(null, mine, theirs);
  assert.deepEqual(ids(r.h.gaps), ids(theirs.gaps));
});

test("the later updated date wins without counting as a conflict", () => {
  const base = ea(), mine = ea(), theirs = ea();
  mine.updated = "2026-11-20"; theirs.updated = "2026-11-25";
  const r = C.mergeHandover(base, mine, theirs);
  assert.equal(r.h.updated, "2026-11-25");
  assert.deepEqual(r.conflicts, []);
});

test("sections for 1.0 readers are written again from the merged data", () => {
  const base = ea();
  const mine = C.addItem(base, "gaps", {text: "Who orders the board lunch"}, {date: day, at: day + "T09:00:00Z"}).h;
  const theirs = C.addItem(base, "gaps", {text: "Where the spare keys are"}, {date: day, at: day + "T10:00:00Z"}).h;
  const r = C.mergeHandover(base, mine, theirs);
  const open = r.h.sections.find(s => s.id === "handover-open");
  assert.match(open.body, /board lunch/); assert.match(open.body, /spare keys/);
  assert.deepEqual(r.conflicts, [], "rendered sections are never conflicts");
});

test("progress is never part of the merged content", () => {
  const mine = ea(); mine.progress = {tasks: {x: "2026-11-27"}};
  assert.equal(C.mergeHandover(ea(), mine, ea()).h.progress, undefined);
});

test("copies of different handovers are refused", () => {
  const other = ea(); other.id = "someone-else";
  assert.throws(() => C.mergeHandover(null, ea(), other), /different handovers/);
});
