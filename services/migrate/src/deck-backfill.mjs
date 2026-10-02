/**
 * The played-card projections (0091): census and diagnostics.
 *
 *   {deck_census: true}
 *     Read-only: participants whose deck_hash has no deck row or no
 *     played rows, collection rows without a catalog card, stub cards the
 *     catalog has not yet confirmed. All zero is the gate for the closing
 *     FKs.
 *
 *   {explain_meta: {clan_tag?, days?}}
 *     EXPLAIN (ANALYZE, BUFFERS) of a clan-scoped meta call's pieces.
 *
 *   {rewrite_table: "battle_participant"}
 *     VACUUM FULL one named table - the space a dropped column (0097)
 *     held comes back only with a rewrite, and a rewrite takes an
 *     exclusive lock for its duration, so it is a deliberate op, never a
 *     migration. Collector submits block and retry meanwhile.
 *
 *   {backends: true}, {terminate_backends: {...}}
 *     What this user's connections are doing, and the lever to end one.
 *
 * The one-time backfill from the deck JSON (deck_backfill, deck_forms)
 * ran on 2026-09-15 (454,654 participants, 90 batches) and left with the
 * column in 0097; tests seed the rows directly (packages/tools/test/deck-rows.mjs).
 */

import pg from "pg";

const REWRITABLE = new Set([
  "battle_participant",
  "battle_participant_card",
  "deck_card",
]);

export async function rewriteTable(databaseUrl, spec) {
  const table = String(spec?.table ?? spec ?? "");
  if (!REWRITABLE.has(table))
    throw new Error(`rewrite_table: not one of ${[...REWRITABLE].join(", ")}`);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const size = async () =>
      (
        await db.query(
          `select pg_total_relation_size($1)::bigint as bytes, pg_relation_size($1)::bigint as heap`,
          [table],
        )
      ).rows[0];
    const before = await size();
    const started = Date.now();
    await db.query(`vacuum (full, analyze) ${table}`);
    const after = await size();
    return { table, ms: Date.now() - started, before, after };
  } finally {
    await db.end();
  }
}

export async function deckCensus(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const {
      rows: [r],
    } = await db.query(
      `select
         (select count(*)::int from battle_participant bp
           where bp.deck_hash is not null
             and not exists (select 1 from deck d where d.deck_hash = bp.deck_hash)) as participants_without_deck,
         (select count(*)::int from battle_participant bp
           where bp.deck_hash is not null
             and not exists (select 1 from battle_participant_card c
                              where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag)) as participants_without_played_rows,
         (select count(*)::int from player_card pc
           where not exists (select 1 from card c where c.card_id = pc.card_id)) as collection_rows_without_card,
         (select count(*)::int from card where catalog_seen_at is null) as stub_cards,
         (select count(*)::int from deck) as decks,
         (select count(*)::int from deck_card) as deck_cards,
         (select count(*)::int from battle_participant_card) as played_rows,
         (select count(*)::int from battle_participant where deck_hash is not null) as participants_with_deck`,
    );
    return r;
  } finally {
    await db.end();
  }
}

/** {explain_meta: {clan_tag?, days?}} - EXPLAIN (ANALYZE, BUFFERS) of the
 *  pieces a clan-scoped battles_meta_decks / battles_meta_cards call runs,
 *  on the live database, read-only. Written when 3.4.0's readers moved
 *  onto the card rows and clan meta still took 15-17 s; the plans say
 *  where, guesses did not. */

/** The least a backend's query must have run before {terminate_backends}
 *  may end it: five minutes, the incident authority's line (DECISIONS:
 *  "holding its query past five minutes (named, never `true`)"). */
const TERMINATE_FLOOR_S = 300;

/** A LIKE pattern names a query when something other than wildcards is
 *  left: `%`, `%%` or `_` would match every backend. */
function namesAQuery(like) {
  return typeof like === "string" && like.replace(/[%_\s]/g, "").length >= 4;
}

