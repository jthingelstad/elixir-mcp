/**
 * The season meta rollups (0121; schema review 2.1-2.3).
 *
 * Two entry points, both from EventBridge through the jobs handler:
 *
 *  - metaRollupNightly: a full rebuild of the running season, then any
 *    ended season that has battles but no final rollup yet (so the
 *    backfill of past seasons is the job's first few nights, not an
 *    operator's invocation), each as ONE transaction over the raw rows.
 *    This is the only writer of `players` (a distinct count never
 *    sums) and of `final`. There is no pair rollup (0122): the pair
 *    aggregation was 25M rows on the micro; cards_synergy walks the
 *    anchor's decks instead. Bounded by a wall-clock
 *    budget; what it does not reach tonight it reaches tomorrow.
 *  - metaRollupHourly: the counters (battles, wins, losses, the totals)
 *    for the running season, incremented from the battles created since
 *    the season's cursor, up to five minutes ago so an ingest transaction
 *    still open at the read is not skipped for good. Sums are exact;
 *    `players` on a deck or card first seen since last night is null
 *    until the rebuild. Best effort until midnight, exact after it: a
 *    battle whose created_at predates the cursor but whose commit
 *    followed the rebuild's read is caught by the next rebuild.
 *
 * The population is the meta tools' own (shared.mjs excludedBreakdown /
 * corpusPrior): a participant is considered when it falls in the season
 * and mode; decided when it is pvp, head-to-head (a deck) and won or
 * lost. 'all' rows hold every mode; card form -1 holds every form.
 * mode_group is data (MODE_GROUP_BY_TYPE), as in rollups.mjs.
 */

import pg from "pg";
import { MODE_GROUP_BY_TYPE } from "@elixir-mcp/contracts";

const DUEL_TYPES = ["riverRaceDuel", "riverRaceDuelColosseum"];
const MODE_GROUP_CASE = `case bp.type ${Object.entries(MODE_GROUP_BY_TYPE)
  .map(([t, g]) => `when '${t}' then '${g}'`)
  .join(" ")} else 'casual' end`;

/** The participant's own trophy band at battle time (0135), the five
 *  bands battles_levels speaks; null without starting trophies. */
const TROPHY_BAND_CASE = `case
  when bp.starting_trophies is null then null
  when bp.starting_trophies < 5000 then 'under_5000'
  when bp.starting_trophies < 8000 then '5000_8000'
  when bp.starting_trophies < 11000 then '8000_11000'
  when bp.starting_trophies < 13000 then '11000_13000'
  else '13000_plus' end`;

/** The population temp table: one row per participant in the season (or
 *  the increment's slice), with its mode group, trophy band and the
 *  level gap against the opposing side (both sides of a battle share
 *  its battle_time, so both are in the slice and the gap is a self
 *  join, never a probe per row). The opposing side's level is joined
 *  as a hashed, pre-aggregated set: the first shape (3.16.0) was a
 *  LATERAL over a once-referenced CTE, which the planner inlines, so
 *  every participant row re-grouped the whole season and the first
 *  nightly on the live corpus ran past the Lambda's 900 s (2026-09-18
 *  19:40Z, rolled back; the 3.15.1 rebuild took 93 s). */
function popSql(fromWhere) {
  return `create temp table pop on commit drop as
     with rows as materialized (
       select bp.battle_id, bp.side, bp.player_tag, bp.deck_hash, bp.outcome, bp.battle_time,
              bp.type, bp.type_class, bp.deck_avg_level,
              ${MODE_GROUP_CASE} as mode_group,
              ${TROPHY_BAND_CASE} as trophy_band
       ${fromWhere}),
     sides as materialized (
       select battle_id, side, avg(deck_avg_level) as lvl from rows group by battle_id, side),
     opposing as materialized (
       select s.battle_id, s.side, avg(o.lvl) as lvl
       from sides s join sides o on o.battle_id = s.battle_id and o.side <> s.side
       group by s.battle_id, s.side)
     select r.player_tag, r.deck_hash, r.outcome, r.battle_time, r.type, r.type_class,
            r.mode_group, r.trophy_band,
            case when r.deck_avg_level is not null and o.lvl is not null
                 then r.deck_avg_level - o.lvl end as level_gap
     from rows r
     left join opposing o on o.battle_id = r.battle_id and o.side = r.side`;
}

/** How far behind now() the hourly increment reads, so an ingest
 *  transaction open at the read is not passed over. */
