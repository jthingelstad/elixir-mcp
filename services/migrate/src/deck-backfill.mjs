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
 * The one-time backfill from the deck JSON (deck_backfill, deck_forms)
 * ran on 2026-09-15 (454,654 participants, 90 batches) and left with the
 * column in 0097; tests seed the rows directly (mcp/test/deck-rows.mjs).
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
export async function explainMeta(databaseUrl, spec = {}) {
  const clanTag = String(spec.clan_tag ?? "#J2RGCRVG").toUpperCase();
  const days = Math.min(90, Math.max(1, Number(spec.days ?? 28)));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = 120000");
    const out = [];
    const explain = async (name, text, values) => {
      const started = Date.now();
      const { rows } = await db.query(
        `explain (analyze, buffers, format text) ${text}`,
        values,
      );
      out.push({
        name,
        ms: Date.now() - started,
        plan: rows.map((r) => r["QUERY PLAN"]).join("\n"),
      });
    };
    const scope = `bp.player_tag in (select cm.player_tag from clan_membership cm
                     where cm.clan_tag = $1 and cm.left_observed_at is null)
                   and bp.battle_time >= $2`;
    const { DUEL_TYPES } = await import("../../mcp/src/tools/shared.mjs");
    await explain(
      "prior (window index)",
      `select count(*)::int as decided, count(*) filter (where bp.outcome = 'win')::int as wins
       from battle_participant bp
       where bp.outcome in ('win','loss') and bp.type_class = 'pvp'
         and bp.deck_hash is not null and bp.battle_time >= $1`,
      [from],
    );
    await explain(
      "excluded breakdown (clan scope, as shared.excludedBreakdown)",
      `select count(*)::int as considered,
              count(*) filter (where b.type = any($3))::int as duels,
              count(*) filter (where b.type_class = 'boat' and not (b.type = any($3)))::int as boat,
              count(*) filter (where bp.outcome = 'draw' and b.type_class = 'pvp' and not (b.type = any($3)))::int as draws,
              count(*) filter (where bp.outcome in ('win','loss') and b.type_class = 'pvp'
                                 and not (b.type = any($3)) and bp.deck_hash is null)::int as no_deck
       from battle_participant bp join battle b on b.battle_id = bp.battle_id
       where ${scope}`,
      [clanTag, from, DUEL_TYPES],
    );
    await explain(
      "deck aggregate (clan scope, no battle join)",
      `select bp.deck_hash, count(*)::int as battles,
              count(*) filter (where bp.outcome = 'win')::int as wins,
              count(distinct bp.player_tag)::int as players,
              min(bp.battle_time), max(bp.battle_time)
       from battle_participant bp
       where ${scope} and bp.deck_hash is not null
         and bp.outcome in ('win','loss') and bp.type_class = 'pvp'
       group by bp.deck_hash`,
      [clanTag, from],
    );
    await explain(
      "card aggregate (clan scope, deck-first)",
      `with pairs as (
         select bp.deck_hash, bp.player_tag, count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins
         from battle_participant bp
         where ${scope} and bp.deck_hash is not null
           and bp.outcome in ('win','loss') and bp.type_class = 'pvp'
         group by bp.deck_hash, bp.player_tag)
       select dc.card_id, c.name, dc.form, sum(p.battles)::int, count(distinct p.player_tag)::int
       from pairs p join deck_card dc on dc.deck_hash = p.deck_hash join card c on c.card_id = dc.card_id
       group by 1, 2, 3`,
      [clanTag, from],
    );
    await explain(
      "corpus card aggregate (deck-first, window index)",
      `with pairs as (
         select bp.deck_hash, bp.player_tag, count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins
         from battle_participant bp
         where bp.battle_time >= $1 and bp.deck_hash is not null
           and bp.outcome in ('win','loss') and bp.type_class = 'pvp'
         group by bp.deck_hash, bp.player_tag)
       select dc.card_id, dc.form, sum(p.battles)::int, count(distinct p.player_tag)::int
       from pairs p join deck_card dc on dc.deck_hash = p.deck_hash
       group by 1, 2`,
      [from],
    );
    // The population-table path (6.12.0): a corpus window inside the
    // running season, the card aggregate as the tool runs it, under the
    // tool's work_mem.
    const {
      rows: [running],
    } = await db.query(
      `select s.season_month from season s join meta_season_state st on st.season_month = s.season_month
        where st.pop_through is not null and not st.final
          and s.starts_at <= now() and s.ends_at > now() limit 1`,
    );
    if (running) {
      await db.query("set work_mem = '32MB'");
      await explain(
        "corpus card aggregate (population table, as battles_meta_cards)",
        `with pairs as (
           select bp.deck_hash, bp.player_tag, bp.type,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  sum(bp.level_gap) as gap_sum, count(bp.level_gap)::int as gap_n
           from meta_season_pop bp
           where bp.season_month = $1 and bp.game_day >= game_day($2::timestamptz - interval '1 day')
             and bp.battle_time >= $2
             and bp.deck_hash is not null and bp.outcome in ('win','loss') and bp.type_class = 'pvp'
           group by bp.deck_hash, bp.player_tag, bp.type),
         per_type as (
           select dc.card_id, dc.form, p.type, sum(p.battles)::int as battles, sum(p.wins)::int as wins,
                  sum(p.gap_sum) as gap_sum, sum(p.gap_n)::int as gap_n
           from pairs p join deck_card dc on dc.deck_hash = p.deck_hash
           group by dc.card_id, dc.form, p.type),
         per_card as (
           select dc.card_id, dc.form, count(distinct p.player_tag)::int as players
           from pairs p join deck_card dc on dc.deck_hash = p.deck_hash
           group by dc.card_id, dc.form)
         select pt.card_id, pt.form, sum(pt.battles)::int, pc.players
         from per_type pt join per_card pc on pc.card_id = pt.card_id and pc.form = pt.form
         group by pt.card_id, pt.form, pc.players`,
        [running.season_month, from],
      );
      await explain(
        "corpus deck aggregate (population table, as battles_meta_decks)",
        `with d as (
           select bp.deck_hash, bp.type, bp.player_tag, count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  sum(bp.level_gap) as gap_sum, count(bp.level_gap)::int as gap_n
           from meta_season_pop bp
           where bp.season_month = $1 and bp.game_day >= game_day($2::timestamptz - interval '1 day')
             and bp.battle_time >= $2
             and bp.deck_hash is not null and bp.outcome in ('win','loss') and bp.type_class = 'pvp'
           group by bp.deck_hash, bp.type, bp.player_tag),
         w as (select sum(battles) as decided, count(distinct player_tag) as players from d),
         dp as (select deck_hash, count(distinct player_tag)::int as deck_players from d group by deck_hash having sum(battles) >= 5)
         select d.deck_hash, d.type, sum(d.battles)::int, count(distinct d.player_tag)::int, dp.deck_players, w.players
         from d join dp on dp.deck_hash = d.deck_hash cross join w
         group by d.deck_hash, d.type, dp.deck_players, w.players`,
        [running.season_month, from],
      );
    }
    return { clan_tag: clanTag, days, explains: out };
  } finally {
    await db.end();
  }
}

