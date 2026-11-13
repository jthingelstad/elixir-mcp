import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { noteClanSize } from "../src/manage/service.mjs";

test("older count changes and tied reads cannot undo the current policy size gate", async () => {
  const ledger = createMemoryLedger();
  const t = Date.parse("2026-10-03T21:00:00Z");
  await noteClanSize(ledger, "#00UQG", 50, t);
  await noteClanSize(ledger, "#00UQG", 9, t - 1000);
  await noteClanSize(ledger, "#00UQG", 8, t);
  assert.deepEqual(await ledger.clanSize("#00UQG"), {
    members: 50,
    observed_at: new Date(t).toISOString(),
  });
  await noteClanSize(ledger, "#00UQG", 9, t + 1000);
  assert.equal((await ledger.clanSize("#00UQG")).members, 9);
  await noteClanSize(ledger, "#00UQG", null, t + 2000);
  assert.equal((await ledger.clanSize("#00UQG")).members, 9);
});

test("a newer unchanged count advances the watermark before a delayed older changed count", async () => {
  const ledger = createMemoryLedger();
  const t = Date.parse("2026-10-03T21:00:00Z");
  await noteClanSize(ledger, "#00UQG", 50, t);
  await noteClanSize(ledger, "#00UQG", 50, t + 2000);
  await noteClanSize(ledger, "#00UQG", 9, t + 1000);
  assert.deepEqual(await ledger.clanSize("#00UQG"), {
    members: 50,
    observed_at: new Date(t + 2000).toISOString(),
  });
});
