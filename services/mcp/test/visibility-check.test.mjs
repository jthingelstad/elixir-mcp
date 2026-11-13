/**
 * The deploy's visibility check (infra/scripts/lib/visibility-check.mjs):
 * one WARNING per table {visibility_check} names, with the exact {vacuum}
 * command; a quiet line when none; and never a throw, whatever the
 * invoke does, because the check must not fail a deploy that is live.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runVisibilityCheck,
  visibilityWarnings,
} from "../../../infra/scripts/lib/visibility-check.mjs";

const BEHIND = {
  floor_pages: 500,
  min_all_visible_share: 0.5,
  checked: 120,
  flagged: [
    {
      table: "battle_participant",
      reason: "visibility_map",
      pages: 11735,
      all_visible_pages: 0,
      all_visible_pct: 0,
      command: `npm run op -- '{"vacuum":{"table":"battle_participant"}}'`,
    },
    {
      table: "admitted_read_day",
      reason: "never_analyzed",
      pages: 40,
      all_visible_pages: 0,
      all_visible_pct: 0,
      command: `npm run op -- '{"vacuum":{"table":"admitted_read_day"}}'`,
    },
  ],
};

const lambdaAnswering = (payload, extra = {}) => ({
  sent: [],
  async send(command) {
    this.sent.push(command.input);
    return { Payload: Buffer.from(JSON.stringify(payload)), ...extra };
  },
});

test("each flagged table is one WARNING naming the table and its vacuum command", () => {
  assert.deepEqual(visibilityWarnings(BEHIND), [
    `WARNING: battle_participant: 0 of 11735 pages all-visible (0%); index-only reads fetch the heap. After the deploy run: npm run op -- '{"vacuum":{"table":"battle_participant"}}'`,
    `WARNING: admitted_read_day: never vacuumed or analyzed (40 pages, no row estimate); the planner guesses its size. After the deploy run: npm run op -- '{"vacuum":{"table":"admitted_read_day"}}'`,
  ]);
});

test("the deploy asks the migrate Lambda for the read-only op and prints what it says", async () => {
  const lambda = lambdaAnswering(BEHIND);
  const printed = [];
  const lines = await runVisibilityCheck(lambda, "elixir-mcp-migrate", {
    log: (l) => printed.push(l),
  });
  assert.deepEqual(lambda.sent, [
    {
      FunctionName: "elixir-mcp-migrate",
      Payload: '{"visibility_check": true}',
    },
  ]);
  assert.equal(printed.length, 2);
  assert.deepEqual(printed, lines);
});

test("a healthy database prints one quiet line", async () => {
  const printed = [];
  await runVisibilityCheck(
    lambdaAnswering({ ...BEHIND, flagged: [] }),
    "elixir-mcp-migrate",
    { log: (l) => printed.push(l) },
  );
  assert.equal(printed.length, 1);
  assert.match(printed[0], /^visibility check: 120 tables, none behind/);
});

test("a failed invoke, a function error or an older bundle is a WARNING, never a throw", async () => {
  const cases = [
    {
      async send() {
        throw new Error("socket hang up");
      },
    },
    lambdaAnswering(
      { errorMessage: "Task timed out" },
      { FunctionError: "Unhandled" },
    ),
    lambdaAnswering({ error: "unknown_op", keys: ["visibility_check"] }),
    lambdaAnswering(null),
  ];
  for (const lambda of cases) {
    const printed = [];
    await runVisibilityCheck(lambda, "elixir-mcp-migrate", {
      log: (l) => printed.push(l),
    });
    assert.equal(printed.length, 1);
    assert.match(
      printed[0],
      /^WARNING: the visibility check (did not run|gave no answer)/,
    );
    assert.match(printed[0], /visibility_check/);
  }
});