/** {terminate_backends: {like: "%<query text>%", older_than_s?: 300,
 *  application_name?: "elixir-mcp-jobs"}}
 *  Terminate THIS user's own backends whose current query matches, has
 *  run longer than the threshold, and (when given) whose application_name
 *  is the one named, or starts with it and a colon (the migrate ops name
 *  themselves `elixir-mcp-migrate:<op>`): the orphan a killed Lambda
 *  leaves behind, still holding its locks (2026-09-15 07:00 CDT: 0099's
 *  unbatched backfill outlived the 300 s ceiling and every connection
 *  queued behind its ACCESS EXCLUSIVE lock until the pool was gone).
 *  `true`, or no `like` that names a query, is refused before connecting:
 *  every service connects as the same user, so a loose pattern ends live
 *  door queries too. The threshold's floor is 300 s.
 *  pg_terminate_backend on one's own backends needs no superuser. */
export async function terminateBackends(databaseUrl, spec) {
  if (!spec || typeof spec !== "object" || !namesAQuery(spec.like))
    return {
      error: "named_query_required",
      message:
        'Name the query: {"terminate_backends": {"like": "%<query text>%", "application_name": "<from {backends}>"}}. `true` and a pattern of wildcards are refused; read {backends} first.',
    };
  const like = spec.like;
  const olderThan = Math.max(
    TERMINATE_FLOOR_S,
    Number(spec.older_than_s ?? TERMINATE_FLOOR_S) || TERMINATE_FLOOR_S,
  );
  const app =
    spec.application_name === undefined || spec.application_name === null
      ? null
      : String(spec.application_name);
  let lastErr = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const db = new pg.Client({ connectionString: databaseUrl });
    try {
      await db.connect();
      const { rows } = await db.query(
        `select pid, application_name, state, now() - query_start as running,
                left(query, 80) as query, pg_terminate_backend(pid) as terminated
         from pg_stat_activity
         where usename = current_user and pid <> pg_backend_pid()
           and query ilike $1
           and query_start < now() - make_interval(secs => $2)
           and ($3::text is null or application_name = $3
                or starts_with(application_name, $3 || ':'))`,
        [like, olderThan, app],
      );
      return {
        attempt,
        like,
        older_than_s: olderThan,
        application_name: app,
        terminated: rows,
      };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      await db.end().catch(() => {});
    }
  }
  throw lastErr;
}

/** {backends: true} or {backends: {application_name: "elixir-mcp-jobs"}}
 *  - read-only: what every connection is doing, grouped by
 *  application_name (each function names its connections: PGAPPNAME in
 *  infra/template.yaml, and `elixir-mcp-migrate:<op>` per op), then each
 *  backend, optionally only those whose application_name is the one named
 *  or starts with it and a colon. `as` is the name this op's own
 *  connection carried. */
export async function listBackends(databaseUrl, spec = {}) {
  const app =
    spec?.application_name === undefined || spec?.application_name === null
      ? null
      : String(spec.application_name);
  let lastErr = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const db = new pg.Client({ connectionString: databaseUrl });
    try {
      await db.connect();
      const { rows } = await db.query(
        `select pid, usename, application_name, state, wait_event_type, wait_event,
                to_char(now() - coalesce(query_start, backend_start), 'HH24:MI:SS') as age,
                left(regexp_replace(query, '\\s+', ' ', 'g'), 100) as query
         from pg_stat_activity
         where datname = current_database() and pid <> pg_backend_pid()
           and ($1::text is null or application_name = $1
                or starts_with(application_name, $1 || ':'))
         order by application_name, query_start nulls last`,
        [app],
      );
      const byApplication = {};
      for (const r of rows) {
        const key = r.application_name || "(unnamed)";
        const g = (byApplication[key] ??= { backends: 0, active: 0 });
        g.backends += 1;
        if (r.state === "active") g.active += 1;
        if (r.state === "idle in transaction")
          g.idle_in_transaction = (g.idle_in_transaction ?? 0) + 1;
      }
      const {
        rows: [limits],
      } = await db.query(
        `select current_setting('max_connections')::int as max_connections,
                (select count(*)::int from pg_stat_activity) as connections,
                current_setting('application_name') as as`,
      );
      return {
        attempt,
        ...limits,
        application_name: app,
        by_application: byApplication,
        backends: rows,
      };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      await db.end().catch(() => {});
    }
  }
  throw lastErr;
}
