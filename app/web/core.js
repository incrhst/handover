/* Handover format core: validation, schedules and progress merging.
   Shared, unchanged, by the app (app/web/core.js) and the agent skill
   (skills/handover/scripts/core.js). Plain ES5, no dependencies.
   In a browser it sets window.HandoverCore; in Node it is module.exports.
   Spec: https://github.com/incrhst/handover/blob/main/spec/SPEC.md */
(function handoverCore(root){
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
  keys(h, "", ["$schema","handover","id","title","summary","from","updated","timezone","settings","path","recurring","questions","sections","progress"].concat(V11, V12));
  pat(h, "id", "", ID, "lowercase letters, digits and dashes, e.g. ops-lead", true);
  if (h.title === undefined) errors.push("title: required"); else text(h, "title", "", true);
  if (h.summary !== undefined) text(h, "summary", "", false);
  if (h.updated !== undefined) pat(h, "updated", "", DATE, "a date like 2026-11-26");
  if (h.timezone !== undefined){ try { new Intl.DateTimeFormat("en-GB", {timeZone: h.timezone}); } catch(e){ errors.push('timezone: "' + h.timezone + '" is not a known time zone. Use a name like Europe/London'); } }
  if (h.from !== undefined){ if (!isObj(h.from)) errors.push("from: must be an object with a name"); else { keys(h.from, "from", ["name","role","contact","availableUntil","hours","paid"]); text(h.from, "name", "from", true); if (h.from.availableUntil !== undefined) pat(h.from, "availableUntil", "from", DATE, "a date like 2026-12-31"); if (h.from.hours !== undefined) text(h.from, "hours", "from"); if (h.from.paid !== undefined && typeof h.from.paid !== "boolean") errors.push("from.paid: must be true or false"); } }
  if (h.settings !== undefined){ if (!isObj(h.settings)) errors.push("settings: must be an object"); else { keys(h.settings, "settings", ["dailyExportTime"]); if (h.settings.dailyExportTime !== undefined) pat(h.settings, "dailyExportTime", "settings", TIME, "a time like 07:00"); } }
  var sec = {}; list("sections").forEach(function(s, i){ var p = "sections[" + i + "]"; if (!isObj(s)){ errors.push(p + ": must be an object"); return; } keys(s, p, ["id","title","body"]); pat(s, "id", p, ID, "an id like systems", true); text(s, "title", p, true); text(s, "body", p, true); if (s.id){ if (sec[s.id]) errors.push(p + ".id: \"" + s.id + "\" is used twice"); sec[s.id] = true; } });
  function see(o, p){ if (o.see !== undefined){ if (typeof o.see !== "string" || !sec[o.see]) errors.push(p + '.see: no section has id "' + o.see + '"'); } }
  /* 1.4: guides name documents (spec section 19) */
  var docs = {}; (Array.isArray(h.documents) ? h.documents : []).forEach(function(d){ if (isObj(d) && typeof d.id === "string") docs[d.id] = true; });
  function guides(o, p){
    var g = o.guides; if (g === undefined) return;
    if (!Array.isArray(g) || !g.length){ errors.push(p + ".guides: must be a list of document ids"); return; }
    g.forEach(function(id, i){
      if (typeof id !== "string" || !docs[id]) errors.push(p + ".guides[" + i + ']: no document has id "' + id + '"' + (h.documents === undefined ? " (the file has no documents)" : ""));
      else if (g.indexOf(id) !== i) errors.push(p + ".guides[" + i + ']: "' + id + '" is listed twice');
    });
  }
  var stageIds = {}, taskIds = {};
  list("path").forEach(function(s, i){
    var p = "path[" + i + "]"; if (!isObj(s)){ errors.push(p + ": must be an object"); return; }
    keys(s, p, ["id","title","summary","tip","tasks"]); pat(s, "id", p, ID, "an id like week-1", true); text(s, "title", p, true);
    if (s.id){ if (stageIds[s.id]) errors.push(p + '.id: "' + s.id + '" is used twice'); stageIds[s.id] = true; }
    if (s.summary !== undefined) text(s, "summary", p);
    if (s.tip !== undefined){ if (!isObj(s.tip)) errors.push(p + ".tip: must be an object"); else { keys(s.tip, p + ".tip", ["title","text"]); text(s.tip, "text", p + ".tip", true); } }
    if (!Array.isArray(s.tasks) || !s.tasks.length) errors.push(p + ".tasks: needs at least one task");
    else s.tasks.forEach(function(t, j){ var q = p + ".tasks[" + j + "]"; if (!isObj(t)){ errors.push(q + ": must be an object"); return; } keys(t, q, ["id","text","detail","see","guides"]); pat(t, "id", q, ID, "an id like get-access", true); text(t, "text", q, true); if (t.detail !== undefined) text(t, "detail", q); see(t, q); guides(t, q); if (t.id){ if (taskIds[t.id]) errors.push(q + '.id: "' + t.id + '" is used by another task'); taskIds[t.id] = true; } });
  });
  var recIds = {};
  list("recurring").forEach(function(r, i){
    var p = "recurring[" + i + "]"; if (!isObj(r)){ errors.push(p + ": must be an object"); return; }
    keys(r, p, ["id","text","area","every","on","day","monthOfQuarter","date","time","start","end","lead","detail","see","guides"]);
    pat(r, "id", p, ID, "an id like payroll", true); text(r, "text", p, true);
    if (r.area !== undefined) text(r, "area", p);
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
    if (r.lead !== undefined){
      if (!(Number.isInteger(r.lead) && r.lead >= 1 && r.lead <= MAX_LEAD)) errors.push(p + ".lead: must be a whole number of days, 1 to " + MAX_LEAD);
      else if (r.every === "day" || r.every === "weekday") warnings.push(p + ".lead: a lead time has no effect on a job done every day or weekday. Leave it out");
      else { var gap = period(r); if (r.lead >= gap) warnings.push(p + ".lead: " + r.lead + " days ahead reaches back past the previous occurrence (they come about every " + gap + " days), so two will be under way at once. Is the lead time right?"); }
    }
    see(r, p); guides(r, p);
  });
  list("questions").forEach(function(q, i){ var p = "questions[" + i + "]"; if (!isObj(q)){ errors.push(p + ": must be an object"); return; } keys(q, p, ["id","q","a","tag","see"]); text(q, "q", p, true); text(q, "a", p, true); if (q.id !== undefined) pat(q, "id", p, ID, "an id"); if (q.tag !== undefined) text(q, "tag", p); see(q, p); });
  if (h.progress !== undefined){
    var g = h.progress; if (!isObj(g)) errors.push("progress: must be an object");
    else { keys(g, "progress", ["updated","firstSeen","tasks","recurring","notes"]); if (g.firstSeen !== undefined) pat(g, "firstSeen", "progress", DATE, "a date");
      ["tasks","recurring"].forEach(function(k){ if (g[k] !== undefined && !isObj(g[k])) errors.push("progress." + k + ": must be an object"); });
      if (g.notes !== undefined && typeof g.notes !== "string") errors.push("progress.notes: must be text"); }
  }
  validate11(h, {errors: errors, warnings: warnings, err: err, keys: keys, isObj: isObj, sec: sec, rec: recIds, guides: guides});
  var needs = usesMinor(h);
  if (ver[1] < needs) warnings.push('handover: the file says "' + h.handover + '" but uses 1.' + needs + ' fields. Set it to "1.' + needs + '"');
  return {errors: errors, warnings: warnings};
}

/* ================= Validation of the 1.1 objects (spec sections 9 to 16) ================= */
var MINOR = 4;
var ROLES = ["outgoing","incoming","principal","owner","facilitator"];
var ASKS = ["breaks","profile","access","limits","confid","emergency","signoff"];
var FINAL = ["recurring","in-progress","decisions","context","access","exceptions","decide"];
var V11 = ["audience","profile","people","stakeholders","plan","asks","gaps","inProgress","rules","decisions","risks","systems","documents","decide","finalCheck","signoff","followUps","catchUps","history","rendered"];
/* 1.2: the role itself (for a job description), jobs done as needed, and an area on regular jobs */
var V12 = ["role","asNeeded"];
/* 1.3: a lead time on regular jobs (spec section 18) */
/* 1.4: guides on tasks and jobs, and a section on first-weeks tasks (spec section 19) */
function uses14(h){
  var jobs = [].concat(Array.isArray(h.recurring) ? h.recurring : [], Array.isArray(h.asNeeded) ? h.asNeeded : []);
  if (jobs.some(function(r){ return r && r.guides !== undefined; })) return true;
  return (Array.isArray(h.path) ? h.path : []).some(function(s){ return s && Array.isArray(s.tasks) && s.tasks.some(function(t){ return t && (t.guides !== undefined || t.see !== undefined); }); });
}
/* The lowest minor version that has every field h uses (spec section 8) */
function usesMinor(h){
  if (!h || typeof h !== "object") return 0;
  if (uses14(h)) return 4;
  if (Array.isArray(h.recurring) && h.recurring.some(function(r){ return r && r.lead !== undefined; })) return 3;
  if (V12.some(function(k){ return h[k] !== undefined; }) || (Array.isArray(h.recurring) && h.recurring.some(function(r){ return r && r.area !== undefined; }))) return 2;
  if (V11.some(function(k){ return h[k] !== undefined; }) || (h.from && typeof h.from === "object" && (h.from.hours !== undefined || h.from.paid !== undefined))) return 1;
  return 0;
}
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
  history: {o: {id: "id", at: "datetime", role: "role", source: E(["app","ai"]), text: "md"}, r: ["id","at","source","text"]},
  asNeeded: {o: {id: "id", text: "line", area: "line", when: "line", detail: "md", see: "id", guides: "skip"}, r: ["id","text"]}
};
var ROLE = {o: {organisation: "line", purpose: "md", location: "line", hours: "line", travel: "line", manages: "line", skills: "md", measures: "md"}, r: []};
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
  /* 1.2 */
  if (h.role !== undefined) fields(h.role, "role", ROLE);
  list(h.asNeeded, "asNeeded", SPEC11.asNeeded, function(o, q){ if (typeof o.see === "string" && !c.sec[o.see]) errors.push(q + '.see: no section has id "' + o.see + '"'); c.guides(o, q); });
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
/* Lead time (spec section 18): the most days ahead a job can start, and the shortest time between two occurrences */
var MAX_LEAD = 366;
function period(r){
  switch (r.every){
    case "day": case "weekday": return 1;
    case "week": var on = [].concat(r.on || "mon").map(function(d){ return DAYS.indexOf(d); }).filter(function(i){ return i > -1; }).sort();
      if (on.length < 2) return 7;
      return on.reduce(function(m, d, i){ var nx = i + 1 < on.length ? on[i + 1] : on[0] + 7; return Math.min(m, nx - d); }, 7);
    case "month": return 28;
    case "quarter": return 89;
    case "year": return 365;
  }
  return 365;
}
function leadOf(r){ return Number.isInteger(r.lead) && r.lead >= 1 && r.lead <= MAX_LEAD ? r.lead : 0; }
var fmtShort = new Intl.DateTimeFormat("en-GB", {weekday: "short", day: "numeric", month: "short", timeZone: "UTC"});
var fmtLong = new Intl.DateTimeFormat("en-GB", {weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC"});
var fmtDay = new Intl.DateTimeFormat("en-GB", {day: "numeric", month: "short", timeZone: "UTC"});
function nice(s, kind){ return (kind === "long" ? fmtLong : kind === "day" ? fmtDay : fmtShort).format(new Date(utc(s))); }
function ordinal(n){ var s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
var DAYNAME = {mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday"};
function cadence(r){ var c = cadenceOnly(r), n = leadOf(r); return n && c ? c + ", starting " + leadWords(n) + " before" : c; }
function leadWords(n){ return n === 1 ? "1 day" : n % 7 === 0 && n <= 56 ? (n === 7 ? "1 week" : n / 7 + " weeks") : n + " days"; }
function cadenceOnly(r){
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
/* What is due on today: {overdue, due, start, next, later}. Each entry is {r, date} for one occurrence (date is when it is due).
   A job with a lead time (spec section 18) goes on the list lead days before its date: start holds the occurrences under way,
   each with starts (the day it went on the list), daysLeft and done. For those jobs, next and later give the day the work starts, as starts. */
function schedule(h, progress, today){
  progress = progress || {};
  var done = progress.recurring || {};
  function isDone(id, date){ return !!done[id + "@" + date]; }
  var rec = h.recurring || [], floor = progress.firstSeen || today;
  var due = [], overdue = [], start = [], next = [], later = [];
  rec.forEach(function(r){
    var lead = leadOf(r);
    if (occursOn(r, today)) due.push({r: r, date: today});
    var lim = BACK[r.every] || 31;
    for (var k = 1; k <= lim; k++){
      var s = addDays(today, -k); if (s < floor || (r.start && s < r.start)) break;
      if (occursOn(r, s)){ if (!isDone(r.id, s)) overdue.push({r: r, date: s}); break; }
    }
    if (lead){
      /* Under way: due in the next lead days. The work went on the list on date - lead. */
      for (var i = 1; i <= lead; i++){ var u = addDays(today, i); if (occursOn(r, u)) start.push({r: r, date: u, starts: addDays(u, -lead), daysLeft: i, done: isDone(r.id, u), doneAt: done[r.id + "@" + u] || null}); }
      /* Starting soon: the day the work for a later occurrence goes on the list */
      if (r.every !== "day" && r.every !== "weekday"){
        for (var j = 1; j <= 7; j++){ var v = addDays(today, j + lead); if (occursOn(r, v)) next.push({r: r, date: v, starts: addDays(today, j)}); }
      }
      if (["month","quarter","year"].indexOf(r.every) > -1){
        for (var y = 8; y <= 75; y++){ var w = addDays(today, y + lead); if (occursOn(r, w)){ later.push({r: r, date: w, starts: addDays(today, y)}); break; } }
      }
      return;
    }
    if (r.every !== "day" && r.every !== "weekday"){
      for (var jj = 1; jj <= 7; jj++){ var d = addDays(today, jj); if (occursOn(r, d)) next.push({r: r, date: d}); }
    }
    if (["month","quarter","year"].indexOf(r.every) > -1){
      for (var x = 8; x <= 75; x++){ var e = addDays(today, x); if (occursOn(r, e)){ later.push({r: r, date: e}); break; } }
    }
  });
  /* By the day it needs doing: the start day for a job with a lead time, the date otherwise */
  var on = function(o){ return o.starts || o.date; };
  var byDate = function(a, b){ return on(a) < on(b) ? -1 : on(a) > on(b) ? 1 : (a.r.time || "") < (b.r.time || "") ? -1 : 1; };
  var byDue = function(a, b){ return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.r.time || "") < (b.r.time || "") ? -1 : 1; };
  due.sort(byDate); overdue.sort(byDate); start.sort(byDue); next.sort(byDate); later.sort(byDate);
  return {due: due, overdue: overdue, start: start, next: next, later: later};
}

/* ================= Reminders ================= */
/* The day and the zone's offset at instant t, in zone tz (the reader's own zone when tz is empty or unknown) */
function zoneClock(t, tz){
  var o = {}; try { new Intl.DateTimeFormat("en-GB", {timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"}).formatToParts(new Date(t)).forEach(function(p){ o[p.type] = p.value; }); }
  catch(e){ return zoneClock(t, undefined); }
  var wall = Date.UTC(+o.year, +o.month - 1, +o.day, o.hour === "24" ? 0 : +o.hour, +o.minute, +o.second);
  return {date: o.year + "-" + o.month + "-" + o.day, offset: wall - Math.floor(t / 1000) * 1000};
}
/* The instant a wall-clock date and time happen in zone tz */
function zoneTime(date, time, tz){
  var a = date.split("-").map(Number), b = (TIME.test(time || "") ? time : "00:00").split(":").map(Number);
  var wall = Date.UTC(a[0], a[1] - 1, a[2], b[0], b[1]), t = wall - zoneClock(wall, tz).offset;
  return wall - zoneClock(t, tz).offset;
}
function firstFew(names, n){ return names.length <= n ? names.join(", ") : names.slice(0, n).join(", ") + " and " + (names.length - n) + " more"; }
/* The morning summary for day d: what needs doing that day (jobs due, overdue and under way, and open things in progress
   due by then), as a reminder at settings.dailyExportTime. null when there is nothing to do. Also used to bring a summary
   already shown up to date once jobs in it are ticked. */
function summaryFor(h, progress, d){
  progress = progress || {};
  var done = progress.recurring || {}, lines = [], count = 0;
  var morning = (h.settings && TIME.test(h.settings.dailyExportTime || "") && h.settings.dailyExportTime) || "07:00";
  function open(x){ return !done[x.r.id + "@" + x.date]; }
  function name(x){ return plainText(x.r.text); }
  var sc = schedule(h, progress, d);
  var due = sc.due.filter(open), overdue = sc.overdue.filter(open), start = sc.start.filter(open);
  var work = (h.inProgress || []).filter(function(x){ return !x.closed && x.due && x.due <= d; });
  if (due.length){ count += due.length; lines.push("Due: " + firstFew(due.map(function(x){ return name(x) + (x.r.time ? " (" + x.r.time + ")" : ""); }), 3)); }
  if (overdue.length){ count += overdue.length; lines.push("Overdue: " + firstFew(overdue.map(name), 2)); }
  if (start.length){ count += start.length; lines.push("Under way: " + firstFew(start.map(function(x){ return name(x) + " (" + (x.daysLeft === 1 ? "1 day" : x.daysLeft + " days") + " left)"; }), 2)); }
  if (work.length){ count += work.length; lines.push("In progress: " + firstFew(work.map(function(x){ return plainText(x.text) + (x.due < d ? " (overdue)" : ""); }), 2)); }
  if (!count) return null;
  return {id: "summary." + d, at: zoneTime(d, morning, h.timezone), date: d, kind: "summary", key: "", title: h.title, subtitle: (count === 1 ? "1 thing" : count + " things") + " to do today", body: lines.join("\n")};
}
/* The reminders to schedule from now until the end of the next `days` days (default 14), each {id, at, date, kind, title,
   subtitle, body, key}: at is the instant (ms) it goes off, date the day it is for. Two kinds:
   - "summary": each morning at settings.dailyExportTime, what needs doing that day (jobs due, overdue and under way, and open
     things in progress due by then). None on a day with nothing to do.
   - "job": a job with a time, at that time on the day it is due, unless it is ticked. key is its occurrence, <id>@<date>.
   Ticks are taken from progress as it is now, so call this again whenever they change. o: {morning, jobs, days, limit}.
   At most limit (default 60: macOS keeps 64 per app, which leaves room for reminders put off for an hour). When there are
   more, the list stops at the last day that fits whole, so no day has only some of its reminders. */
function reminders(h, progress, now, o){
  o = o || {}; progress = progress || {};
  var tz = h.timezone, today = zoneClock(now, tz).date, days = o.days || 14, done = progress.recurring || {}, out = [];
  for (var i = 0; i < days; i++){
    var d = addDays(today, i);
    if (o.jobs !== false) (h.recurring || []).forEach(function(r){
      if (!r.time || !occursOn(r, d) || done[r.id + "@" + d]) return;
      var at = zoneTime(d, r.time, tz);
      if (at > now) out.push({id: "job." + r.id + "@" + d, at: at, date: d, kind: "job", key: r.id + "@" + d, title: plainText(r.text), subtitle: h.title, body: "Due at " + r.time + (r.detail ? ". " + plainText(String(r.detail).split("\n")[0]) : "")});
    });
    if (o.morning === false) continue;
    var sum = summaryFor(h, progress, d);
    if (sum && sum.at > now) out.push(sum);
  }
  out.sort(function(a, b){ return a.at - b.at || (a.id < b.id ? -1 : 1); });
  var limit = o.limit || 60;
  if (out.length <= limit) return out;
  var cut = out[limit].date, whole = out.filter(function(x){ return x.date < cut; });
  return whole.length ? whole : out.slice(0, limit);
}

/* The occurrences ticked that are due on or after since, so a reminder put off for later can be dropped once its job is done */
function ticksSince(progress, since){
  var done = (progress && progress.recurring) || {};
  return Object.keys(done).filter(function(k){ return done[k] && k.split("@")[1] >= since; }).sort();
}

/* ================= Calendar file (.ics, RFC 5545) ================= */
/* The regular jobs as one calendar file that Apple Calendar, Google Calendar and Outlook can import. Each job is one event that
   repeats on the job's schedule, from its first date on or after o.from (default: today in the handover's zone) until its end.
   A job with a time is an event at that time in the handover's zone (a VTIMEZONE is written for it); one without is all-day.
   A job with a lead time gets an alert that many days before. The UID is the job's id, so importing again can update it.
   o: {ids (only these jobs), from (YYYY-MM-DD), now (ms, for DTSTAMP)}. Returns {text, count}. No change to the format. */
var ICS_DAY = {mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU"}, ICS_DOW = ["SU","MO","TU","WE","TH","FR","SA"];
function icsText(s){ return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
/* Lines longer than 75 octets go on in a line that starts with a space, never splitting a character */
function icsFold(line){
  var out = [], cur = "", n = 0;
  for (var i = 0; i < line.length; i++){
    var c = line.charAt(i), code = line.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < line.length){ c += line.charAt(++i); }
    var b = code < 0x80 ? 1 : code < 0x800 ? 2 : c.length > 1 ? 4 : 3;
    if (n + b > (out.length ? 74 : 75)){ out.push(cur); cur = ""; n = 0; }
    cur += c; n += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
function icsDate(s){ return s.replace(/-/g, ""); }
function icsUtc(t){ return new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); }
function icsOffset(ms){ var m = Math.round(ms / 60000), a = Math.abs(m); return (m < 0 ? "-" : "+") + ("0" + Math.floor(a / 60)).slice(-2) + ("0" + a % 60).slice(-2); }
function validZone(tz){ if (!tz) return false; try { new Intl.DateTimeFormat("en-GB", {timeZone: tz}); return true; } catch(e){ return false; } }
/* The nth (or, for -1, the last) weekday dow (0 = Sunday) of month m in year y, as a day of the month */
function nthWeekday(y, m, dow, n){
  if (n < 0){ var last = dim(y, m), ld = new Date(Date.UTC(y, m - 1, last)).getUTCDay(); return last - ((ld - dow + 7) % 7); }
  var fd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return 1 + ((dow - fd + 7) % 7) + (n - 1) * 7;
}
/* The zone's rules as worked out for year: each change of offset that year as a yearly rule (nth or last weekday of a month) */
function vtimezone(tz, year){
  function off(t){ return zoneClock(t, tz).offset; }
  var lines = ["BEGIN:VTIMEZONE", "TZID:" + tz], prev = Date.UTC(year, 0, 1, 12), was = off(prev), found = 0;
  for (var i = 1; i <= 366; i++){
    var t = Date.UTC(year, 0, 1 + i, 12), now = off(t);
    if (now === was){ prev = t; continue; }
    var lo = prev, hi = t;
    while (hi - lo > 60000){ var mid = Math.floor((lo + hi) / 2 / 60000) * 60000; if (off(mid) === was) lo = mid; else hi = mid; }
    var wall = new Date(hi + was), m = wall.getUTCMonth() + 1, d = wall.getUTCDate(), dow = wall.getUTCDay();
    var n = d + 7 > dim(year, m) ? -1 : Math.ceil(d / 7), kind = now > was ? "DAYLIGHT" : "STANDARD";
    var hm = ("0" + wall.getUTCHours()).slice(-2) + ("0" + wall.getUTCMinutes()).slice(-2) + "00";
    lines.push("BEGIN:" + kind, "DTSTART:1970" + ("0" + m).slice(-2) + ("0" + nthWeekday(1970, m, dow, n)).slice(-2) + "T" + hm,
      "RRULE:FREQ=YEARLY;BYMONTH=" + m + ";BYDAY=" + n + ICS_DOW[dow], "TZOFFSETFROM:" + icsOffset(was), "TZOFFSETTO:" + icsOffset(now), "END:" + kind);
    found++; was = now; prev = t;
  }
  if (!found) lines.push("BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:" + icsOffset(was), "TZOFFSETTO:" + icsOffset(was), "END:STANDARD");
  lines.push("END:VTIMEZONE");
  return lines;
}
/* The day of the month as a rule: a day past a month's end falls on its last day (spec section 5), so 29 to 31 take the last of 28..n */
function icsMonthDay(day){
  if (day === "last") return "BYMONTHDAY=-1";
  var n = day || 1; if (n <= 28) return "BYMONTHDAY=" + n;
  var ds = []; for (var k = 28; k <= n; k++) ds.push(k);
  return "BYMONTHDAY=" + ds.join(",") + ";BYSETPOS=-1";
}
function icsRule(r){
  switch (r.every){
    case "day": return "FREQ=DAILY";
    case "weekday": return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "week": var on = [].concat(r.on || "mon"); return "FREQ=WEEKLY;BYDAY=" + DAYS.filter(function(d){ return on.indexOf(d) > -1; }).map(function(d){ return ICS_DAY[d]; }).join(",");
    case "month": return "FREQ=MONTHLY;" + icsMonthDay(r.day);
    case "quarter": return "FREQ=MONTHLY;INTERVAL=3;" + icsMonthDay(r.day);
    case "year": var md = r.date.split("-").map(Number); return "FREQ=YEARLY;BYMONTH=" + md[0] + ";" + icsMonthDay(md[1]);
  }
  return "";
}
/* The first date on or after from that the job falls on, or null when it has none left */
function firstOn(r, from){
  var s = r.start && r.start > from ? r.start : from;
  for (var i = 0; i <= 400; i++){ var d = addDays(s, i); if (r.end && d > r.end) return null; if (occursOn(r, d)) return d; }
  return null;
}
function calendarFile(h, o){
  o = o || {};
  var tz = validZone(h.timezone) ? h.timezone : "", from = o.from || zoneParts(h.timezone).date, now = o.now || Date.now();
  var title = plainText(h.title || "Handover"), events = [], timed = false;
  (h.recurring || []).forEach(function(r){
    if (!r || r.visibleTo || (o.ids && o.ids.indexOf(r.id) < 0)) return;
    var first = firstOn(r, from); if (!first) return;
    var at = TIME.test(r.time || "") ? r.time : "", lead = leadOf(r), rule = icsRule(r);
    if (!rule) return;
    var ev = ["BEGIN:VEVENT", "UID:" + r.id + "@" + (h.id || "handover") + ".handover", "DTSTAMP:" + icsUtc(now), "SUMMARY:" + icsText(plainText(r.text))];
    if (at){
      timed = true;
      var local = icsDate(first) + "T" + at.replace(":", "") + "00";
      ev.push(tz ? "DTSTART;TZID=" + tz + ":" + local : "DTSTART:" + local, "DURATION:PT30M");
      if (r.end) rule += ";UNTIL=" + (tz ? icsUtc(zoneTime(r.end, at, tz)) : icsDate(r.end) + "T" + at.replace(":", "") + "00");
    } else {
      ev.push("DTSTART;VALUE=DATE:" + icsDate(first), "DTEND;VALUE=DATE:" + icsDate(addDays(first, 1)), "TRANSP:TRANSPARENT");
      if (r.end) rule += ";UNTIL=" + icsDate(r.end);
    }
    ev.push("RRULE:" + rule);
    var desc = [cadence(r) + (at ? ", at " + at : "") + "."];
    if (r.detail) desc.push(String(r.detail).split("\n").map(plainText).join("\n").trim());
    desc.push("From the handover: " + title);
    ev.push("DESCRIPTION:" + icsText(desc.filter(Boolean).join("\n\n")));
    if (r.area) ev.push("CATEGORIES:" + icsText(plainText(r.area)));
    if (lead) ev.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsText("Start now: " + plainText(r.text) + " (due in " + leadWords(lead) + ")"), "TRIGGER:-P" + lead + "D", "END:VALARM");
    ev.push("END:VEVENT");
    events.push(ev);
  });
  var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//incrhst//Handover//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + icsText(title)];
  if (tz) lines.push("X-WR-TIMEZONE:" + tz);
  if (timed && tz) lines = lines.concat(vtimezone(tz, +from.slice(0, 4)));
  events.forEach(function(ev){ lines = lines.concat(ev); });
  lines.push("END:VCALENDAR");
  return {text: lines.map(icsFold).join("\r\n") + "\r\n", count: events.length};
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

/* ================= Apple Reminders: the regular jobs as a to-do list ================= */
/* The jobs to keep in a Reminders list on day today: one item per job, for its next date that isn't ticked (or the one that
   is overdue). It shows from o.days (default 7) days before that date, or from the day the work starts for a job with a lead
   time, and stays until it is ticked. Each item is {key (<id>@<date>), title, notes, due, time, starts}. ticked lists the
   occurrences done in the last 400 days (a yearly job can be ticked late), so their reminders can be ticked too. Items for some people only are left out. */
var TODO_BACK = 400;
function todoList(h, progress, today, o){
  o = o || {}; progress = progress || {};
  var done = progress.recurring || {}, days = o.days || 7, title = plainText(h.title || "Handover"), items = [];
  var overdue = {}; schedule(h, progress, today).overdue.forEach(function(x){ overdue[x.r.id] = x.date; });
  (h.recurring || []).forEach(function(r){
    if (!r || r.visibleTo) return;
    var d = overdue[r.id] || null;
    for (var i = 0; !d && i <= 400; i++){ var s = addDays(today, i); if (r.end && s > r.end) break; if (occursOn(r, s) && !done[r.id + "@" + s]) d = s; }
    if (!d) return;
    var lead = leadOf(r), starts = lead ? addDays(d, -lead) : "";
    if (d > today && (starts || d) > addDays(today, days)) return;
    var notes = [cadence(r) + (r.time ? ", at " + r.time : "") + "."];
    if (r.detail) notes.push(String(r.detail).split("\n").map(plainText).join("\n").trim());
    notes.push("From the handover: " + title);
    items.push({key: r.id + "@" + d, title: plainText(r.text), notes: notes.filter(Boolean).join("\n\n"), due: d, time: TIME.test(r.time || "") ? r.time : "", starts: starts});
  });
  items.sort(function(a, b){ return a.due < b.due ? -1 : a.due > b.due ? 1 : (a.time || "") < (b.time || "") ? -1 : 1; });
  var since = addDays(today, -TODO_BACK);
  return {items: items, ticked: Object.keys(done).filter(function(k){ return done[k] && (k.split("@")[1] || "") >= since; }).sort()};
}
/* What to change so the Reminders list matches, and the other way round. want is todoList's result; have is the list's
   reminders as {id, key, done}. seen maps each key to whether its reminder was ticked when the two last matched, and
   written to a fingerprint of what was last written into it. A reminder ticked or unticked in Reminders since then (done
   differs from seen) goes back to the app as ticks, and wins over the app for that round. Otherwise the app wins: reminders
   are ticked or unticked to match, rewritten when the job changed (not when someone edited the reminder), created, or
   removed when not ticked and no longer wanted. Returns {ticks: [{key, done}], create: [item], update: [{id, ...item}],
   set: [{id, done}], remove: [id], seen, written}. */
function todoSig(w){ return [w.title, w.notes, w.due, w.time, w.starts].map(function(v){ return v || ""; }).join("\n\u0001"); }
function todoPlan(want, have, seen, written){
  seen = seen || {}; written = written || {};
  var wanted = {}, ticked = {}, kept = {}, out = {ticks: [], create: [], update: [], set: [], remove: [], seen: {}, written: {}};
  (want.items || []).forEach(function(w){ wanted[w.key] = w; });
  (want.ticked || []).forEach(function(k){ ticked[k] = true; });
  function keep(k){ if (written[k]) out.written[k] = written[k]; }
  (have || []).forEach(function(x){
    if (!x || !x.key || kept[x.key]){ if (x && x.id) out.remove.push(x.id); return; }
    var k = x.key, done = !!x.done, w = wanted[k];
    kept[k] = true;
    if (done !== (seen[k] === true)){ out.ticks.push({key: k, done: done}); out.seen[k] = done; keep(k); return; }
    if (!!ticked[k] !== done){ done = !!ticked[k]; out.set.push({id: x.id, done: done}); }
    if (!done && !w){ out.remove.push(x.id); return; }
    out.seen[k] = done;
    if (w && !done && written[k] !== todoSig(w)){
      var u = {id: x.id}; Object.keys(w).forEach(function(f){ u[f] = w[f]; });
      out.update.push(u); out.written[k] = todoSig(w);
    } else keep(k);
  });
  (want.items || []).forEach(function(w){ if (!kept[w.key] && !ticked[w.key]){ out.create.push(w); out.seen[w.key] = false; out.written[w.key] = todoSig(w); } });
  return out;
}

/* ================= Merging two copies of the content (a shared folder) ================= */
/* mergeHandover(base, mine, theirs) combines two copies of one handover that were changed apart.
   base is the copy both started from, or null if it isn't known (then nothing counts as removed).
   Items in lists match by id. A change made on one side only is kept. Where both sides changed the
   same field differently, mine is kept and the field is listed in conflicts. Two items added on both
   sides under the same id, with different added (or at) times, are different items: mine gets a new
   id, listed in renamed. Sections written for 1.0 readers are written again from the merged data.
   Returns {h, conflicts: ["gaps › gap-x › text", …], renamed: [{where, from, to}]}. */
function mObj(v){ return !!v && typeof v === "object" && !Array.isArray(v); }
function canon(v){
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (mObj(v)) return "{" + Object.keys(v).sort().map(function(k){ return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
function same(a, b){ return canon(a) === canon(b); }
function isIdList(lists){
  var all = [].concat.apply([], lists.filter(Array.isArray));
  return all.length > 0 && all.every(function(x){ return mObj(x) && typeof x.id === "string"; });
}
function byId(list){ var o = {}; list.forEach(function(x){ o[x.id] = x; }); return o; }
function bornAt(x){ return String(x.added || x.at || ""); }
function merge3(b, m, t, where, out){
  if (same(m, t)) return clone(m);
  if (b !== undefined){ if (same(b, m)) return clone(t); if (same(b, t)) return clone(m); }
  if (mObj(m) && mObj(t)) return mergeObject(mObj(b) ? b : undefined, m, t, where, out);
  if (Array.isArray(m) && Array.isArray(t) && isIdList([b, m, t])) return mergeIdList(Array.isArray(b) ? b : undefined, m, t, where, out);
  out.conflicts.push(where.join(" › ") || "the whole file");
  return clone(m);
}
function mergeObject(b, m, t, where, out){
  var r = {}, keys = Object.keys(m);
  Object.keys(t).forEach(function(k){ if (keys.indexOf(k) < 0) keys.push(k); });
  keys.forEach(function(k){
    var bv = b ? b[k] : undefined, mv = m[k], tv = t[k];
    if (mv === undefined){ if (bv !== undefined && same(bv, tv)) return; r[k] = clone(tv); }       // removed here, or added there
    else if (tv === undefined){ if (bv !== undefined && same(bv, mv)) return; r[k] = clone(mv); }  // removed there, or added here
    else r[k] = merge3(bv, mv, tv, where.concat([k]), out);
  });
  return r;
}
function mergeIdList(b, m, t, where, out){
  var bm = byId(b || []), mm = byId(m), tm = byId(t), taken = {}, collide = {}, res = [];
  [b || [], m, t].forEach(function(l){ l.forEach(function(x){ taken[x.id] = true; }); });
  /* Their order first, merging the items both have */
  t.forEach(function(x){
    var mine = mm[x.id];
    if (mine){
      if (!bm[x.id] && bornAt(mine) !== bornAt(x) && !same(mine, x)){ collide[x.id] = true; res.push(clone(x)); }
      else res.push(merge3(bm[x.id], mine, x, where.concat([x.id]), out));
    } else if (!(bm[x.id] && same(bm[x.id], x))) res.push(clone(x));   // kept unless I removed it and they didn't change it
  });
  /* Then mine that they don't have, each placed after the item before it in my copy */
  var placed = {}; res.forEach(function(x){ placed[x.id] = x.id; });
  m.forEach(function(x, i){
    if (tm[x.id] && !collide[x.id]) return;
    if (!tm[x.id] && bm[x.id] && same(bm[x.id], x)) return;            // they removed it and I didn't change it
    var item = clone(x);
    if (collide[x.id]){
      var k = 2; while (taken[x.id + "-" + k]) k++;
      item.id = x.id + "-" + k; taken[item.id] = true;
      out.renamed.push({where: where.join(" › "), from: x.id, to: item.id});
    }
    var at = 0;
    for (var j = i - 1; j >= 0; j--){
      var prev = collide[m[j].id] ? placed["mine:" + m[j].id] : placed[m[j].id] && m[j].id;
      if (prev){ at = res.map(function(y){ return y.id; }).indexOf(prev) + 1; break; }
    }
    res.splice(at, 0, item);
    placed[collide[x.id] ? "mine:" + x.id : x.id] = item.id;
  });
  return res;
}
function mergeHandover(base, mine, theirs){
  if (!mObj(mine) || !mObj(theirs)) throw new Error("Both copies must be handovers.");
  if (mine.id !== theirs.id) throw new Error('These are different handovers: "' + mine.id + '" and "' + theirs.id + '".');
  var rendered = [mine, theirs].some(function(h){ return Array.isArray(h.rendered) && h.rendered.length; });
  function prep(h){
    if (!mObj(h)) return undefined;
    var c = clone(contentOnly(h)), old = {};
    if (Array.isArray(c.rendered)){
      c.rendered.forEach(function(id){ old[id] = true; });
      if (Array.isArray(c.sections)){ c.sections = c.sections.filter(function(s){ return !old[s.id]; }); if (!c.sections.length) delete c.sections; }
      delete c.rendered;
    }
    return c;
  }
  var b = prep(base), m = prep(mine), t = prep(theirs);
  /* The later "updated" date and the higher format version win, rather than counting as conflicts */
  if (m.updated && t.updated) m.updated = t.updated = m.updated > t.updated ? m.updated : t.updated;
  if (m.handover && t.handover){ var vm = m.handover.split(".").map(Number), vt = t.handover.split(".").map(Number); m.handover = t.handover = (vm[0] - vt[0] || vm[1] - vt[1]) > 0 ? m.handover : t.handover; }
  var out = {conflicts: [], renamed: []};
  var h = merge3(b, m, t, [], out);
  if (Array.isArray(h.history)) h.history.sort(function(x, y){ return String(x.at) < String(y.at) ? -1 : String(x.at) > String(y.at) ? 1 : 0; });
  if (rendered) h = withRendered(h);
  dropLostGuides(h);  /* one side may have taken out a document the other made a guide (spec section 19) */
  return {h: h, conflicts: out.conflicts, renamed: out.renamed};
}

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
  (h.recurring || []).forEach(function(r, i){ ["text", "area", "detail"].forEach(function(k){ add("recurring", "recurring[" + i + "] (" + r.id + ") " + k, r[k], ["recurring", i, k]); }); });
  (h.questions || []).forEach(function(q, i){ add("questions", "questions[" + i + '] "' + q.q + '"', q.a, ["questions", i, "a"]); });
  (h.sections || []).forEach(function(s, i){ if (!skip[s.id]) add("sections", "sections[" + i + "] (" + s.id + ") body", s.body, ["sections", i, "body"]); });
  if (h.from && typeof h.from === "object") ["contact","hours"].forEach(function(k){ add("from", "from." + k, h.from[k], ["from", k]); });
  /* 1.1: every string inside the new objects. Ids, enums and dates never contain TODO:, so walking them all is safe. */
  function walk(area, where, v, path){
    if (typeof v === "string") add(area, where, v, path);
    else if (Array.isArray(v)) v.forEach(function(x, i){ walk(area, where + "[" + i + "]" + (x && typeof x === "object" && typeof x.id === "string" ? " (" + x.id + ")" : ""), x, path.concat([i])); });
    else if (v && typeof v === "object") Object.keys(v).forEach(function(k){ if (k !== "id") walk(area, where + "." + k, v[k], path.concat([k])); });
  }
  V11.concat(V12).forEach(function(k){ if (k !== "rendered" && k !== "audience" && h[k] !== undefined) walk(k, k, h[k], [k]); });
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
  followUps: "Follow-ups", catchUps: "Check-ins", history: "History", profile: "Profile", role: "About the role", asNeeded: "Jobs done as needed"};
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
function finish(out, o){
  if (o.date) out.updated = o.date;
  /* A change that uses newer fields (an area on a regular job) raises the declared version to match */
  var need = usesMinor(out), ver = String(out.handover || "1.0").split(".").map(Number);
  if (ver[0] === 1 && ver[1] < need) out.handover = "1." + need;
  return out.rendered ? withRendered(out) : out;
}
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
  if (o.by && !o.role) o.role = o.by;   // the change log names who closed it
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
  gaps: [{k: "text", t: "md", req: true, label: "What's missing", hint: "What someone still needs to find out, get or be given"}, {k: "blocks", t: "bool", label: "It blocks work today", n: "whether it blocks work"}],
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
var SECRET_HELP = " Handover files MUST NOT hold passwords, PINs, codes, keys or card and bank numbers. Write where it is kept and who grants access instead, e.g. \"In the team password manager, Finance folder; Ravi grants access\".";
/* Whether a field applies, given the other values (a regular job's schedule fields depend on how often it happens) */
function fieldApplies(d, values){ return !d.when || d.when.is.indexOf(String(values[d.when.k] || "")) > -1; }
/* One field's value from a form: returns the value to store, or undefined to leave it out. Throws with .field set. */
function fieldValue(d, v, values){
  if (d.t === "bool") return v === true || v === "true" || v === "on" ? true : undefined;
  if (d.t === "docs"){
    var ids = [].concat(v || []).map(function(x){ return String(x).trim(); }).filter(function(x, i, a){ return x && a.indexOf(x) === i; });
    if (ids.some(function(x){ return !ID.test(x); })) throw addError("Choose the documents for “" + d.label + "” from the list.", d.k);
    return ids.length ? ids : undefined;
  }
  if (d.t === "days"){
    var on = [].concat(v || []).map(function(x){ return String(x).trim(); }).filter(Boolean);
    if (on.some(function(x){ return DAYS.indexOf(x) < 0; })) throw addError("Choose the days for “" + d.label + "”.", d.k);
    on = DAYS.filter(function(x){ return on.indexOf(x) > -1; });
    return !on.length ? undefined : on.length === 1 ? on[0] : on;
  }
  v = String(v === undefined || v === null ? "" : v).trim();
  if (d.t !== "md") v = v.replace(/\s*\r?\n\s*/g, " ");
  if (!v){ if (d.req || (d.reqWhen && fieldApplies({when: d.reqWhen}, values))) throw addError("Fill in “" + d.label + "”.", d.k); return undefined; }
  if (Array.isArray(d.t)){
    if (!d.t.some(function(x){ return x[0] === v; })) throw addError("Choose one of the options for “" + d.label + "”.", d.k);
    return d.num ? +v : v;
  }
  if (d.t === "role"){ if (ROLES.indexOf(v) < 0) throw addError("Choose who for “" + d.label + "”.", d.k); return v; }
  if (d.t === "section"){ if (!ID.test(v)) throw addError("Choose a section for “" + d.label + "” from the list.", d.k); return v; }
  if (d.t === "date"){ if (!DATE.test(v)) throw addError("“" + d.label + "” needs a date like 2026-12-31.", d.k); return v; }
  if (d.t === "time"){ if (!TIME.test(v)) throw addError("“" + d.label + "” needs a time like 09:30.", d.k); return v; }
  if (d.t === "monthday"){
    if (/^last$/i.test(v)) return "last";
    if (!/^\d{1,2}$/.test(v) || +v < 1 || +v > 31) throw addError("“" + d.label + "” needs a day from 1 to 31, or “last”.", d.k);
    return +v;
  }
  if (d.t === "count"){
    if (!/^\d{1,4}$/.test(v) || +v < 1 || +v > (d.max || 9999)) throw addError("“" + d.label + "” needs a whole number from 1 to " + (d.max || 9999) + ".", d.k);
    return +v;
  }
  if (d.t === "mmdd"){ if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) throw addError("“" + d.label + "” needs a month and day like 03-01 (1 March).", d.k); return v; }
  var why = secretReason(v);
  if (why) throw addError(why + SECRET_HELP, d.k);
  return v;
}
/* Every field of a list from a form, checked: {field: value} with left-out fields absent */
function readFields(defs, values){
  var item = {};
  defs.forEach(function(d){
    if (!fieldApplies(d, values)) return;
    var v = fieldValue(d, values[d.k], values);
    if (v !== undefined) item[d.k] = v;
  });
  return item;
}
/* A task's or job's section and guides must name things in the file (spec sections 2 and 19) */
function checkRefs(h, item){
  if (item.see !== undefined && !(h.sections || []).some(function(s){ return s.id === item.see; })) throw addError("That section isn't in the file any more. Choose another.", "see");
  if (item.guides !== undefined){
    var docs = {}; (h.documents || []).forEach(function(d){ docs[d.id] = true; });
    if (item.guides.some(function(id){ return !docs[id]; })) throw addError("One of those documents isn't in the file any more. Choose again.", "guides");
  }
}
/* A copy of h with one new record: values = {field: value}, o = {role (who added it), date, at}. Returns {h, id}; throws with .field set. */
function addItem(h, list, values, o){
  o = o || {}; values = values || {};
  var defs = ADD_FIELDS[list];
  if (!defs) throw new Error("Items can't be added to " + list + ".");
  if (list !== "asNeeded" && (!h.handover || h.handover === "1.0")) throw new Error("This file uses format 1.0, which has no records. Ask the AI to write it again as format 1.1.");
  var item = readFields(defs, values);
  if (list === "documents" && !item.url && !item.location) throw addError("Give a link, or say where the document is kept.", "url");
  checkRefs(h, item);
  var out = clone(h), items = list === "asNeeded" ? out.asNeeded || [] : recordList(out, list), used = {};
  items.forEach(function(x){ used[x.id] = true; });
  var base = slugFor(item.text || item.name || item.title, LIST_NOUN[list]), id = base, k = 2;
  while (used[id]) id = base + "-" + k++;
  var rec = {id: id};
  Object.keys(item).forEach(function(f){ rec[f] = item[f]; });
  if (list !== "asNeeded"){ rec.added = stamp(o); if (o.role) rec.addedBy = o.role; }  /* jobs carry no provenance: the change log says who added it */
  if (list === "decide"){ out.decide = out.decide || {}; out.decide.cards = (out.decide.cards || []).concat([rec]); }
  else out[list] = items.concat([rec]);
  o.idPrefix = "add";
  logChange(out, o, "Added " + LIST_NOUN[list] + " " + id + " in the app.");
  return {h: finish(out, o), id: id};
}

/* ================= Editing (records, first-weeks tasks and regular jobs) ================= */
var AREA_HINT = "The part of the role it belongs to, e.g. \"Finance\". To put it under a larger area, use a slash with spaces: \"Villa / Bookings\"";
var EVERY_OPTS = [["day", "Every day"], ["weekday", "Monday to Friday"], ["week", "Every week"], ["month", "Every month"], ["quarter", "Every quarter"], ["year", "Every year"]];
var SEE_FIELD = {k: "see", t: "section", label: "Reference section", hint: "A section of the reference that explains it, shown with the task", n: "the reference section"};
var GUIDES_FIELD = {k: "guides", t: "docs", label: "Guides and walkthroughs", hint: "Documents to open with it: a step-by-step guide, a recording, a template. Add a document under Records first", n: "the guides"};
var EDIT_FIELDS = {
  path: [{k: "text", t: "line", req: true, label: "The task", n: "the task"}, {k: "detail", t: "md", label: "Details", hint: "How to do it, or where to look", n: "the details"}, SEE_FIELD, GUIDES_FIELD],
  recurring: [{k: "text", t: "line", req: true, label: "The job", n: "the job"},
    {k: "area", t: "line", label: "Area of work", hint: AREA_HINT, n: "the area"},
    {k: "every", t: EVERY_OPTS, req: true, label: "How often", n: "how often"},
    {k: "on", t: "days", label: "On", hint: "Monday if none is ticked", when: {k: "every", is: ["week"]}, n: "the days"},
    {k: "day", t: "monthday", label: "Day of the month", hint: "1 to 31, or “last”. A day past the month's end falls on its last day. The 1st if left empty", when: {k: "every", is: ["month", "quarter"]}, n: "the day"},
    {k: "monthOfQuarter", t: [["1", "First month (Jan, Apr, Jul, Oct)"], ["2", "Second month (Feb, May, Aug, Nov)"], ["3", "Third month (Mar, Jun, Sep, Dec)"]], num: true, label: "Which month of the quarter", when: {k: "every", is: ["quarter"]}, n: "the month"},
    {k: "date", t: "mmdd", label: "Date each year", hint: "Month and day, e.g. 03-01 for 1 March", when: {k: "every", is: ["year"]}, reqWhen: {k: "every", is: ["year"]}, n: "the date"},
    {k: "time", t: "time", label: "Time of day", hint: "e.g. 09:30", n: "the time"},
    {k: "start", t: "date", label: "From", hint: "Leave empty if it already applies", n: "the start"},
    {k: "end", t: "date", label: "Until", hint: "Leave empty if it carries on", n: "the end"},
    {k: "lead", t: "count", max: MAX_LEAD, label: "Lead time in days", hint: "How many days before the date the work has to start, e.g. 90 for a registration that takes three months. It goes on the list that day and stays until it is done. Leave empty if it is done on the day", when: {k: "every", is: ["week", "month", "quarter", "year"]}, n: "the lead time"},
    {k: "detail", t: "md", label: "Details", hint: "How to do it, or where to look", n: "the details"}, SEE_FIELD, GUIDES_FIELD],
  asNeeded: [{k: "text", t: "line", req: true, label: "The job", n: "the job"},
    {k: "area", t: "line", label: "Area of work", hint: AREA_HINT, n: "the area"},
    {k: "when", t: "line", label: "When it comes up", hint: "e.g. \"When a new member of staff joins\". \"As needed\" if left empty", n: "when it comes up"},
    {k: "detail", t: "md", label: "Details", hint: "How to do it, or where to look", n: "the details"}, SEE_FIELD, GUIDES_FIELD]
};
LIST_NOUN.path = "first-weeks task"; LIST_NOUN.recurring = "regular job"; LIST_NOUN.asNeeded = "job done as needed";
ADD_FIELDS.asNeeded = EDIT_FIELDS.asNeeded;
/* Lists whose items can be deleted outright. Records close instead, so their history stays; a job done as needed has none. */
var DELETABLE = ["asNeeded"];
/* A copy of h without one item: o = {role (who deleted it), date, at}. Throws with a message for the person. */
function deleteItem(h, list, id, o){
  o = o || {};
  if (DELETABLE.indexOf(list) < 0) throw new Error("Items on " + list + " can't be deleted." + (CLOSE_HOW[list] ? " Close it instead, so its history stays." : ""));
  var out = clone(h), items = out[list] || [], item = items.filter(function(x){ return x.id === id; })[0];
  if (!item) throw new Error("That item isn't in the file any more.");
  out[list] = items.filter(function(x){ return x !== item; });
  if (!out[list].length) delete out[list];
  o.idPrefix = "delete";
  logChange(out, o, "Deleted " + LIST_NOUN[list] + " " + id + " in the app: " + plainText(item.text) + ".");
  return finish(out, o);
}

/* ================= The role (1.2) ================= */
var ROLE_FIELDS = [
  {k: "organisation", t: "line", label: "Organisation", n: "the organisation"},
  {k: "purpose", t: "md", label: "Purpose of the role", hint: "Two or three sentences: why the role exists", n: "the purpose"},
  {k: "location", t: "line", label: "Location", hint: "Where the work is done, e.g. \"Head office, London, with some home working\"", n: "the location"},
  {k: "hours", t: "line", label: "Hours", hint: "e.g. \"Weekdays 8:30 to 5:00\"", n: "the hours"},
  {k: "travel", t: "line", label: "Travel", hint: "How much travel the role involves", n: "the travel"},
  {k: "manages", t: "line", label: "Manages", hint: "Who the role manages, if anyone", n: "who it manages"},
  {k: "skills", t: "md", label: "Skills and experience the work calls for", hint: "One per line, starting with \"- \"", n: "the skills"},
  {k: "measures", t: "md", label: "What good looks like", hint: "How anyone can tell the role is done well. One per line, starting with \"- \"", n: "what good looks like"}];
/* The role form's starting values */
function roleValues(h){ var v = {}, r = h.role || {}; ROLE_FIELDS.forEach(function(d){ if (r[d.k] !== undefined) v[d.k] = r[d.k]; }); return v; }
/* A copy of h with the role changed: values = every field of the form, o = {role (who edited it), date, at}.
   Keeps x- fields; an empty form removes the role. Never the pay: a hiring decision, and personal financial data. Returns {h, changed}. */
function editRole(h, values, o){
  o = o || {}; values = values || {};
  var next = readFields(ROLE_FIELDS, values);
  ROLE_FIELDS.forEach(function(d){
    if (next[d.k] && /\b(salary|salaries|pay (band|grade|scale|range|rate)|hourly rate|per annum)\b/i.test(next[d.k])) throw addError("Leave the pay out of the handover: it is a hiring decision, and pay is personal financial information.", d.k);
  });
  var out = clone(h), role = out.role || {}, changed = [];
  ROLE_FIELDS.forEach(function(d){
    if (JSON.stringify(role[d.k]) === JSON.stringify(next[d.k])) return;
    changed.push(fieldName(d));
    if (next[d.k] === undefined) delete role[d.k]; else role[d.k] = next[d.k];
  });
  if (!changed.length) throw new Error("Nothing has changed.");
  if (Object.keys(role).length) out.role = role; else delete out.role;
  o.idPrefix = "edit";
  logChange(out, o, "Edited the role in the app: " + listWords(changed) + ".");
  return {h: finish(out, o), changed: changed};
}
function editFields(list){ return EDIT_FIELDS[list] || ADD_FIELDS[list]; }

/* ================= The plan's dates (1.1) ================= */
/* The first day is optional: nobody may be hired yet, or the start date may not be known. Without it the handover runs with no overlap. */
var PLAN_FIELDS = [
  {k: "prepStart", t: "date", req: true, label: "Preparation from", n: "when preparation starts"},
  {k: "lastDay", t: "date", req: true, label: "The outgoing assistant's last day", n: "the last day"},
  {k: "firstDay", t: "date", label: "The incoming assistant's first day", hint: "Leave it empty while nobody is hired or the date isn't known. Until it is set, the handover runs with no overlap", n: "the first day"},
  {k: "track", t: [["light", "Light: asks less of the principal's time"], ["full", "Full"]], req: true, label: "Track", n: "the track"}];
/* The dates form's starting values, or null when the file has no plan */
function planValues(h){
  var p = h.plan; if (!p) return null;
  var v = {track: p.track || "light"};
  ["prepStart", "lastDay", "firstDay"].forEach(function(k){ if (p[k] !== undefined) v[k] = p[k]; });
  return v;
}
/* A copy of h with the plan's dates or track changed: values = every field of the form, o = {role (who edited it), date, at}.
   Step dates are worked out from these, so nothing else moves. Returns {h, changed}; throws with .field set. */
function editPlan(h, values, o){
  o = o || {}; values = values || {};
  if (!h.plan) throw new Error("This file has no handover plan.");
  var next = readFields(PLAN_FIELDS, values);
  if (next.prepStart > next.lastDay) throw addError("Preparation has to start on or before the last day.", "prepStart");
  if (next.firstDay && next.firstDay < next.prepStart) throw addError("The first day can't be before preparation starts.", "firstDay");
  var out = clone(h), plan = out.plan, changed = [];
  PLAN_FIELDS.forEach(function(d){
    var was = d.k === "track" ? plan.track || "light" : plan[d.k];
    if (was === next[d.k]) return;
    changed.push(d.k === "firstDay" && next.firstDay === undefined ? "the first day (now not known)" : fieldName(d));
    if (next[d.k] === undefined) delete plan[d.k]; else plan[d.k] = next[d.k];
  });
  if (!changed.length) throw new Error("Nothing has changed.");
  o.idPrefix = "edit";
  logChange(out, o, "Edited the handover dates in the app: " + listWords(changed) + ".");
  return {h: finish(out, o), changed: changed};
}
function fieldName(d){ return d.n || (d.k === "text" ? "the text" : d.label.charAt(0).toLowerCase() + d.label.slice(1)); }
function editList(h, list){
  if (list === "path"){ var all = []; (h.path || []).forEach(function(s){ all = all.concat(s.tasks || []); }); return all; }
  return list === "recurring" || list === "asNeeded" ? h[list] || [] : recordList(h, list);
}
/* A form's starting values for one item: {field: value}, numbers and lists as the form shows them */
function editValues(h, list, id){
  var item = editList(h, list).filter(function(x){ return x.id === id; })[0];
  if (!item) return null;
  var v = {};
  editFields(list).forEach(function(d){ var x = item[d.k]; if (x === undefined) return; v[d.k] = d.t === "days" ? [].concat(x) : typeof x === "number" ? String(x) : x; });
  return v;
}
/* A copy of h with one item changed: values = every field of the form, o = {role (who edited it), date, at}.
   Keeps the id (so progress stays), the provenance and closure, and fields the form doesn't show. Returns {h, changed}; throws with .field set. */
function editItem(h, list, id, values, o){
  o = o || {}; values = values || {};
  var defs = editFields(list);
  if (!defs) throw new Error("Items on " + list + " can't be edited.");
  if (!EDIT_FIELDS[list] && (!h.handover || h.handover === "1.0")) throw new Error("This file uses format 1.0, which has no records.");
  var next = readFields(defs, values);
  if (list === "documents" && !next.url && !next.location) throw addError("Give a link, or say where the document is kept.", "url");
  checkRefs(h, next);
  var out = clone(h), item = editList(out, list).filter(function(x){ return x.id === id; })[0];
  if (!item) throw new Error("That item isn't in the file any more.");
  var changed = [];
  defs.forEach(function(d){
    if (d.t === "bool" ? !!item[d.k] === !!next[d.k] : JSON.stringify(item[d.k]) === JSON.stringify(next[d.k])) return;
    changed.push(fieldName(d));
    if (next[d.k] === undefined) delete item[d.k]; else item[d.k] = next[d.k];
  });
  if (!changed.length) throw new Error("Nothing has changed.");
  if (!EDIT_FIELDS[list]) delete item.aiDrafted;  /* a person has now checked it */
  o.idPrefix = "edit";
  logChange(out, o, "Edited " + LIST_NOUN[list] + " " + id + " in the app: " + listWords(changed) + ".");
  return {h: finish(out, o), changed: changed};
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
  dropLostGuides(o);
  if (audience) o.audience = audience.slice(); else delete o.audience;
  o.profile = profile;
  ["stakeholders"].concat(RECORDS).forEach(function(k){ if (Array.isArray(o[k]) && !o[k].length) delete o[k]; });
  return withRendered(o);
}

/* Guides that name a document no longer in the file are left out (spec section 19) */
function dropLostGuides(o){
  var docs = {}; (o.documents || []).forEach(function(d){ docs[d.id] = true; });
  guideHolders(o).forEach(function(x){
    if (!Array.isArray(x.guides)) return;
    x.guides = x.guides.filter(function(id){ return docs[id]; });
    if (!x.guides.length) delete x.guides;
  });
  return o;
}
/* Every task and job that can carry guides */
function guideHolders(h){
  var out = [];
  (h.path || []).forEach(function(s){ (s.tasks || []).forEach(function(t){ out.push(t); }); });
  return out.concat(h.recurring || [], h.asNeeded || []);
}
/* What to show with a task or job (spec section 19): its section, then its guides, in the file's order.
   Each is {kind: "section", id, title, body} or {kind: "document", id, title, doc}. Closed documents are left out. */
function guidesFor(h, item){
  var out = [];
  if (!item) return out;
  if (typeof item.see === "string"){ var s = (h.sections || []).filter(function(x){ return x.id === item.see; })[0]; if (s) out.push({kind: "section", id: s.id, title: s.title, body: s.body}); }
  (Array.isArray(item.guides) ? item.guides : []).forEach(function(id){
    var d = (h.documents || []).filter(function(x){ return x.id === id; })[0];
    if (d && !d.closed) out.push({kind: "document", id: d.id, title: d.title, doc: d});
  });
  return out;
}
/* A guide's name in a list: "Step guide: Payroll run" */
function guideLabel(g){
  if (g.kind === "section") return g.title;
  var kind = g.doc.type && g.doc.type !== "other" ? DOC_TYPE[g.doc.type] : "";
  /* No "Recording: Recording: …" when the title already says what it is */
  return kind && String(g.title).toLowerCase().indexOf(kind.toLowerCase()) !== 0 ? kind + ": " + g.title : g.title;
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
  var ro = h.role && typeof h.role === "object" ? h.role : null;
  if (ro) add("handover-role", "About the role", [
    ro.purpose || "",
    ROLE_FACTS.some(function(f){ return ro[f[0]]; }) ? tableMd(["About the role", "Details"], ROLE_FACTS.filter(function(f){ return ro[f[0]]; }).map(function(f){ return [f[1], ro[f[0]]]; })) : "",
    ro.skills ? "### " + ROLE_SKILLS + "\n\n" + ro.skills : "",
    ro.measures ? "### " + ROLE_MEASURES + "\n\n" + ro.measures : ""
  ]);
  add("handover-as-needed", "Jobs done as needed", [(h.asNeeded || []).length ? tableMd(["Job", "When", "Area", "Details"], h.asNeeded.map(function(a){ return [a.text, whenNeeded(a), a.area || "", a.detail || ""]; })) : ""]);
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
/* 1.2: the role's facts, in the order a job description gives them */
var ROLE_FACTS = [["organisation", "Organisation"], ["location", "Location"], ["hours", "Hours"], ["travel", "Travel"], ["manages", "Manages"]];
var ROLE_SKILLS = "Skills and experience the work calls for", ROLE_MEASURES = "What good looks like";
function whenNeeded(a){ return a.when || "As needed"; }
/* An area as [top, sub]: "Villa / Bookings" is the Bookings part of the Villa */
function areaParts(area){ var s = String(area || "").split(" / ").map(function(x){ return x.trim(); }).filter(Boolean); return [s[0] || "", s.slice(1).join(" / ")]; }
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
  {key: "jobs", title: "Jobs", hint: "Regular duties by how often they happen, and the ones done as needed"},
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
  jobs: ["How often", "Job", "Area", "When", "Time", "Risk", "Notes"], tasks: ["Stage", "Task", "Detail"], steps: ["Phase", "Step", "Who", "Status", "Why"],
  inProgress: ["What", "Owner", "Due", "Status"], gaps: ["Gap", "Blocks work", "Status"], rules: ["When this happens", "Situation", "Status"],
  decisions: ["Decision", "Why", "Decided", "Status"], risks: ["Risk", "Kind", "Severity", "How it's passed on", "On the list", "Evidence", "Status"],
  systems: ["System", "Used for", "Login kept in", "Access from", "Access check", "Status"], documents: ["Document", "Type", "Where", "Link", "Status"],
  stakeholders: ["Name", "Who they are", "When to involve them", "Contact"], decide: ["Who decides", "Decision", "Limit", "Approver", "Note"],
  questions: ["Question", "Answer", "Topic"], overview: ["Part", "Item", "Details"], people: ["Name", "Role", "Contact"], sections: ["Section", "Text"],
  asks: ["Question", "Status", "Minutes", "Sent", "Reply by", "Answered", "If no reply", "Correction"], finalCheck: ["Check", "Result", "Note", "Owner", "Due"], signoff: ["Who", "Role", "Signed"]
};
/* "Guide: Step guide: Payroll run" for an exported task or job; a document's link comes with it */
function guideMeta(h, item){
  var g = guidesFor(h, item); if (!g.length) return "";
  return (g.length === 1 ? "Guide: " : "Guides: ") + g.map(function(x){ return guideLabel(x) + (x.kind === "document" && x.doc.url ? " (" + x.doc.url + ")" : ""); }).join("; ");
}
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
        return {id: r.id, title: r.text, meta: [when + (r.time ? " · " + r.time : ""), r.area || "", risk, span, guideMeta(h, r)], note: r.detail, row: [f[1], r.text, r.area || "", when + (span ? " (" + span + ")" : ""), r.time || "", risk, r.detail || ""]};
      }));
    }).concat([G("As needed", (h.asNeeded || []).map(function(a){
      return {id: a.id, title: a.text, meta: [whenNeeded(a), a.area || "", guideMeta(h, a)], note: a.detail, row: ["As needed", a.text, a.area || "", whenNeeded(a), "", "", a.detail || ""]};
    }))]);
    case "tasks": return (h.path || []).map(function(st){ return G(st.title, st.tasks.map(function(t){ return {id: t.id, title: t.text, meta: [guideMeta(h, t)], note: t.detail, row: [st.title, t.text, t.detail || ""]}; })); });
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
        dates.push({id: "d-first", title: pl.firstDay || personOf(h, "incoming") ? who(h, "incoming") + "'s first day" : "First day", meta: [pl.firstDay ? nice(pl.firstDay, "long") : personOf(h, "incoming") ? "Not known yet" : "Not hired yet"]});
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
/* ================= Reports for the principal =================
   Plain documents the principal can be sent at any point. Each opens with a short summary worked out from the file:
   it states what the file shows and never claims more. Items the principal may not see are left out (spec section 14). */
var REPORTS = [
  {key: "working", title: "What we're working on", hint: "What's under way, what's been finished lately, and what's next in the handover"},
  {key: "jobs", title: "The assistant's jobs", hint: "The regular jobs, and what the assistant decides alone or brings to you"},
  {key: "needs", title: "What needs you", hint: "Questions waiting for an answer, things handed to you, and the who-decides board to confirm"},
  {key: "jd", title: "Job description", hint: "The role's duties by area of work, what it decides, who it works with and what it calls for. Leaves out anything marked for some people only"}
];
function forPrincipal(x){ return !Array.isArray(x.visibleTo) || x.visibleTo.indexOf("principal") > -1; }
function plural(n, one, many){ return n + " " + (n === 1 ? one : many || one + "s"); }
function isAre(n){ return n === 1 ? "is" : "are"; }
function addDays(d, n){ var t = new Date(utc(d)); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function listWords(xs){ return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]; }
/* In reports, an assistant with no name in the file is spelled out as a role, like a name */
var ASSISTANT = {incoming: "Incoming Assistant", outgoing: "Outgoing Assistant"};
function personOf(h, role){ return (h.people || []).filter(function(p){ return (p.roles || []).indexOf(role) > -1; })[0]; }
function nameFor(h, role){ var p = personOf(h, role); return p ? p.name : ASSISTANT[role] || who(h, role); }
function firstFor(h, role){ var p = personOf(h, role); return p ? p.name.split(" ")[0] : ASSISTANT[role] || who(h, role); }
/* Whose work the reports describe: the outgoing assistant until their last day if nobody is named to take over, else the incoming one */
function assistantRole(h, date){
  if (personOf(h, "incoming")) return "incoming";
  var last = h.plan && h.plan.lastDay;
  return personOf(h, "outgoing") && (!last || !DATE.test(last) || date <= last) ? "outgoing" : "incoming";
}
function principalReport(h, key, o){
  o = o || {};
  var date = o.date || new Date().toISOString().slice(0, 10);
  var P = who(h, "principal"), ar = assistantRole(h, date);
  var Afull = nameFor(h, ar), A = firstFor(h, ar);
  var whoFor = function(role){ return role === "principal" ? "you" : nameFor(h, role); };
  var meta = REPORTS.filter(function(r){ return r.key === key; })[0];
  if (!meta) throw new Error("No report called " + key + ".");
  var open = function(x){ return !x.closed && forPrincipal(x); };
  var day = function(v){ return nice(String(v).slice(0, 10)); };
  var OK = "ok", WARN = "warn", BAD = "bad", NEUTRAL = "neutral";
  /* An item: title (first column), cells (the other columns), status {text, tone}, or a block with a body */
  var I = function(id, title, cells, status, extra){ var it = {id: id, title: title, cells: cells || [], status: status || null, meta: [], note: "", body: "", block: false, row: []}; Object.keys(extra || {}).forEach(function(k){ it[k] = extra[k]; }); it.meta = it.cells.filter(Boolean).concat(status ? [status.text] : []); return it; };
  var intro = [], parts = [], figures = [];
  var part = function(title, columns, groups){ groups = groups.filter(function(g){ return g.items.length; }); if (groups.length) parts.push({key: key, title: title, columns: columns, groups: groups}); };
  var fig = function(value, label, tone){ figures.push({value: String(value), label: label, tone: tone || NEUTRAL}); };
  var steps = ((h.plan && h.plan.steps) || []).filter(function(s){ return s.status !== "na"; }), ov = overlap(h.plan);
  var board = (h.decide && h.decide.cards || []).filter(open);
  var COL = {alone: A + " decides alone", check: A + " checks with you first", principal: "Always you"};
  function boardGroups(){
    return ["alone", "check", "principal"].map(function(c){
      return {title: COL[c], items: board.filter(function(x){ return x.column === c; }).map(function(x){
        var ap = x.approver ? (x.approver.role ? whoFor(x.approver.role) : ((h.stakeholders || []).filter(function(s){ return s.id === x.approver.stakeholder; })[0] || {}).name) : "";
        return I(x.id, x.text, [x.limit ? "Up to " + money(x.limit) : "", ap ? cap(ap) : ""], x.movedByPrincipal ? {text: "You moved this", tone: NEUTRAL} : null);
      })};
    });
  }
  var BOARD_COLS = ["Kind of decision", "Limit", "Approved by", ""];
  function findingOut(gp){ return gp.sort(function(a, b){ return (b.blocks ? 1 : 0) - (a.blocks ? 1 : 0); }).map(function(x){ return I(x.id, x.text, [], x.blocks ? {text: "Holds up work", tone: BAD} : {text: "Not holding up work", tone: NEUTRAL}); }); }
  if (key === "working"){
    var ip = (h.inProgress || []).filter(open).sort(function(a, b){ return (a.due || "9") < (b.due || "9") ? -1 : 1; });
    var good = ip.filter(function(x){ return x.owner && x.due; }).length, late = ip.filter(function(x){ return x.due && x.due < date; }).length;
    if (!ip.length) intro.push("Nothing is half-finished right now.");
    else intro.push(plural(ip.length, "thing") + " " + isAre(ip.length) + " under way. " + (good === ip.length ? (ip.length === 1 ? "It has" : "Each one has") + " an owner and a date." : good + " of them " + (good === 1 ? "has" : "have") + " an owner and a date; the table shows what the others still need.") + (late ? " " + late + " " + isAre(late) + " past " + (late === 1 ? "its" : "their") + " date." : ""));
    var since = o.since || addDays(date, -7), done = [];
    ["inProgress", "gaps", "risks"].forEach(function(l){ (h[l] || []).filter(forPrincipal).forEach(function(x){ if (x.closed && x.closed.at && String(x.closed.at).slice(0, 10) >= since && x.closed.how !== "principal") done.push(x); }); });
    done.sort(function(a, b){ return a.closed.at < b.closed.at ? -1 : 1; });
    if (done.length) intro.push("Since " + nice(since, "long") + ", " + plural(done.length, "thing was", "things were") + " finished or settled.");
    var gp = (h.gaps || []).filter(open), blocking = gp.filter(function(g){ return g.blocks; }).length;
    intro.push(gp.length ? plural(gp.length, "thing") + " " + isAre(gp.length) + " still being found out" + (blocking ? (gp.length === 1 ? ", and it holds up work today." : ", and " + blocking + " of them " + (blocking === 1 ? "holds" : "hold") + " up work today.") : (gp.length === 1 ? "; it doesn't hold up work today." : "; none of them holds up work today.")) : "Nothing about the role is still unknown.");
    var sd = steps.filter(function(s){ return s.status === "done"; }).length;
    if (steps.length) intro.push("The handover plan: " + sd + " of " + plural(steps.length, "step") + " done.");
    fig(ip.length, "Under way", late ? BAD : good === ip.length ? OK : WARN);
    fig(done.length, "Finished since " + nice(since), done.length ? OK : NEUTRAL);
    fig(gp.length, "Still being found out", blocking ? BAD : gp.length ? WARN : OK);
    if (steps.length) fig(sd + "/" + steps.length, "Handover steps done", sd === steps.length ? OK : NEUTRAL);
    part("Under way", ["What", "With", "Due", "Status"], [{title: "", items: ip.map(function(x){
      var st = x.due && x.due < date ? {text: "Past its date", tone: BAD} : !x.owner ? {text: "No one named yet", tone: WARN} : !x.due ? {text: "No date yet", tone: WARN} : {text: "Scheduled", tone: OK};
      return I(x.id, x.text, [x.owner ? cap(whoFor(x.owner)) : "", x.due ? nice(x.due) : ""], st);
    })}]);
    part("Finished since " + nice(since, "long"), ["What", "When", "Where the answer is", "Outcome"], [{title: "", items: done.map(function(x){ return I(x.id, x.text, [day(x.closed.at), x.closed.fix || ""], {text: CLOSE_LABEL[x.closed.how], tone: OK}); })}]);
    part("Still being found out", ["What " + A + " is finding out", "Effect"], [{title: "", items: findingOut(gp)}]);
    var next = PHASES.map(function(ph){ return steps.filter(function(s){ return s.phase === ph && s.status === "open"; }); }).filter(function(l){ return l.length; })[0] || [];
    part("Next in the handover", ["Step", "Who", "Stage"], [{title: "", items: next.map(function(s){ return I(s.id, s.title, [cap(whoFor(s.role)), phaseLabel(s.phase, ov)]); })}]);
  } else if (key === "jobs"){
    var rec = h.recurring || [], counts = [];
    FREQ.forEach(function(f){ var n = rec.filter(function(r){ return f[2].indexOf(r.every) > -1; }).length; if (n) counts.push(n + " " + f[1].toLowerCase()); });
    intro.push(rec.length ? A + " does " + plural(rec.length, "regular job") + " for you: " + listWords(counts) + ". Each one comes up on " + A + "'s list on the day it's due, with its time." : "No regular jobs are recorded yet.");
    if ((h.asNeeded || []).length) intro[0] += " " + A + " also does " + plural(h.asNeeded.length, "job") + " when " + (h.asNeeded.length === 1 ? "it comes" : "they come") + " up.";
    var c = function(col){ return board.filter(function(x){ return x.column === col; }).length; };
    if (board.length){
      intro.push(A + " decides " + plural(c("alone"), "kind of thing", "kinds of thing") + " alone, checks with you first on " + c("check") + ", and always brings " + c("principal") + " to you.");
      intro.push(h.decide.confirmed ? "You confirmed this" + (h.decide.confirmedAt ? " on " + nice(String(h.decide.confirmedAt).slice(0, 10), "long") : "") + "." : "You haven't confirmed this yet. It is in “What needs you”.");
    }
    fig(rec.length, "Regular jobs", rec.length ? OK : NEUTRAL);
    if (board.length){ fig(c("alone"), A + " decides alone"); fig(c("check"), "Checked with you first"); fig(c("principal"), "Always you"); }
    var jobs = [];
    FREQ.forEach(function(f){ rec.filter(function(r){ return f[2].indexOf(r.every) > -1; }).forEach(function(r){ jobs.push(I(r.id, r.text, [f[1].replace(/^Every /, "Each ").replace("Each day", "Daily"), cadence(r), r.time || ""])); }); });
    part("Regular jobs", ["Job", "How often", "When", "Time"], [{title: "", items: jobs}]);
    part("Done as needed", ["Job", "When"], [{title: "", items: (h.asNeeded || []).map(function(a){ return I(a.id, a.text, [whenNeeded(a)]); })}]);
    part("Who decides what", BOARD_COLS, boardGroups());
    var ru = (h.rules || []).filter(open), sits = ru.map(function(r){ return r.situation || ""; }).filter(function(s, i, a){ return a.indexOf(s) === i; }).sort(function(a, b){ return a === "" ? -1 : b === "" ? 1 : 0; });
    part("When something comes up", ["What happens"], sits.map(function(s){ return {title: s || "Any time", items: ru.filter(function(r){ return (r.situation || "") === s; }).map(function(r){ return I(r.id, r.text); })}; }));
  } else if (key === "jd"){
    return jobDescription(h, date, meta);
  } else {
    var asks = (h.asks || []).filter(function(a){ return a.status === "draft" || a.status === "sent"; });
    var mins = asks.reduce(function(n, a){ return n + (typeof a.minutes === "number" ? a.minutes : 0); }, 0);
    var handed = (h.gaps || []).filter(function(g){ return g.closed && g.closed.how === "principal" && forPrincipal(g); });
    var asked = {}; asks.forEach(function(a){ asked[a.id] = true; });
    var mine = steps.filter(function(s){ return s.role === "principal" && s.status === "open" && !(s.ask && asked[s.ask]); });
    var checks = (h.finalCheck || []).filter(function(x){ return x.result === "fail" && x.owner === "principal"; });
    var confirm = board.length && !(h.decide && h.decide.confirmed);
    var bits = [];
    if (asks.length) bits.push(plural(asks.length, "question") + " to answer" + (mins ? " (about " + mins + " minutes in all)" : ""));
    if (handed.length) bits.push(plural(handed.length, "thing") + " handed to you");
    if (confirm) bits.push("the who-decides board to confirm");
    if (mine.length) bits.push(plural(mine.length, "step") + " for you in the handover plan");
    if (checks.length) bits.push(plural(checks.length, "check") + " waiting on you");
    intro.push(bits.length ? "Waiting for you: " + listWords(bits) + "." : "Nothing is waiting for you right now.");
    var gq = (h.gaps || []).filter(open);
    if (gq.length) intro.push(A + " is still finding out " + plural(gq.length, "thing") + (gq.length === 1 ? ". It is listed at the end, in case you know the answer." : ". They are listed at the end, in case you know the answer."));
    fig(asks.length, "Questions to answer", asks.length ? WARN : OK);
    if (asks.length) fig(mins ? "~" + mins : "–", "Minutes needed");
    fig(handed.length, "Handed to you", handed.length ? WARN : OK);
    fig(board.length ? (confirm ? "To confirm" : "Confirmed") : "–", "Who decides what", confirm ? WARN : OK);
    part("Questions for you", [], [{title: "", items: asks.map(function(a){ return I(a.id, ASK_TITLE[a.id], [a.minutes ? "About " + a.minutes + " minutes" : "", a.replyBy ? "Reply by " + nice(a.replyBy, "long") : ""], null, {block: true, body: a.draft || "", note: a["default"] ? "If there's no reply: " + oneLine(a["default"]) : ""}); })}]);
    part("Handed to you", ["What", "Handed over", "Notes"], [{title: "", items: handed.map(function(g){ return I(g.id, g.text, [g.closed.at ? day(g.closed.at) : "", g.closed.fix || ""]); })}]);
    if (confirm) part("Please confirm who decides what", BOARD_COLS, boardGroups());
    part("Your steps in the handover", ["Step", "Stage", "Why"], [{title: "", items: mine.map(function(s){ return I(s.id, s.title, [phaseLabel(s.phase, ov), s.why || ""]); })}]);
    part("Checks waiting on you", ["Check", "Due", "Note"], [{title: "", items: checks.map(function(x){ return I(x.id, FINAL_TITLE[x.id], [x.due ? nice(x.due) : "", x.note || ""]); })}]);
    part("Still being found out", ["What " + A + " is finding out", "Effect"], [{title: "", items: findingOut(gq)}]);
  }
  return {style: "report", report: key, name: meta.title, title: meta.title, subtitle: h.title + " · for " + P + " · " + nice(date, "long"),
    kicker: "Handover report", role: h.title, preparedFor: P, preparedBy: Afull, date: nice(date, "long"), figures: figures, intro: intro, parts: parts};
}
/* A job description, written from the file: the role as it is done today. It is meant to go beyond the principal
   (to HR, or to candidates), so it leaves out every item marked for some people only, every contact, and closed items. */
function jobDescription(h, date, meta){
  var hasP = (h.people || []).some(function(p){ return (p.roles || []).indexOf("principal") > -1; });
  var P = hasP ? who(h, "principal") : "", Pf = hasP ? P.split(" ")[0] : "the principal";
  var ro = h.role && typeof h.role === "object" ? h.role : {};
  var everyone = function(x){ return !x.closed && !Array.isArray(x.visibleTo); };
  var I = function(id, title, cells, extra){ var it = {id: id, title: title, cells: cells || [], status: null, meta: [], note: "", body: "", block: false, row: []}; Object.keys(extra || {}).forEach(function(k){ it[k] = extra[k]; }); it.meta = it.cells.filter(Boolean); return it; };
  var parts = [], part = function(title, columns, groups, bold){ groups = groups.filter(function(g){ return g.items.length; }); if (groups.length) parts.push({key: "jd", title: title, columns: columns, groups: groups, plain: !bold}); };
  var block = function(id, body){ return I(id, "", [], {block: true, body: body}); };
  /* A duty: its text, then the first paragraph of its details, which usually says how or why */
  var duty = function(text, md){
    var b = parseBlocks(md || "")[0]; if (!b || b.t !== "p" || /TODO:/.test(b.text)) return text;  /* a gap is for the handover, not the job description */
    var t = String(text).replace(/[.\s]+$/, "");
    return t + ". " + b.text;
  };
  var regular = function(r){ return I(r.id, duty(r.text, r.detail), [cadence(r) + (r.time ? ", " + r.time : "")]); };
  var needed = function(a){ return I(a.id, duty(a.text, a.detail), [whenNeeded(a)]); };
  var DUTY = ["Duty", "When"];
  /* About the role */
  var facts = ROLE_FACTS.filter(function(f){ return f[0] !== "organisation" && ro[f[0]]; }).map(function(f){ return I("role-" + f[0], f[1], [ro[f[0]]]); });
  if (hasP) facts.unshift(I("role-reports", "Reports to", [P]));
  part("About the role", ["", ""], [{title: "", items: facts}], true);
  /* Duties: by area when the file gives areas, otherwise by how often */
  var rec = h.recurring || [], an = h.asNeeded || [], duties = rec.map(function(r){ return {area: r.area, item: regular(r)}; }).concat(an.map(function(a){ return {area: a.area, item: needed(a)}; }));
  if (duties.some(function(d){ return d.area; })){
    var areas = [], find = function(list, title){ var x = list.filter(function(a){ return a.title === title; })[0]; if (!x){ x = {title: title, groups: [], items: []}; list.push(x); } return x; };
    duties.forEach(function(d){ var ap = areaParts(d.area), top = find(areas, ap[0]); find(top.groups, ap[1]).items.push(d.item); });
    areas.sort(function(a, b){ return (a.title ? 0 : 1) - (b.title ? 0 : 1); });  /* duties with no area come last */
    areas.forEach(function(a){ part(a.title || (areas.length > 1 ? "Other duties" : "Duties"), DUTY, a.groups.sort(function(x, y){ return (x.title ? 1 : 0) - (y.title ? 1 : 0); })); });
  } else {
    part("Regular duties", DUTY, FREQ.map(function(f){ return {title: f[1], items: rec.filter(function(r){ return f[2].indexOf(r.every) > -1; }).map(regular)}; }));
    part("Done as needed", DUTY, [{title: "", items: an.map(needed)}]);
  }
  /* Authority: the who-decides board, in the third person */
  var cards = ((h.decide && h.decide.cards) || []).filter(everyone), stake = {};
  (h.stakeholders || []).forEach(function(x){ stake[x.id] = x.name; });
  var COL = {alone: "Decides alone", check: "Checks with " + Pf + " first", principal: "Always goes to " + Pf};
  part("Authority and limits", ["Kind of decision", "Limit", "Approved by"], ["alone", "check", "principal"].map(function(c){
    return {title: COL[c], items: cards.filter(function(x){ return x.column === c; }).map(function(x){
      var ap = x.approver ? (x.approver.role ? who(h, x.approver.role) : stake[x.approver.stakeholder] || "") : "";
      return I(x.id, x.text, [x.limit ? "Up to " + money(x.limit) : "", ap]);
    })};
  }));
  var ru = (h.rules || []).filter(everyone), sits = ru.map(function(r){ return r.situation || ""; }).filter(function(x, i, a){ return a.indexOf(x) === i; }).sort(function(a, b){ return a === "" ? -1 : b === "" ? 1 : 0; });
  part("When something comes up", [""], sits.map(function(x){ return {title: x || "Any time", items: ru.filter(function(r){ return (r.situation || "") === x; }).map(function(r){ return I(r.id, r.text); })}; }));
  part("Working relationships", ["Who", "Relationship", "Working together"], [{title: "", items: (h.stakeholders || []).filter(everyone).map(function(x){ return I(x.id, x.name, [x.relationship || "", x.involve ? oneLine(x.involve) : ""]); })}], true);
  part("Systems used", ["System", "What it's for"], [{title: "", items: (h.systems || []).filter(everyone).map(function(x){ return I(x.id, x.name, [x.purpose || ""]); })}], true);
  if (ro.skills) part(ROLE_SKILLS, [], [{title: "", items: [block("role-skills", ro.skills)]}]);
  if (ro.measures) part(ROLE_MEASURES, [], [{title: "", items: [block("role-measures", ro.measures)]}]);
  var line = "Job description" + (hasP ? " · Reports to " + P : "");
  return {style: "report", report: "jd", name: meta.title, title: h.title, subtitle: (ro.organisation ? ro.organisation + " · " : "") + line + " · " + nice(date, "long"),
    kicker: ro.organisation || "Job description", role: ro.organisation ? line : (hasP ? "Reports to " + P : ""), preparedFor: "", preparedBy: "", date: nice(date, "long"),
    figures: [], introLabel: "Purpose of the role", intro: ro.purpose ? parseBlocks(ro.purpose).filter(function(b){ return b.text; }).map(function(b){ return b.text; }) : [], parts: parts};
}
/* A combined report's title, placed in the handover's own time: the days left to the outgoing assistant's last day,
   then the incoming assistant's weeks (week 1 is their first seven days). With no last day, the ISO week of the year. */
function reportTitle(h, date){
  var pl = h.plan || {}, days = function(a, b){ return Math.round((utc(b) - utc(a)) / 864e5); };
  var Out = firstFor(h, "outgoing"), In = firstFor(h, "incoming"), poss = function(n){ return n + "'s"; };
  var t;
  if (pl.lastDay && DATE.test(pl.lastDay) && DATE.test(date)){
    var left = days(date, pl.lastDay);
    if (left > 0) t = plural(left, "day") + " to " + poss(Out) + " last day";
    else if (left === 0) t = poss(Out) + " last day";
    else if (pl.firstDay && DATE.test(pl.firstDay) && date >= pl.firstDay) t = poss(In) + " week " + (Math.floor(days(pl.firstDay, date) / 7) + 1);
    else t = "week " + (Math.floor((-left - 1) / 7) + 1) + " since " + Out + " left";
  } else if (DATE.test(date)){
    var d = new Date(utc(date)), dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow + 3);
    var jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)), wk = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    t = "week " + wk + ", " + d.getUTCFullYear();
  }
  return "Handover update" + (t ? ": " + t : "");
}
/* The handover date on a combined report's cover: days to (or since) the outgoing assistant's last day, and the date */
function handoverFigures(h, date){
  var pl = h.plan || {};
  if (!pl.lastDay || !DATE.test(pl.lastDay) || !DATE.test(date)) return [];
  var Out = firstFor(h, "outgoing");
  var left = Math.round((utc(pl.lastDay) - utc(date)) / 864e5), poss = Out + "'s";
  var first = left > 0 ? {value: String(left), label: (left === 1 ? "Day" : "Days") + " to " + poss + " last day", tone: left <= 7 ? "warn" : "neutral"}
    : left === 0 ? {value: "Today", label: poss + " last day", tone: "warn"}
    : {value: String(-left), label: (left === -1 ? "Day" : "Days") + " since " + poss + " last day", tone: "ok"};
  return [first, {value: nice(pl.lastDay), label: "Handover day", tone: "neutral"}];
}
/* Several reports in one document: a cover, a short "In this report" box, then each report as a part with its own
   figures, summary and sections. One key gives the single report unchanged. o = {date, since, title}; the title defaults to reportTitle. */
function principalReports(h, keys, o){
  o = o || {};
  keys = [].concat(keys || []);
  var pick = REPORTS.map(function(r){ return r.key; }).filter(function(k){ return keys.indexOf(k) > -1; });
  keys.forEach(function(k){ if (pick.indexOf(k) < 0) throw new Error("No report called " + k + "."); });
  if (!pick.length) throw new Error("Choose at least one report.");
  if (pick.length === 1) return principalReport(h, pick[0], o);
  var date = o.date || new Date().toISOString().slice(0, 10), docs = pick.map(function(k){ return principalReport(h, k, o); });
  var lead = docs.filter(function(d){ return d.preparedFor; })[0] || docs[0], title = String(o.title || "").replace(/\s+/g, " ").trim() || reportTitle(h, date);
  var chapters = docs.map(function(d){ return {key: d.report, title: d.name, figures: d.figures || [], intro: d.intro || [], introLabel: d.introLabel || "", parts: d.parts}; });
  return {style: "report", report: "combined", reports: pick, name: title, title: title,
    subtitle: h.title + " · for " + lead.preparedFor + " · " + nice(date, "long") + " · " + listWords(docs.map(function(d){ return d.name; })),
    kicker: "Handover report", role: h.title, preparedFor: lead.preparedFor, preparedBy: lead.preparedBy, date: nice(date, "long"),
    figures: handoverFigures(h, date), introLabel: "In this report",
    intro: chapters.map(function(c, i){ return "**" + (i + 1) + ". " + c.title + ".** " + (c.intro[0] || (c.parts.length ? "" : "Nothing to report.")); }),
    chapters: chapters, parts: [].concat.apply([], chapters.map(function(c){ return c.parts; }))};
}
/* ================= Transition kit: the whole handover as one HTML file ================= */
/* The viewer page (app/web/index.html) with this file, the handover and a strict policy inlined.
   It opens in any browser with nothing else: no app, no server, no internet. Read-only; ticks and
   notes stay in that browser. It carries only what the chosen profile may see (spec section 14). */
/* Built from parts so that this file, inlined in the kit, never contains the tag itself */
var KIT_OPEN = "<script type=\"application/json\" id=\"" + ["handover", "kit"].join("-") + "\">";
var CORE_TAG = "<script src=\"core.js\"></" + "script>";
var KIT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'";
function scriptSafe(s){ return String(s).replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--"); }
function kitData(json){ return json.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
function transitionKit(h, o){
  o = o || {};
  var profile = o.profile || "newcomer";
  if (!PROFILES[profile]) throw new Error('profile must be "newcomer" or "record"');
  if (typeof o.viewer !== "string" || o.viewer.indexOf(CORE_TAG) < 0) throw new Error("transitionKit needs the viewer page (app/web/index.html) as o.viewer");
  var data = h.handover === "1.0" ? contentOnly(h) : exportProfile(h, profile, o.audience);
  var kit = {kit: 1, made: o.date || new Date().toISOString().slice(0, 10), profile: data.profile || profile, handover: data};
  var core = "(" + handoverCore.toString() + ")(typeof window !== \"undefined\" ? window : this);";
  var page = o.viewer
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '<meta http-equiv="Content-Security-Policy" content="' + KIT_CSP + '">')
    .replace(/<title>[^<]*<\/title>/i, function(){ return "<title>" + escHtml(data.title || "Handover") + " \u00b7 transition kit</title>"; })
    .replace(/<a href="(?:https?:)?\/\/[^"]*"[^>]*>([^<]*)<\/a>/gi, "$1");
  var at = page.indexOf(CORE_TAG);
  return page.slice(0, at) + "<script>\n" + scriptSafe(core) + "\n</script>\n" +
    KIT_OPEN + kitData(JSON.stringify(kit)) + "</script>" +
    page.slice(at + CORE_TAG.length);
}
/* The handover inside a transition kit, or null */
function readKit(html){
  html = String(html); var at = html.lastIndexOf(KIT_OPEN); if (at < 0) return null;
  var end = html.indexOf("</script>", at); return end < 0 ? null : JSON.parse(html.slice(at + KIT_OPEN.length, end));
}

/* Every report and export ends by saying it was made with Handover and how to get the app. The lines are inline
   Markdown; each format draws them its own way, with the links kept as links. */
var APP_SITE = "https://incrhst.github.io/handover/", APP_DMG = "https://github.com/incrhst/handover/releases/latest/download/Handover.dmg", MAKER = "https://incrementic.com";
var APP_AD = {title: "Made with Handover", lines: [
  "Handover is a free Mac app for taking over a role, made by [Incrementic](" + MAKER + "). It turns one file into a guided first month, a daily list of what's due and a reference you can search.",
  "Get it at [incrhst.github.io/handover](" + APP_SITE + "), or [download it for Mac](" + APP_DMG + ") and drag it to Applications."]};
/* The links in a line of Markdown, as {text, uri}: where a PDF puts its link areas */
function appAdHtml(){ return '<aside class="app"><p class="app-t">' + escHtml(APP_AD.title) + "</p>" + APP_AD.lines.map(function(s){ return "<p>" + inlineHtml(s) + "</p>"; }).join("") + "</aside>"; }
function mdLinks(md){ var out = [], re = /\[([^\]]+)\]\((https?:[^)\s]+)\)/g, m; while ((m = re.exec(md))) out.push({text: m[1], uri: m[2]}); return out; }
/* The link areas for one printed line l of the Markdown md, drawn at x, y in font size: {r: [x1, y1, x2, y2], uri, text} */
function pdfLinks(l, md, x, y, size, bold){
  return mdLinks(md).map(function(k){ var i = l.indexOf(k.text); if (i < 0) return null; var x1 = x + textWidth(l.slice(0, i), bold, size);
    return {r: [x1, y - size * 0.25, x1 + textWidth(k.text, bold, size), y + size * 0.8], uri: k.uri, text: k.text}; }).filter(Boolean);
}
/* The parts of a report document: its chapters, or the whole document as one */
function docChapters(doc){ return doc.chapters || [{title: "", figures: doc.figures || [], intro: doc.intro || [], introLabel: doc.introLabel || "", parts: doc.parts}]; }
function docMarkdown(doc){
  var L = ["# " + doc.title, "", "*" + doc.subtitle + "*", ""], ch = !!doc.chapters, d = ch ? 1 : 0;
  function summary(intro, label, lv){ if (intro && intro.length){ if (label) L.push(hashes(lv) + " " + label, ""); intro.forEach(function(s){ L.push(s, ""); }); } }
  var figLine = function(F){ if ((F || []).length) L.push(F.map(function(f){ return "**" + f.value + "** " + f.label; }).join(" · "), ""); };
  if (ch){ figLine(doc.figures); summary(doc.intro, doc.introLabel, 2); }
  docChapters(doc).forEach(function(c, ci){
  if (ch){
    L.push("## Part " + (ci + 1) + ": " + c.title, "");
    figLine(c.figures);
    summary(c.intro, c.introLabel, 3);
    if (!c.parts.length) L.push("Nothing to report.", "");
  } else summary(c.intro, c.introLabel, 2);
  c.parts.forEach(function(p){
    L.push(hashes(2 + d) + " " + p.title, "");
    p.groups.forEach(function(g){
      if (g.title) L.push(hashes(3 + d) + " " + g.title, "");
      g.items.forEach(function(it){
        var t = oneLine(it.title), lv = (g.title ? 4 : 3) + d;
        if (it.block){
          if (t) L.push(hashes(lv) + " " + t, "");
          if (it.body) L.push(mdBody(it.body, lv), "");
          if (it.meta.length) L.push("*" + it.meta.map(oneLine).join(" · ") + "*", "");
          if (it.note) L.push(oneLine(it.note), "");
          return;
        }
        if (p.plain){ L.push("- " + t + (it.meta.length ? " *(" + it.meta.map(oneLine).join(" · ") + ")*" : "")); if (it.note) L.push("  - " + oneLine(it.note)); return; }
        L.push("- " + (/\*\*/.test(t) ? t : "**" + t + "**"));
        if (it.meta.length) L.push("  - " + it.meta.map(oneLine).join(" · "));
        if (it.note) L.push("  - " + oneLine(it.note));
      });
      L.push("");
    });
  });
  });
  L.push("---", "", "**" + APP_AD.title + "**", "");
  APP_AD.lines.forEach(function(s){ L.push(s, ""); });
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
  if (doc.style === "report") return reportHtml(doc);
  var b = [];
  b.push("<h1>" + inlineHtml(doc.title) + "</h1>", '<p class="sub">' + inlineHtml(doc.subtitle) + "</p>");
  if (doc.intro && doc.intro.length) b.push('<div class="intro">' + doc.intro.map(function(x){ return "<p>" + inlineHtml(x) + "</p>"; }).join("") + "</div>");
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
  b.push(appAdHtml());
  return '<!doctype html>\n<html><head><meta charset="utf-8"><title>' + escHtml(doc.title) + "</title><style>" +
    ".app{border-top:1px solid #ddd;margin:28px 0 0;padding:12px 0 0;color:#555;font-size:9.5pt}.app p{margin:4px 0}.app .app-t{color:#1d1d1f;font-weight:700}" +
    "body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.45;color:#1d1d1f;max-width:720px;margin:24px auto;padding:0 16px}" +
    "h1{font-size:20pt;margin:0 0 4px}h2{font-size:15pt;margin:22px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px}h3{font-size:12pt;margin:14px 0 4px}" +
    ".sub{color:#666;margin:0 0 12px}.intro{background:#f3f6f1;border-left:3px solid #4f7a5a;padding:8px 14px;margin:8px 0 16px}.intro p{margin:6px 0}.meta{color:#555;font-size:10pt}ul,ol{padding-left:20px;margin:4px 0 10px}li{margin:0 0 7px}a{color:#3b2a8a}h4,h5,h6{font-size:11pt;margin:12px 0 4px}" +
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
  if (doc.style === "report") return reportPdf(doc, o);
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
  if (doc.intro && doc.intro.length){ doc.intro.forEach(function(x){ para(x, {font: "F1", size: 11.5}); y -= 5; }); y -= 4; }
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
  /* Made with Handover, kept on one page */
  var links = [], adSize = 9, adLh = adSize * 1.35;
  var adLines = APP_AD.lines.map(function(md){ return {md: md, lines: wrapText(plainText(md), false, adSize, CW)}; });
  need(30 + adLines.reduce(function(s, a){ return s + a.lines.length * adLh + 2; }, 0));
  y -= 18; ops.push("0.85 0.84 0.8 RG 0.5 w " + M + " " + y.toFixed(2) + " m " + (W - M) + " " + y.toFixed(2) + " l S"); y -= 4;
  para(APP_AD.title, {font: "F2", size: 9.5});
  adLines.forEach(function(a){ a.lines.forEach(function(l){
    y -= adLh; text(M, l, "F1", adSize, true);
    var pi = pages.length - 1, ls = pdfLinks(l, a.md, M, y, adSize, false); links[pi] = (links[pi] || []).concat(ls);
    ls.forEach(function(k){ ops.push("0.231 0.165 0.541 rg BT /F1 " + adSize + " Tf " + k.r[0].toFixed(2) + " " + y.toFixed(2) + " Td " + pdfStr(k.text) + " Tj ET"); });
  }); y -= 2; });
  var n = pages.length;
  pages.forEach(function(pg, i){ var foot = plainText(doc.title) + "  ·  " + (i + 1) + " of " + n; pg.push("0.37 0.39 0.36 rg BT /F1 8 Tf " + M + " " + (M - 24) + " Td " + pdfStr(foot) + " Tj ET"); });
  return pdfFile(pages, W, Hh, plainText(doc.title), plainText(doc.subtitle), links);
}

/* The PDF objects around the pages: three Helvetica fonts, an info dictionary and the cross-reference table */
function pdfFile(pages, W, Hh, title, subject, links){
  var objs = [], next = 7 + pages.length * 2;
  links = links || [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>";
  objs[6] = "<< /Title " + pdfStr(title) + " /Subject " + pdfStr(subject) + " /Producer (Handover) >>";
  var kids = [];
  var n = pages.length;
  pages.forEach(function(pg, i){
    var pid = 7 + i * 2, cid = pid + 1, body = pg.join("\n");
    kids.push(pid + " 0 R");
    /* Link areas on this page: a URI action each, no border */
    var refs = (links[i] || []).map(function(k){
      objs[next] = "<< /Type /Annot /Subtype /Link /Rect [" + k.r.map(function(v){ return v.toFixed(2); }).join(" ") + "] /Border [0 0 0] /A << /S /URI /URI " + pdfStr(k.uri) + " >> >>";
      return (next++) + " 0 R";
    });
    objs[pid] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + Hh + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents " + cid + " 0 R" + (refs.length ? " /Annots [" + refs.join(" ") + "]" : "") + " >>";
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

/* ================= Report layout (reports for the principal) =================
   A band with the title, key figures, a summary box, numbered sections and tables with status pills. */
var RPT = {accent: "2E4A3B", gold: "B08D4A", ink: "1C201E", grey: "5F6560", rule: "DDDAD2", tint: "F2F4F0", card: "F8F8F5", band: "D5E0D8",
  tones: {ok: ["2A6F45", "E2F0E6"], warn: ["8A5A00", "FBEFD3"], bad: ["A12A1F", "F8E0DC"], neutral: ["5F6560", "ECEBE6"]}};
function rgbOf(hex){ return [0, 2, 4].map(function(i){ return (parseInt(hex.substr(i, 2), 16) / 255).toFixed(3); }).join(" "); }
/* The columns a report table shows: drops columns that are empty in every row */
function reportColumns(cols, items){
  var nc = items.length ? items[0].cells.length : 0, out = [{k: "title", label: cols[0] || ""}];
  for (var i = 0; i < nc; i++) if (items.some(function(it){ return it.cells[i]; })) out.push({k: i, label: cols[i + 1] || ""});
  if (cols.length > 1 + nc && items.some(function(it){ return it.status; })) out.push({k: "status", label: cols[cols.length - 1] || ""});
  return out;
}
function noHead(C){ return C.every(function(c){ return !c.label; }); }
function cellOf(it, c){ return c.k === "title" ? it.title : c.k === "status" ? (it.status ? it.status.text : "") : it.cells[c.k] || ""; }
function blockLines(src){ var out = []; parseBlocks(src).forEach(function(b){ if (b.items) b.items.forEach(function(x){ out.push("• " + x); }); else if (b.text) out.push(b.text); }); return out; }
function reportPdf(doc, o){
  o = o || {};
  var letter = /^America\//.test(o.timezone || ""), W = letter ? 612 : 595.28, Hh = letter ? 792 : 841.89, M = 50, CW = W - 2 * M, BOTTOM = M + 34;
  var pages = [], ops = null, y = 0;
  function rect(x, yy, w, hgt, hex){ ops.push(rgbOf(hex) + " rg " + x.toFixed(2) + " " + yy.toFixed(2) + " " + w.toFixed(2) + " " + hgt.toFixed(2) + " re f"); }
  function hline(x1, yy, x2, hex, wd){ ops.push(rgbOf(hex) + " RG " + (wd || 0.5) + " w " + x1.toFixed(2) + " " + yy.toFixed(2) + " m " + x2.toFixed(2) + " " + yy.toFixed(2) + " l S"); }
  function text(x, yy, str, font, size, hex, sp){ ops.push(rgbOf(hex) + " rg BT /" + font + " " + size + " Tf " + (sp || 0) + " Tc " + x.toFixed(2) + " " + yy.toFixed(2) + " Td " + pdfStr(str) + " Tj ET"); }
  function wrap(str, bold, size, width){ return wrapText(plainText(str), bold, size, width); }
  function newPage(){
    ops = []; pages.push(ops); y = Hh - M;
    if (pages.length > 1){
      text(M, Hh - 30, plainText(doc.title).toUpperCase(), "F2", 7.5, RPT.grey, 0.8);
      var r = plainText(doc.role || ""); text(W - M - textWidth(r, false, 8), Hh - 30, r, "F1", 8, RPT.grey);
      hline(M, Hh - 37, W - M, RPT.rule, 0.5); y = Hh - 58;
    }
  }
  function need(hgt){ if (y - hgt < BOTTOM) newPage(); }
  /* The band */
  newPage();
  var tl = wrap(doc.title, true, 24, CW), bandH = 112 + (tl.length - 1) * 28 + (doc.role ? 15 : 0);
  rect(0, Hh - bandH, W, bandH, RPT.accent); rect(0, Hh - bandH - 3, W, 3, RPT.gold);
  text(M, Hh - 42, (doc.kicker || "Report").toUpperCase(), "F2", 8, RPT.gold, 1.4);
  var yy = Hh - 72; tl.forEach(function(l){ text(M, yy, l, "F2", 24, "FFFFFF"); yy -= 28; });
  yy += 6; if (doc.role){ text(M, yy, plainText(doc.role), "F1", 10, RPT.band); yy -= 15; }
  text(M, yy, (doc.preparedFor ? "Prepared for " + doc.preparedFor + "  ·  " : "") + (doc.date || ""), "F1", 10, RPT.band);
  y = Hh - bandH - 3 - 26;
  /* Key figures */
  function figures(F){
  if (F.length){
    var gap = 10, tw = (CW - gap * (F.length - 1)) / F.length, th = 64;
    need(th + 4);
    F.forEach(function(f, i){
      var x = M + i * (tw + gap), t = RPT.tones[f.tone] || RPT.tones.neutral, vs = f.value.length > 6 ? 15 : 22;
      rect(x, y - th, tw, th, t[1]); rect(x, y - th, 3, th, t[0]);
      text(x + 12, y - 30, f.value, "F2", vs, t[0]);
      wrap(f.label, false, 8.5, tw - 20).slice(0, 2).forEach(function(l, j){ text(x + 12, y - 46 - j * 10.5, l, "F1", 8.5, RPT.ink); });
    });
    y -= th + 22;
  }
  }
  /* Summary */
  function summary(intro, label){
  if (intro && intro.length){
    var lines = [];
    intro.forEach(function(s, i){ wrap(s, false, 10.5, CW - 48).forEach(function(l, j){ lines.push({t: l, first: j === 0, gap: j === 0 && i > 0}); }); });
    var bh = 46 + lines.length * 14.5 + (intro.length - 1) * 4;
    need(bh); rect(M, y - bh, CW, bh, RPT.tint); rect(M, y - bh, 3, bh, RPT.accent);
    text(M + 18, y - 20, (label || "Summary").toUpperCase(), "F2", 7.5, RPT.accent, 1.2);
    var sy = y - 38;
    lines.forEach(function(l){ if (l.gap) sy -= 4; if (l.first) rect(M + 18, sy + 2.5, 4, 4, RPT.gold); text(M + 32, sy, l.t, "F1", 10.5, RPT.ink); sy -= 14.5; });
    y -= bh + 28;
  }
  }
  function pill(x, top, st){
    var t = RPT.tones[st.tone] || RPT.tones.neutral, w = textWidth(st.text, true, 7.5) + 12;
    rect(x, top - 13, w, 13, t[1]); text(x + 6, top - 9.3, st.text, "F2", 7.5, t[0]);
  }
  function table(cols, items, plain){
    var C = reportColumns(cols, items), size = 9, lh = 11.5, pad = 5, widths = [], bold = function(c){ return c.k === "title" && !plain; };
    var natural = function(c){ var w = textWidth(plainText(c.label).toUpperCase(), true, 7.5) + 2 * pad; items.forEach(function(it){ var v = plainText(cellOf(it, c)); w = Math.max(w, c.k === "status" ? textWidth(v, true, 7.5) + 12 + 2 * pad + 2 : textWidth(v, bold(c), size) + 2 * pad + 3); }); return w; };
    var nat = C.map(natural), fixed = 0, flex = 0;
    C.forEach(function(c, i){ if (c.k === "title") return; nat[i] = Math.min(nat[i], c.k === "status" ? 120 : 150); fixed += nat[i]; });
    var titleW = Math.max(CW - fixed, CW * 0.42);
    if (C.length === 1) titleW = CW;
    var scale = C.length > 1 ? (CW - titleW) / fixed : 1;
    C.forEach(function(c, i){ widths[i] = c.k === "title" ? titleW : nat[i] * scale; });
    function header(){
      if (noHead(C)) return;
      need(24); var x = M;
      C.forEach(function(c, i){ text(x + pad, y - 10, plainText(c.label).toUpperCase(), "F2", 7, RPT.grey, 0.6); x += widths[i]; });
      y -= 16; hline(M, y, W - M, RPT.accent, 0.8);
    }
    header();
    items.forEach(function(it){
      var cells = C.map(function(c, i){ return c.k === "status" ? null : wrap(cellOf(it, c), bold(c), size, widths[i] - 2 * pad); });
      var nl = Math.max.apply(null, cells.map(function(l){ return l ? l.length : 1; })), rh = nl * lh + 2 * pad + 2, before = pages.length;
      need(rh); if (pages.length > before) header();
      var top = y, x = M;
      C.forEach(function(c, i){
        if (c.k === "status"){ if (it.status) pill(x + pad, top - pad + 1, it.status); }
        else cells[i].forEach(function(l, li){ text(x + pad, top - pad - 8 - li * lh, l, bold(c) ? "F2" : "F1", size, RPT.ink); });
        x += widths[i];
      });
      y = top - rh; hline(M, y, W - M, RPT.rule, 0.5);
    });
    y -= 10;
  }
  function card(it){
    var inner = CW - 34, tl2 = it.title ? wrap(it.title, true, 11, inner) : [], body = [];
    blockLines(it.body).forEach(function(s){ wrap(s, false, 10, inner).forEach(function(l){ body.push(l); }); });
    var meta = it.cells.filter(Boolean).join("  ·  "), ml = meta ? wrap(meta, false, 8.5, inner) : [], nl = it.note ? wrap(it.note, false, 9, inner) : [];
    var hgt = (tl2.length ? 22 : 18) + tl2.length * 14 + body.length * 13 + (ml.length ? 6 + ml.length * 11 : 0) + (nl.length ? 4 + nl.length * 12 : 0);
    need(hgt); rect(M, y - hgt, CW, hgt, RPT.card); rect(M, y - hgt, 3, hgt, RPT.gold);
    var cy = y - 18;
    tl2.forEach(function(l){ text(M + 18, cy, l, "F2", 11, RPT.ink); cy -= 14; });
    body.forEach(function(l){ text(M + 18, cy, l, "F1", 10, RPT.ink); cy -= 13; });
    if (ml.length){ cy -= 6; ml.forEach(function(l){ text(M + 18, cy, l, "F2", 8.5, RPT.accent); cy -= 11; }); }
    if (nl.length){ cy -= 4; nl.forEach(function(l){ text(M + 18, cy, l, "F3", 9, RPT.grey); cy -= 12; }); }
    y -= hgt + 10;
  }
  /* Parts (a combined report), each with its figures, summary and sections; sections are numbered right through */
  var chs = docChapters(doc), sec = 0;
  if (doc.chapters){ figures(doc.figures || []); summary(doc.intro, doc.introLabel); }
  chs.forEach(function(c, ci){
    if (doc.chapters){
      if (ci > 0) newPage(); else need(140);
      text(M, y - 10, ("Part " + (ci + 1) + " of " + chs.length).toUpperCase(), "F2", 8, RPT.gold, 1.2);
      var ctl = wrap(c.title, true, 20, CW); y -= 18;
      ctl.forEach(function(l){ y -= 22; text(M, y, l, "F2", 20, RPT.accent); });
      y -= 10; rect(M, y, CW, 1.5, RPT.accent); y -= 22;
      if (!c.parts.length && !c.intro.length){ text(M, y - 10, "Nothing to report.", "F1", 10.5, RPT.grey); y -= 30; }
    }
    figures(c.figures); summary(c.intro, c.introLabel);
    sections(c.parts);
  });
  function sections(parts){
  parts.forEach(function(p){
    var pi = sec++;
    need(90);
    text(M, y - 14, (pi < 9 ? "0" : "") + (pi + 1), "F2", 11, RPT.gold);
    text(M + 24, y - 14, plainText(p.title), "F2", 14, RPT.ink);
    y -= 26;
    p.groups.forEach(function(g){
      if (g.title){ need(50); text(M, y - 9, plainText(g.title).toUpperCase(), "F2", 7.5, RPT.accent, 0.8); y -= 16; }
      if (g.items.some(function(it){ return it.block; })) g.items.forEach(card); else table(p.columns || [], g.items, p.plain);
    });
    y -= 12;
  });
  }
  /* Made with Handover: a tinted box after the last section, kept on one page */
  var links = [], adSize = 9, adLh = adSize * 1.4, pad = 12, inner = CW - 2 * pad - 3;
  var adLines = APP_AD.lines.map(function(md){ return {md: md, lines: wrapText(plainText(md), false, adSize, inner)}; });
  var adH = pad + 12 + adLines.reduce(function(s, a){ return s + a.lines.length * adLh + 4; }, 0) + pad - 4;
  need(adH + 24); y -= 18;
  rect(M, y - adH, CW, adH, RPT.tint); rect(M, y - adH, 3, adH, RPT.accent);
  var ax = M + 3 + pad, ay = y - pad - 6;
  text(ax, ay, APP_AD.title.toUpperCase(), "F2", 7.5, RPT.accent, 1.1); ay -= 6;
  adLines.forEach(function(a){ a.lines.forEach(function(l){
    ay -= adLh; text(ax, ay, l, "F1", adSize, RPT.grey);
    var pi = pages.length - 1, ls = pdfLinks(l, a.md, ax, ay, adSize, false); links[pi] = (links[pi] || []).concat(ls);
    ls.forEach(function(k){ text(k.r[0], ay, k.text, "F1", adSize, RPT.accent); });
  }); ay -= 4; });
  y -= adH;
  var n = pages.length;
  pages.forEach(function(pg, i){
    ops = pg;
    hline(M, M + 12, W - M, RPT.rule, 0.5);
    text(M, M, (doc.preparedFor ? "Prepared for " + doc.preparedFor + " from the handover file" : "From the handover file") + (doc.date ? "  ·  " + doc.date : ""), "F1", 7.5, RPT.grey);
    var pn = "Page " + (i + 1) + " of " + n; text(W - M - textWidth(pn, false, 7.5), M, pn, "F1", 7.5, RPT.grey);
  });
  return pdfFile(pages, W, Hh, plainText(doc.title), plainText(doc.subtitle || ""), links);
}

function reportHtml(doc){
  var b = [], T = RPT.tones;
  var pillH = function(st){ return st ? '<span class="pill ' + (T[st.tone] ? st.tone : "neutral") + '">' + escHtml(st.text) + "</span>" : ""; };
  b.push('<header class="band"><div class="kicker">' + escHtml(doc.kicker || "Report") + "</div><h1>" + inlineHtml(doc.title) + "</h1>" + (doc.role ? '<div class="line">' + inlineHtml(doc.role) + "</div>" : "") +
    '<div class="line">' + (doc.preparedFor ? "Prepared for " + escHtml(doc.preparedFor) + " &middot; " : "") + escHtml(doc.date || "") + "</div></header>");
  var figs = function(F){ if ((F || []).length) b.push('<div class="figs">' + F.map(function(f){ return '<div class="fig ' + (T[f.tone] ? f.tone : "neutral") + '"><b>' + escHtml(f.value) + "</b><span>" + escHtml(f.label) + "</span></div>"; }).join("") + "</div>"); };
  var summary = function(intro, label){ if ((intro || []).length) b.push('<div class="summary"><div class="kick">' + escHtml(label || "Summary") + '</div><ul>' + intro.map(function(s){ return "<li>" + inlineHtml(s) + "</li>"; }).join("") + "</ul></div>"); };
  var chs = docChapters(doc), sec = 0;
  if (doc.chapters){ figs(doc.figures); summary(doc.intro, doc.introLabel); }
  chs.forEach(function(c, ci){
  if (doc.chapters){
    b.push('<div class="chapter"><div class="partno">Part ' + (ci + 1) + " of " + chs.length + "</div><h2 class=\"ch\">" + inlineHtml(c.title) + "</h2></div>");
    if (!c.parts.length && !c.intro.length) b.push('<p class="none">Nothing to report.</p>');
  }
  figs(c.figures); summary(c.intro, c.introLabel);
  c.parts.forEach(function(p){
    var pi = sec++;
    b.push('<h2><span class="num">' + (pi < 9 ? "0" : "") + (pi + 1) + "</span>" + inlineHtml(p.title) + "</h2>");
    p.groups.forEach(function(g){
      if (g.title) b.push('<h3>' + inlineHtml(g.title) + "</h3>");
      if (g.items.some(function(it){ return it.block; })){
        g.items.forEach(function(it){ b.push('<div class="card">' + (it.title ? "<h4>" + inlineHtml(it.title) + "</h4>" : "") + (it.body ? htmlBody(it.body, 4) : "") + (it.cells.filter(Boolean).length ? '<p class="cmeta">' + it.cells.filter(Boolean).map(inlineHtml).join(" &middot; ") + "</p>" : "") + (it.note ? '<p class="cnote">' + inlineHtml(it.note) + "</p>" : "") + "</div>"); });
        return;
      }
      var C = reportColumns(p.columns || [], g.items);
      b.push("<table>" + (noHead(C) ? "" : "<thead><tr>" + C.map(function(c){ return "<th" + (c.k === "status" ? ' class="st"' : "") + ">" + escHtml(c.label) + "</th>"; }).join("") + "</tr></thead>") + "<tbody>" +
        g.items.map(function(it){ return "<tr>" + C.map(function(c){ return c.k === "status" ? '<td class="st">' + pillH(it.status) + "</td>" : "<td" + (c.k === "title" && !p.plain ? ' class="t"' : "") + ">" + inlineHtml(cellOf(it, c)) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>");
    });
  });
  });
  b.push(appAdHtml());
  b.push('<footer>' + (doc.preparedFor ? "Prepared for " + escHtml(doc.preparedFor) + " from the handover file" : "From the handover file") + (doc.date ? " &middot; " + escHtml(doc.date) : "") + "</footer>");
  var tone = function(k){ return "." + k + "{--fg:#" + T[k][0] + ";--bg:#" + T[k][1] + "}"; };
  return '<!doctype html>\n<html><head><meta charset="utf-8"><title>' + escHtml(plainText(doc.title)) + "</title><style>" +
    "body{font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:10.5pt;line-height:1.45;color:#" + RPT.ink + ";margin:0;background:#fff}" +
    ".band{background:#" + RPT.accent + ";color:#fff;padding:30px 40px 22px;border-bottom:3px solid #" + RPT.gold + "}.kicker{color:#" + RPT.gold + ";font-weight:700;font-size:8pt;letter-spacing:.16em;text-transform:uppercase}" +
    ".band h1{font-size:24pt;margin:6px 0 8px;line-height:1.15}.band .line{color:#" + RPT.band + ";font-size:10pt}" +
    "main{padding:22px 40px 30px;max-width:900px}.figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:0 0 20px}" +
    ".fig{background:var(--bg);border-left:3px solid var(--fg);padding:10px 12px}.fig b{display:block;color:var(--fg);font-size:20pt;line-height:1.1}.fig span{font-size:8.5pt}" +
    tone("ok") + tone("warn") + tone("bad") + tone("neutral") +
    ".summary{background:#" + RPT.tint + ";border-left:3px solid #" + RPT.accent + ";padding:12px 18px;margin:0 0 24px}.kick{color:#" + RPT.accent + ";font-weight:700;font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px}" +
    ".summary ul{margin:0;padding:0;list-style:none}.summary li{position:relative;padding-left:16px;margin:4px 0}.summary li::before{content:'';position:absolute;left:0;top:.55em;width:5px;height:5px;background:#" + RPT.gold + "}" +
    "h2{font-size:14pt;margin:26px 0 8px}.num{color:#" + RPT.gold + ";font-size:11pt;margin-right:10px}h3{color:#" + RPT.accent + ";font-size:7.5pt;letter-spacing:.1em;text-transform:uppercase;margin:14px 0 4px}" +
    "table{width:100%;border-collapse:collapse;margin:0 0 10px;font-size:9.5pt}th{text-align:left;font-size:7pt;letter-spacing:.08em;text-transform:uppercase;color:#" + RPT.grey + ";border-bottom:1.5px solid #" + RPT.accent + ";padding:4px 6px}" +
    "td{border-bottom:1px solid #" + RPT.rule + ";padding:6px;vertical-align:top}td.t{font-weight:700}th.st,td.st{width:1%;white-space:nowrap}" +
    ".pill{display:inline-block;background:var(--bg);color:var(--fg);font-weight:700;font-size:7.5pt;padding:2px 7px}" +
    ".card{background:#" + RPT.card + ";border-left:3px solid #" + RPT.gold + ";padding:10px 16px;margin:0 0 10px}.card h4{margin:0 0 4px;font-size:11pt}.card p{margin:4px 0}.cmeta{color:#" + RPT.accent + ";font-weight:700;font-size:8.5pt}.cnote{color:#" + RPT.grey + ";font-style:italic;font-size:9pt}" +
    ".chapter{margin:40px 0 18px;padding-bottom:10px;border-bottom:2px solid #" + RPT.accent + "}.chapter:first-child{margin-top:4px}.partno{color:#" + RPT.gold + ";font-weight:700;font-size:8pt;letter-spacing:.14em;text-transform:uppercase}h2.ch{color:#" + RPT.accent + ";font-size:20pt;margin:4px 0 0}.none{color:#" + RPT.grey + "}" +
    "@media print{.chapter{break-before:page}.chapter:first-child{break-before:auto}}" +
    "footer{border-top:1px solid #" + RPT.rule + ";color:#" + RPT.grey + ";font-size:8pt;padding:8px 40px 20px;margin-top:10px}" +
    ".app{background:#" + RPT.tint + ";border-left:3px solid #" + RPT.accent + ";padding:10px 18px;margin:30px 0 0;font-size:9pt;color:#" + RPT.grey + ";break-inside:avoid}.app p{margin:3px 0}.app .app-t{color:#" + RPT.accent + ";font-weight:700;font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase}.app a{color:#" + RPT.accent + "}" +
    "@media print{.band,.fig,.summary,.pill,.card{-webkit-print-color-adjust:exact;print-color-adjust:exact}}" +
    "</style></head><body>\n" + b[0] + "\n<main>" + b.slice(1, -1).join("\n") + "</main>\n" + b[b.length - 1] + "\n</body></html>\n";
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
  /* Report layout (reports for the principal): band, key figures, summary, numbered sections, tables with status labels */
  function reportBody(body){
    var T = RPT.tones, TWD = 9638;
    var shd = function(hex){ return '<w:shd w:val="clear" w:color="auto" w:fill="' + hex + '"/>'; };
    var r = function(text, o){ o = o || {}; return "<w:r><w:rPr>" + (o.bold ? "<w:b/>" : "") + (o.italic ? "<w:i/>" : "") + (o.caps ? "<w:caps/>" : "") + (o.color ? '<w:color w:val="' + o.color + '"/>' : "") + (o.spacing ? '<w:spacing w:val="' + o.spacing + '"/>' : "") + (o.size ? '<w:sz w:val="' + o.size + '"/><w:szCs w:val="' + o.size + '"/>' : "") + (o.fill ? shd(o.fill) : "") + '</w:rPr><w:t xml:space="preserve">' + xmlEsc(text) + "</w:t></w:r>"; };
    var para = function(content, ppr){ return "<w:p><w:pPr>" + (ppr || "") + "</w:pPr>" + content + "</w:p>"; };
    var sp = function(before, after){ return '<w:spacing w:before="' + (before || 0) + '" w:after="' + (after || 0) + '"/>'; };
    var none = function(){ return ["top", "left", "bottom", "right", "insideH", "insideV"].map(function(e){ return "<w:" + e + ' w:val="nil"/>'; }).join(""); };
    var box = function(cells, mar){ return '<w:tbl><w:tblPr><w:tblW w:w="' + TWD + '" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>' + none() + "</w:tblBorders>" + (mar || "") + '</w:tblPr><w:tblGrid>' + cells.map(function(c){ return '<w:gridCol w:w="' + c.w + '"/>'; }).join("") + "</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>" + cells.map(function(c){ return '<w:tc><w:tcPr><w:tcW w:w="' + c.w + '" w:type="dxa"/>' + (c.left ? '<w:tcBorders><w:left w:val="single" w:sz="24" w:space="0" w:color="' + c.left + '"/></w:tcBorders>' : "") + (c.fill ? shd(c.fill) : "") + '<w:tcMar><w:top w:w="' + (c.pad || 140) + '" w:type="dxa"/><w:left w:w="' + (c.padX || 220) + '" w:type="dxa"/><w:bottom w:w="' + (c.pad || 140) + '" w:type="dxa"/><w:right w:w="' + (c.padX || 220) + '" w:type="dxa"/></w:tcMar></w:tcPr>' + (c.body || para("")) + "</w:tc>"; }).join("") + "</w:tr></w:tbl>"; };
    var gapP = function(after){ return para("", sp(0, after) + '<w:rPr><w:sz w:val="4"/></w:rPr>'); };
    /* Band */
    body.push(box([{w: TWD, fill: RPT.accent, pad: 300, padX: 360, body:
      para(r((doc.kicker || "Report").toUpperCase(), {bold: true, color: RPT.gold, size: 16, spacing: 30}), sp(0, 60)) +
      para(r(plainText(doc.title), {bold: true, color: "FFFFFF", size: 52}), sp(0, 100)) +
      (doc.role ? para(r(plainText(doc.role), {color: RPT.band, size: 20}), sp(0, 20)) : "") +
      para(r((doc.preparedFor ? "Prepared for " + doc.preparedFor + "  ·  " : "") + (doc.date || ""), {color: RPT.band, size: 20}), sp(0, 0))}]));
    body.push(para("", sp(0, 0) + '<w:pBdr><w:top w:val="single" w:sz="24" w:space="0" w:color="' + RPT.gold + '"/></w:pBdr>'));
    /* Key figures */
    function figures(F){
    if (F.length){
      var g = 160, fw = Math.floor((TWD - g * (F.length - 1)) / F.length), cells = [];
      F.forEach(function(f, i){
        var t = T[f.tone] || T.neutral;
        if (i) cells.push({w: g, padX: 0, pad: 0});
        cells.push({w: fw, fill: t[1], left: t[0], padX: 200, pad: 140, body: para(r(f.value, {bold: true, color: t[0], size: f.value.length > 6 ? 30 : 40}), sp(0, 20)) + para(r(f.label, {size: 17, color: RPT.ink}), sp(0, 0))});
      });
      body.push(gapP(160)); body.push(box(cells));
    }
    }
    /* Summary */
    function summary(intro, label){
    if ((intro || []).length){
      body.push(gapP(240));
      body.push(box([{w: TWD, fill: RPT.tint, left: RPT.accent, pad: 180, padX: 300, body:
        para(r((label || "Summary").toUpperCase(), {bold: true, color: RPT.accent, size: 15, spacing: 24}), sp(0, 100)) +
        intro.map(function(s){ return para(r("■  ", {color: RPT.gold, size: 14}) + runs(s, {size: 21}), sp(0, 80) + '<w:ind w:left="300" w:hanging="300"/>'); }).join("")}]));
    }
    }
    /* Parts (a combined report): each starts on a new page; sections are numbered right through */
    var chs = docChapters(doc), sec = 0;
    if (doc.chapters){ figures(doc.figures || []); summary(doc.intro, doc.introLabel); }
    chs.forEach(function(c, ci){
      if (doc.chapters){
        if (ci > 0) body.push(para('<w:r><w:br w:type="page"/></w:r>', sp(0, 0))); else body.push(gapP(400));
        body.push(para(r(("Part " + (ci + 1) + " of " + chs.length).toUpperCase(), {bold: true, color: RPT.gold, size: 16, spacing: 30}), "<w:keepNext/>" + sp(0, 60)));
        body.push(para(r(plainText(c.title), {bold: true, color: RPT.accent, size: 40}), "<w:keepNext/>" + sp(0, 120) + '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="' + RPT.accent + '"/></w:pBdr>'));
        if (!c.parts.length && !c.intro.length) body.push(para(r("Nothing to report.", {color: RPT.grey, size: 21}), sp(120, 0)));
      }
      figures(c.figures); summary(c.intro, c.introLabel);
      sections(c.parts);
    });
    function sections(parts){
    parts.forEach(function(pt){
      var pi = sec++;
      body.push(para(r((pi < 9 ? "0" : "") + (pi + 1) + "   ", {bold: true, color: RPT.gold, size: 22}) + r(plainText(pt.title), {bold: true, size: 28}), "<w:keepNext/>" + sp(400, 120)));
      pt.groups.forEach(function(gr){
        if (gr.title) body.push(para(r(plainText(gr.title), {bold: true, caps: true, color: RPT.accent, size: 15, spacing: 16}), "<w:keepNext/>" + sp(160, 60)));
        if (gr.items.some(function(it){ return it.block; })){
          gr.items.forEach(function(it){
            body.push(box([{w: TWD, fill: RPT.card, left: RPT.gold, pad: 140, padX: 260, body:
              (it.title ? para(runs(it.title, {bold: true, size: 22}), sp(0, 60)) : "") + (it.body ? blocks(it.body) : "") +
              (it.cells.filter(Boolean).length ? para(r(it.cells.filter(Boolean).map(plainText).join("  ·  "), {bold: true, color: RPT.accent, size: 17}), sp(60, 20)) : "") +
              (it.note ? para(r(plainText(it.note), {italic: true, color: RPT.grey, size: 18}), sp(20, 0)) : "")}]));
            body.push(gapP(120));
          });
          return;
        }
        var C = reportColumns(pt.columns || [], gr.items), nat = C.map(function(c){ var w = Math.max(8, c.label.length); gr.items.forEach(function(it){ w = Math.max(w, Math.min(c.k === "title" ? 70 : 28, plainText(cellOf(it, c)).length + (c.k === "status" ? 3 : 0))); }); return w; });
        var other = 0; C.forEach(function(c, i){ if (c.k !== "title") other += nat[i]; });
        var titleShare = C.length === 1 ? 1 : Math.max(0.42, Math.min(0.7, nat[0] / (nat[0] + other)));
        var widths = C.map(function(c, i){ return c.k === "title" ? Math.round(TWD * titleShare) : Math.round(TWD * (1 - titleShare) * nat[i] / other); });
        var edge = function(e, sz, col){ return "<w:" + e + ' w:val="single" w:sz="' + sz + '" w:space="0" w:color="' + col + '"/>'; };
        var tc = function(i, content, head){ return '<w:tc><w:tcPr><w:tcW w:w="' + widths[i] + '" w:type="dxa"/><w:tcBorders>' + edge("bottom", head ? 12 : 4, head ? RPT.accent : RPT.rule) + "</w:tcBorders></w:tcPr>" + content + "</w:tc>"; };
        var cellP = function(content){ return para(content, sp(40, 40)); };
        var head = noHead(C) ? "" : "<w:tr><w:trPr><w:tblHeader/></w:trPr>" + C.map(function(c, i){ return tc(i, cellP(r(c.label.toUpperCase(), {bold: true, color: RPT.grey, size: 14, spacing: 10})), true); }).join("") + "</w:tr>";
        var rows = gr.items.map(function(it){ return "<w:tr><w:trPr><w:cantSplit/></w:trPr>" + C.map(function(c, i){
          if (c.k === "status"){ var t = it.status ? T[it.status.tone] || T.neutral : null; return tc(i, cellP(t ? r(" " + it.status.text + " ", {bold: true, color: t[0], size: 15, fill: t[1]}) : "")); }
          return tc(i, cellP(c.k === "title" && !pt.plain ? runs(cellOf(it, c), {bold: true, size: 19}) : runs(cellOf(it, c), {size: 19})));
        }).join("") + "</w:tr>"; }).join("");
        body.push('<w:tbl><w:tblPr><w:tblW w:w="' + TWD + '" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>' + none() + '</w:tblBorders><w:tblCellMar><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + widths.map(function(w){ return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>" + head + rows + "</w:tbl>");
        body.push(gapP(120));
      });
    });
    }
  }
  var body = [];
  if (doc.style === "report") reportBody(body); else {
  body.push(p("Title", run(plainText(doc.title))));
  body.push(p("Subtitle", run(plainText(doc.subtitle))));
  (doc.intro || []).forEach(function(x){ body.push(p("", runs(x, {size: 24}))); });
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
  }
  /* Made with Handover, after a rule, kept together */
  body.push(p("", run(APP_AD.title, {bold: true, color: RPT.accent, size: 19}), '<w:keepNext/><w:pBdr><w:top w:val="single" w:sz="4" w:space="8" w:color="' + RPT.rule + '"/></w:pBdr><w:spacing w:before="480" w:after="60"/>'));
  APP_AD.lines.forEach(function(s, i){ body.push(p("", runs(s, {size: 18, color: RPT.grey}), (i < APP_AD.lines.length - 1 ? "<w:keepNext/>" : "") + '<w:spacing w:before="0" w:after="60"/>')); });
  var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  var documentXml = XML_HEAD + "<w:document " + W + "><w:body>" + body.join("") +
    '<w:sectPr>' + (doc.style === "report" ? '<w:footerReference w:type="default" r:id="rIdF"/>' : "") + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
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
    (doc.style === "report" ? '<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : "") + links.map(function(u, i){ return '<Relationship Id="rIdL' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xmlEsc(u) + '" TargetMode="External"/>'; }).join("");
  return zip([
    {name: "[Content_Types].xml", text: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' + (doc.style === "report" ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : "") + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'},
    {name: "_rels/.rels", text: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'},
    {name: "docProps/core.xml", text: coreProps(plainText(doc.title))},
    {name: "word/document.xml", text: documentXml},
    {name: "word/styles.xml", text: stylesXml},
    {name: "word/numbering.xml", text: numberingXml},
    doc.style === "report" ? {name: "word/footer1.xml", text: XML_HEAD + "<w:ftr " + W + '><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="' + RPT.rule + '"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs></w:pPr>' +
      '<w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/></w:rPr><w:t xml:space="preserve">' + xmlEsc((doc.preparedFor ? "Prepared for " + doc.preparedFor + " from the handover file" : "From the handover file") + (doc.date ? "  \u00b7  " + doc.date : "")) + '</w:t></w:r><w:r><w:rPr><w:sz w:val="15"/></w:rPr><w:tab/></w:r>' +
      '<w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/></w:rPr><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/></w:rPr><w:t xml:space="preserve"> of </w:t></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="' + RPT.grey + '"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>'} : null,
    {name: "word/_rels/document.xml.rels", text: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>"}
  ].filter(Boolean));
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
  /* A last sheet: made with Handover, how to get it, and the links as HYPERLINK formulas so they can be clicked */
  var about = APP_AD.title, k = 2; while (used[about.toLowerCase()]) about = APP_AD.title + " " + k++;
  var aboutRows = [cellXml("A1", APP_AD.title, 1)].concat(APP_AD.lines.map(function(s, i){ return cellXml("A" + (i + 2), plainText(s), 2); }));
  [].concat.apply([], APP_AD.lines.map(mdLinks)).forEach(function(l){
    var r = aboutRows.length + 1, shown = l.text.charAt(0).toUpperCase() + l.text.slice(1) + ": " + l.uri;
    aboutRows.push('<c r="A' + r + '" t="str" s="2"><f>' + xmlEsc('HYPERLINK("' + l.uri.replace(/"/g, '""') + '","' + shown.replace(/"/g, '""') + '")') + "</f><v>" + xmlEsc(shown) + "</v></c>");
  });
  sheets.push({name: about, xml: XML_HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"' + (sheets.length ? "" : ' tabSelected="1"') + '/></sheetViews><cols><col min="1" max="1" width="100" customWidth="1"/></cols><sheetData>' +
    aboutRows.map(function(c, i){ return '<row r="' + (i + 1) + '">' + c + "</row>"; }).join("") + "</sheetData></worksheet>"});
  var files = [
    {name: "[Content_Types].xml", text: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      sheets.map(function(sh, i){ return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("") + "</Types>"},
    {name: "_rels/.rels", text: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'},
    {name: "docProps/core.xml", text: coreProps(plainText(doc.title))},
    {name: "xl/workbook.xml", text: XML_HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function(sh, i){ return '<sheet name="' + xmlEsc(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("") + "</sheets>" +
      (sheets.length > 1 ? "<definedNames>" + sheets.map(function(sh, i){ var f = sh.xml.match(/autoFilter ref="([^"]+)"/); return f ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + xmlEsc(sh.name.replace(/'/g, "''")) + "'!" + f[1].replace(/([A-Z]+)(\d+)/g, "$$$1$$$2") + "</definedName>" : ""; }).join("") + "</definedNames>" : "") + "</workbook>"},
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

var api = {version: "1.4", guidesFor: guidesFor, guideLabel: guideLabel, docType: DOC_TYPE, validate: validate, schedule: schedule, reminders: reminders, summaryFor: summaryFor, ticksSince: ticksSince, calendarFile: calendarFile, zoneTime: zoneTime, occursOn: occursOn, cadence: cadence, leadWords: leadWords, maxLead: MAX_LEAD, nice: nice, zoneParts: zoneParts, addDays: addDays, mergeProgress: mergeProgress, mergeHandover: mergeHandover, contentOnly: contentOnly,
  textFields: textFields, findGaps: findGaps, gapCounts: gapCounts, overlap: overlap, phaseLabel: phaseLabel, phases: PHASES, gates: gates, askMinutes: askMinutes,
  canSee: canSee, exportProfile: exportProfile, renderSections: renderSections, withRendered: withRendered, roles: ROLES, roleName: ROLE_NAME,
  exportKinds: exportKinds, itemsDocument: itemsDocument, docMarkdown: docMarkdown, docHtml: docHtml, docPdf: docPdf, docDocx: docDocx, docXlsx: docXlsx, base64: base64, parseBlocks: parseBlocks, blocksText: blocksText, gapList: gapList, fillGap: fillGap, fillGaps: fillGaps, secretReason: secretReason, closeItem: closeItem, reopenItem: reopenItem, closeHow: CLOSE_HOW, closeLabel: CLOSE_LABEL, reports: REPORTS, principalReport: principalReport, principalReports: principalReports, reportTitle: reportTitle, usesMinor: usesMinor, areaParts: areaParts, whenNeeded: whenNeeded, roleFacts: ROLE_FACTS, addItem: addItem, addFields: ADD_FIELDS, deleteItem: deleteItem, deletable: DELETABLE, roleFields: ROLE_FIELDS, roleValues: roleValues, editRole: editRole, planFields: PLAN_FIELDS, planValues: planValues, editPlan: editPlan, listNoun: LIST_NOUN, editItem: editItem, editFields: editFields, editValues: editValues, fieldApplies: fieldApplies, transitionKit: transitionKit, readKit: readKit, todoList: todoList, todoPlan: todoPlan};
if (typeof module === "object" && module.exports) module.exports = api; else root.HandoverCore = api;
})(typeof window !== "undefined" ? window : this);
