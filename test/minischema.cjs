// A small JSON Schema 2020-12 checker, enough for schema/v1*.json. No dependencies.
// Supports: $ref (local), type, required, properties, additionalProperties, patternProperties,
// propertyNames, enum, const, pattern, minLength, minimum, maximum, items, minItems, maxItems,
// uniqueItems, oneOf, anyOf.
"use strict";
function check(schema, value) {
  let errors = [];
  function resolve(ref) { return ref.replace(/^#\//, "").split("/").reduce((o, k) => o[k], schema); }
  function type(v) { return v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v; }
  function walk(s, v, p) {
    if (s === true) return; if (s === false) { errors.push(p + ": not allowed"); return; }
    if (s.$ref) walk(resolve(s.$ref), v, p);
    const t = type(v);
    if (s.type && !(s.type === t || (s.type === "number" && t === "integer"))) { errors.push(`${p}: expected ${s.type}, got ${t}`); return; }
    if (s.enum && !s.enum.includes(v)) errors.push(`${p}: not one of ${s.enum.join(", ")}`);
    if ("const" in s && s.const !== v) errors.push(`${p}: must be ${JSON.stringify(s.const)}`);
    if (typeof v === "string") {
      if (s.pattern && !new RegExp(s.pattern, "u").test(v)) errors.push(`${p}: does not match ${s.pattern}`);
      if (s.minLength && v.length < s.minLength) errors.push(`${p}: too short`);
    }
    if (typeof v === "number") {
      if (s.minimum !== undefined && v < s.minimum) errors.push(`${p}: below ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) errors.push(`${p}: above ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems && v.length < s.minItems) errors.push(`${p}: needs ${s.minItems} item(s)`);
      if (s.maxItems !== undefined && v.length > s.maxItems) errors.push(`${p}: at most ${s.maxItems} item(s)`);
      if (s.uniqueItems && new Set(v.map(x => JSON.stringify(x))).size !== v.length) errors.push(`${p}: items must be unique`);
      if (s.items) v.forEach((x, i) => walk(s.items, x, `${p}[${i}]`));
    }
    if (t === "object") {
      (s.required || []).forEach(k => { if (!(k in v)) errors.push(`${p}.${k}: required`); });
      for (const k of Object.keys(v)) {
        if (s.propertyNames) walk(s.propertyNames, k, `${p}{${k}}`);
        let matched = false;
        if (s.properties && k in s.properties) { matched = true; walk(s.properties[k], v[k], `${p}.${k}`); }
        for (const re of Object.keys(s.patternProperties || {})) if (new RegExp(re, "u").test(k)) { matched = true; walk(s.patternProperties[re], v[k], `${p}.${k}`); }
        if (!matched && s.additionalProperties !== undefined) walk(s.additionalProperties, v[k], `${p}.${k}`);
      }
    }
    for (const [kw, need] of [["oneOf", 1], ["anyOf", 0]]) if (s[kw]) {
      const ok = s[kw].filter(x => { const saved = errors; errors = []; walk(x, v, p); const pass = !errors.length; errors = saved; return pass; }).length;
      if (kw === "oneOf" ? ok !== 1 : ok === 0) errors.push(`${p}: must match ${kw === "oneOf" ? "exactly one" : "at least one"} of the ${kw} choices (${ok} matched)`);
    }
  }
  walk(schema, value, "$");
  return errors;
}
module.exports = { check };
