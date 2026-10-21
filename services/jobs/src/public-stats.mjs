import pg from "pg";
import { refreshPublicStats } from "@elixir-mcp/tools/public-stats";

/**
 * One refresh with every read in one snapshot, and the snapshot's instant
 * as its as_of. A migration that deletes receipts commits its ledger row
 * with the deletion; read committed let one land between the ledger read
 * and the recount, so the payload mixed instants under an as_of later
 * than either (Codex on #636). Now it is exact as of `at`, and a
 * migration after `at` is seen, ledger and deletion together, by the
 * next refresh.
 */
export async function refreshInOneSnapshot(db) {
  await db.query("begin isolation level repeatable read read only");
  try {
    const {
      rows: [{ at }],
    } = await db.query("select now() as at");
    // The last snapshot and its bookkeeping (0231): the fetch series
    // recounts only the days new receipts reached. `state` is stored
    // beside the payload and never served.
    const { rows: previous } = await db.query(
      "select payload, state from public_stats_cache where cache_key = 1",
    );
    const refreshed = await refreshPublicStats(db, previous[0] ?? null);
    await db.query("commit");
    return { at, ...refreshed };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

export async function publishPublicStats(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { at, payload, state, fetches_recounted } =
      await refreshInOneSnapshot(db);
    // A slower refresh from an older snapshot never replaces a newer one.
    const { rowCount } = await db.query(
      `insert into public_stats_cache(cache_key, payload, state, updated_at)
       values (1, $1, $2, $3) on conflict (cache_key) do update
       set payload = excluded.payload, state = excluded.state,
           updated_at = excluded.updated_at
       where public_stats_cache.updated_at <= excluded.updated_at`,
      [JSON.stringify(payload), JSON.stringify(state), at],
    );
    return {
      as_of: at.toISOString(),
      fetches_recounted,
      published: rowCount === 1,
    };
  } finally {
    await db.end();
  }
}
