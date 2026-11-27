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
  function add(area, where, v, path){ if (typeof v === "string") out.push({area: area, where: where, text: v, path: path}); }
  add("summary", "summary", h.summary, ["summary"]);
  (h.path || []).forEach(function(s, i){
    add("path", "path[" + i + '] "' + s.title + '" summary', s.summary, ["path", i, "summary"]);
    if (s.tip) add("path", "path[" + i + '] "' + s.title + '" tip', s.tip.text, ["path", i, "tip", "text"]);
    (s.tasks || []).forEach(function(t, j){ add("path", "path[" + i + "].tasks[" + j + "] (" + t.id + ") text", t.text, ["path", i, "tasks", j, "text"]); add("path", "path[" + i + "].tasks[" + j + "] (" + t.id + ") detail", t.detail, ["path", i, "tasks", j, "detail"]); });
  });
  (h.recurring || []).forEach(function(r, i){ add("recurring", "recurring[" + i + "] (" + r.id + ") text", r.text, ["recurring", i, "text"]); add("recurring", "recurring[" + i + "] (" + r.id + ") detail", r.detail, ["recurring", i, "detail"]); });
  (h.questions || []).forEach(function(q, i){ add("questions", "questions[" + i + '] "' + q.q + '"', q.a, ["questions", i, "a"]); });
  (h.sections || []).forEach(function(s, i){ if (!skip[s.id]) add("sections", "sections[" + i + "] (" + s.id + ") body", s.body, ["sections", i, "body"]); });
  if (h.from && typeof h.from === "object") ["contact","hours"].forEach(function(k){ add("from", "from." + k, h.from[k], ["from", k]); });
  /* 1.1: every string inside the new objects. Ids, enums and dates never contain TODO:, so walking them all is safe. */
  function walk(area, where, v, path){
    if (typeof v === "string") add(area, where, v, path);
    else if (Array.isArray(v)) v.forEach(function(x, i){ walk(area, where + "[" + i + "]" + (x && typeof x === "object" && typeof x.id === "string" ? " (" + x.id + ")" : ""), x, path.concat([i])); });
    else if (v && typeof v === "object") Object.keys(v).forEach(function(k){ if (k !== "id") walk(area, where + "." + k, v[k], path.concat([k])); });
  }
  V11.forEach(function(k){ if (k !== "rendered" && k !== "audience" && h[k] !== undefined) walk(k, k, h[k], [k]); });
  return out;
}
/* The gaps on one line, in order. Each is {what, start, end}: the text from start to end is what filling it replaces. */
function lineGapSpans(line){
  var found = [], m, re = /\{TODO:\s*([^}]*)\}/g;
  while ((m = re.exec(line))) found.push({what: m[1].trim() || "(no description)", start: m.index, end: m.index + m[0].length});
  /* A table cell, or a whole line, that is only "TODO: …" */
  var pos = 0, table = line.indexOf("|") > -1;
  line.split("|").forEach(function(cell){
    var c = cell.match(/^(\s*)TODO:\s*(.*?)(\s*)$/);
    if (c) found.push({what: c[2].trim() || "(no description)", start: pos + c[1].length, end: pos + cell.length - c[3].length, cell: table});
    pos += cell.length + 1;
  });
  /* "… TODO: …" at the end of a line of text */
  if (!table){
    var t = line.match(/(^|\s)TODO:\s*(.*)$/);
    if (t && !/^\s*TODO:/.test(line) && !/\{TODO:/.test(line)) found.push({what: t[2].trim(), start: t.index + t[1].length, end: line.length});
  }
  return found;
}
function lineGaps(line){ return lineGapSpans(line).map(function(g){ return g.what; }); }
/* Every TODO gap: [{area, where, what}] */
function findGaps(h){
  var found = [];
  textFields(h).forEach(function(f){ f.text.split("\n").forEach(function(line){ lineGaps(line).forEach(function(what){ found.push({area: f.area, where: f.where, what: what}); }); }); });
  return found;
}

/* ================= Filling gaps in a tool (spec sections 2 and 4) ================= */
var GAP_AREA = {summary: "Summary", path: "First weeks", recurring: "Jobs", questions: "Questions and answers", sections: "Reference", from: "Contact after the handover",
  people: "Who's who", stakeholders: "People to know", plan: "Handover plan", asks: "Questions for the principal", gaps: "Gaps", inProgress: "In progress", rules: "When this happens",
  decisions: "Decisions", risks: "Risks", systems: "Systems and access", documents: "Documents", decide: "Who decides what", finalCheck: "Final check", signoff: "Sign-off",
  followUps: "Follow-ups", catchUps: "Check-ins", history: "History", profile: "Profile"};
function getAt(o, path){ return path.reduce(function(v, k){ return v === undefined || v === null ? undefined : v[k]; }, o); }
/* Something a person would recognise: the area, then the item it sits in */
function gapLabel(h, path){
  var parts = [GAP_AREA[path[0]] || String(path[0])];
  for (var i = 1; i < path.length; i++){
    var o = getAt(h, path.slice(0, i + 1));
    if (o && typeof o === "object" && !Array.isArray(o)){
      var name = o.title || o.name || o.text || o.q || o.system || o.what;
      if (typeof name === "string" && name.indexOf("TODO") < 0){ parts.push(oneLine(name).replace(/\*\*/g, "").slice(0, 60)); }
    }
  }
  return parts.join(" › ");
}
/* Every gap with what filling it needs: [{key, area, label, what, path, n, line}]. n counts the gaps within one field, in order. */
function gapList(h){
  var out = [];
  textFields(h).forEach(function(f){
    var n = 0;
    f.text.split("\n").forEach(function(line){
      lineGapSpans(line).forEach(function(g){
        out.push({key: f.path.join(".") + "#" + n, area: f.area, label: gapLabel(h, f.path), what: g.what, path: f.path, n: n, line: line, start: g.start, end: g.end, cell: !!g.cell});
        n++;
      });
    });
  });
  return out;
}
/* A copy of h with gap n of the field at path replaced by text. Table cells can't hold "|" or line breaks, and no gap can. */
function fillGap(h, path, n, text){
  var o = clone(h), field = getAt(o, path);
  if (typeof field !== "string") throw new Error("No text field at " + path.join("."));
  var value = String(text).replace(/\s*\r?\n\s*/g, " ").trim(), count = 0, done = false;
  if (!value) throw new Error("Write something to fill the gap with.");
  var lines = field.split("\n").map(function(line){
    if (done) return line;
    var spans = lineGapSpans(line);
    for (var i = 0; i < spans.length; i++){
      if (count++ === n){ done = true; var g = spans[i]; return line.slice(0, g.start) + (g.cell ? value.replace(/\|/g, "/") : value) + line.slice(g.end); }
    }
    return line;
  });
  if (!done) throw new Error("That gap isn't there any more.");
  var parent = getAt(o, path.slice(0, -1)); parent[path[path.length - 1]] = lines.join("\n");
  return o;
}
/* The no-secrets rule (spec section 2): a reason this text looks like a secret, or "" */
function luhn(d){ var sum = 0; for (var i = 0; i < d.length; i++){ var x = +d[d.length - 1 - i]; if (i % 2){ x *= 2; if (x > 9) x -= 9; } sum += x; } return sum % 10 === 0; }
function secretReason(text){
  var t = String(text || "");
  var digits = t.match(/(?:\d[ -]?){13,19}/g) || [];
  if (digits.some(function(d){ var x = d.replace(/\D/g, ""); return x.length >= 13 && x.length <= 19 && luhn(x); })) return "This looks like a card number.";
  if (/\b(?:password|passcode|passwd|pwd|pin|otp|one[- ]time code|recovery code|security code|cvv|cvc|api[ _-]?key|secret|token)\b\s*(?:is|=|:)\s*\S+/i.test(t)) return "This looks like a password, PIN, code or key.";
  if (/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{30,}/.test(t)) return "This looks like an API key or token.";
  if (/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/.test(t)) return "This looks like a bank account number (IBAN).";
  if (/(?:^|\s)(?=[A-Za-z0-9+\/_=-]*[0-9])(?=[A-Za-z0-9+\/_=-]*[a-z])(?=[A-Za-z0-9+\/_=-]*[A-Z])[A-Za-z0-9+\/_=-]{24,}(?=\s|$)/.test(t)) return "This looks like a key or token.";
  return "";
}
/* ================= Closing records (spec section 11) ================= */
/* The ways each list can be closed. Gaps and things in progress follow the spec; for the rest an item closes when it no longer applies. */
var CLOSE_HOW = {gaps: ["fixed", "answered", "principal"], inProgress: ["done", "dropped"], risks: ["fixed", "dropped"],
  rules: ["dropped"], decisions: ["dropped"], systems: ["dropped"], documents: ["dropped"], decide: ["dropped"]};
