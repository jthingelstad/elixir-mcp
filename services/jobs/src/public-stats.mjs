import pg from "pg";
import { refreshPublicStats } from "@elixir-mcp/tools/public-stats";

export async function publishPublicStats(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // The last snapshot and its bookkeeping (0231): the fetch series
    // recounts only the days new receipts reached. `state` is stored
    // beside the payload and never served.
    const { rows: previous } = await db.query(
      "select payload, state from public_stats_cache where cache_key = 1",
    );
    const { payload, state, fetches_recounted } = await refreshPublicStats(
      db,
      previous[0] ?? null,
    );
    const { rows } = await db.query(
      `insert into public_stats_cache(cache_key, payload, state, updated_at)
       values (1, $1, $2, now()) on conflict (cache_key) do update
       set payload = excluded.payload, state = excluded.state,
           updated_at = excluded.updated_at
       returning updated_at`,
      [JSON.stringify(payload), JSON.stringify(state)],
    );
    return { as_of: rows[0].updated_at.toISOString(), fetches_recounted };
  } finally {
    await db.end();
  }
}