export const INCREMENT_LAG_MS = 5 * 60_000;
/** The nightly run stops STARTING past seasons after this; the Lambda
 *  has 900 s, so one full-month season begun at the budget still fits. */
const NIGHTLY_BUDGET_MS = 300_000;

/** The aggregate statements, shared by the rebuild (into empty rows)
 *  and the increment (added onto existing ones). `pop` must exist. */
function aggregateSql(month, { withPlayers, withBands = true }) {
  const players = withPlayers ? "count(distinct player_tag)::int" : "null";
  return {
    withBands,
    totals: `insert into meta_season_totals
       (season_month, mode_group, considered, duels, boat, draws, unresolved, no_deck, decided, wins)
     select '${month}', m.mode_group,
            count(*)::int,
            count(*) filter (where pop.type = any($1))::int,
            count(*) filter (where pop.type_class = 'boat' and not pop.type = any($1))::int,
            count(*) filter (where pop.outcome = 'draw' and pop.type_class = 'pvp' and not pop.type = any($1))::int,
            count(*) filter (where (pop.outcome is null or pop.outcome = 'unresolved')
                               and pop.type_class = 'pvp' and not pop.type = any($1))::int,
            count(*) filter (where pop.outcome in ('win','loss') and pop.type_class = 'pvp'
                               and not pop.type = any($1) and pop.deck_hash is null)::int,
            count(*) filter (where pop.outcome in ('win','loss') and pop.type_class = 'pvp'
                               and pop.deck_hash is not null)::int,
            count(*) filter (where pop.outcome = 'win' and pop.type_class = 'pvp'
                               and pop.deck_hash is not null)::int
     from pop cross join lateral (values (pop.mode_group), ('all')) m(mode_group)
     group by m.mode_group
     on conflict (season_month, mode_group) do update set
       considered = meta_season_totals.considered + excluded.considered,
       duels = meta_season_totals.duels + excluded.duels,
       boat = meta_season_totals.boat + excluded.boat,
       draws = meta_season_totals.draws + excluded.draws,
       unresolved = meta_season_totals.unresolved + excluded.unresolved,
       no_deck = meta_season_totals.no_deck + excluded.no_deck,
       decided = meta_season_totals.decided + excluded.decided,
       wins = meta_season_totals.wins + excluded.wins`,
    decided: `create temp table dec on commit drop as
     select m.mode_group, pop.deck_hash, pop.player_tag, pop.outcome, pop.battle_time,
            pop.trophy_band, pop.level_gap
     from pop cross join lateral (values (pop.mode_group), ('all')) m(mode_group)
     where pop.type_class = 'pvp' and pop.deck_hash is not null
       and pop.outcome in ('win', 'loss')`,
    // level_gap_sum / level_gap_battles (0135): null + x stays null on a
    // row the rebuild has not yet filled, so a reader never serves a
    // gap that covers a few hours as the season's.
    decks: `insert into deck_meta_season
       (season_month, mode_group, deck_hash, battles, wins, losses, players, first_used, last_used,
        level_gap_sum, level_gap_battles)
     select '${month}', mode_group, deck_hash,
            count(*)::int,
            count(*) filter (where outcome = 'win')::int,
            count(*) filter (where outcome = 'loss')::int,
            ${players},
            min(battle_time), max(battle_time),
            sum(level_gap), count(level_gap)::int
     from dec
     group by mode_group, deck_hash
     on conflict (season_month, mode_group, deck_hash) do update set
       battles = deck_meta_season.battles + excluded.battles,
       wins = deck_meta_season.wins + excluded.wins,
       losses = deck_meta_season.losses + excluded.losses,
       first_used = least(deck_meta_season.first_used, excluded.first_used),
       last_used = greatest(deck_meta_season.last_used, excluded.last_used),
       level_gap_sum = deck_meta_season.level_gap_sum + excluded.level_gap_sum,
       level_gap_battles = deck_meta_season.level_gap_battles + excluded.level_gap_battles`,
    // (deck, player) pairs first, as the card meta tool does: one row per
    // card per deck from deck_card, never one probe per participant.
    deckPlayers: `create temp table dp on commit drop as
     select mode_group, deck_hash, player_tag,
            count(*)::int as battles,
            count(*) filter (where outcome = 'win')::int as wins,
            sum(level_gap) as gap_sum, count(level_gap)::int as gap_n
     from dec group by mode_group, deck_hash, player_tag`,
    cards: `insert into card_meta_season
       (season_month, mode_group, card_id, form, battles, wins, losses, players,
        level_gap_sum, level_gap_battles)
     select '${month}', dp.mode_group, dc.card_id, f.form,
            sum(dp.battles)::int, sum(dp.wins)::int, sum(dp.battles - dp.wins)::int,
            ${withPlayers ? "count(distinct dp.player_tag)::int" : "null"},
            sum(dp.gap_sum), sum(dp.gap_n)::int
     from dp
     join deck_card dc on dc.deck_hash = dp.deck_hash
     cross join lateral (values (dc.form::smallint), (-1::smallint)) f(form)
     group by dp.mode_group, dc.card_id, f.form
     on conflict (season_month, mode_group, card_id, form) do update set
       battles = card_meta_season.battles + excluded.battles,
       wins = card_meta_season.wins + excluded.wins,
       losses = card_meta_season.losses + excluded.losses,
       level_gap_sum = card_meta_season.level_gap_sum + excluded.level_gap_sum,
       level_gap_battles = card_meta_season.level_gap_battles + excluded.level_gap_battles`,
    // The band tables (0135): the same three shapes keyed by the
    // participant's own trophy band, decided rows with a band only.
    bandTotals: `insert into meta_season_band_totals
       (season_month, mode_group, trophy_band, decided, wins, players)
     select '${month}', mode_group, trophy_band,
            count(*)::int, count(*) filter (where outcome = 'win')::int, ${players}
     from dec where trophy_band is not null
     group by mode_group, trophy_band
     on conflict (season_month, mode_group, trophy_band) do update set
       decided = meta_season_band_totals.decided + excluded.decided,
       wins = meta_season_band_totals.wins + excluded.wins`,
    // The decided players per mode (product call 5): nightly only.
    totalPlayers: withPlayers
      ? `update meta_season_totals t set players = d.n
         from (select mode_group, count(distinct player_tag)::int as n from dec group by mode_group) d
         where t.season_month = '${month}' and t.mode_group = d.mode_group`
      : null,
    bandDecks: `insert into deck_meta_season_band
       (season_month, mode_group, trophy_band, deck_hash, battles, wins, losses, players,
        first_used, last_used, level_gap_sum, level_gap_battles)
     select '${month}', mode_group, trophy_band, deck_hash,
            count(*)::int,
            count(*) filter (where outcome = 'win')::int,
            count(*) filter (where outcome = 'loss')::int,
            ${players},
            min(battle_time), max(battle_time),
            sum(level_gap), count(level_gap)::int
     from dec where trophy_band is not null
     group by mode_group, trophy_band, deck_hash
     on conflict (season_month, mode_group, trophy_band, deck_hash) do update set
       battles = deck_meta_season_band.battles + excluded.battles,
       wins = deck_meta_season_band.wins + excluded.wins,
       losses = deck_meta_season_band.losses + excluded.losses,
       first_used = least(deck_meta_season_band.first_used, excluded.first_used),
       last_used = greatest(deck_meta_season_band.last_used, excluded.last_used),
       level_gap_sum = deck_meta_season_band.level_gap_sum + excluded.level_gap_sum,
       level_gap_battles = deck_meta_season_band.level_gap_battles + excluded.level_gap_battles`,
    bandDeckPlayers: `create temp table dpb on commit drop as
     select mode_group, trophy_band, deck_hash, player_tag,
            count(*)::int as battles,
            count(*) filter (where outcome = 'win')::int as wins,
            sum(level_gap) as gap_sum, count(level_gap)::int as gap_n
     from dec where trophy_band is not null
     group by mode_group, trophy_band, deck_hash, player_tag`,
    bandCards: `insert into card_meta_season_band
       (season_month, mode_group, trophy_band, card_id, form, battles, wins, losses, players,
        level_gap_sum, level_gap_battles)
     select '${month}', dp.mode_group, dp.trophy_band, dc.card_id, f.form,
            sum(dp.battles)::int, sum(dp.wins)::int, sum(dp.battles - dp.wins)::int,
            ${withPlayers ? "count(distinct dp.player_tag)::int" : "null"},
            sum(dp.gap_sum), sum(dp.gap_n)::int
     from dpb dp
     join deck_card dc on dc.deck_hash = dp.deck_hash
     cross join lateral (values (dc.form::smallint), (-1::smallint)) f(form)
     group by dp.mode_group, dp.trophy_band, dc.card_id, f.form
     on conflict (season_month, mode_group, trophy_band, card_id, form) do update set
       battles = card_meta_season_band.battles + excluded.battles,
       wins = card_meta_season_band.wins + excluded.wins,
       losses = card_meta_season_band.losses + excluded.losses,
       level_gap_sum = card_meta_season_band.level_gap_sum + excluded.level_gap_sum,
       level_gap_battles = card_meta_season_band.level_gap_battles + excluded.level_gap_battles`,
  };
}

