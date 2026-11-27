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
  strict = ver[1] <= MINOR; /* a newer minor version may add fields: report them as warnings, never reject (spec section 8) */
  keys(h, "", ["$schema","handover","id","title","summary","from","updated","timezone","settings","path","recurring","questions","sections","progress"].concat(V11));
  pat(h, "id", "", ID, "lowercase letters, digits and dashes, e.g. ops-lead", true);
  if (h.title === undefined) errors.push("title: required"); else text(h, "title", "", true);
  if (h.summary !== undefined) text(h, "summary", "", false);
  if (h.updated !== undefined) pat(h, "updated", "", DATE, "a date like 2026-11-26");
  if (h.timezone !== undefined){ try { new Intl.DateTimeFormat("en-GB", {timeZone: h.timezone}); } catch(e){ errors.push('timezone: "' + h.timezone + '" is not a known time zone. Use a name like Europe/London'); } }
  if (h.from !== undefined){ if (!isObj(h.from)) errors.push("from: must be an object with a name"); else { keys(h.from, "from", ["name","role","contact","availableUntil","hours","paid"]); text(h.from, "name", "from", true); if (h.from.availableUntil !== undefined) pat(h.from, "availableUntil", "from", DATE, "a date like 2026-12-31"); if (h.from.hours !== undefined) text(h.from, "hours", "from"); if (h.from.paid !== undefined && typeof h.from.paid !== "boolean") errors.push("from.paid: must be true or false"); } }
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
  validate11(h, {errors: errors, warnings: warnings, err: err, keys: keys, isObj: isObj, sec: sec, rec: recIds});
  if (ver[1] === 0 && (V11.some(function(k){ return h[k] !== undefined; }) || (isObj(h.from) && (h.from.hours !== undefined || h.from.paid !== undefined))))
    warnings.push('handover: the file says "1.0" but uses 1.1 fields. Set it to "1.1"');
  return {errors: errors, warnings: warnings};
}