/** {terminate_backends: {like?: "%battle_participant%", older_than_s?: 120}}
 *  Terminate THIS user's own backends whose current query matches and has
 *  run longer than the threshold - the orphan a killed migrate Lambda
 *  leaves behind, still holding its locks (2026-09-15 07:00 CDT: 0099's
 *  unbatched backfill outlived the 300 s ceiling and every connection
 *  queued behind its ACCESS EXCLUSIVE lock until the pool was gone).
 *  pg_terminate_backend on one's own backends needs no superuser. */
export async function terminateBackends(databaseUrl, spec = {}) {
  const like = String(spec.like ?? "%battle_participant%");
  const olderThan = Math.max(30, Number(spec.older_than_s ?? 120));
  let lastErr = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const db = new pg.Client({ connectionString: databaseUrl });
    try {
      await db.connect();
      const { rows } = await db.query(
        `select pid, state, now() - query_start as running, left(query, 80) as query,
                pg_terminate_backend(pid) as terminated
         from pg_stat_activity
         where usename = current_user and pid <> pg_backend_pid()
           and query ilike $1
           and query_start < now() - make_interval(secs => $2)`,
        [like, olderThan],
      );
      return { attempt, terminated: rows };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      await db.end().catch(() => {});
    }
  }
  throw lastErr;
}