/** Run the aggregate statements in order over an existing `pop`. Returns
 *  each statement's milliseconds, so the nightly's log line says where a
 *  season's rebuild spends its budget (the first 3.16.0 rebuild on the
 *  live corpus took 603 s against 3.15.1's 93 s, and a total says
 *  nothing about which of the new statements did it). */
async function runAggregates(db, sql) {
  const phases = {};
  const timed = async (name, text, params) => {
    const t = Date.now();
    await db.query(text, params);
    phases[name] = Date.now() - t;
  };
  await timed("totals", sql.totals, [DUEL_TYPES]);
  await timed("decided", sql.decided);
  await timed("decks", sql.decks);
  await timed("deck_players", sql.deckPlayers);
  await timed("cards", sql.cards);
  if (sql.totalPlayers) await timed("total_players", sql.totalPlayers);
  if (sql.withBands) {
    await timed("band_totals", sql.bandTotals);
    await timed("band_decks", sql.bandDecks);
    await timed("band_deck_players", sql.bandDeckPlayers);
    await timed("band_cards", sql.bandCards);
  }
  return phases;
}

/** One season, rebuilt from the raw rows in one transaction. */
export async function rebuildSeason(db, season, { final = false } = {}) {
  const month = season.season_month;
  const t0 = Date.now();
  await db.query("begin");
  try {
    // The meta queries spill at the micro's 4 MB work_mem (review 2.6);
    // this connection is the job's own.
    await db.query("set local work_mem = '64MB'");
    const {
      rows: [{ cursor }],
    } = await db.query("select now() as cursor");
    const tPop = Date.now();
    await db.query(
      popSql(`from battle_participant bp
       where bp.battle_time >= $1 and bp.battle_time < $2`),
      [season.starts_at, season.ends_at],
    );
    const phases = { pop: Date.now() - tPop };
    for (const table of [
      "meta_season_totals",
      "deck_meta_season",
      "card_meta_season",
      "meta_season_band_totals",
      "deck_meta_season_band",
      "card_meta_season_band",
    ])
      await db.query(`delete from ${table} where season_month = $1`, [month]);
    const sql = aggregateSql(month, { withPlayers: true });
    Object.assign(phases, await runAggregates(db, sql));
    const {
      rows: [counts],
    } = await db.query(
      `select (select count(*)::int from deck_meta_season where season_month = $1) as decks,
              (select count(*)::int from card_meta_season where season_month = $1) as cards,
              (select decided from meta_season_totals where season_month = $1 and mode_group = 'all') as decided`,
      [month],
    );
    await db.query(
      `insert into meta_season_state (season_month, counters_through, rebuilt_at, final, bands_rebuilt_at)
       values ($1, $2, $2, $3, $2)
       on conflict (season_month) do update set
         counters_through = excluded.counters_through,
         rebuilt_at = excluded.rebuilt_at,
         final = excluded.final,
         bands_rebuilt_at = excluded.bands_rebuilt_at`,
      [month, cursor, final],
    );
    await db.query("commit");
    return {
      season_month: month,
      final,
      ms: Date.now() - t0,
      phases,
      ...counts,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/** The running season and every ended season with battles but no final
 *  rollup, oldest first, within the budget. */
export async function metaRollupNightly(
  databaseUrl,
  { budgetMs = NIGHTLY_BUDGET_MS, nowMs = Date.now() } = {},
) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  const done = [];
  try {
    const { rows: current } = await db.query(
      `select season_month, starts_at, ends_at from season
       where starts_at <= $1 and ends_at > $1`,
      [new Date(nowMs)],
    );
    if (current[0]) done.push(await rebuildSeason(db, current[0]));
    // Ended a day ago or more, holding battles, not yet final. Oldest
    // first so a from-scratch install fills history in order.
    const { rows: pending } = await db.query(
      `select s.season_month, s.starts_at, s.ends_at
       from season s
       left join meta_season_state st on st.season_month = s.season_month
       where s.ends_at <= $1::timestamptz - interval '1 day'
         and coalesce(st.final, false) = false
         and exists (select 1 from battle_participant bp
                     where bp.battle_time >= s.starts_at and bp.battle_time < s.ends_at)
       order by s.starts_at`,
      [new Date(nowMs)],
    );
    let skipped = 0;
    for (const season of pending) {
      if (Date.now() - started > budgetMs) {
        skipped += 1;
        continue;
      }
      done.push(await rebuildSeason(db, season, { final: true }));
    }
    return { rebuilt: done, pending_after: skipped, ms: Date.now() - started };
  } finally {
    await db.end();
  }
}

/** One EMF line for the war-calendar guard (ElixirMCP/Record
 *  WarBattleUnresolved): a war-typed battle in the last seven days that
 *  falls in no war_period row. The calendar is generated with each
 *  season by the scheduler's tick, so a non-zero count means that upsert
 *  failed and the war readers are blind to those battles; the alarm in
 *  infra/template.yaml fires at 1. The scheduler's metrics.mjs shape:
 *  stdout, one JSON object, no network. */
export function warUnresolvedEmf(count, now = Date.now()) {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: "ElixirMCP/Record",
          Dimensions: [[]],
          Metrics: [{ Name: "WarBattleUnresolved", Unit: "Count" }],
        },
      ],
    },
    WarBattleUnresolved: count,
  });
}

