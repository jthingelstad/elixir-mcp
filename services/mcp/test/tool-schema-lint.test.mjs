/**
 * Registry-wide lint on argument descriptions.
 *
 * `to` carried a bare {type: "string"} on ten tools while `from` beside it
 * was documented, so the asymmetry between the bounds - a date-only `to`
 * covers the WHOLE named local day, an ISO instant is used as given - had
 * to be reverse-engineered from filters_applied after the fact (playtest
 * round, 2026-09-09).
 *
 * This is a lint, not a behaviour test: it fails when a NEW window
 * argument is added without saying what it means.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRegistry } from "../src/tools.mjs";
import {
  WINDOW_FROM_DESC,
  WINDOW_TO_DESC,
  WINDOW_DATE_ONLY_DESC,
} from "../src/tools/shared.mjs";

const WINDOW_ARGS = new Set(["from", "to", "compare_from", "compare_to"]);
const declarations = makeRegistry().declarations();

const windowArgs = declarations.flatMap((d) =>
  Object.entries(d.inputSchema?.properties ?? {})
    .filter(([name]) => WINDOW_ARGS.has(name))
    .map(([name, schema]) => ({ tool: d.name, name, schema })),
);

test("every window argument says what it means", () => {
  assert.ok(windowArgs.length >= 15, "the registry still has window args");
  const bare = windowArgs
    .filter(({ schema }) => !schema.description?.trim())
    .map(({ tool, name }) => `${tool}.${name}`);
  assert.deepEqual(
    bare,
    [],
    `undescribed window arguments: ${bare.join(", ")}`,
  );
});

test("both bounds are described the same way wherever they appear", () => {
  // Three shapes, no free text: instant-resolving tools use the from/to
  // pair, snapshot-series tools take whole days. Before this, one tool
  // called its `to` "inclusive" while the instant path treats it as
  // exclusive - the kind of drift free-text descriptions invite.
  for (const { tool, name, schema } of windowArgs) {
    const allowed = name.endsWith("from")
      ? [WINDOW_FROM_DESC, WINDOW_DATE_ONLY_DESC]
      : [WINDOW_TO_DESC, WINDOW_DATE_ONLY_DESC];
    assert.ok(
      allowed.some((a) => schema.description.includes(a)),
      `${tool}.${name} describes the bound in its own words: ${schema.description}`,
    );
  }
});

test("the exclusive end and the whole-day rule are actually stated", () => {
  // The two facts a caller cannot guess, and got wrong.
  assert.match(WINDOW_TO_DESC, /exclusive/i);
  assert.match(WINDOW_TO_DESC, /WHOLE local day/);
  assert.match(WINDOW_FROM_DESC, /inclusive/i);
});