/** {backends: true} - read-only: what this user's connections are doing. */
export async function listBackends(databaseUrl) {
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
         order by query_start nulls last`,
      );
      const {
        rows: [limits],
      } = await db.query(
        `select current_setting('max_connections')::int as max_connections,
                (select count(*)::int from pg_stat_activity) as connections`,
      );
      return { attempt, ...limits, backends: rows };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      await db.end().catch(() => {});
    }
  }
  throw lastErr;
}

/** {type_backfill: {batch?: 10000}} - fill battle_participant.type (0099)
 *  from battle in keyset batches by primary key, each its own short
 *  transaction; rerunnable; returns done when no null remains. */
export async function typeBackfill(databaseUrl, spec = {}) {
  const batch = Math.min(Math.max(Number(spec?.batch ?? 10000), 100), 50000);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  try {
    const { rowCount } = await db.query(
      `with todo as (
         select bp.battle_id, bp.player_tag
         from battle_participant bp
         where bp.type is null
         order by bp.battle_id, bp.player_tag
         limit $1)
       update battle_participant bp
          set type = b.type
         from todo join battle b on b.battle_id = todo.battle_id
        where bp.battle_id = todo.battle_id and bp.player_tag = todo.player_tag`,
      [batch],
    );
    const {
      rows: [{ remaining }],
    } = await db.query(
      `select count(*)::int as remaining from battle_participant where type is null`,
    );
    return {
      updated: rowCount,
      remaining,
      done: remaining === 0,
      ms: Date.now() - started,
    };
  } finally {
    await db.end();
  }
}

/** {tower_hp_backfill: {after?: [battle_id, player_tag], batch?: 10000}}
 *  - fill the three tower columns (0123) from tower_hp, one keyset batch
 *  per call in its own short transaction (the 0099 shape). Returns the
 *  last key filled; the caller passes it back as `after` until `done`.
 *  {tower_hp_backfill: {census: true}} counts instead: rows with JSON,
 *  rows with columns, and the princess-array shapes the JSON holds. */
export async function towerHpBackfill(databaseUrl, spec = {}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  try {
    if (spec.census) {
      const {
        rows: [r],
      } = await db.query(
        `select count(*) filter (where tower_hp is not null)::int as with_json,
                count(*) filter (where king_tower_hp is not null or princess_tower_hp_1 is not null)::int as with_columns,
                count(*) filter (where tower_hp is not null and king_tower_hp is null
                                   and princess_tower_hp_1 is null)::int as json_without_columns,
                count(*) filter (where jsonb_typeof(tower_hp->'princess') = 'array'
                                   and jsonb_array_length(tower_hp->'princess') = 0)::int as princess_empty,
                count(*) filter (where jsonb_typeof(tower_hp->'princess') = 'array'
                                   and jsonb_array_length(tower_hp->'princess') = 1)::int as princess_one,
                count(*) filter (where jsonb_typeof(tower_hp->'princess') = 'array'
                                   and jsonb_array_length(tower_hp->'princess') > 2)::int as princess_many,
                count(*) filter (where tower_hp is not null and tower_hp ? 'king' = false)::int as no_king,
                count(*) filter (where tower_hp is not null and tower_hp ? 'princess' = false)::int as no_princess
         from battle_participant`,
      );
      return { ...r, ms: Date.now() - started };
    }
    const batch = Math.min(Math.max(Number(spec.batch ?? 10000), 100), 50000);
    const after = Array.isArray(spec.after) ? spec.after : ["", ""];
    const { rows } = await db.query(
      `with todo as (
         select bp.battle_id, bp.player_tag
         from battle_participant bp
         where (bp.battle_id, bp.player_tag) > ($1, $2)
         order by bp.battle_id, bp.player_tag
         limit $3),
       done as (
         update battle_participant bp
            set king_tower_hp = (bp.tower_hp->>'king')::smallint,
                princess_tower_hp_1 = case when jsonb_typeof(bp.tower_hp->'princess') = 'array'
                                           then coalesce((bp.tower_hp->'princess'->>0)::smallint, 0) end,
                princess_tower_hp_2 = case when jsonb_typeof(bp.tower_hp->'princess') = 'array'
                                           then coalesce((bp.tower_hp->'princess'->>1)::smallint, 0) end
           from todo
          where bp.battle_id = todo.battle_id and bp.player_tag = todo.player_tag
            and bp.tower_hp is not null
          returning 1)
       select (select count(*)::int from todo) as scanned,
              (select count(*)::int from done) as filled,
              (select max(battle_id) from todo) as last_battle_id,
              (select player_tag from todo order by battle_id desc, player_tag desc limit 1) as last_player_tag`,
      [after[0], after[1], batch],
    );
    const r = rows[0];
    return {
      scanned: r.scanned,
      filled: r.filled,
      after: r.scanned > 0 ? [r.last_battle_id, r.last_player_tag] : after,
      done: r.scanned < batch,
      ms: Date.now() - started,
    };
  } finally {
    await db.end();
  }
}
