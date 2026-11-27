/* Handover format core: validation, schedules and progress merging.
   Shared, unchanged, by the app (app/web/core.js) and the agent skill
   (skills/handover/scripts/core.js). Plain ES5, no dependencies.
   In a browser it sets window.HandoverCore; in Node it is module.exports.
   Spec: https://github.com/incrhst/handover/blob/main/spec/SPEC.md */
(function(root){
"use strict";
/* ================= Validation (mirrors schema/v1.json) ================= */
var ID = /^[a-z0-9][a-z0-9-]{0,63}$/, DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
var DAYS = ["mon","tue","wed","thu","fri","sat","sun"], EVERY = ["day","weekday","week","month","quarter","year"];
function validate(h){
  var errors = [], warnings = [], strict = true;
  function isObj(v){ return v && typeof v === "object" && !Array.isArray(v); }
  function err(p, msg){ (strict ? errors : warnings).push((p ? p + ": " : "") + msg); }
  function keys(o, p, allowed){ Object.keys(o).forEach(function(k){ if (allowed.indexOf(k) < 0 && k.indexOf("x-") !== 0) err(p ? p + "." + k : k, "not a known field. Allowed: " + allowed.join(", ") + ", or an x- extension"); }); }
  function at(p, k){ return p ? p + "." + k : k; }
  function text(o, k, p, req){ var v = o[k]; if (v === undefined){ if (req) errors.push(at(p, k) + ": required"); return; } if (typeof v !== "string" || !v.trim()) errors.push(at(p, k) + ": must be non-empty text"); }
  function pat(o, k, p, re, what, req){ var v = o[k]; if (v === undefined){ if (req) errors.push(at(p, k) + ": required"); return; } if (typeof v !== "string" || !re.test(v)) errors.push(at(p, k) + ": must be " + what + (typeof v === "string" ? ' (got "' + v + '")' : "")); }
  function list(k){ if (h[k] === undefined) return []; if (!Array.isArray(h[k])){ errors.push(k + ": must be a list"); return []; } return h[k]; }
  if (!isObj(h)) return {errors: ["The file must contain a JSON object, starting with {"], warnings: []};
  if (typeof h.handover !== "string" || !/^\d+\.\d+$/.test(h.handover)) return {errors: ['handover: required. It is the format version, "1.0". Is this a handover file?'], warnings: []};
  var ver = h.handover.split(".").map(Number);
  if (ver[0] !== 1) return {errors: ["handover: this app reads format version 1.x, but the file is version " + h.handover + ". Update the app."], warnings: []};
  strict = ver[1] === 0;
  keys(h, "", ["$schema","handover","id","title","summary","from","updated","timezone","settings","path","recurring","questions","sections","progress"]);
  pat(h, "id", "", ID, "lowercase letters, digits and dashes, e.g. ops-lead", true);
  if (h.title === undefined) errors.push("title: required"); else text(h, "title", "", true);
  if (h.summary !== undefined) text(h, "summary", "", false);
  if (h.updated !== undefined) pat(h, "updated", "", DATE, "a date like 2026-11-26");
  if (h.timezone !== undefined){ try { new Intl.DateTimeFormat("en-GB", {timeZone: h.timezone}); } catch(e){ errors.push('timezone: "' + h.timezone + '" is not a known time zone. Use a name like Europe/London'); } }
  if (h.from !== undefined){ if (!isObj(h.from)) errors.push("from: must be an object with a name"); else { keys(h.from, "from", ["name","role","contact","availableUntil"]); text(h.from, "name", "from", true); if (h.from.availableUntil !== undefined) pat(h.from, "availableUntil", "from", DATE, "a date like 2026-12-31"); } }
  if (h.settings !== undefined){ if (!isObj(h.settings)) errors.push("settings: must be an object"); else { keys(h.settings, "settings", ["dailyExportTime"]); if (h.settings.dailyExportTime !== undefined) pat(h.settings, "dailyExportTime", "settings", TIME, "a time like 07:00"); } }
  var sec = {}; list("sections").forEach(function(s, i){ var p = "sections[" + i + "]"; if (!isObj(s)){ errors.push(p + ": must be an object"); return; } keys(s, p, ["id","title","body"]); pat(s, "id", p, ID, "an id like systems", true); text(s, "title", p, true); text(s, "body", p, true); if (s.id){ if (sec[s.id]) errors.push(p + ".id: \"" + s.id + "\" is used twice"); sec[s.id] = true; } });
  function see(o, p){ if (o.see !== undefined){ if (typeof o.see !== "string" || !sec[o.see]) errors.push(p + '.see: no section has id "' + o.see + '"'); } }
  var stageIds = {}, taskIds = {};
  list("path").forEach(function(s, i){
    var p = "path[" + i + "]"; if (!isObj(s)){ errors.push(p + ": must be an object"); return; }
    keys(s, p, ["id","title","summary","tip","tasks"]); pat(s, "id", p, ID, "an id like week-1", true); text(s, "title", p, true);
    if (s.id){ if (stageIds[s.id]) errors.push(p + '.id: "' + s.id + '" is used twice'); stageIds[s.id] = true; }
    if (s.summary !== undefined) text(s, "summary", p);
    if (s.tip !== undefined){ if (!isObj(s.tip)) errors.push(p + ".tip: must be an object"); else { keys(s.tip, p + ".tip", ["title","text"]); text(s.tip, "text", p + ".tip", true); } }
    if (!Array.isArray(s.tasks) || !s.tasks.length) errors.push(p + ".tasks: needs at least one task");
    else s.tasks.forEach(function(t, j){ var q = p + ".tasks[" + j + "]"; if (!isObj(t)){ errors.push(q + ": must be an object"); return; } keys(t, q, ["id","text","detail"]); pat(t, "id", q, ID, "an id like get-access", true); text(t, "text", q, true); if (t.id){ if (taskIds[t.id]) errors.push(q + '.id: "' + t.id + '" is used by another task'); taskIds[t.id] = true; } });
  });
  var recIds = {};
  list("recurring").forEach(function(r, i){
    var p = "recurring[" + i + "]"; if (!isObj(r)){ errors.push(p + ": must be an object"); return; }
    keys(r, p, ["id","text","every","on","day","monthOfQuarter","date","time","start","end","detail","see"]);
    pat(r, "id", p, ID, "an id like payroll", true); text(r, "text", p, true);
    if (r.id){ if (recIds[r.id]) errors.push(p + '.id: "' + r.id + '" is used twice'); recIds[r.id] = true; }
    if (EVERY.indexOf(r.every) < 0) errors.push(p + ".every: must be one of " + EVERY.join(", "));
    if (r.on !== undefined){ var on = [].concat(r.on); if (!on.length || on.some(function(d){ return DAYS.indexOf(d) < 0; })) errors.push(p + ".on: use mon, tue, wed, thu, fri, sat or sun, or a list of them"); }
    if (r.day !== undefined && r.day !== "last" && !(Number.isInteger(r.day) && r.day >= 1 && r.day <= 31)) errors.push(p + '.day: must be 1 to 31, or "last"');
    if (r.monthOfQuarter !== undefined && [1,2,3].indexOf(r.monthOfQuarter) < 0) errors.push(p + ".monthOfQuarter: must be 1, 2 or 3");
    if (r.every === "year"){ if (typeof r.date !== "string" || !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(r.date)) errors.push(p + '.date: yearly duties need a date like "03-01" (MM-DD)'); }
    else if (r.date !== undefined) err(p + ".date", "only used when every is year");
    if (r.time !== undefined) pat(r, "time", p, TIME, "a time like 09:30");
    if (r.start !== undefined) pat(r, "start", p, DATE, "a date like 2026-12-01");
    if (r.end !== undefined) pat(r, "end", p, DATE, "a date like 2027-06-30");
    if (r.detail !== undefined) text(r, "detail", p);
    see(r, p);
  });
  list("questions").forEach(function(q, i){ var p = "questions[" + i + "]"; if (!isObj(q)){ errors.push(p + ": must be an object"); return; } keys(q, p, ["id","q","a","tag","see"]); text(q, "q", p, true); text(q, "a", p, true); if (q.id !== undefined) pat(q, "id", p, ID, "an id"); if (q.tag !== undefined) text(q, "tag", p); see(q, p); });
  if (h.progress !== undefined){
    var g = h.progress; if (!isObj(g)) errors.push("progress: must be an object");
    else { keys(g, "progress", ["updated","firstSeen","tasks","recurring","notes"]); if (g.firstSeen !== undefined) pat(g, "firstSeen", "progress", DATE, "a date");
      ["tasks","recurring"].forEach(function(k){ if (g[k] !== undefined && !isObj(g[k])) errors.push("progress." + k + ": must be an object"); });
      if (g.notes !== undefined && typeof g.notes !== "string") errors.push("progress.notes: must be text"); }
  }
  return {errors: errors, warnings: warnings};
}

/* ================= Dates and schedules (spec section 5) ================= */
var DOW = ["sun","mon","tue","wed","thu","fri","sat"];
function utc(s){ var a = s.split("-").map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); }
function ymd(t){ return new Date(t).toISOString().slice(0, 10); }
function addDays(s, n){ return ymd(utc(s) + n * 86400000); }
function parts(s){ var d = new Date(utc(s)); return {y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay()}; }
function dim(y, m){ return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function zoneParts(tz){
  var o = {}; try { new Intl.DateTimeFormat("en-GB", {timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(new Date()).forEach(function(p){ o[p.type] = p.value; }); }
  catch(e){ return zoneParts(undefined); }
  return {date: o.year + "-" + o.month + "-" + o.day, time: (o.hour === "24" ? "00" : o.hour) + ":" + o.minute};
}
function dayMatch(day, p){ var last = dim(p.y, p.m); if (day === "last") return p.d === last; return p.d === Math.min(day || 1, last); }
function occursOn(r, s){
  if (r.start && s < r.start) return false; if (r.end && s > r.end) return false;
  var p = parts(s);
  switch (r.every){
    case "day": return true;
    case "weekday": return p.dow >= 1 && p.dow <= 5;
    case "week": return [].concat(r.on || "mon").indexOf(DOW[p.dow]) > -1;
    case "month": return dayMatch(r.day, p);
    case "quarter": return ((p.m - 1) % 3) + 1 === (r.monthOfQuarter || 1) && dayMatch(r.day, p);
    case "year": var md = r.date.split("-").map(Number); return p.m === md[0] && p.d === Math.min(md[1], dim(p.y, p.m));
  }
  return false;
}
var BACK = {day: 1, weekday: 3, week: 7, month: 31, quarter: 92, year: 366};
var fmtShort = new Intl.DateTimeFormat("en-GB", {weekday: "short", day: "numeric", month: "short", timeZone: "UTC"});
var fmtLong = new Intl.DateTimeFormat("en-GB", {weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC"});
var fmtDay = new Intl.DateTimeFormat("en-GB", {day: "numeric", month: "short", timeZone: "UTC"});
function nice(s, kind){ return (kind === "long" ? fmtLong : kind === "day" ? fmtDay : fmtShort).format(new Date(utc(s))); }
function ordinal(n){ var s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
var DAYNAME = {mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday"};
function cadence(r){
  var dayTxt = r.day === "last" ? "the last day" : "the " + ordinal(r.day || 1);
  switch (r.every){
    case "day": return "Every day";
    case "weekday": return "Weekdays";
    case "week": return "Every " + [].concat(r.on || "mon").map(function(d){ return DAYNAME[d]; }).join(" and ");
    case "month": return "Monthly, " + dayTxt;
    case "quarter": return "Quarterly, " + dayTxt + " of " + ["Jan, Apr, Jul and Oct", "Feb, May, Aug and Nov", "Mar, Jun, Sep and Dec"][(r.monthOfQuarter || 1) - 1];
    case "year": return "Every year, " + nice("2001-" + r.date, "day");
  }
  return "";
}
function schedule(h, progress, today){
  progress = progress || {};
  var done = progress.recurring || {};
  function isDone(id, date){ return !!done[id + "@" + date]; }
  var rec = h.recurring || [], floor = progress.firstSeen || today;
  var due = [], overdue = [], next = [], later = [];
  rec.forEach(function(r){
    if (occursOn(r, today)) due.push({r: r, date: today});
    var lim = BACK[r.every] || 31;
    for (var k = 1; k <= lim; k++){
      var s = addDays(today, -k); if (s < floor || (r.start && s < r.start)) break;
      if (occursOn(r, s)){ if (!isDone(r.id, s)) overdue.push({r: r, date: s}); break; }
    }
    if (r.every !== "day" && r.every !== "weekday"){
      for (var j = 1; j <= 7; j++){ var d = addDays(today, j); if (occursOn(r, d)) next.push({r: r, date: d}); }
    }
    if (["month","quarter","year"].indexOf(r.every) > -1){
      for (var x = 8; x <= 75; x++){ var e = addDays(today, x); if (occursOn(r, e)){ later.push({r: r, date: e}); break; } }
    }
  });
  var byDate = function(a, b){ return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.r.time || "") < (b.r.time || "") ? -1 : 1; };
  due.sort(byDate); overdue.sort(byDate); next.sort(byDate); later.sort(byDate);
  return {due: due, overdue: overdue, next: next, later: later};
}

/* ================= Progress (spec section 6) ================= */
function mergeProgress(state, p){
  if (!p) return state;
  state.tasks = state.tasks || {}; state.recurring = state.recurring || {};
  Object.keys(p.tasks || {}).forEach(function(k){ if (!state.tasks[k]) state.tasks[k] = p.tasks[k]; });
  Object.keys(p.recurring || {}).forEach(function(k){ if (!state.recurring[k]) state.recurring[k] = p.recurring[k]; });
  if (p.firstSeen && (!state.firstSeen || p.firstSeen < state.firstSeen)) state.firstSeen = p.firstSeen;
  if (p.notes && !(state.notes || "").trim()) state.notes = p.notes;
  return state;
}
function contentOnly(h){ var c = {}; Object.keys(h).forEach(function(k){ if (k !== "progress") c[k] = h[k]; }); return c; }

var api = {version: "1.0", validate: validate, schedule: schedule, occursOn: occursOn, cadence: cadence, nice: nice, zoneParts: zoneParts, addDays: addDays, mergeProgress: mergeProgress, contentOnly: contentOnly};
if (typeof module === "object" && module.exports) module.exports = api; else root.HandoverCore = api;
})(typeof window !== "undefined" ? window : this);
