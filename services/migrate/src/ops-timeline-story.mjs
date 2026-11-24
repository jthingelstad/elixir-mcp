/**
 * The stored Timeline's backfill ({timeline_story_backfill}, 0314; stage 1,
 * 2026-11-23): every recorded player's stories over the last 35 days
 * (since stage 3, the tools' recorded set: RECORDED_PLAYERS_SQL),
 * written by the builder through writeSubjectStories
 * (packages/tools/src/activity/story-store.mjs), so the player page's
 * shadow has rows to compare with and real row sizes can be measured
 * before retention is settled.
 *
 *   {timeline_story_backfill: {}}                  the first batch
 *   ... {after: "<cursor>"}                         the next batch, from
 *                                                   the `after` the last
 *                                                   one answered
 *   ... {limit: 100, budget_ms: 45000}              players per batch (at
 *                                                   most 1000), time per
 *                                                   batch (at most 60000)
 *
 * Players are taken in the order of md5(player_tag), so the cursor is
 * that digest: no tag is ever in the answer or the log. Each player is
 * one build and one short transaction (an upsert of what changed, a
 * delete of what the build no longer tells inside the span). Safe to run
 * again: a second pass over an unchanged record writes nothing. A player
 * whose build fails is counted in `failed`, and the cursor moves past it.
 * Never beside a deploy (migrate has reserved concurrency 1): run it
 * through `npm run op:batch`.
 *
 * The answer: `{players, stories, written, deleted, failed, after, done,
 * remaining, ms, size}`; `size` is the table's bytes now (total, heap,
 * indexes, TOAST) and, in the batch that answers `done`, its rows and
 * the average stored item's bytes. That batch also vacuums the table.
 */
import pg from "pg";
import {
  storySpan,
  writeSubjectStories,
} from "@elixir-mcp/tools/activity/story-store";
import { RECORDED_PLAYERS_SQL } from "@elixir-mcp/tools/recorded-players";
import { vacuumAnalyze } from "./vacuum.mjs";

const KEYS = new Set(["after", "limit", "budget_ms"]);
const CURSOR = /^[0-9a-f]{32}$/;

/** The request, checked, or why it is refused. */
export function readSpec(spec) {
  const s = spec === true ? {} : spec;
  if (!s || typeof s !== "object" || Array.isArray(s))
    return { error: "timeline_story_backfill takes an object" };
  const unknown = Object.keys(s).filter((k) => !KEYS.has(k));
  if (unknown.length) return { error: "unknown_keys", keys: unknown };
  if (s.after != null && !(typeof s.after === "string" && CURSOR.test(s.after)))
    return { error: "after must be the cursor a batch answered" };
  const limit = s.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    return { error: "limit must be 1 to 1000" };
  const budget = s.budget_ms ?? 45_000;
  if (!Number.isSafeInteger(budget) || budget < 1000 || budget > 60_000)
    return { error: "budget_ms must be 1000 to 60000" };
  return { after: s.after ?? null, limit, budgetMs: budget };
}

/** The players the backfill is for, after the cursor: every player the
 *  record is recording (RECORDED_PLAYERS_SQL: a direct recording, or an
 *  open member of a clan recorded at comprehensive scope). */
const NEXT = `select player_tag, md5(player_tag) as cursor
  from (${RECORDED_PLAYERS_SQL}) r
  where ($1::text is null or md5(player_tag) > $1::text)
  order by md5(player_tag) limit $2::int`;

/** The table's size now; with `rows`, its row count and average item. */
async function sizeOf(db, rows = false) {
  const {
    rows: [s],
  } = await db.query(
    `select pg_total_relation_size('timeline_story')::bigint as total_bytes,
            pg_relation_size('timeline_story')::bigint as heap_bytes,
            pg_indexes_size('timeline_story')::bigint as index_bytes,
            coalesce(pg_total_relation_size(
              (select reltoastrelid from pg_class
                where oid = 'timeline_story'::regclass
                  and reltoastrelid <> 0)), 0)::bigint as toast_bytes`,
  );
  const out = {
    total_bytes: Number(s.total_bytes),
    heap_bytes: Number(s.heap_bytes),
    index_bytes: Number(s.index_bytes),
    toast_bytes: Number(s.toast_bytes),
  };
  if (rows) {
    const {
      rows: [c],
    } = await db.query(
      `select count(*)::int as rows,
              coalesce(round(avg(pg_column_size(item))), 0)::int as avg_item_bytes
         from timeline_story`,
    );
    out.rows = c.rows;
    out.avg_item_bytes = c.avg_item_bytes;
  }
  return out;
}

/** One batch on an open connection (tests call it on a scratch one). */
export async function timelineStoryBackfill(
  db,
  spec,
  { now = Date.now(), write = writeSubjectStories } = {},
) {
  const started = Date.now();
  const span = storySpan(now);
  const { rows: batch } = await db.query(NEXT, [spec.after, spec.limit]);
  const out = {
    span: {
      from: new Date(span.fromMs).toISOString(),
      to: new Date(span.toMs).toISOString(),
    },
    players: 0,
    stories: 0,
    written: 0,
    deleted: 0,
    failed: 0,
    after: spec.after,
    done: false,
    remaining: 0,
    ms: 0,
  };
  let stopped = false;
  for (const { player_tag: tag, cursor } of batch) {
    if (Date.now() - started >= spec.budgetMs) {
      stopped = true;
      break;
    }
    try {
      const r = await write(db, "player", tag, span);
      out.stories += r.stories;
      out.written += r.written;
      out.deleted += r.deleted;
    } catch (err) {
      out.failed += 1;
      // The error's class only: its message can carry a value.
      console.error(
        JSON.stringify({
          at: "timeline_story_backfill_failed",
          error: err?.code ?? err?.name ?? "error",
        }),
      );
    }
    out.players += 1;
    out.after = cursor;
  }
  const {
    rows: [left],
  } = await db.query(
    `select count(*)::int as n from (${NEXT.replace("limit $2::int", "")}) x`,
    [out.after],
  );
  out.remaining = left.n;
  out.done = !stopped && left.n === 0;
  if (out.done) {
    out.after = null;
    out.vacuumed = await vacuumAnalyze(db, "timeline_story", {
      statementMs: 30_000,
    });
  }
  out.size = await sizeOf(db, out.done);
  out.ms = Date.now() - started;
  return out;
}

export async function timelineStoryBackfillOp(databaseUrl, raw) {
  const spec = readSpec(raw);
  if (spec.error) return spec;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = '30s'");
    return await timelineStoryBackfill(db, spec);
  } finally {
    await db.end();
  }
}