var CLOSE_LABEL = {fixed: "Fixed", answered: "Answered", principal: "Handed to the principal", done: "Done", dropped: "No longer applies"};
var LIST_NOUN = {gaps: "gap", inProgress: "thing in progress", risks: "risk", rules: "rule", decisions: "decision", systems: "system", documents: "document", decide: "who-decides card"};
function recordList(h, list){ return list === "decide" ? (h.decide && h.decide.cards) || [] : h[list] || []; }
function stamp(o){ return o.at || new Date().toISOString().replace(/\.\d+Z$/, "Z"); }
function logChange(out, o, text){
  if (out.handover === "1.0") return;
  var hist = out.history || [], used = {}; hist.forEach(function(x){ used[x.id] = true; });
  var base = (o.idPrefix || "change") + "-" + (o.date || "x"), id = base, k = 2; while (used[id]) id = base + "-" + k++;
  var entry = {id: id, at: stamp(o), source: "app", text: text};
  if (o.role) entry.role = o.role;
  out.history = hist.concat([entry]);
}
function finish(out, o){ if (o.date) out.updated = o.date; return out.rendered ? withRendered(out) : out; }
/* A copy of h with one record closed: o = {how, by (role), fix (line), date, at}. Throws with a message for the person. */
function closeItem(h, list, id, o){
  o = o || {};
  if (!CLOSE_HOW[list]) throw new Error("Items on " + list + " can't be closed.");
  if (CLOSE_HOW[list].indexOf(o.how) < 0) throw new Error("Choose how it was closed: " + CLOSE_HOW[list].map(function(x){ return CLOSE_LABEL[x].toLowerCase(); }).join(", ") + ".");
  var fix = String(o.fix || "").replace(/\s*\r?\n\s*/g, " ").trim();
  var why = secretReason(fix);
  if (why) throw new Error(why + " Handover files MUST NOT hold passwords, PINs, codes, keys or card and bank numbers. Link to where the fix is written down, or say who has it.");
  var out = clone(h), item = recordList(out, list).filter(function(x){ return x.id === id; })[0];
  if (!item) throw new Error("That item isn't in the file any more.");
  if (item.closed) throw new Error("That item is already closed.");
  item.closed = {how: o.how, at: stamp(o)};
  if (o.by) item.closed.by = o.by;
  if (fix) item.closed.fix = fix;
  o.idPrefix = "close";
  logChange(out, o, "Closed " + LIST_NOUN[list] + " " + id + " in the app: " + CLOSE_LABEL[o.how].toLowerCase() + ".");
  return finish(out, o);
}
function reopenItem(h, list, id, o){
  o = o || {};
  var out = clone(h), item = recordList(out, list).filter(function(x){ return x.id === id; })[0];
  if (!item) throw new Error("That item isn't in the file any more.");
  if (!item.closed) throw new Error("That item is already open.");
  delete item.closed;
  o.idPrefix = "reopen";
  logChange(out, o, "Reopened " + LIST_NOUN[list] + " " + id + " in the app.");
  return finish(out, o);
}