/* ================= Validation of the 1.1 objects (spec sections 9 to 16) ================= */
var MINOR = 1;
var ROLES = ["outgoing","incoming","principal","owner","facilitator"];
var ASKS = ["breaks","profile","access","limits","confid","emergency","signoff"];
var FINAL = ["recurring","in-progress","decisions","context","access","exceptions","decide"];
var V11 = ["audience","profile","people","stakeholders","plan","asks","gaps","inProgress","rules","decisions","risks","systems","documents","decide","finalCheck","signoff","followUps","catchUps","history","rendered"];
var RECORDS = ["gaps","inProgress","rules","decisions","risks","systems","documents"];
function E(values){ return {e: values}; }
var DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
var CLOSED = {o: {how: E(["fixed","answered","principal","done","dropped"]), at: "datetime", by: "role", fix: "line"}, r: ["how"]};
var META = {added: "datetime", addedBy: "role", aiDrafted: "bool", visibleTo: "roles", closed: CLOSED};
var CHECK = {o: {result: E(["pass","fail"]), note: "line", at: "datetime"}, r: ["result"]};
var CHECKS = {o: {opens: CHECK, create: CHECK, level: CHECK}, r: []};
function withMeta(o){ var c = {id: "id"}; Object.keys(o).forEach(function(k){ c[k] = o[k]; }); Object.keys(META).forEach(function(k){ c[k] = META[k]; }); return c; }
var SPEC11 = {
  people: {o: {id: "id", name: "line", roles: "roles", contact: "line"}, r: ["id","name","roles"]},
  stakeholders: {o: withMeta({name: "line", relationship: "line", involve: "md", contact: "line", contactVisibleTo: "roles"}), r: ["id","name","relationship"]},
  asks: {o: {id: E(ASKS), minutes: "int", draft: "md", replyBy: "date", "default": "md", status: E(["draft","sent","confirmed","corrected","defaulted"]), correction: "md", sent: "datetime", answered: "datetime"}, r: ["id","status"]},
  gaps: {o: withMeta({text: "md", blocks: "bool"}), r: ["id","text"]},
  inProgress: {o: withMeta({text: "md", owner: "role", due: "date"}), r: ["id","text"]},
  rules: {o: withMeta({text: "md", situation: "line"}), r: ["id","text"]},
  decisions: {o: withMeta({text: "md", reason: "md", date: "date"}), r: ["id","text"]},
  risks: {o: withMeta({text: "md", list: E(["weekly","occasional","spof"]), severity: E(["high","medium","low"]), treatment: E(["record","write","brief"]),
    evidence: {o: {cadence: E(["daily","weekly","monthly","quarterly","annual","rare"]), occurrences: "int", hours: "num", firstSeen: "date", lastSeen: "date", source: "line"}, r: []}, recurring: "id"}), r: ["id","text","list"]},
  systems: {o: withMeta({name: "line", purpose: "line", credentialLocation: "line", grantedBy: "line", checks: CHECKS}), r: ["id","name"]},
  documents: {o: withMeta({title: "line", url: "line", location: "line", type: E(["folder","brief","profile","recording","guide","template","protected","other"]), status: E(["draft","final"]), owner: "role", checks: CHECKS}), r: ["id","title"]},
  cards: {o: withMeta({text: "md", column: E(["alone","check","principal"]), movedByPrincipal: "bool", limit: {o: {amount: "num", currency: "currency"}, r: ["amount","currency"]}, approver: {o: {role: "role", stakeholder: "id"}, r: []}}), r: ["id","text","column"]},
  steps: {o: {id: "id", role: "role", phase: E(["prepare","shadow","swap","after"]), title: "line", why: "line", status: E(["open","done","na"]), reason: "line", gate: E(["ready","done","sign"]), ask: E(ASKS)}, r: ["id","role","phase","title","status"]},
  finalCheck: {o: {id: E(FINAL), result: E(["pass","fail"]), owner: "role", due: "date", note: "md", at: "datetime"}, r: ["id","result"]},
  notes: {o: {id: "id", text: "md", role: "role", at: "datetime"}, r: ["id","text","at"]},
  followUps: {o: {id: E(["f1","f2"]), answers: "answers", gapsFound: "int", gapsFixed: "int", at: "datetime"}, r: ["id"]},
  catchUps: {o: {id: "id", at: "datetime"}, r: ["id","at"]},
  history: {o: {id: "id", at: "datetime", role: "role", source: E(["app","ai"]), text: "md"}, r: ["id","at","source","text"]}
};
var PLAN = {o: {prepStart: "date", firstDay: "date", lastDay: "date", track: E(["light","full"]), practice: "bool", template: "line", steps: "skip"}, r: ["prepStart","lastDay"]};
var DECIDE = {o: {confirmed: "bool", confirmedAt: "datetime", cards: "skip"}, r: []};
var SIGNOFF = {o: {outgoing: "datetime", incoming: "datetime", principal: "datetime", frozen: "date", notes: "skip"}, r: []};
function validate11(h, c){
  var errors = c.errors, isObj = c.isObj;
  function value(v, p, t){
    if (t === "skip") return;
    if (t && t.e){ if (t.e.indexOf(v) < 0) errors.push(p + ": must be one of " + t.e.join(", ")); return; }
    if (t && t.o){ fields(v, p, t); return; }
    var ok = true, what = "";
    switch (t){
      case "id": ok = typeof v === "string" && ID.test(v); what = "an id: lowercase letters, digits and dashes"; break;
      case "line": case "md": ok = typeof v === "string" && !!v.trim(); what = "non-empty text"; break;
      case "date": ok = typeof v === "string" && DATE.test(v); what = "a date like 2026-12-31"; break;
      case "datetime": ok = typeof v === "string" && DATETIME.test(v) && !isNaN(Date.parse(v)); what = "a date and time like 2026-10-05T09:00:00Z"; break;
      case "bool": ok = typeof v === "boolean"; what = "true or false"; break;
      case "int": ok = typeof v === "number" && v >= 0 && Math.floor(v) === v; what = "a whole number, 0 or more"; break;
      case "num": ok = typeof v === "number" && isFinite(v) && v >= 0; what = "a number, 0 or more"; break;
      case "currency": ok = typeof v === "string" && /^[A-Z]{3}$/.test(v); what = "a three-letter currency code like USD"; break;
      case "role": ok = ROLES.indexOf(v) > -1; what = "one of " + ROLES.join(", "); break;
      case "roles": ok = Array.isArray(v) && v.length > 0 && v.every(function(r, i){ return ROLES.indexOf(r) > -1 && v.indexOf(r) === i; }); what = "a list of different roles from " + ROLES.join(", "); break;
      case "answers": ok = Array.isArray(v) && v.length <= 3 && v.every(function(a){ return typeof a === "string" && !!a.trim(); }); what = "a list of up to three answers"; break;
    }
    if (!ok) errors.push(p + ": must be " + what + (typeof v === "string" ? ' (got "' + v + '")' : ""));
  }
  function fields(o, p, t){
    if (!isObj(o)){ errors.push(p + ": must be an object"); return false; }
    c.keys(o, p, Object.keys(t.o));
    t.r.forEach(function(k){ if (o[k] === undefined) errors.push(p + "." + k + ": required"); });
    Object.keys(t.o).forEach(function(k){ if (o[k] !== undefined) value(o[k], p + "." + k, t.o[k]); });
    return true;
  }
  /* A list of objects with unique ids. Returns the ids. */
  function list(v, p, t, each){
    var ids = {};
    if (v === undefined) return ids;
    if (!Array.isArray(v)){ errors.push(p + ": must be a list"); return ids; }
    v.forEach(function(o, i){
      var q = p + "[" + i + "]";
      if (!fields(o, q, t)) return;
      if (typeof o.id === "string"){ if (ids[o.id]) errors.push(q + '.id: "' + o.id + '" is used twice in ' + p); ids[o.id] = true; }
      if (each) each(o, q);
    });
    return ids;
  }
  function closedHow(allowed){ return function(o, q){ if (isObj(o.closed) && o.closed.how !== undefined && allowed.indexOf(o.closed.how) < 0 && t11.e.indexOf(o.closed.how) > -1) errors.push(q + ".closed.how: a " + q.split("[")[0] + " item closes as " + allowed.join(", ")); }; }
  var t11 = CLOSED.o.how;

  if (h.audience !== undefined) value(h.audience, "audience", "roles");
  if (h.profile !== undefined) value(h.profile, "profile", E(["newcomer","record"]));
  var held = {};
  list(h.people, "people", SPEC11.people, function(o, q){
    (Array.isArray(o.roles) ? o.roles : []).forEach(function(r){ if (held[r]) errors.push(q + '.roles: "' + r + '" is already held by ' + held[r] + ". Each role is held by one person"); held[r] = '"' + o.name + '"'; });
    if (Array.isArray(o.roles) && o.roles.indexOf("outgoing") > -1 && isObj(h.from) && typeof h.from.name === "string" && o.name !== h.from.name) c.warnings.push(q + '.name: the outgoing person is "' + o.name + '" here but "' + h.from.name + '" in from');
  });
  var stake = list(h.stakeholders, "stakeholders", SPEC11.stakeholders);
  var asks = list(h.asks, "asks", SPEC11.asks, function(o, q){ if (o.status === "corrected" && o.correction === undefined) errors.push(q + ".correction: required when status is corrected"); });
  if (h.plan !== undefined && fields(h.plan, "plan", PLAN)){
    list(h.plan.steps, "plan.steps", SPEC11.steps, function(o, q){
      if (o.status === "na" && o.reason === undefined) errors.push(q + ".reason: required when status is na (not applicable)");
      if (o.ask !== undefined && !asks[o.ask]) errors.push(q + '.ask: no ask has id "' + o.ask + '"' + (h.asks === undefined ? " (the file has no asks)" : ""));
    });
  }
  list(h.gaps, "gaps", SPEC11.gaps, closedHow(["fixed","answered","principal"]));
  list(h.inProgress, "inProgress", SPEC11.inProgress, closedHow(["done","dropped"]));
  list(h.rules, "rules", SPEC11.rules);
  list(h.decisions, "decisions", SPEC11.decisions);
  list(h.risks, "risks", SPEC11.risks, function(o, q){ if (typeof o.recurring === "string" && !c.rec[o.recurring]) errors.push(q + '.recurring: no recurring duty has id "' + o.recurring + '"'); });
  list(h.systems, "systems", SPEC11.systems);
  list(h.documents, "documents", SPEC11.documents, function(o, q){ if (o.url === undefined && o.location === undefined) errors.push(q + ": needs a url, or a location for a protected file"); });
  if (h.decide !== undefined && fields(h.decide, "decide", DECIDE)){
    list(h.decide.cards, "decide.cards", SPEC11.cards, function(o, q){
      var a = o.approver; if (!isObj(a)) return;
      var n = (a.role !== undefined ? 1 : 0) + (a.stakeholder !== undefined ? 1 : 0);
      if (n !== 1) errors.push(q + ".approver: give either a role or a stakeholder");
      else if (a.stakeholder !== undefined && !stake[a.stakeholder]) errors.push(q + '.approver.stakeholder: no stakeholder has id "' + a.stakeholder + '"');
    });
  }
  list(h.finalCheck, "finalCheck", SPEC11.finalCheck, function(o, q){ if (o.result === "fail"){ if (o.owner === undefined) errors.push(q + ".owner: required when the check fails"); if (o.due === undefined) errors.push(q + ".due: required when the check fails"); } });
  if (h.signoff !== undefined && fields(h.signoff, "signoff", SIGNOFF)) list(h.signoff.notes, "signoff.notes", SPEC11.notes);
  list(h.followUps, "followUps", SPEC11.followUps);
  list(h.catchUps, "catchUps", SPEC11.catchUps);
  list(h.history, "history", SPEC11.history);
  if (h.rendered !== undefined){
    if (!Array.isArray(h.rendered)) errors.push("rendered: must be a list of section ids");
    else h.rendered.forEach(function(id, i){ if (!c.sec[id]) errors.push("rendered[" + i + ']: no section has id "' + id + '"'); else if (h.rendered.indexOf(id) !== i) errors.push("rendered[" + i + ']: "' + id + '" is listed twice'); });
  }
  /* Visibility (spec section 14): nothing the audience may not see */
  var aud = Array.isArray(h.audience) ? h.audience : null;
  eachItem(h, function(o, p){
    [["visibleTo", "the item"], ["contactVisibleTo", "the contact"]].forEach(function(f){
      var v = o[f[0]]; if (!Array.isArray(v)) return;
      if (!aud) errors.push(p + "." + f[0] + ": the file has no audience, so it is for anyone. Leave " + f[1] + " out, or set audience");
      else { var miss = aud.filter(function(r){ return v.indexOf(r) < 0; }); if (miss.length) errors.push(p + "." + f[0] + ": the audience includes " + miss.join(", ") + ", who may not see " + f[1] + ". Leave it out of this file"); }
    });
  });
}
/* Calls fn(item, path) for every item that can carry visibleTo */
function eachItem(h, fn){
  ["stakeholders"].concat(RECORDS).forEach(function(k){ if (Array.isArray(h[k])) h[k].forEach(function(o, i){ if (o && typeof o === "object") fn(o, k + "[" + i + "]", k); }); });
  if (h.decide && Array.isArray(h.decide.cards)) h.decide.cards.forEach(function(o, i){ if (o && typeof o === "object") fn(o, "decide.cards[" + i + "]", "cards"); });
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
function clone(v){ return JSON.parse(JSON.stringify(v)); }

/* ================= Gaps: TODO markers in every text field (spec section 4) ================= */
/* Every text field, as {area, where, text}. Sections written for 1.0 readers are skipped, so gaps in the data count once. */
function textFields(h){
  var out = [], skip = {};
  (Array.isArray(h.rendered) ? h.rendered : []).forEach(function(id){ skip[id] = true; });
  function add(area, where, v){ if (typeof v === "string") out.push({area: area, where: where, text: v}); }
  add("summary", "summary", h.summary);
  (h.path || []).forEach(function(s, i){
    add("path", "path[" + i + '] "' + s.title + '" summary', s.summary);
    if (s.tip) add("path", "path[" + i + '] "' + s.title + '" tip', s.tip.text);
    (s.tasks || []).forEach(function(t, j){ add("path", "path[" + i + "].tasks[" + j + "] (" + t.id + ") text", t.text); add("path", "path[" + i + "].tasks[" + j + "] (" + t.id + ") detail", t.detail); });
  });
  (h.recurring || []).forEach(function(r, i){ add("recurring", "recurring[" + i + "] (" + r.id + ") text", r.text); add("recurring", "recurring[" + i + "] (" + r.id + ") detail", r.detail); });
  (h.questions || []).forEach(function(q, i){ add("questions", "questions[" + i + '] "' + q.q + '"', q.a); });
  (h.sections || []).forEach(function(s, i){ if (!skip[s.id]) add("sections", "sections[" + i + "] (" + s.id + ") body", s.body); });
  if (h.from && typeof h.from === "object") ["contact","hours"].forEach(function(k){ add("from", "from." + k, h.from[k]); });
  /* 1.1: every string inside the new objects. Ids, enums and dates never contain TODO:, so walking them all is safe. */
  function walk(area, where, v){
    if (typeof v === "string") add(area, where, v);
    else if (Array.isArray(v)) v.forEach(function(x, i){ walk(area, where + "[" + i + "]" + (x && typeof x === "object" && typeof x.id === "string" ? " (" + x.id + ")" : ""), x); });
    else if (v && typeof v === "object") Object.keys(v).forEach(function(k){ if (k !== "id") walk(area, where + "." + k, v[k]); });
  }
  V11.forEach(function(k){ if (k !== "rendered" && k !== "audience" && h[k] !== undefined) walk(k, k, h[k]); });
  return out;
}
function lineGaps(line){
  var found = [], m, re = /\{TODO:\s*([^}]*)\}/g;
  while ((m = re.exec(line))) found.push(m[1].trim() || "(no description)");
  line.split("|").forEach(function(cell){ var c = cell.trim().match(/^TODO:\s*(.*)$/); if (c) found.push(c[1].trim() || "(no description)"); });
  if (line.indexOf("|") < 0){ var t = line.match(/(?:^|\s)TODO:\s*(.*)$/); if (t && !/^\s*TODO:/.test(line) && !/\{TODO:/.test(line)) found.push(t[1].trim()); }
  return found;
}
/* Every TODO gap: [{area, where, what}] */
function findGaps(h){
  var found = [];
  textFields(h).forEach(function(f){ f.text.split("\n").forEach(function(line){ lineGaps(line).forEach(function(what){ found.push({area: f.area, where: f.where, what: what}); }); }); });
  return found;
}
/* TODO gaps counted by top-level area, plus the open items on the gaps list */
function gapCounts(h){
  var by = {}, all = findGaps(h);
  all.forEach(function(g){ by[g.area] = (by[g.area] || 0) + 1; });
  var open = (h.gaps || []).filter(function(g){ return !g.closed; });
  return {todo: all.length, byArea: by, openItems: open.length, blocking: open.filter(function(g){ return g.blocks; }).length};
}

/* ================= Worked out, not stored (spec section 15) ================= */
function overlap(plan){ return !!(plan && plan.firstDay && plan.lastDay && plan.firstDay <= plan.lastDay); }
var PHASES = ["prepare","shadow","swap","after"];
function phaseLabel(phase, overlapping){
  return {prepare: "Prepare", shadow: overlapping ? "Shadow" : "Incoming starts", swap: overlapping ? "Swap" : "Incoming takes over", after: "After"}[phase] || phase;
}
var GATES = {ready: "Ready for the principal", done: "Final check", sign: "Sign-off"};
/* The simplest reading of each gate: met when every step that counts toward it is done or not applicable */
function gates(h){
  var out = {};
  Object.keys(GATES).forEach(function(g){
    var steps = ((h.plan && h.plan.steps) || []).filter(function(s){ return s.gate === g; });
    var left = steps.filter(function(s){ return s.status !== "done" && s.status !== "na"; }).length;
    out[g] = {title: GATES[g], steps: steps.length, left: left, met: steps.length > 0 && left === 0};
  });
  return out;
}
function askMinutes(h){ return (h.asks || []).reduce(function(n, a){ return n + (typeof a.minutes === "number" ? a.minutes : 0); }, 0); }

/* ================= Sharing (spec section 14) ================= */
function canSee(roles, audience){ if (!Array.isArray(roles)) return true; if (!audience) return false; return audience.every(function(r){ return roles.indexOf(r) > -1; }); }
var PROFILES = {newcomer: true, record: true};
var PROCESS = ["plan","asks","finalCheck","signoff","followUps","catchUps","history"];
/* A copy of h for one export profile and audience. Leaves out what the audience may not see and writes the 1.0 sections again. */
function exportProfile(h, profile, audience){
  if (!PROFILES[profile]) throw new Error('profile must be "newcomer" or "record"');
  var o = clone(h);
  audience = audience || (profile === "newcomer" ? ["incoming"] : h.audience);
  delete o.progress;
  function keep(item){ return canSee(item.visibleTo, audience) && !(profile === "newcomer" && item.closed); }
  ["stakeholders"].concat(RECORDS).forEach(function(k){ if (Array.isArray(o[k])) o[k] = o[k].filter(keep); });
  if (o.decide && Array.isArray(o.decide.cards)) o.decide.cards = o.decide.cards.filter(keep);
  (o.stakeholders || []).forEach(function(s){ if (s.contactVisibleTo && !canSee(s.contactVisibleTo, audience)){ delete s.contact; delete s.contactVisibleTo; } });
  if (profile === "newcomer"){
    PROCESS.forEach(function(k){ delete o[k]; });
    if (o.from) delete o.from.paid;
    eachItem(o, function(item){ ["added","addedBy","aiDrafted","visibleTo","contactVisibleTo","closed"].forEach(function(k){ delete item[k]; }); });
  }
  if (audience) o.audience = audience.slice(); else delete o.audience;
  o.profile = profile;
  ["stakeholders"].concat(RECORDS).forEach(function(k){ if (Array.isArray(o[k]) && !o[k].length) delete o[k]; });
  return withRendered(o);
}

/* ================= Sections for 1.0 readers (spec section 16) ================= */
var ROLE_NAME = {outgoing: "Outgoing assistant", incoming: "Incoming assistant", principal: "Principal", owner: "Owner", facilitator: "Facilitator"};
function cell(v){ return v === undefined || v === null || v === "" ? "" : String(v).replace(/\r?\n+/g, " ").replace(/\|/g, "/"); }
function tableMd(head, rows){ return "| " + head.join(" | ") + " |\n|" + head.map(function(){ return "---"; }).join("|") + "|\n" + rows.map(function(r){ return "| " + r.map(cell).join(" | ") + " |"; }).join("\n"); }
function who(h, role){ var p = (h.people || []).filter(function(x){ return (x.roles || []).indexOf(role) > -1; })[0]; return p ? p.name : ROLE_NAME[role] || role; }
function money(m){ return m ? m.currency + " " + Number(m.amount).toLocaleString("en-GB") : ""; }
function renderSections(h){
  var out = [];
  function add(id, title, parts){ parts = parts.filter(Boolean); if (parts.length) out.push({id: id, title: title, body: parts.join("\n\n")}); }
  var open = function(x){ return !x.closed; };
  add("handover-people", "People", [
    (h.people || []).length ? tableMd(["Name", "Role", "Contact"], h.people.map(function(p){ return [p.name, p.roles.map(function(r){ return ROLE_NAME[r]; }).join(", "), p.contact]; })) : "",
    (h.stakeholders || []).length ? "### People to know\n\n" + tableMd(["Name", "Who they are", "When to involve them", "Contact"], h.stakeholders.map(function(s){ return [s.name, s.relationship, s.involve, s.contact]; })) : ""
  ]);
  add("handover-access", "Systems and documents", [
    (h.systems || []).length ? tableMd(["System", "Used for", "Credential kept in", "Access from", "Access check"], h.systems.map(function(s){ return [s.name, s.purpose, s.credentialLocation, s.grantedBy, checksText(s.checks)]; })) : "",
    (h.documents || []).length ? "### Documents\n\n" + tableMd(["Document", "Type", "Where", "Status"], h.documents.map(function(d){ return [d.url ? "[" + cell(d.title) + "](" + d.url + ")" : d.title, DOC_TYPE[d.type] || "", d.location || "", cap(d.status)]; })) : ""
  ]);
  add("handover-knowledge", "Rules, decisions and risks", [
    (h.rules || []).filter(open).length ? "### When this happens\n\n" + h.rules.filter(open).map(function(r){ return "- " + cell(r.text) + (r.situation ? " (" + cell(r.situation) + ")" : ""); }).join("\n") : "",
    (h.decisions || []).filter(open).length ? "### Decisions\n\n" + tableMd(["Date", "Decision", "Why"], h.decisions.filter(open).map(function(d){ return [d.date, d.text, d.reason]; })) : "",
    (h.risks || []).filter(open).length ? "### Risks\n\n" + tableMd(["Risk", "Kind", "Severity", "When"], h.risks.filter(open).map(function(r){ var d = r.recurring && (h.recurring || []).filter(function(x){ return x.id === r.recurring; })[0]; return [r.text, {weekly: "Recurring work", occasional: "Occasional", spof: "Only one person knows"}[r.list], cap(r.severity), d ? cadence(d) : cap(r.evidence && r.evidence.cadence)]; })) : ""
  ]);
  add("handover-open", "Open items", [
    (h.inProgress || []).filter(open).length ? "### In progress\n\n" + tableMd(["What", "Owner", "Due"], h.inProgress.filter(open).map(function(x){ return [x.text, x.owner ? who(h, x.owner) : "", x.due]; })) : "",
    (h.gaps || []).filter(open).length ? "### Gaps still open\n\n" + h.gaps.filter(open).map(function(g){ return "- " + (g.blocks ? "**Blocks work:** " : "") + cell(g.text); }).join("\n") : ""
  ]);
  var cards = (h.decide && h.decide.cards) || [], stake = {};
  (h.stakeholders || []).forEach(function(s){ stake[s.id] = s.name; });
  add("handover-decide", "Who decides what", [
    cards.length ? tableMd(["Decision", "Who decides", "Limit", "Approver"], cards.filter(open).map(function(c){ return [c.text, {alone: "Decide alone", check: "Check first", principal: "Always the principal"}[c.column], money(c.limit), c.approver ? (c.approver.role ? who(h, c.approver.role) : stake[c.approver.stakeholder]) : ""]; })) : "",
    cards.length && h.decide.confirmed === false ? "> The principal has not confirmed this yet." : ""
  ]);
  var steps = (h.plan && h.plan.steps) || [], ov = overlap(h.plan);
  add("handover-plan", "The handover plan", steps.length ? PHASES.map(function(ph){
    var s = steps.filter(function(x){ return x.phase === ph; }); if (!s.length) return "";
    return "### " + phaseLabel(ph, ov) + "\n\n" + tableMd(["Step", "Who", "Status"], s.map(function(x){ return [x.title, who(h, x.role), {open: "Open", done: "Done", na: "Not needed: " + (x.reason || "")}[x.status]]; }));
  }) : []);
  return out;
}
function cap(s){ return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : ""; }
var DOC_TYPE = {folder: "Folder", brief: "One-page brief", profile: "Principal profile", recording: "Recording", guide: "Step guide", template: "Template", protected: "Protected file", other: "Other"};
function checksText(c){ if (!c) return ""; return ["opens","create","level"].filter(function(k){ return c[k]; }).map(function(k){ return {opens: "Opens", create: "Can create", level: "Right level"}[k] + ": " + (c[k].result === "pass" ? "pass" : "fail" + (c[k].note ? " (" + c[k].note + ")" : "")); }).join("; "); }
/* A copy of h with the sections for 1.0 readers written again from the data */
function withRendered(h){
  var o = clone(h), old = {}, taken = {};
  (o.rendered || []).forEach(function(id){ old[id] = true; });
  o.sections = (o.sections || []).filter(function(s){ return !old[s.id]; });
  o.sections.forEach(function(s){ taken[s.id] = true; });
  var fresh = renderSections(o).map(function(s){ var id = s.id, n = 2; while (taken[id]) id = s.id + "-" + n++; taken[id] = true; s.id = id; return s; });
  o.sections = o.sections.concat(fresh);
  if (fresh.length) o.rendered = fresh.map(function(s){ return s.id; }); else delete o.rendered;
  if (!o.sections.length) delete o.sections;
  return o;
}

var api = {version: "1.1", validate: validate, schedule: schedule, occursOn: occursOn, cadence: cadence, nice: nice, zoneParts: zoneParts, addDays: addDays, mergeProgress: mergeProgress, contentOnly: contentOnly,
  textFields: textFields, findGaps: findGaps, gapCounts: gapCounts, overlap: overlap, phaseLabel: phaseLabel, phases: PHASES, gates: gates, askMinutes: askMinutes,
  canSee: canSee, exportProfile: exportProfile, renderSections: renderSections, withRendered: withRendered, roles: ROLES, roleName: ROLE_NAME};
if (typeof module === "object" && module.exports) module.exports = api; else root.HandoverCore = api;
})(typeof window !== "undefined" ? window : this);
