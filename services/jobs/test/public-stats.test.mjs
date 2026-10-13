import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { publishPublicStats } from "../src/public-stats.mjs";
import { readPublicStats } from "@elixir-mcp/tools/public-stats";

test("the public projection preserves the counts, replaces atomically and falls back when stale", async () => {
  const scratch = await scratchDb("public_stats_web");
  try {
    const direct = await readPublicStats(scratch.db);
    await publishPublicStats(scratch.url);
    const snapshot = await readPublicStats(scratch.db);
    assert.deepEqual(snapshot.totals, direct.totals);
    assert.deepEqual(snapshot.series, direct.series);
    assert.ok(snapshot.as_of);
    await publishPublicStats(scratch.url);
    assert.equal(
      (
        await scratch.db.query(
          "select count(*)::int as n from public_stats_cache",
        )
      ).rows[0].n,
      1,
    );
    await scratch.db.query(
      "update public_stats_cache set payload = '{\"fictional_stale\":true}', updated_at = now() - interval '3 hours'",
    );
    assert.equal(
      (await readPublicStats(scratch.db)).fictional_stale,
      undefined,
    );
  } finally {
    await scratch.drop();
  }
});
