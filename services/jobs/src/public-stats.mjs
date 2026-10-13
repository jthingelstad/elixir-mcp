import pg from "pg";
import { calculatePublicStats } from "@elixir-mcp/tools/public-stats";

export async function publishPublicStats(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const payload = await calculatePublicStats(db);
    const { rows } = await db.query(
      `insert into public_stats_cache(cache_key, payload, updated_at)
       values (1, $1, now()) on conflict (cache_key) do update
       set payload = excluded.payload, updated_at = excluded.updated_at
       returning updated_at`,
      [JSON.stringify(payload)],
    );
    return { as_of: rows[0].updated_at.toISOString() };
  } finally {
    await db.end();
  }
}
