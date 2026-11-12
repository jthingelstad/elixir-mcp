import { test } from "node:test";
import assert from "node:assert/strict";
import { runEmail } from "../src/email/index.mjs";
import { deliver } from "@elixir-mcp/mail/deliver";
import { handler } from "../src/index.mjs";

test("scheduled, forced and direct entry points of every retired mail perform no IO", async () => {
  const forbidden = () => {
    throw new Error("retired mail performed IO");
  };
  // The clan report, Arena week and milestone folded into the one digest
  // (Jamie, 2026-11-12): a rule left behind or a forced run sends nothing.
  for (const kind of [
    "top_100",
    "card_of_week",
    "clan_report",
    "arena_week",
    "milestone",
  ]) {
    for (const force of [false, true]) {
      const result = await runEmail({
        kind,
        force,
        db: { query: forbidden },
        enqueue: forbidden,
      });
      assert.equal(result.skipped, "retired");
      assert.equal(
        (
          await deliver({
            kind,
            force,
            db: { query: forbidden },
            enqueue: forbidden,
          })
        ).reason,
        "retired",
      );
    }
    assert.equal(
      (await handler({ email: kind, force: true })).skipped,
      "retired",
    );
  }
  for (const event of [
    { top100_generate: true },
    { top100_accept: { key: "old" } },
    { issue_accept: { key: "old", kind: "card_of_week" } },
    { card_of_week_preview: true },
    { card_of_week_generate: true },
  ])
    assert.equal((await handler(event)).skipped, "retired");
});
