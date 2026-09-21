/**
 * Prove it bites: every rule and case the suite relies on is shown to
 * FAIL on a captured answer from a day the product was wrong. A rule
 * that passes on known-bad history is decoration, and a suite whose
 * baselines were recorded from current behaviour would ossify its
 * errors - so the manifest here is what keeps the gate honest, and this
 * runs under `npm run verify` with no network (bites/README.md has the
 * workflow: a finding gets a capture and a manifest entry with its fix).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRegistry } from "../services/mcp/src/tools.mjs";
import { replayDoor } from "./replay.mjs";
import { runSuite } from "./run.mjs";
import * as lib from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bitesDir = path.join(here, "bites");
const manifest = JSON.parse(
  readFileSync(path.join(bitesDir, "manifest.json"), "utf8"),
);
const load = (name) =>
  JSON.parse(readFileSync(path.join(bitesDir, name), "utf8"));
const tools = makeRegistry().declarations();
const ctx = { tools: new Map(tools.map((t) => [t.name, t])) };

/** The rules a `rule` bite may name, each applied to one capture. */
const RULES = {
  answered: (c) =>
    lib.answered(
      { body: c.response, isError: Boolean(c.response.error) },
      c.request.tool,
    ),
  notesNameFields: (c) => lib.notesNameFields(ctx, c.request.tool, c.response),
};

test("every capture in bites/ is named by the manifest", () => {
  const named = new Set(manifest.flatMap((b) => b.captures ?? [b.capture]));
  for (const f of readdirSync(bitesDir).filter(
    (f) => f.endsWith(".json") && f !== "manifest.json",
  ))
    assert.ok(named.has(f), `${f} is not in the manifest`);
});

for (const bite of manifest) {
  const label = `${bite.feedback ? `#${bite.feedback} ` : ""}${bite.case ?? bite.rule} bites on ${bite.contract}: ${bite.why}`;
  test(label, async () => {
    if (bite.case) {
      const door = replayDoor(bite.captures.map(load));
      const report = await runSuite(door, {
        only: bite.case,
        quiet: true,
        tools,
      });
      assert.equal(report.cases.length, 1, `one case matches ${bite.case}`);
      assert.equal(
        report.cases[0].ok,
        false,
        `${bite.case} must fail on the capture`,
      );
      assert.match(report.cases[0].error, new RegExp(bite.expect));
    } else {
      const rule = RULES[bite.rule];
      assert.ok(rule, `unknown rule ${bite.rule}`);
      assert.throws(() => rule(load(bite.capture)), new RegExp(bite.expect));
    }
  });
}
