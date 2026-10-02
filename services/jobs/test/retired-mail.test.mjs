import { test } from "node:test";
import assert from "node:assert/strict";
import { runEmail, writtenSendDue } from "../src/email/index.mjs";
import { deliver } from "@elixir-mcp/mail/deliver";
import { handler } from "../src/index.mjs";
import { top100Generate, top100Accept } from "../src/email/top100.mjs";
import {
  cardOfWeekGenerate,
  cardOfWeekAccept,
} from "../src/email/card-of-week.mjs";
import { cardOfWeekPreview } from "../src/email/card-of-week-preview.mjs";

test("scheduled, forced and direct editorial entry points perform no IO", async () => {
  const forbidden = () => {
    throw new Error("retired mail performed IO");
  };
  for (const kind of ["top_100", "card_of_week"]) {
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
      writtenSendDue(kind, "2026-10-01", new Date("2026-10-02T15:00:00Z")),
      false,
    );
    assert.equal(
      (await handler({ email: kind, force: true })).skipped,
      "retired",
    );
  }
  for (const fn of [
    top100Generate,
    top100Accept,
    cardOfWeekGenerate,
    cardOfWeekAccept,
    cardOfWeekPreview,
  ])
    assert.equal((await fn({ db: { query: forbidden } })).skipped, "retired");
  for (const event of [
    { top100_generate: true },
    { top100_accept: { key: "old" } },
    { issue_accept: { key: "old", kind: "card_of_week" } },
    { card_of_week_preview: true },
    { card_of_week_generate: true },
  ])
    assert.equal((await handler(event)).skipped, "retired");
});
