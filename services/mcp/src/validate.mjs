/**
 * Argument validation at the registry boundary.
 *
 * Every tool declares a JSON Schema for its arguments and clients see it in
 * tools/list, but nothing checked calls against it: handlers received raw
 * objects and each one re-validated what it happened to remember. Unknown
 * properties were silently ignored, and a wrong-typed value reached SQL.
 *
 * This covers the subset the declarations actually use (type, enum,
 * min/max, minLength/maxLength, minItems/maxItems, items, pattern,
 * properties, required, additionalProperties: false). It is deliberately
 * not a general JSON Schema engine, and it takes no dependency: a
 * declaration using a keyword this does not know is a build-time gap to
 * close here, never a silent pass.
 */

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(declared, value) {
  const types = Array.isArray(declared) ? declared : [declared];
  const actual = typeOf(value);
  return types.some(
    (t) => t === actual || (t === "number" && actual === "integer"),
  );
}

/** Returns null when valid, else a human-readable problem naming the path. */
export function validateArgs(schema, value, path = "arguments") {
  if (!schema || typeof schema !== "object") return null;
  if (schema.type !== undefined && !matchesType(schema.type, value)) {
    const want = Array.isArray(schema.type)
      ? schema.type.join(" or ")
      : schema.type;
    return `${path} must be ${want}, got ${typeOf(value)}.`;
  }
  if (value === null) return null;
  if (schema.enum && !schema.enum.includes(value))
    return `${path} must be one of ${schema.enum.join(", ")}.`;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return `${path} must be at least ${schema.minLength} characters.`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return `${path} must be at most ${schema.maxLength} characters.`;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))
      return `${path} does not match ${schema.pattern}.`;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      return `${path} must be at least ${schema.minimum}.`;
    if (schema.maximum !== undefined && value > schema.maximum)
      return `${path} must be at most ${schema.maximum}.`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      return `${path} needs at least ${schema.minItems} items.`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      return `${path} takes at most ${schema.maxItems} items.`;
    if (schema.items) {
      for (const [i, item] of value.entries()) {
        const problem = validateArgs(schema.items, item, `${path}[${i}]`);
        if (problem) return problem;
      }
    }
  }
  if (typeOf(value) === "object") {
    const props = schema.properties ?? {};
    // What was sent is judged before what was left out: an unknown or
    // wrong-typed property is the more specific problem.
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      if (!Object.hasOwn(props, key)) {
        if (schema.additionalProperties === false)
          return `${path} has no property '${key}'. Known: ${Object.keys(props).join(", ")}.`;
        continue;
      }
      const problem = validateArgs(props[key], item, `${path}.${key}`);
      if (problem) return problem;
    }
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) return `${path}.${key} is required.`;
    }
  }
  return null;
}
