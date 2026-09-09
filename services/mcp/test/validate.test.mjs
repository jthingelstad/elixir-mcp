import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRegistry, ToolFailure } from "../src/tools.mjs";
import { validateArgs } from "../src/validate.mjs";

/** A value of the wrong type for a declared property. */
function wrongTyped(spec) {
  const types = Array.isArray(spec.type) ? spec.type : [spec.type];
  if (!types.includes("object")) return { nope: true };
  return 1;
}

// The handler must never run: a ctx with no database proves it did not.
const noCtx = { db: null, account: {} };

test("every registered tool rejects an unknown property before its handler runs", async () => {
  const registry = makeRegistry();
  for (const d of registry.declarations()) {
    await assert.rejects(
      registry.invoke(d.name, noCtx, { definitely_not_declared: 1 }),
      (err) =>
        err instanceof ToolFailure &&
        err.code === "bad_request" &&
        /no property 'definitely_not_declared'/.test(err.message),
      d.name,
    );
  }
});

test("every registered tool rejects a wrong-typed property before its handler runs", async () => {
  const registry = makeRegistry();
  let checked = 0;
  for (const d of registry.declarations()) {
    const props = d.inputSchema?.properties ?? {};
    const [key, spec] = Object.entries(props)[0] ?? [];
    if (!key) continue;
    checked += 1;
    await assert.rejects(
      registry.invoke(d.name, noCtx, { [key]: wrongTyped(spec) }),
      (err) =>
        err instanceof ToolFailure &&
        err.code === "bad_request" &&
        err.message.includes(`arguments.${key}`),
      `${d.name}.${key}`,
    );
  }
  assert.ok(checked > 30, `checked ${checked} tools`);
});

test("the validator covers the keywords the declarations use", () => {
  const schema = {
    type: "object",
    properties: {
      tag: { type: "string", minLength: 2, maxLength: 4, pattern: "^#" },
      n: { type: "integer", minimum: 1, maximum: 5 },
      mode: { type: "string", enum: ["a", "b"] },
      tags: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 2,
      },
      nick: { type: ["string", "null"], maxLength: 3 },
    },
    required: ["tag"],
    additionalProperties: false,
  };
  assert.equal(
    validateArgs(schema, {
      tag: "#AB",
      n: 3,
      mode: "a",
      tags: ["x"],
      nick: null,
    }),
    null,
  );
  assert.match(validateArgs(schema, {}), /tag is required/);
  assert.match(validateArgs(schema, { tag: "#" }), /at least 2/);
  assert.match(validateArgs(schema, { tag: "#ABCDE" }), /at most 4/);
  assert.match(validateArgs(schema, { tag: "AB" }), /does not match/);
  assert.match(validateArgs(schema, { tag: "#AB", n: 0 }), /at least 1/);
  assert.match(validateArgs(schema, { tag: "#AB", n: 9 }), /at most 5/);
  assert.match(validateArgs(schema, { tag: "#AB", n: 1.5 }), /must be integer/);
  assert.match(validateArgs(schema, { tag: "#AB", mode: "c" }), /one of a, b/);
  assert.match(
    validateArgs(schema, { tag: "#AB", tags: [] }),
    /at least 1 items/,
  );
  assert.match(
    validateArgs(schema, { tag: "#AB", tags: [1] }),
    /tags\[0\] must be string/,
  );
  assert.match(validateArgs(schema, { tag: "#AB", nick: 5 }), /string or null/);
  assert.match(
    validateArgs(schema, { tag: "#AB", extra: 1 }),
    /no property 'extra'/,
  );
});