/* ================= Adding records (spec section 11) ================= */
/* The fields a person fills in for each list. t: md (several lines), line, date, role, bool, or options [[value, label]]. */
var ADD_FIELDS = {
  inProgress: [{k: "text", t: "md", req: true, label: "What's under way", hint: "What it is and where it has got to"}, {k: "owner", t: "role", label: "Who owns it now"}, {k: "due", t: "date", label: "Due"}],
  gaps: [{k: "text", t: "md", req: true, label: "What's missing", hint: "What someone still needs to find out, get or be given"}, {k: "blocks", t: "bool", label: "It blocks work today"}],
  rules: [{k: "text", t: "md", req: true, label: "The rule", hint: "If this happens, then do that"}, {k: "situation", t: "line", label: "Situation", hint: "The situation it belongs to, e.g. \"Principal travelling\""}],
  decisions: [{k: "text", t: "md", req: true, label: "What was decided"}, {k: "reason", t: "md", label: "Why"}, {k: "date", t: "date", label: "When it was decided"}],
  risks: [{k: "text", t: "md", req: true, label: "What could go wrong"},
    {k: "list", t: [["weekly", "Recurring work"], ["occasional", "An occasional or seasonal flow"], ["spof", "Only one person knows or does it"]], req: true, label: "Kind of risk"},
    {k: "severity", t: [["high", "High"], ["medium", "Medium"], ["low", "Low"]], label: "How much it hurts if it fails"},
    {k: "treatment", t: [["record", "Record someone doing it"], ["write", "Write it down"], ["brief", "A line in the one-page brief"]], label: "How to pass it on"}],
  systems: [{k: "name", t: "line", req: true, label: "System"}, {k: "purpose", t: "line", label: "What it's for"},
    {k: "credentialLocation", t: "line", label: "Where the login is kept", hint: "e.g. \"Team password manager, Finance folder\". Never the password itself"},
    {k: "grantedBy", t: "line", label: "Who grants access"}],
  documents: [{k: "title", t: "line", req: true, label: "Title"}, {k: "url", t: "line", label: "Link"},
    {k: "location", t: "line", label: "Where it is kept", hint: "Give a link, or say where it is kept and who holds it (for a protected file, don't give a link)"},
    {k: "type", t: [["folder", "Folder"], ["brief", "One-page brief"], ["profile", "Principal profile"], ["recording", "Recording"], ["guide", "Step-by-step guide"], ["template", "Template"], ["protected", "Protected file"], ["other", "Other"]], label: "Kind of document"},
    {k: "status", t: [["draft", "Draft"], ["final", "Final"]], label: "Status"}, {k: "owner", t: "role", label: "Who keeps it up to date"}],
  decide: [{k: "text", t: "md", req: true, label: "What kind of decision", hint: "e.g. \"Booking travel under USD 500\""},
    {k: "column", t: [["alone", "Decide alone"], ["check", "Check first"], ["principal", "Always the principal"]], req: true, label: "Who decides"}]
};
function slugFor(text, noun){
  var words = String(text || "").toLowerCase().replace(/\*\*|__|`/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).slice(0, 5);
  var s = words.join("-").slice(0, 40).replace(/-+$/, "");
  return s || noun.replace(/[^a-z]+/g, "-");
}
function addError(message, field){ var e = new Error(message); e.field = field; return e; }
/* A copy of h with one new record: values = {field: value}, o = {role (who added it), date, at}. Returns {h, id}; throws with .field set. */
function addItem(h, list, values, o){
  o = o || {}; values = values || {};
  var defs = ADD_FIELDS[list];
  if (!defs) throw new Error("Items can't be added to " + list + ".");
  if (!h.handover || h.handover === "1.0") throw new Error("This file uses format 1.0, which has no records. Ask the AI to write it again as format 1.1.");
  var item = {};
  defs.forEach(function(d){
    var v = values[d.k];
    if (d.t === "bool"){ if (v === true || v === "true" || v === "on") item[d.k] = true; return; }
    v = String(v === undefined || v === null ? "" : v).trim();
    if (d.t !== "md") v = v.replace(/\s*\r?\n\s*/g, " ");
    if (!v){ if (d.req) throw addError("Fill in “" + d.label + "”.", d.k); return; }
    if (Array.isArray(d.t)){ if (!d.t.some(function(x){ return x[0] === v; })) throw addError("Choose one of the options for “" + d.label + "”.", d.k); }
    else if (d.t === "role"){ if (ROLES.indexOf(v) < 0) throw addError("Choose who for “" + d.label + "”.", d.k); }
    else if (d.t === "date"){ if (!DATE.test(v)) throw addError("“" + d.label + "” needs a date like 2026-12-31.", d.k); }
    else {
      var why = secretReason(v);
      if (why) throw addError(why + " Handover files MUST NOT hold passwords, PINs, codes, keys or card and bank numbers. Write where it is kept and who grants access instead, e.g. \"In the team password manager, Finance folder; Ravi grants access\".", d.k);
    }
    item[d.k] = v;
  });
  if (list === "documents" && !item.url && !item.location) throw addError("Give a link, or say where the document is kept.", "url");
  var out = clone(h), items = recordList(out, list), used = {};
  items.forEach(function(x){ used[x.id] = true; });
  var base = slugFor(item.text || item.name || item.title, LIST_NOUN[list]), id = base, k = 2;
  while (used[id]) id = base + "-" + k++;
  var rec = {id: id};
  Object.keys(item).forEach(function(f){ rec[f] = item[f]; });
  rec.added = stamp(o);
  if (o.role) rec.addedBy = o.role;
  if (list === "decide"){ out.decide = out.decide || {}; out.decide.cards = (out.decide.cards || []).concat([rec]); }
  else out[list] = items.concat([rec]);
  o.idPrefix = "add";
  logChange(out, o, "Added " + LIST_NOUN[list] + " " + id + " in the app.");
  return {h: finish(out, o), id: id};
}

/* Fill several gaps at once ({key: text}), record it in the history (1.1) and the date, and write the 1.0 sections again.
   Returns {h, filled} or throws with a message for the person. */
function fillGaps(h, answers, o){
  o = o || {};
  var list = gapList(h), byKey = {}, picked = [];
  list.forEach(function(g){ byKey[g.key] = g; });
  Object.keys(answers).forEach(function(k){ if (String(answers[k] || "").trim() && byKey[k]) picked.push(byKey[k]); });
  if (!picked.length) throw new Error("Nothing to fill in yet.");
  picked.forEach(function(g){ var why = secretReason(answers[g.key]); if (why) { var e = new Error(why + " Handover files MUST NOT hold passwords, PINs, codes, keys or card and bank numbers. Write where it is kept and who grants access instead, e.g. \"In the team password manager, Finance folder; Ravi grants access\"."); e.key = g.key; throw e; } });
  /* Later gaps first within a field, so the earlier ones keep their numbers */
  picked.sort(function(a, b){ var pa = a.path.join("."), pb = b.path.join("."); return pa === pb ? b.n - a.n : 0; });
  var out = h;
  picked.forEach(function(g){ out = fillGap(out, g.path, g.n, answers[g.key]); });
  var areas = []; picked.forEach(function(g){ var a = GAP_AREA[g.area] || g.area; if (areas.indexOf(a) < 0) areas.push(a); });
  logChange(out, {idPrefix: "fill", date: o.date, at: o.at, role: o.role}, "Filled " + picked.length + (picked.length === 1 ? " gap" : " gaps") + " in the app: " + areas.join(", ") + ".");
  return {h: finish(out, o), filled: picked.length};
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

/* ================= Items as a document =================
   exportKinds(h) lists what can go in a document; itemsDocument(h, opts) builds it.
   opts: kinds (keys, in order), only ({kind: [ids]} to pick single items), closed (include closed items),
   private (include items with visibleTo and restricted contacts), title, date (YYYY-MM-DD). */
var FREQ = [["daily", "Every day", ["day", "weekday"]], ["weekly", "Every week", ["week"]], ["monthly", "Every month", ["month"]], ["quarterly", "Every quarter", ["quarter"]], ["yearly", "Every year", ["year"]]];
var RISK_LIST = {weekly: "Recurring work", occasional: "Occasional", spof: "Only one person knows"}, TREAT = {record: "Record someone doing it", write: "Write it down", brief: "A line in the brief"};
var COLUMN = {alone: "Decide alone", check: "Check first", principal: "Always the principal"};
var ASK_TITLE = {breaks: "What breaks if the outgoing assistant is absent", profile: "Profile check", access: "Access approvals", limits: "Who decides what", confid: "Confidentiality rules", emergency: "Emergency plan", signoff: "Sign-off"};
var FINAL_TITLE = {recurring: "Recurring work", "in-progress": "Things in progress", decisions: "Decisions and reasons", context: "Live context", access: "Access", exceptions: "Exceptions", decide: "Who decides what"};
var EXPORT_KINDS = [
  {key: "overview", title: "Overview", hint: "What this handover is, the dates and how to reach the outgoing person"},
  {key: "people", title: "Who's who", hint: "The people in the handover and their roles"},
  {key: "jobs", title: "Jobs", hint: "Recurring duties, by how often they happen"},
  {key: "tasks", title: "First-weeks tasks", hint: "The path, stage by stage"},
  {key: "stakeholders", title: "People to know", hint: "Who they are and when to involve them"},
  {key: "decide", title: "Who decides what", hint: "Limits and approvers"},
  {key: "systems", title: "Systems and access", hint: "Where logins are kept and who grants access"},
  {key: "documents", title: "Documents", hint: "Links and where files are kept"},
  {key: "rules", title: "When this happens", hint: "If this, then that"},
  {key: "decisions", title: "Decisions", hint: "Already made, and why"},
  {key: "risks", title: "Risks", hint: "What could go wrong"},
  {key: "inProgress", title: "In progress", hint: "Unfinished work, with owners and due dates"},
  {key: "gaps", title: "Gaps", hint: "Things still unknown or unclear"},
  {key: "sections", title: "Reference sections", hint: "The full reference pages, with their tables and lists"},
  {key: "questions", title: "Questions and answers", hint: "Quick answers"},
  {key: "steps", title: "Handover plan steps", hint: "Who does what, phase by phase"},
  {key: "asks", title: "Questions for the principal", hint: "What was asked, and the answers"},
  {key: "finalCheck", title: "Final check", hint: "The seven checks before sign-off"},
  {key: "signoff", title: "Sign-off", hint: "Who signed, and notes added since"}
];
var KIND_COLS = {
  jobs: ["How often", "Job", "When", "Time", "Risk", "Notes"], tasks: ["Stage", "Task", "Detail"], steps: ["Phase", "Step", "Who", "Status", "Why"],
  inProgress: ["What", "Owner", "Due", "Status"], gaps: ["Gap", "Blocks work", "Status"], rules: ["When this happens", "Situation", "Status"],
  decisions: ["Decision", "Why", "Decided", "Status"], risks: ["Risk", "Kind", "Severity", "How it's passed on", "On the list", "Evidence", "Status"],
  systems: ["System", "Used for", "Login kept in", "Access from", "Access check", "Status"], documents: ["Document", "Type", "Where", "Link", "Status"],
  stakeholders: ["Name", "Who they are", "When to involve them", "Contact"], decide: ["Who decides", "Decision", "Limit", "Approver", "Note"],
  questions: ["Question", "Answer", "Topic"], overview: ["Part", "Item", "Details"], people: ["Name", "Role", "Contact"], sections: ["Section", "Text"],
  asks: ["Question", "Status", "Minutes", "Sent", "Reply by", "Answered", "If no reply", "Correction"], finalCheck: ["Check", "Result", "Note", "Owner", "Due"], signoff: ["Who", "Role", "Signed"]
};
function exportItems(h, key, o){
  o = o || {};
  var keep = function(x){ return (o.closed || !x.closed) && (o["private"] || !Array.isArray(x.visibleTo)); };
  var stake = {}; (h.stakeholders || []).forEach(function(s){ stake[s.id] = s.name; });
  var duty = {}; (h.recurring || []).forEach(function(r){ duty[r.id] = r; });
  var riskFor = {}; (h.risks || []).filter(keep).forEach(function(r){ if (r.recurring) riskFor[r.recurring] = r; });
  var closedMeta = function(x){ return x.closed ? "Closed" + (x.closed.at ? " " + nice(String(x.closed.at).slice(0, 10)) : "") : ""; };
  var status = function(x){ return x.closed ? closedMeta(x) : "Open"; };
  var G = function(title, items){ return {title: title, items: items}; };
  switch (key){
    case "jobs": return FREQ.map(function(f){
      return G(f[1], (h.recurring || []).filter(function(r){ return f[2].indexOf(r.every) > -1; }).map(function(r){
        var rk = riskFor[r.id], when = cadence(r), risk = rk && rk.severity ? cap(rk.severity) + " risk: " + rk.text : "";
        var span = r.start || r.end ? (r.start ? "From " + nice(r.start) : "") + (r.start && r.end ? " " : "") + (r.end ? "until " + nice(r.end) : "") : "";
        return {id: r.id, title: r.text, meta: [when + (r.time ? " · " + r.time : ""), risk, span], note: r.detail, row: [f[1], r.text, when + (span ? " (" + span + ")" : ""), r.time || "", risk, r.detail || ""]};
      }));
    });
    case "tasks": return (h.path || []).map(function(st){ return G(st.title, st.tasks.map(function(t){ return {id: t.id, title: t.text, note: t.detail, row: [st.title, t.text, t.detail || ""]}; })); });
    case "steps": var steps = (h.plan && h.plan.steps) || [], ov = overlap(h.plan); return PHASES.map(function(ph){
      var label = phaseLabel(ph, ov);
      return G(label, steps.filter(function(x){ return x.phase === ph; }).map(function(x){
        var st = {open: "Open", done: "Done", na: "Not needed" + (x.reason ? ": " + x.reason : "")}[x.status];
        return {id: x.id, title: x.title, meta: [who(h, x.role), st], note: x.why, row: [label, x.title, who(h, x.role), st, x.why || ""]};
      }));
    });
    case "inProgress": return [G("", (h.inProgress || []).filter(keep).map(function(x){ var ow = x.owner ? who(h, x.owner) : ""; return {id: x.id, title: x.text, meta: [ow ? "Owner: " + ow : "", x.due ? "Due " + nice(x.due) : "", closedMeta(x)], row: [x.text, ow, x.due || "", status(x)]}; }))];
    case "gaps": return [G("", (h.gaps || []).filter(keep).map(function(x){ return {id: x.id, title: x.text, meta: [x.blocks ? "Blocks work" : "", closedMeta(x)], row: [x.text, x.blocks ? "Yes" : "", status(x)]}; }))];
    case "rules": return [G("", (h.rules || []).filter(keep).map(function(x){ return {id: x.id, title: x.text, meta: [x.situation || "", closedMeta(x)], row: [x.text, x.situation || "", status(x)]}; }))];
    case "decisions": return [G("", (h.decisions || []).filter(keep).map(function(x){ return {id: x.id, title: x.text, meta: [x.date ? "Decided " + nice(x.date) : "", closedMeta(x)], note: x.reason, row: [x.text, x.reason || "", x.date || "", status(x)]}; }))];
    case "risks": return [G("", (h.risks || []).filter(keep).map(function(x){
      var d = x.recurring && duty[x.recurring], ev = x.evidence, onList = d ? cadence(d) + (d.time ? " · " + d.time : "") : "";
      var evText = ev ? [ev.cadence ? cap(ev.cadence) : "", ev.occurrences !== undefined ? ev.occurrences + (ev.occurrences === 1 ? " time" : " times") : "", ev.hours !== undefined ? "about " + ev.hours + " h" : "", ev.source || ""].filter(Boolean).join(", ") : "";
      return {id: x.id, title: x.text, meta: [RISK_LIST[x.list], x.severity ? cap(x.severity) + " severity" : "", x.treatment ? TREAT[x.treatment] : "", onList ? "On the list: " + onList : "", closedMeta(x)],
        note: evText ? "Evidence: " + evText + "." : "", row: [x.text, RISK_LIST[x.list] || "", cap(x.severity), x.treatment ? TREAT[x.treatment] : "", onList, evText, status(x)]};
    }))];
    case "systems": return [G("", (h.systems || []).filter(keep).map(function(x){ var ck = checksText(x.checks); return {id: x.id, title: x.name, meta: [x.purpose || "", x.credentialLocation ? "Login kept in: " + x.credentialLocation : "", x.grantedBy ? "Access from: " + x.grantedBy : "", ck, closedMeta(x)], row: [x.name, x.purpose || "", x.credentialLocation || "", x.grantedBy || "", ck, status(x)]}; }))];
    case "documents": return [G("", (h.documents || []).filter(keep).map(function(x){ return {id: x.id, title: x.url ? "[" + x.title + "](" + x.url + ")" : x.title, meta: [DOC_TYPE[x.type] || "", x.location || "", cap(x.status), closedMeta(x)], row: [x.title, DOC_TYPE[x.type] || "", x.location || "", x.url || "", x.closed ? closedMeta(x) : cap(x.status)]}; }))];
    case "stakeholders": return [G("", (h.stakeholders || []).filter(keep).map(function(x){
      var contact = x.contact && (o["private"] || !Array.isArray(x.contactVisibleTo)) ? x.contact : "";
      return {id: x.id, title: x.name, meta: [x.relationship, contact ? "Contact: " + contact : ""], note: x.involve, row: [x.name, x.relationship, x.involve || "", contact]};
    }))];
    case "decide": var cards = ((h.decide && h.decide.cards) || []).filter(keep); return ["alone", "check", "principal"].map(function(c){
      return G(COLUMN[c], cards.filter(function(x){ return x.column === c; }).map(function(x){
        var ap = x.approver ? (x.approver.role ? who(h, x.approver.role) : stake[x.approver.stakeholder] || "") : "", moved = x.movedByPrincipal ? "Moved here by the principal" : "";
        return {id: x.id, title: x.text, meta: [x.limit ? "Up to " + money(x.limit) : "", ap ? "Approver: " + ap : "", moved], row: [COLUMN[c], x.text, x.limit ? money(x.limit) : "", ap, moved]};
      }));
    });
    case "questions": return [G("", (h.questions || []).map(function(q, i){ return {id: q.id || "q" + (i + 1), title: q.q, meta: [q.tag || ""], note: q.a, row: [q.q, q.a, q.tag || ""]}; }))];
    case "overview": var pl = h.plan, f = h.from || {}, ovl = overlap(pl), dates = [];
      if (pl){
        dates.push({id: "d-prep", title: "Preparation from", meta: [nice(pl.prepStart, "long")]});
        dates.push({id: "d-last", title: who(h, "outgoing") + "'s last day", meta: [nice(pl.lastDay, "long")]});
        dates.push({id: "d-first", title: pl.firstDay ? who(h, "incoming") + "'s first day" : "First day", meta: [pl.firstDay ? nice(pl.firstDay, "long") : "Not hired yet"]});
        dates.push({id: "d-mode", title: ovl ? "Overlap" : "No overlap", meta: [ovl ? "Both assistants work together for a time" : who(h, "principal") + " holds the desk in between"]});
      }
      if (h.timezone) dates.push({id: "d-tz", title: "Timezone", meta: [h.timezone]});
      dates.forEach(function(d){ d.row = ["Dates", d.title, d.meta.join(" · ")]; });
      var contact = f.name || f.availableUntil || f.contact || f.hours ? [{id: "contact", title: f.name ? f.name + (f.role ? ", " + f.role : "") : "The outgoing person",
        meta: [f.availableUntil ? "Can be contacted until " + nice(f.availableUntil, "long") : "", f.contact || "", f.hours || ""]}] : [];
      contact.forEach(function(c){ c.row = ["Contact after the handover", c.title, c.meta.filter(Boolean).join(" · ")]; });
      return [
        G("", h.summary ? [{id: "summary", title: "About this handover", body: h.summary, block: true, row: ["About", "About this handover", blocksText(h.summary)]}] : []),
        G("Dates", dates),
        G("Contact after the handover", contact)
      ];
    case "people": return [G("", (h.people || []).map(function(x){ var r = x.roles.map(function(k){ return ROLE_NAME[k]; }).join(", "); return {id: x.id, title: x.name, meta: [r, x.contact || ""], row: [x.name, r, x.contact || ""]}; }))];
    case "sections": var hidden = {}; (h.rendered || []).forEach(function(id){ hidden[id] = true; });
      return [G("", (h.sections || []).filter(function(x){ return !hidden[x.id]; }).map(function(x){ return {id: x.id, title: x.title, body: x.body, block: true, row: [x.title, blocksText(x.body)]}; }))];
    case "asks": return [G("", (h.asks || []).map(function(x){
      var st = {draft: "Draft", sent: "Sent", confirmed: "Confirmed", corrected: "Corrected", defaulted: "Confirmed by default"}[x.status];
      var dt = function(v){ return v ? nice(String(v).slice(0, 10)) : ""; };
      return {id: x.id, title: ASK_TITLE[x.id], meta: [st, x.minutes ? "about " + x.minutes + " min" : "", x.sent ? "Sent " + dt(x.sent) : "", x.replyBy ? "Reply by " + nice(x.replyBy) : "", x.answered ? "Answered " + dt(x.answered) : ""],
        note: [x.default ? "If no reply: " + x.default : "", x.correction ? "Correction: " + x.correction : ""].filter(Boolean).join(" "),
        row: [ASK_TITLE[x.id], st, x.minutes ? String(x.minutes) : "", dt(x.sent), x.replyBy || "", dt(x.answered), x.default || "", x.correction || ""]};
    }))];
    case "finalCheck": return [G("", (h.finalCheck || []).map(function(x){
      var res = x.result === "pass" ? "Pass" : "Fail";
      return {id: x.id, title: FINAL_TITLE[x.id], meta: [res, x.owner ? "Owner: " + who(h, x.owner) : "", x.due ? "Due " + nice(x.due) : ""], note: x.note || "", row: [FINAL_TITLE[x.id], res, x.note || "", x.owner ? who(h, x.owner) : "", x.due || ""]};
    }))];
    case "signoff": var so = h.signoff; if (!so) return [];
      var signed = ["outgoing", "incoming", "principal"].map(function(r){ return {id: "s-" + r, title: who(h, r), meta: [ROLE_NAME[r], so[r] ? "Signed " + nice(String(so[r]).slice(0, 10)) : "Not signed yet"], row: [who(h, r), ROLE_NAME[r], so[r] ? String(so[r]).slice(0, 10) : ""]}; });
      if (so.frozen) signed.push({id: "s-frozen", title: "Record frozen", meta: [nice(so.frozen, "long")], row: ["Record frozen", "", so.frozen]});
      return [G("", signed), G("Notes added since", (so.notes || []).map(function(n){ return {id: "n-" + n.id, title: n.text, meta: [nice(String(n.at).slice(0, 10)), n.role ? who(h, n.role) : ""], row: [n.text, n.role ? who(h, n.role) : "", String(n.at).slice(0, 10)]}; }))];
  }
  return [];
}
function exportKinds(h, o){
  return EXPORT_KINDS.map(function(k){
    var groups = exportItems(h, k.key, o).filter(function(g){ return g.items.length; });
    var items = []; groups.forEach(function(g){ g.items.forEach(function(it){ items.push({id: it.id, title: it.title, group: g.title}); }); });
    return {key: k.key, title: k.title, hint: k.hint, count: items.length, items: items};
  }).filter(function(k){ return k.count; });
}
function itemsDocument(h, o){
  o = o || {};
  var kinds = o.kinds || ["jobs", "tasks"], parts = [];
  kinds.forEach(function(key){
    var meta = EXPORT_KINDS.filter(function(k){ return k.key === key; })[0]; if (!meta) return;
    var pick = o.only && o.only[key] ? o.only[key] : null;
    var groups = exportItems(h, key, o).map(function(g){
      return {title: g.title, items: g.items.filter(function(it){ return !pick || pick.indexOf(it.id) > -1; }).map(function(it){
        return {id: it.id, title: it.title, meta: (it.meta || []).filter(Boolean), note: it.note || "", body: it.body || "", block: !!it.block, row: it.row || []};
      })};
    }).filter(function(g){ return g.items.length; });
    if (groups.length) parts.push({key: key, title: meta.title, columns: KIND_COLS[key], groups: groups});
  });
  return {title: o.title || h.title, subtitle: h.title + (o.date ? " · " + nice(o.date, "long") : ""), parts: parts};
}
function docMarkdown(doc){
  var L = ["# " + doc.title, "", "*" + doc.subtitle + "*", ""];
  doc.parts.forEach(function(p){
    L.push("## " + p.title, "");
    p.groups.forEach(function(g){
      if (g.title) L.push("### " + g.title, "");
      g.items.forEach(function(it){
        var t = oneLine(it.title), lv = g.title ? 4 : 3;
        if (it.block){
          L.push(hashes(lv) + " " + t, "");
          if (it.body) L.push(mdBody(it.body, lv), "");
          if (it.meta.length) L.push("*" + it.meta.map(oneLine).join(" · ") + "*", "");
          if (it.note) L.push(oneLine(it.note), "");
          return;
        }
        L.push("- " + (/\*\*/.test(t) ? t : "**" + t + "**"));
        if (it.meta.length) L.push("  - " + it.meta.map(oneLine).join(" · "));
        if (it.note) L.push("  - " + oneLine(it.note));
      });
      L.push("");
    });
  });
  return L.join("\n");
}
/* Section bodies (spec section 9): headings, paragraphs, lists, notes (>), warnings (!>) and tables, as blocks */
function tableCells(row){ var r = row.trim(); if (r.charAt(0) === "|") r = r.slice(1); if (r.charAt(r.length - 1) === "|") r = r.slice(0, -1); return r.split("|").map(function(c){ return c.trim(); }); }
var BLOCK_START = /^(#{1,3}\s|\s*\||\s*[-*]\s+|\s*\d+[.)]\s+|>\s?|!>\s?)/;
function parseBlocks(src){
  var lines = String(src || "").replace(/\r\n?/g, "\n").split("\n"), out = [], i = 0, m, buf;
  function take(re){ var got = []; while (i < lines.length && re.test(lines[i])) got.push(lines[i++].replace(re, "")); return got; }
  while (i < lines.length){
    var l = lines[i];
    if (!l.trim()){ i++; continue; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))){ out.push({t: "h", level: m[1].length, text: m[2]}); i++; continue; }
    if (/^\s*\|/.test(l)){
      var rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      var head = null; if (rows.length > 1 && /^\s*\|?\s*:?-{2,}/.test(rows[1])){ head = tableCells(rows[0]); rows = rows.slice(2); }
      out.push({t: "table", head: head, rows: rows.map(tableCells)}); continue;
    }
    if (/^\s*[-*]\s+/.test(l)){ out.push({t: "ul", items: take(/^\s*[-*]\s+/)}); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)){ out.push({t: "ol", items: take(/^\s*\d+[.)]\s+/)}); continue; }
    if (/^!>\s?/.test(l)){ out.push({t: "warn", text: take(/^!>\s?/).join(" ")}); continue; }
    if (/^>\s?/.test(l)){ out.push({t: "note", text: take(/^>\s?/).join(" ")}); continue; }
    buf = []; while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) buf.push(lines[i++]);
    out.push({t: "p", text: buf.join(" ")});
  }
  return out;
}
function tableWidth(b){ return Math.max(b.head ? b.head.length : 0, b.rows.reduce(function(n, r){ return Math.max(n, r.length); }, 0)); }
/* A section body as plain lines, for a spreadsheet cell */
function blocksText(src){
  return parseBlocks(src).map(function(b){
    switch (b.t){
      case "ul": return b.items.map(function(x){ return "• " + x; }).join("\n");
      case "ol": return b.items.map(function(x, i){ return (i + 1) + ". " + x; }).join("\n");
      case "note": return "Note: " + b.text;
      case "warn": return "Warning: " + b.text;
      case "table": return b.rows.map(function(r){ return r.map(function(c, j){ return c && b.head && b.head[j] ? b.head[j] + ": " + c : c; }).filter(Boolean).join(" · "); }).join("\n");
      default: return b.text;
    }
  }).join("\n");
}
function hashes(n){ return new Array(Math.min(6, n) + 1).join("#"); }
function mdBody(src, base){
  return parseBlocks(src).map(function(b){
    switch (b.t){
      case "h": return hashes(base + b.level) + " " + oneLine(b.text);
      case "ul": return b.items.map(function(x){ return "- " + oneLine(x); }).join("\n");
      case "ol": return b.items.map(function(x, i){ return (i + 1) + ". " + oneLine(x); }).join("\n");
      case "note": return "> " + oneLine(b.text);
      case "warn": return "> **Warning:** " + oneLine(b.text);
      case "table":
        var n = tableWidth(b), head = b.head || b.rows[0], rows = b.head ? b.rows : b.rows.slice(1);
        var line = function(r){ var c = []; for (var j = 0; j < n; j++) c.push(oneLine(r[j] || "").replace(/\|/g, "\\|")); return "| " + c.join(" | ") + " |"; };
        return [line(head), "|" + new Array(n + 1).join(" --- |")].concat(rows.map(line)).join("\n");
      default: return oneLine(b.text);
    }
  }).join("\n\n");
}
/* One line, with links into the handover itself reduced to their text: they lead nowhere outside it */
function oneLine(s){ return String(s).replace(/\s*\r?\n+\s*/g, " ").replace(/\[([^\]]+)\]\(#[^)\s]*\)/g, "$1").trim(); }
function escHtml(s){ return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function inlineHtml(s){
  return escHtml(oneLine(s))
    .replace(/\{TODO:\s*([^}]*)\}/g, '<span style="background:#fff3c4">To fill in: $1</span>').replace(/(^|\s)TODO:\s*(.*)$/, '$1<span style="background:#fff3c4">To fill in: $2</span>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>').replace(/\[([^\]]+)\]\([^)\s]*\)/g, "$1");
}
function htmlBody(src, base){
  return parseBlocks(src).map(function(b){
    var lv = Math.min(6, base + b.level);
    switch (b.t){
      case "h": return "<h" + lv + ">" + inlineHtml(b.text) + "</h" + lv + ">";
      case "ul": return "<ul>" + b.items.map(function(x){ return "<li>" + inlineHtml(x) + "</li>"; }).join("") + "</ul>";
      case "ol": return "<ol>" + b.items.map(function(x){ return "<li>" + inlineHtml(x) + "</li>"; }).join("") + "</ol>";
      case "note": return '<div class="note">' + inlineHtml(b.text) + "</div>";
      case "warn": return '<div class="warn"><b>Warning:</b> ' + inlineHtml(b.text) + "</div>";
      case "table":
        var n = tableWidth(b), row = function(r, tag){ var c = []; for (var j = 0; j < n; j++) c.push("<" + tag + ">" + inlineHtml(r[j] || "") + "</" + tag + ">"); return "<tr>" + c.join("") + "</tr>"; };
        return "<table>" + (b.head ? "<thead>" + row(b.head, "th") + "</thead>" : "") + "<tbody>" + b.rows.map(function(r){ return row(r, "td"); }).join("") + "</tbody></table>";
      default: return "<p>" + inlineHtml(b.text) + "</p>";
    }
  }).join("");
}
function docHtml(doc){
  var b = [];
  b.push("<h1>" + inlineHtml(doc.title) + "</h1>", '<p class="sub">' + inlineHtml(doc.subtitle) + "</p>");
  doc.parts.forEach(function(p){
    b.push("<h2>" + inlineHtml(p.title) + "</h2>");
    p.groups.forEach(function(g){
      if (g.title) b.push("<h3>" + inlineHtml(g.title) + "</h3>");
      var lv = g.title ? 4 : 3, list = [];
      var flush = function(){ if (list.length) b.push("<ul>" + list.join("") + "</ul>"); list = []; };
      g.items.forEach(function(it){
        var t = inlineHtml(it.title);
        if (it.block){
          flush();
          b.push("<h" + lv + ">" + t + "</h" + lv + ">" + (it.body ? htmlBody(it.body, lv) : "") + (it.meta.length ? '<p class="meta">' + it.meta.map(inlineHtml).join(" · ") + "</p>" : "") + (it.note ? "<p>" + inlineHtml(it.note) + "</p>" : ""));
          return;
        }
        list.push("<li>" + (/<b>/.test(t) ? t : "<b>" + t + "</b>") + (it.meta.length ? '<br><span class="meta">' + it.meta.map(inlineHtml).join(" · ") + "</span>" : "") + (it.note ? "<br>" + inlineHtml(it.note) : "") + "</li>");
      });
      flush();
    });
  });
  return '<!doctype html>\n<html><head><meta charset="utf-8"><title>' + escHtml(doc.title) + "</title><style>" +
    "body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.45;color:#1d1d1f;max-width:720px;margin:24px auto;padding:0 16px}" +
    "h1{font-size:20pt;margin:0 0 4px}h2{font-size:15pt;margin:22px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px}h3{font-size:12pt;margin:14px 0 4px}" +
    ".sub{color:#666;margin:0 0 12px}.meta{color:#555;font-size:10pt}ul,ol{padding-left:20px;margin:4px 0 10px}li{margin:0 0 7px}a{color:#3b2a8a}h4,h5,h6{font-size:11pt;margin:12px 0 4px}" +
    "table{border-collapse:collapse;width:100%;margin:6px 0 12px;font-size:10pt}th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}th{background:#efede6}" +
    ".note,.warn{border-left:3px solid #c9c4b5;background:#f6f5f1;padding:6px 10px;margin:6px 0 10px}.warn{border-color:#b3261e;background:#fbeeec}" +
    "</style></head><body>\n" + b.join("\n") + "\n</body></html>\n";
}

/* ================= PDF, with no dependencies =================
   Standard Helvetica fonts, WinAnsi text, uncompressed: the whole file is 7-bit ASCII, so it can be
   passed around as a string. Letter paper for American timezones, A4 elsewhere. */
var HELV = " 278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584".trim().split(" ").map(Number);
var HELVB = "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584".split(" ").map(Number);
var WIN = {8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134, 8225: 135, 710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140, 381: 142, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151, 732: 152, 8482: 153, 353: 154, 8250: 155, 339: 156, 382: 158, 376: 159, 8239: 32, 8201: 32, 8202: 32, 8209: 45, 8208: 45};
var WIN_W = {128: 556, 130: 222, 133: 1000, 145: 222, 146: 222, 147: 333, 148: 333, 149: 350, 150: 556, 151: 1000, 153: 1000, 160: 278, 183: 278};
function winBytes(str){ var out = []; for (var i = 0; i < str.length; i++){ var c = str.charCodeAt(i); if (c >= 0xD800 && c <= 0xDBFF){ i++; out.push(63); continue; } out.push(c < 128 || (c >= 160 && c < 256) ? c : WIN[c] || 63); } return out; }
function textWidth(str, bold, size){ return winBytes(str).reduce(function(w, b){ return w + (b >= 32 && b <= 126 ? (bold ? HELVB : HELV)[b - 32] : WIN_W[b] || 556); }, 0) * size / 1000; }
function pdfStr(str){ return "(" + winBytes(str).map(function(b){ return b === 40 || b === 41 || b === 92 ? "\\" + String.fromCharCode(b) : b < 32 || b > 126 ? "\\" + ("00" + b.toString(8)).slice(-3) : String.fromCharCode(b); }).join("") + ")"; }
/* Inline Markdown reduced to plain text for print */
function plainText(s){
  return oneLine(s).replace(/\{TODO:\s*([^}]*)\}/g, "[to fill in: $1]").replace(/(^|\s)TODO:\s*(.*)$/, "$1[to fill in: $2]")
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1$2").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1");
}
function wrapText(str, bold, size, width){
  var words = str.split(/\s+/).filter(Boolean), lines = [], cur = "";
  words.forEach(function(w){
    while (textWidth(w, bold, size) > width){ var n = w.length; while (n > 1 && textWidth(w.slice(0, n), bold, size) > width) n--; if (cur){ lines.push(cur); cur = ""; } lines.push(w.slice(0, n)); w = w.slice(n); }
    var t = cur ? cur + " " + w : w;
    if (cur && textWidth(t, bold, size) > width){ lines.push(cur); cur = w; } else cur = t;
  });
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
function docPdf(doc, o){
  o = o || {};
  var letter = /^America\//.test(o.timezone || ""), W = letter ? 612 : 595.28, Hh = letter ? 792 : 841.89, M = 56, CW = W - 2 * M;
  var pages = [], ops = null, y = 0;
  function newPage(){ ops = []; pages.push(ops); y = Hh - M; }
  function need(h){ if (!ops || y - h < M + 18) newPage(); }
  function text(x, str, font, size, grey){ ops.push((grey ? "0.37 0.39 0.36 rg " : "0.1 0.1 0.1 rg ") + "BT /" + font + " " + size + " Tf " + x.toFixed(2) + " " + y.toFixed(2) + " Td " + pdfStr(str) + " Tj ET"); }
  function para(str, opt){
    var bold = opt.font === "F2", lines = wrapText(plainText(str), bold, opt.size, CW - (opt.indent || 0)), lh = opt.size * 1.3;
    lines.forEach(function(l, i){ need(lh); y -= lh; if (i === 0 && (opt.bullet || opt.marker)){ var mk = opt.marker || "•"; text(M + (opt.indent || 0) - 4 - textWidth(mk, false, opt.size), mk, "F1", opt.size, false); } text(M + (opt.indent || 0), l, opt.font, opt.size, opt.grey); });
  }
  /* A table with wrapped cells; the header row repeats after a page break */
  function grid(b){
    var n = tableWidth(b), size = 8.5, lh = size * 1.25, pad = 4, cols = [], c, j;
    var all = (b.head ? [b.head] : []).concat(b.rows);
    for (c = 0; c < n; c++){ var w = 30; all.forEach(function(r, ri){ w = Math.max(w, textWidth(plainText(r[c] || ""), !!b.head && ri === 0, size) + 2 * pad); }); cols.push(w); }
    var total = cols.reduce(function(a, x){ return a + x; }, 0);
    if (total > CW){
      var fair = CW / n, small = 0, bigNat = 0;
      cols.forEach(function(x){ if (x <= fair) small += x; else bigNat += x; });
      cols = cols.map(function(x){ return x <= fair ? x : x * (CW - small) / bigNat; });
    } else cols = cols.map(function(x){ return x * CW / total; });
    function rule(){ ops.push("0.85 0.84 0.8 RG 0.5 w " + M + " " + y.toFixed(2) + " m " + (M + CW).toFixed(2) + " " + y.toFixed(2) + " l S"); }
    function row(r, head){
      var wrapped = [], lines = 1;
      for (j = 0; j < n; j++){ wrapped.push(wrapText(plainText(r[j] || ""), head, size, cols[j] - 2 * pad)); lines = Math.max(lines, wrapped[j].length); }
      var hgt = lines * lh + 2 * pad, before = pages.length;
      need(hgt);
      if (pages.length > before){ rule(); if (!head && b.head) row(b.head, true); }
      var top = y, x = M;
      if (head) ops.push("0.94 0.93 0.9 rg " + M + " " + (top - hgt).toFixed(2) + " " + CW.toFixed(2) + " " + hgt.toFixed(2) + " re f");
      wrapped.forEach(function(ls, k){ ls.forEach(function(l, li){ y = top - pad - size * 0.85 - li * lh; text(x + pad, l, head ? "F2" : "F1", size, false); }); x += cols[k]; });
      y = top - hgt; rule();
    }
    need(lh * 3); y -= 4; rule();
    if (b.head) row(b.head, true);
    b.rows.forEach(function(r){ row(r, false); });
    y -= 8;
  }
  function blocks(src){
    parseBlocks(src).forEach(function(b){
      switch (b.t){
        case "h": need(40); y -= 4; para(b.text, {font: "F2", size: b.level === 1 ? 11 : 10, grey: b.level > 1}); y -= 2; break;
        case "ul": b.items.forEach(function(x){ para(x, {font: "F1", size: 10, indent: 14, bullet: true}); y -= 2; }); y -= 4; break;
        case "ol": b.items.forEach(function(x, i){ para(x, {font: "F1", size: 10, indent: 16, marker: (i + 1) + "."}); y -= 2; }); y -= 4; break;
        case "note": para(b.text, {font: "F3", size: 10, indent: 10, grey: true}); y -= 6; break;
        case "warn": para("Warning: " + b.text, {font: "F2", size: 10, indent: 10}); y -= 6; break;
        case "table": grid(b); break;
        default: para(b.text, {font: "F1", size: 10}); y -= 5;
      }
    });
  }
  newPage();
  para(doc.title, {font: "F2", size: 20}); y -= 2;
  para(doc.subtitle, {font: "F3", size: 10, grey: true}); y -= 10;
  doc.parts.forEach(function(p){
    need(14 * 1.3 + 50); y -= 12; para(p.title, {font: "F2", size: 14});
    ops.push("0.85 0.84 0.8 RG 0.6 w " + M + " " + (y - 4).toFixed(2) + " m " + (W - M) + " " + (y - 4).toFixed(2) + " l S"); y -= 8;
    p.groups.forEach(function(g){
      if (g.title){ need(11 * 1.3 + 40); y -= 6; para(g.title, {font: "F2", size: 11, grey: true}); y -= 2; }
      g.items.forEach(function(it){
        if (it.block){
          need(12 * 1.3 + 40); y -= 6; para(it.title, {font: "F2", size: 12}); y -= 3;
          if (it.body) blocks(it.body);
          if (it.meta.length) para(it.meta.join(" · "), {font: "F1", size: 9, grey: true});
          if (it.note) para(it.note, {font: "F1", size: 10});
          y -= 4; return;
        }
        need(10.5 * 1.3 + (it.meta.length ? 12 : 0));
        para(it.title, {font: "F2", size: 10.5, indent: 14, bullet: true});
        if (it.meta.length) para(it.meta.join(" · "), {font: "F1", size: 9, indent: 14, grey: true});
        if (it.note) para(it.note, {font: "F1", size: 10, indent: 14});
        y -= 6;
      });
    });
  });
  var n = pages.length;
  pages.forEach(function(pg, i){ var foot = plainText(doc.title) + "  ·  " + (i + 1) + " of " + n; pg.push("0.37 0.39 0.36 rg BT /F1 8 Tf " + M + " " + (M - 24) + " Td " + pdfStr(foot) + " Tj ET"); });
  var objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>";
  objs[6] = "<< /Title " + pdfStr(plainText(doc.title)) + " /Subject " + pdfStr(plainText(doc.subtitle)) + " /Producer (Handover) >>";
  var kids = [];
  pages.forEach(function(pg, i){
    var pid = 7 + i * 2, cid = pid + 1, body = pg.join("\n");
    kids.push(pid + " 0 R");
    objs[pid] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + Hh + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents " + cid + " 0 R >>";
    objs[cid] = "<< /Length " + body.length + " >>\nstream\n" + body + "\nendstream";
  });
  objs[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + n + " >>";
  var out = "%PDF-1.4\n", offs = [];
  for (var k = 1; k < objs.length; k++){ offs[k] = out.length; out += k + " 0 obj\n" + objs[k] + "\nendobj\n"; }
  var xref = out.length;
  out += "xref\n0 " + objs.length + "\n0000000000 65535 f \n" + offs.slice(1).map(function(x){ return ("000000000" + x).slice(-10) + " 00000 n \n"; }).join("");
  out += "trailer\n<< /Size " + objs.length + " /Root 1 0 R /Info 6 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return out;
}

/* ================= Word (.docx) and Excel (.xlsx), with no dependencies =================
   Both are zip files of XML. The zip is stored, not compressed: simple, and these files are small. */
function utf8(str){
  var out = [], i, c;
  for (i = 0; i < str.length; i++){
    c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length){ c = 0x10000 + ((c - 0xD800) << 10) + (str.charCodeAt(++i) - 0xDC00); }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else out.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  return out;
}
var CRC = (function(){ var t = [], c, n, k; for (n = 0; n < 256; n++){ c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes){ var c = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files){
  var out = [], central = [], le = function(arr, v, n){ for (var i = 0; i < n; i++) arr.push(v >>> (8 * i) & 255); };
  var push = function(arr){ for (var i = 0; i < arr.length; i++) out.push(arr[i]); };
  files.forEach(function(f){
    var name = utf8(f.name), data = utf8(f.text), crc = crc32(data), off = out.length, hd = [];
    le(hd, 0x04034b50, 4); le(hd, 20, 2); le(hd, 0x0800, 2); le(hd, 0, 2); le(hd, 0, 2); le(hd, 0x21, 2); le(hd, crc, 4); le(hd, data.length, 4); le(hd, data.length, 4); le(hd, name.length, 2); le(hd, 0, 2);
    push(hd); push(name); push(data);
    var cd = []; le(cd, 0x02014b50, 4); le(cd, 20, 2); le(cd, 20, 2); le(cd, 0x0800, 2); le(cd, 0, 2); le(cd, 0, 2); le(cd, 0x21, 2); le(cd, crc, 4); le(cd, data.length, 4); le(cd, data.length, 4); le(cd, name.length, 2); le(cd, 0, 2); le(cd, 0, 2); le(cd, 0, 2); le(cd, 0, 2); le(cd, 0, 4); le(cd, off, 4);
    central.push(cd.concat(name));
  });
  var start = out.length, size = 0;
  central.forEach(function(c){ push(c); size += c.length; });
  var end = []; le(end, 0x06054b50, 4); le(end, 0, 2); le(end, 0, 2); le(end, files.length, 2); le(end, files.length, 2); le(end, size, 4); le(end, start, 4); le(end, 0, 2);
  push(end);
  return typeof Uint8Array !== "undefined" ? new Uint8Array(out) : out;
}
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes){
  var s = "", i, n;
  for (i = 0; i < bytes.length; i += 3){
    n = bytes[i] << 16 | (i + 1 < bytes.length ? bytes[i + 1] << 8 : 0) | (i + 2 < bytes.length ? bytes[i + 2] : 0);
    s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return s;
}
function xmlEsc(s){ return String(s === undefined || s === null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); }
var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
function coreProps(title){
  return XML_HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xmlEsc(title) + "</dc:title><dc:creator>Handover</dc:creator></cp:coreProperties>";
}

function docDocx(doc){
  var links = [];
  function run(text, o){
    o = o || {};
    var rpr = (o.bold ? "<w:b/>" : "") + (o.italic ? "<w:i/>" : "") + (o.color ? '<w:color w:val="' + o.color + '"/>' : "") + (o.size ? '<w:sz w:val="' + o.size + '"/><w:szCs w:val="' + o.size + '"/>' : "");
    return "<w:r>" + (rpr ? "<w:rPr>" + rpr + "</w:rPr>" : "") + '<w:t xml:space="preserve">' + xmlEsc(text) + "</w:t></w:r>";
  }
  /* Inline Markdown to runs: **bold**, links (external ones stay links), TODO markers */
  function runs(md, o){
    o = o || {};
    var text = oneLine(md).replace(/\{TODO:\s*([^}]*)\}/g, "[to fill in: $1]").replace(/(^|\s)TODO:\s*(.*)$/, "$1[to fill in: $2]").replace(/`([^`]+)`/g, "$1");
    var out = "", re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g, last = 0, m;
    while ((m = re.exec(text))){
      if (m.index > last) out += run(text.slice(last, m.index).replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1$2"), o);
      if (m[1] !== undefined) out += run(m[1], {bold: true, color: o.color, size: o.size, italic: o.italic});
      else if (/^https?:/.test(m[3])){ links.push(m[3]); out += '<w:hyperlink r:id="rIdL' + links.length + '" w:history="1">' + run(m[2], {color: "3B2A8A", size: o.size, bold: o.bold}).replace("</w:rPr>", '<w:u w:val="single"/></w:rPr>') + "</w:hyperlink>"; }
      else out += run(m[2], o);
      last = re.lastIndex;
    }
    if (last < text.length) out += run(text.slice(last).replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1$2"), o);
    return out;
  }
  function p(style, body, extra){ return "<w:p><w:pPr>" + (style ? '<w:pStyle w:val="' + style + '"/>' : "") + (extra || "") + "</w:pPr>" + body + "</w:p>"; }
  var ordered = 0, TW = 9638;
  function list(id){ return '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + id + '"/></w:numPr>'; }
  function tbl(b){
    var n = tableWidth(b), all = (b.head ? [b.head] : []).concat(b.rows), nat = [], j;
    for (j = 0; j < n; j++){ var w = 6; all.forEach(function(r){ w = Math.max(w, Math.min(60, plainText(r[j] || "").length)); }); nat.push(w); }
    var sum = nat.reduce(function(a, x){ return a + x; }, 0), widths = nat.map(function(x){ return Math.round(x * TW / sum); });
    var edge = function(side){ return "<w:" + side + ' w:val="single" w:sz="4" w:space="0" w:color="DEDAD0"/>'; };
    var row = function(r, head){
      var c = []; for (j = 0; j < n; j++) c.push('<w:tc><w:tcPr><w:tcW w:w="' + widths[j] + '" w:type="dxa"/>' + (head ? '<w:shd w:val="clear" w:color="auto" w:fill="EFEDE6"/>' : "") + "</w:tcPr>" + p("TableText", runs(r[j] || "", head ? {bold: true} : {})) + "</w:tc>");
      return "<w:tr>" + (head ? "<w:trPr><w:tblHeader/></w:trPr>" : "<w:trPr><w:cantSplit/></w:trPr>") + c.join("") + "</w:tr>";
    };
    return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' + ["top", "left", "bottom", "right", "insideH", "insideV"].map(edge).join("") + "</w:tblBorders>" +
      '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      widths.map(function(w){ return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>" + (b.head ? row(b.head, true) : "") + b.rows.map(function(r){ return row(r, false); }).join("") + "</w:tbl>" + p("Spacer", "");
  }
  function blocks(src){
    return parseBlocks(src).map(function(b){
      switch (b.t){
        case "h": return p("Heading4", runs(b.text));
        case "ul": return b.items.map(function(x){ return p("ListParagraph", runs(x), list(1)); }).join("");
        case "ol": ordered++; return b.items.map(function(x){ return p("ListParagraph", runs(x), list(ordered + 1)); }).join("");
        case "note": return p("Callout", runs(b.text));
        case "warn": return p("Callout", run("Warning: ", {bold: true}) + runs(b.text));
        case "table": return tbl(b);
        default: return p("", runs(b.text));
      }
    }).join("");
  }
  var body = [];
  body.push(p("Title", run(plainText(doc.title))));
  body.push(p("Subtitle", run(plainText(doc.subtitle))));
  doc.parts.forEach(function(pt){
    body.push(p("Heading1", run(pt.title)));
    pt.groups.forEach(function(g){
      if (g.title) body.push(p("Heading2", run(g.title)));
      g.items.forEach(function(it){
        if (it.block){
          body.push(p("Heading3", runs(it.title)));
          if (it.body) body.push(blocks(it.body));
          if (it.meta.length) body.push(p("Meta", runs(it.meta.join(" · ")), '<w:ind w:left="0"/>'));
          if (it.note) body.push(p("", runs(it.note)));
          return;
        }
        body.push(p("ListParagraph", /\*\*/.test(it.title) ? runs(it.title) : runs(it.title, {bold: true}), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="80" w:after="0"/>'));
        if (it.meta.length) body.push(p("Meta", runs(it.meta.join(" · "))));
        if (it.note) body.push(p("Note", runs(it.note)));
      });
    });
  });
  var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  var documentXml = XML_HEAD + "<w:document " + W + "><w:body>" + body.join("") +
    '<w:sectPr><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
  var font = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>';
  function style(id, name, ppr, rpr, based){ return '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/>' + (based ? '<w:basedOn w:val="' + based + '"/>' : "") + '<w:qFormat/><w:pPr>' + (ppr || "") + "</w:pPr><w:rPr>" + (rpr || "") + "</w:rPr></w:style>"; }
  var stylesXml = XML_HEAD + "<w:styles " + W + "><w:docDefaults><w:rPrDefault><w:rPr>" + font + '<w:color w:val="1D1D1F"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    style("Normal", "Normal") +
    style("Title", "Title", '<w:spacing w:after="40"/>', '<w:b/><w:sz w:val="40"/><w:szCs w:val="40"/>', "Normal") +
    style("Subtitle", "Subtitle", '<w:spacing w:after="240"/>', '<w:i/><w:color w:val="5F645C"/><w:sz w:val="20"/><w:szCs w:val="20"/>', "Normal") +
    style("Heading1", "heading 1", '<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="DEDAD0"/></w:pBdr><w:spacing w:before="320" w:after="80"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="28"/><w:szCs w:val="28"/>', "Normal") +
    style("Heading2", "heading 2", '<w:keepNext/><w:spacing w:before="200" w:after="40"/><w:outlineLvl w:val="1"/>', '<w:b/><w:color w:val="5F645C"/><w:sz w:val="22"/>', "Normal") +
    style("Heading3", "heading 3", '<w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="24"/><w:szCs w:val="24"/>', "Normal") +
    style("Heading4", "heading 4", '<w:keepNext/><w:spacing w:before="160" w:after="40"/><w:outlineLvl w:val="3"/>', '<w:b/><w:color w:val="5F645C"/><w:sz w:val="21"/><w:szCs w:val="21"/>', "Normal") +
    style("Callout", "Callout", '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="C9C4B5"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F6F5F1"/><w:spacing w:before="80" w:after="120"/><w:ind w:left="200" w:right="200"/>', "", "Normal") +
    style("TableText", "Table text", '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="18"/><w:szCs w:val="18"/>', "Normal") +
    style("Spacer", "Spacer", '<w:spacing w:after="0" w:line="120" w:lineRule="exact"/>', '<w:sz w:val="8"/>', "Normal") +
    style("ListParagraph", "List Paragraph", '<w:ind w:left="360" w:hanging="240"/>', "", "Normal") +
    style("Meta", "Item details", '<w:keepLines/><w:spacing w:after="0"/><w:ind w:left="360"/>', '<w:color w:val="5F645C"/><w:sz w:val="18"/>', "Normal") +
    style("Note", "Item note", '<w:spacing w:after="40"/><w:ind w:left="360"/>', "", "Normal") +
    "</w:styles>";
  var numberingXml = XML_HEAD + "<w:numbering " + W + '><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="300"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' + new Array(ordered + 1).join(".").split("").map(function(x, i){ return '<w:num w:numId="' + (i + 2) + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'; }).join("") + "</w:numbering>";
  var rels = '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    links.map(function(u, i){ return '<Relationship Id="rIdL' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xmlEsc(u) + '" TargetMode="External"/>'; }).join("");
  return zip([
    {name: "[Content_Types].xml", text: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'},
    {name: "_rels/.rels", text: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'},
    {name: "docProps/core.xml", text: coreProps(plainText(doc.title))},
    {name: "word/document.xml", text: documentXml},
    {name: "word/styles.xml", text: stylesXml},
    {name: "word/numbering.xml", text: numberingXml},
    {name: "word/_rels/document.xml.rels", text: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>"}
  ]);
}

/* One sheet per kind of item, with a header row, filters and frozen headers */
function cellText(v){ return String(v === undefined || v === null ? "" : v).split("\n").map(plainText).join("\n"); }
function docXlsx(doc){
  function col(n){ var s = ""; n++; while (n){ var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function cellXml(ref, v, st){ return '<c r="' + ref + '" t="inlineStr"' + (st ? ' s="' + st + '"' : "") + '><is><t xml:space="preserve">' + xmlEsc(v) + "</t></is></c>"; }
  var used = {}, sheets = doc.parts.map(function(pt, i){
    var name = pt.title.replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31), n = 2; while (used[name.toLowerCase()]) name = name.slice(0, 28) + " " + n++; used[name.toLowerCase()] = true;
    var head = pt.columns || ["Item"], rows = [];
    pt.groups.forEach(function(g){ g.items.forEach(function(it){ rows.push(it.row && it.row.length ? it.row.map(cellText) : [plainText(it.title)]); }); });
    var widths = head.map(function(hd, c){ var w = hd.length; rows.forEach(function(r){ String(r[c] || "").split("\n").forEach(function(l){ w = Math.max(w, l.length); }); }); return Math.min(Math.max(w + 2, 10), 60); });
    var last = col(head.length - 1) + (rows.length + 1);
    var xml = XML_HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetViews><sheetView workbookViewId="0"' + (i === 0 ? ' tabSelected="1"' : "") + '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      "<cols>" + widths.map(function(w, c){ return '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>'; }).join("") + "</cols><sheetData>" +
      '<row r="1">' + head.map(function(hd, c){ return cellXml(col(c) + "1", hd, 1); }).join("") + "</row>" +
      rows.map(function(r, ri){ return '<row r="' + (ri + 2) + '">' + head.map(function(hd, c){ return cellXml(col(c) + (ri + 2), r[c] || "", 2); }).join("") + "</row>"; }).join("") +
      '</sheetData><autoFilter ref="A1:' + last + '"/></worksheet>';
    return {name: name, xml: xml};
  });
  var files = [
    {name: "[Content_Types].xml", text: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      sheets.map(function(sh, i){ return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("") + "</Types>"},
    {name: "_rels/.rels", text: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'},
    {name: "docProps/core.xml", text: coreProps(plainText(doc.title))},
    {name: "xl/workbook.xml", text: XML_HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function(sh, i){ return '<sheet name="' + xmlEsc(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("") + "</sheets>" +
      (sheets.length ? "<definedNames>" + sheets.map(function(sh, i){ return '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + xmlEsc(sh.name.replace(/'/g, "''")) + "'!" + sh.xml.match(/autoFilter ref="([^"]+)"/)[1].replace(/([A-Z]+)(\d+)/g, "$$$1$$$2") + "</definedName>"; }).join("") + "</definedNames>" : "") + "</workbook>"},
    {name: "xl/_rels/workbook.xml.rels", text: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function(sh, i){ return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join("") +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name: "xl/styles.xml", text: XML_HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEDE6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'}
  ];
  sheets.forEach(function(sh, i){ files.push({name: "xl/worksheets/sheet" + (i + 1) + ".xml", text: sh.xml}); });
  return zip(files);
}

var api = {version: "1.1", validate: validate, schedule: schedule, occursOn: occursOn, cadence: cadence, nice: nice, zoneParts: zoneParts, addDays: addDays, mergeProgress: mergeProgress, contentOnly: contentOnly,
  textFields: textFields, findGaps: findGaps, gapCounts: gapCounts, overlap: overlap, phaseLabel: phaseLabel, phases: PHASES, gates: gates, askMinutes: askMinutes,
  canSee: canSee, exportProfile: exportProfile, renderSections: renderSections, withRendered: withRendered, roles: ROLES, roleName: ROLE_NAME,
  exportKinds: exportKinds, itemsDocument: itemsDocument, docMarkdown: docMarkdown, docHtml: docHtml, docPdf: docPdf, docDocx: docDocx, docXlsx: docXlsx, base64: base64, parseBlocks: parseBlocks, blocksText: blocksText, gapList: gapList, fillGap: fillGap, fillGaps: fillGaps, secretReason: secretReason, closeItem: closeItem, reopenItem: reopenItem, closeHow: CLOSE_HOW, closeLabel: CLOSE_LABEL, addItem: addItem, addFields: ADD_FIELDS, listNoun: LIST_NOUN};
if (typeof module === "object" && module.exports) module.exports = api; else root.HandoverCore = api;
})(typeof window !== "undefined" ? window : this);