/** The count behind the guard: the diagnostics probe's UNRESOLVED
 *  bucket, over seven days of war-typed rows through the time index. */
export async function warBattlesUnresolved(db) {
  const {
    rows: [r],
  } = await db.query(
    `select count(*)::int as n
     from battle b
     where (b.type like 'riverRace%' or b.type = 'boatBattle')
       and b.battle_time > now() - interval '7 days'
       and not exists (select 1 from war_period p
                       where b.battle_time >= p.starts_at and b.battle_time < p.ends_at)`,
  );
  return r.n;
}

/** The counters for the running season, from battles created since
 *  the cursor. Nothing until the first nightly rebuild has run. The
 *  war-calendar guard rides this hourly run: one count, one EMF line. */
export async function metaRollupHourly(
  databaseUrl,
  {
    nowMs = Date.now(),
    emitMetrics = (line) => process.stdout.write(line),
  } = {},
) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const t0 = Date.now();
  try {
    const unresolved = await warBattlesUnresolved(db);
    emitMetrics(`${warUnresolvedEmf(unresolved)}\n`);
    const { rows } = await db.query(
      `select s.season_month, s.starts_at, s.ends_at, st.counters_through, st.bands_rebuilt_at
       from season s join meta_season_state st on st.season_month = s.season_month
       where s.starts_at <= $1 and s.ends_at > $1 and not st.final`,
      [new Date(nowMs)],
    );
    const season = rows[0];
    if (!season)
      return {
        season_month: null,
        battles: 0,
        reason: "no_rollup_yet",
        war_unresolved: unresolved,
      };
    const upto = new Date(nowMs - INCREMENT_LAG_MS);
    if (upto <= season.counters_through)
      return {
        season_month: season.season_month,
        battles: 0,
        reason: "cursor_ahead",
        war_unresolved: unresolved,
      };
    await db.query("begin");
    try {
      await db.query("set local work_mem = '64MB'");
      const { rowCount } = await db.query(
        popSql(`from battle b
         join battle_participant bp on bp.battle_id = b.battle_id
         where b.created_at > $1 and b.created_at <= $2
           and bp.battle_time >= $3 and bp.battle_time < $4`),
        [season.counters_through, upto, season.starts_at, season.ends_at],
      );
      // The band tables take increments only once a rebuild has filled
      // them (0135): a few hours' rows must never read as a season.
      const sql = aggregateSql(season.season_month, {
        withPlayers: false,
        withBands: season.bands_rebuilt_at !== null,
      });
      if (rowCount > 0) await runAggregates(db, sql);
      await db.query(
        `update meta_season_state set counters_through = $2 where season_month = $1`,
        [season.season_month, upto],
      );
      await db.query("commit");
      return {
        season_month: season.season_month,
        battles: rowCount,
        war_unresolved: unresolved,
        ms: Date.now() - t0,
      };
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    }
  } finally {
    await db.end();
  }
}
