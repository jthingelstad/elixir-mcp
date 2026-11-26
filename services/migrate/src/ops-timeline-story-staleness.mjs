/**
 * How fresh the stored Timeline is ({timeline_story_staleness}; stage 2,
 * 2026-11-23): counts only, never a tag. Reads only, in a read-only
 * transaction (storyStaleness, packages/tools/src/activity/story-store.mjs).
 *
 *   {timeline_story_staleness: true}                 the answer
 *   {timeline_story_staleness: {budget_ms: 45000}}   time for the news
 *                                                    probes (1000 to 60000)
 *
 * The answer: `{players_recorded, players_with_rows, players_written,
 * players_unwritten, players_stale, oldest_gap_s, oldest_write_s,
 * open_quiet, build_ms_avg, build_ms_max, probed, complete, clans, ms}`.
 * `players_stale` counts the written players whose record learned
 * something after their write; `oldest_gap_s` is the longest of those
 * gaps, in seconds (null when none). Probes run oldest write first, and
 * `complete: false` says the budget stopped them. `clans` (stage 5,
 * 2026-11-26) answers the same for the clans some Timeline reads:
 * `{set, written, unwritten, stale, oldest_write_s, build_ms_avg,
 * build_ms_max, probed, complete}`.
 */
import pg from "pg";
import { storyStaleness } from "@elixir-mcp/tools/activity/story-store";

/** The request, checked, or why it is refused. */
export function readStalenessSpec(spec) {
  const s = spec === true ? {} : spec;
  if (!s || typeof s !== "object" || Array.isArray(s))
    return { error: "timeline_story_staleness takes true or an object" };
  const unknown = Object.keys(s).filter((k) => k !== "budget_ms");
  if (unknown.length) return { error: "unknown_keys", keys: unknown };
  const budget = s.budget_ms ?? 45_000;
  if (!Number.isSafeInteger(budget) || budget < 1000 || budget > 60_000)
    return { error: "budget_ms must be 1000 to 60000" };
  return { budgetMs: budget };
}

/** The answer on an open connection, inside a read-only transaction. */
export async function timelineStoryStaleness(db, spec, { now } = {}) {
  await db.query("begin transaction read only");
  try {
    const out = await storyStaleness(db, {
      budgetMs: spec.budgetMs,
      ...(now === undefined ? {} : { now }),
    });
    await db.query("commit");
    return out;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

export async function timelineStoryStalenessOp(databaseUrl, raw) {
  const spec = readStalenessSpec(raw);
  if (spec.error) return spec;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = '30s'");
    return await timelineStoryStaleness(db, spec);
  } finally {
    await db.end();
  }
}
