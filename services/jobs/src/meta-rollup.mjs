/**
 * The season meta rollups (0121; schema review 2.1-2.3).
 *
 * Two entry points, both from EventBridge through the jobs handler:
 *
 *  - metaRollupNightly: the running season rebuilt from its persisted
 *    population (0140: meta_season_pop, one row per participant, built
 *    by game day and appended to, never re-derived whole), then any
 *    ended season that has battles but no final rollup yet (so the
 *    backfill of past seasons is the job's first few nights, not an
 *    operator's invocation). The aggregates are ONE transaction over
 *    the population table. This is the only writer of `players` (a
 *    distinct count never sums) and of `final`. There is no pair rollup
 *    (0122): the pair aggregation was 25M rows on the micro;
 *    cards_synergy walks the anchor's decks instead. Bounded by a
 *    wall-clock budget; what it does not reach tonight it reaches
 *    tomorrow.
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
 *
 * The population table (0140; interface review close-out 2026-09-19).
 * The rebuild used to re-derive `pop` from the raw battle_participant
 * heap every night: 227 s of a 495 s run on day 12 of September, every
 * statement scaling with the season's rows, the 900 s ceiling due
 * around day 22 and the final rebuild at the close never finishing.
 * Now meta_season_pop holds the running season's population keyed by
 * game day (0126). A night rebuilds only the days not yet SEALED (a day
 * seals once its 10:00Z end is a full day past the cursor, so a battle
 * log fetched hours late still lands in its day), appends to sealed
 * days the battles created since the last run's cursor (nothing late
 * is lost, whatever its age), and aggregates from the table. Every row
 * is bounded by battle.created_at <= the cursor, which is also the
 * hourly's counters_through: the two writers never count a battle
 * twice. Days build in their own short transactions, so a run the
 * Lambda cuts short keeps its days; the aggregates are one transaction.
 * The from-scratch and final paths build the same table the same way,
 * and the final path drops the season's rows once its rollup is final.
 * A participant row enriched after its day sealed (a cross-observer
 * sighting filling a null) is not re-read; the equivalence op measures
 * how many that is.
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

/** The population's SELECT: one row per participant in `fromWhere`'s
 *  slice (the hourly's increment, or one game day of the season), with
 *  its mode group, trophy band and the level gap against the opposing
 *  side (both sides of a battle share its battle_time and its
 *  created_at, so both are in any slice and the gap is a self join,
 *  never a probe per row). The opposing side's level is joined as a
 *  hashed, pre-aggregated set: the first shape (3.16.0) was a LATERAL
 *  over a once-referenced CTE, which the planner inlines, so every
 *  participant row re-grouped the whole season and the first nightly on
 *  the live corpus ran past the Lambda's 900 s (2026-09-18 19:40Z,
 *  rolled back; the 3.15.1 rebuild took 93 s). */
const POP_COLUMNS =
  "battle_id, player_tag, deck_hash, outcome, battle_time, type, type_class, mode_group, trophy_band, level_gap";
function popSelect(fromWhere) {
  return `with rows as materialized (
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
     select r.battle_id, r.player_tag, r.deck_hash, r.outcome, r.battle_time, r.type, r.type_class,
            r.mode_group, r.trophy_band,
            case when r.deck_avg_level is not null and o.lvl is not null
                 then r.deck_avg_level - o.lvl end as level_gap
     from rows r
     left join opposing o on o.battle_id = r.battle_id and o.side = r.side`;
}

/** The hourly's population: a temp table over the increment's slice. */
function popSql(fromWhere) {
  return `create temp table pop on commit drop as ${popSelect(fromWhere)}`;
}

/** The persisted population as the aggregates read it: the season's
 *  rows of meta_season_pop under the alias every statement names. */
function popTable(month) {
  return `(select * from meta_season_pop where season_month = '${month}') pop`;
}

/** The season's rows from the raw heap, bounded by created_at: one game
 *  day (`day` set) or every day of a created_at slice (`day` null, the
 *  late append). `game_day()` is 0126's. */
function popInsertSql(onConflict) {
  return `insert into meta_season_pop (season_month, game_day, ${POP_COLUMNS})
     select $1, game_day(p.battle_time), ${POP_COLUMNS} from (${popSelect(
       `from battle_participant bp
        join battle b on b.battle_id = bp.battle_id
        where bp.battle_time >= $2 and bp.battle_time < $3
          and b.created_at > $4 and b.created_at <= $5`,
     )}) p
     ${onConflict}`;
}
const POP_UPSERT = `on conflict (season_month, game_day, battle_id, player_tag) do update set
       deck_hash = excluded.deck_hash, outcome = excluded.outcome,
       type = excluded.type, type_class = excluded.type_class,
       mode_group = excluded.mode_group, trophy_band = excluded.trophy_band,
       level_gap = excluded.level_gap
     where (meta_season_pop.deck_hash, meta_season_pop.outcome, meta_season_pop.type,
            meta_season_pop.type_class, meta_season_pop.mode_group,
            meta_season_pop.trophy_band, meta_season_pop.level_gap)
           is distinct from
           (excluded.deck_hash, excluded.outcome, excluded.type, excluded.type_class,
            excluded.mode_group, excluded.trophy_band, excluded.level_gap)`;
const EPOCH = new Date(0);
const DAY_MS = 86_400_000;
/** A game day seals once its end is this far behind the cursor: a
 *  battle log fetched hours after the day still lands in its day. */
export const SEAL_AFTER_MS = DAY_MS;

/** How far behind now() the hourly increment reads, so an ingest
 *  transaction open at the read is not passed over. */
export const INCREMENT_LAG_MS = 5 * 60_000;
/** The nightly run stops STARTING past seasons after this; the Lambda
 *  has 900 s, so one full-month season begun at the budget still fits. */
const NIGHTLY_BUDGET_MS = 300_000;

/** The aggregate statements, shared by the rebuild (into empty rows)
 *  and the increment (added onto existing ones). `pop` must exist. */
function aggregateSql(month, { withPlayers, withBands = true, pop = "pop" }) {
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
     from ${pop} cross join lateral (values (pop.mode_group), ('all')) m(mode_group)
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
     from ${pop} cross join lateral (values (pop.mode_group), ('all')) m(mode_group)
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

/** The season's game days from its start to the cursor (the running
 *  season's current, partial day included), as [dayKey, startMs, endMs]. */
function seasonDays(season, cursorMs) {
  const out = [];
  const endMs = Math.min(season.ends_at.getTime(), cursorMs);
  for (let t = season.starts_at.getTime(); t < endMs; t += DAY_MS)
    out.push({
      day: new Date(t - 10 * 3600_000).toISOString().slice(0, 10),
      startMs: t,
      endMs: Math.min(t + DAY_MS, season.ends_at.getTime()),
    });
  return out;
}

/** The population days not yet sealed, built from the raw rows bounded
 *  by the cursor, each its own transaction; sealed when their end is a
 *  day behind the cursor. Stops at the deadline and says so: the days
 *  committed so far stay, and the next run continues. */
async function buildPopDays(db, season, cursor, { deadlineMs }) {
  const month = season.season_month;
  const { rows: ledger } = await db.query(
    `select game_day::text as day, sealed from meta_season_pop_day where season_month = $1`,
    [month],
  );
  const sealed = new Set(ledger.filter((r) => r.sealed).map((r) => r.day));
  const out = { built: 0, changed: 0, sealed: sealed.size, complete: true };
  for (const d of seasonDays(season, cursor.getTime())) {
    if (sealed.has(d.day)) continue;
    if (Date.now() > deadlineMs) {
      out.complete = false;
      break;
    }
    await db.query("begin");
    try {
      await db.query("set local work_mem = '64MB'");
      const { rowCount: changed } = await db.query(popInsertSql(POP_UPSERT), [
        month,
        new Date(d.startMs),
        new Date(d.endMs),
        EPOCH,
        cursor,
      ]);
      const {
        rows: [{ n }],
      } = await db.query(
        `select count(*)::int as n from meta_season_pop where season_month = $1 and game_day = $2`,
        [month, d.day],
      );
      const seal = d.endMs + SEAL_AFTER_MS <= cursor.getTime();
      await db.query(
        `insert into meta_season_pop_day (season_month, game_day, rows, built_at, sealed)
         values ($1, $2, $3, $4, $5)
         on conflict (season_month, game_day) do update set
           rows = excluded.rows, built_at = excluded.built_at, sealed = excluded.sealed`,
        [month, d.day, n, cursor, seal],
      );
      await db.query("commit");
      out.built += 1;
      out.changed += changed;
      if (seal) out.sealed += 1;
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    }
  }
  return out;
}

/** The population rows of every season OLDER than the one just made
 *  final, dropped: one statement a day, never a season in one (the 0099
 *  rule's spirit). The season going final keeps its own rows, so the
 *  meta tools can answer a window inside it, or one spanning the roll
 *  into the running season, from the table (6.12.0, feedback #77-#79):
 *  "this week against last" is asked most in a season's first week. */
async function dropPop(db, season) {
  const { rows } = await db.query(
    `select season_month, game_day::text as day from meta_season_pop_day
      where season_month < $1 order by 1, 2`,
    [season.season_month],
  );
  for (const r of rows)
    await db.query(
      `delete from meta_season_pop where season_month = $1 and game_day = $2`,
      [r.season_month, r.day],
    );
  await db.query(`delete from meta_season_pop_day where season_month < $1`, [
    season.season_month,
  ]);
  return rows.length;
}

/** One season, rebuilt: its population days brought up to the cursor,
 *  the late battles appended, then the aggregates in one transaction.
 *  `incomplete: true` when the days did not all fit before the
 *  deadline; nothing else is touched then. */
export async function rebuildSeason(
  db,
  season,
  { final = false, deadlineMs = Date.now() + 480_000, nowMs = null } = {},
) {
  const month = season.season_month;
  const t0 = Date.now();
  // The cursor is the database's clock (the hourly reads the same one);
  // injectable so a test can rebuild "later" than its rows' created_at.
  const {
    rows: [{ cursor }],
  } = await db.query("select coalesce($1::timestamptz, now()) as cursor", [
    nowMs === null ? null : new Date(nowMs),
  ]);
  const {
    rows: [prior],
  } = await db.query(
    `select pop_through from meta_season_state where season_month = $1`,
    [month],
  );
  const tPop = Date.now();
  const days = await buildPopDays(db, season, cursor, { deadlineMs });
  const phases = { pop_days: Date.now() - tPop };
  if (!days.complete)
    return {
      season_month: month,
      final,
      incomplete: true,
      days,
      ms: Date.now() - t0,
      phases,
    };
  await db.query("begin");
  try {
    // The meta queries spill at the micro's 4 MB work_mem (review 2.6);
    // this connection is the job's own.
    await db.query("set local work_mem = '64MB'");
    // Battles recorded since the last run whose day has sealed: appended,
    // whatever their age. (An unsealed day was just rebuilt to the same
    // bound, so the conflict is a no-op there.)
    const tLate = Date.now();
    let late = 0;
    if (prior?.pop_through) {
      const { rows: perDay } = await db.query(
        `with ins as (${popInsertSql("on conflict do nothing returning game_day")})
         select game_day, count(*)::int as n from ins group by game_day`,
        [month, season.starts_at, season.ends_at, prior.pop_through, cursor],
      );
      for (const r of perDay) {
        late += r.n;
        await db.query(
          `update meta_season_pop_day set rows = rows + $3
            where season_month = $1 and game_day = $2`,
          [month, r.game_day, r.n],
        );
      }
    }
    phases.pop_late = Date.now() - tLate;
    for (const table of [
      "meta_season_totals",
      "deck_meta_season",
      "card_meta_season",
      "meta_season_band_totals",
      "deck_meta_season_band",
      "card_meta_season_band",
    ])
      await db.query(`delete from ${table} where season_month = $1`, [month]);
    const sql = aggregateSql(month, {
      withPlayers: true,
      pop: popTable(month),
    });
    Object.assign(phases, await runAggregates(db, sql));
    const {
      rows: [counts],
    } = await db.query(
      `select (select count(*)::int from deck_meta_season where season_month = $1) as decks,
              (select count(*)::int from card_meta_season where season_month = $1) as cards,
              (select decided from meta_season_totals where season_month = $1 and mode_group = 'all') as decided,
              (select count(*)::int from meta_season_pop where season_month = $1) as pop_rows`,
      [month],
    );
    await db.query(
      `insert into meta_season_state
         (season_month, counters_through, rebuilt_at, final, bands_rebuilt_at, pop_through)
       values ($1, $2, $2, $3, $2, $2)
       on conflict (season_month) do update set
         counters_through = excluded.counters_through,
         rebuilt_at = excluded.rebuilt_at,
         final = excluded.final,
         bands_rebuilt_at = excluded.bands_rebuilt_at,
         pop_through = excluded.pop_through`,
      [month, cursor, final],
    );
    await db.query("commit");
    const dropped = final ? await dropPop(db, season) : 0;
    return {
      season_month: month,
      final,
      ms: Date.now() - t0,
      phases,
      days: { ...days, late, dropped },
      ...counts,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/** The population days stop building past this point of the run, so
 *  the aggregates that follow still fit the Lambda's 900 s. */
const POP_DEADLINE_MS = 480_000;

/** The running season and every ended season with battles but no final
 *  rollup, oldest first, within the budget. */
/** {meta_rollup_season: {season_month, final?}}: one named season rebuilt
 *  on demand - its population days brought up to the cursor (from the
 *  heap where they are gone) and its aggregates. The one-off that
 *  restores an ended season's population after 6.12.0 began keeping
 *  the previous season's (2026-08 was dropped at its final under the
 *  old rule). `final` defaults to the season's current state. */
export async function metaRollupSeason(databaseUrl, spec = {}) {
  const month = String(spec.season_month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month))
    throw new Error("meta_rollup_season needs season_month as YYYY-MM");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const {
      rows: [season],
    } = await db.query(
      `select s.season_month, s.starts_at, s.ends_at, coalesce(st.final, false) as final
         from season s left join meta_season_state st on st.season_month = s.season_month
        where s.season_month = $1`,
      [month],
    );
    if (!season) throw new Error(`no season ${month}`);
    const final =
      typeof spec.final === "boolean" ? spec.final : season.final === true;
    return await rebuildSeason(db, season, {
      final,
      deadlineMs: Date.now() + POP_DEADLINE_MS,
    });
  } finally {
    await db.end();
  }
}

export async function metaRollupNightly(
  databaseUrl,
  { budgetMs = NIGHTLY_BUDGET_MS, nowMs = Date.now() } = {},
) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  const deadlineMs = started + POP_DEADLINE_MS;
  const done = [];
  try {
    const { rows: current } = await db.query(
      `select season_month, starts_at, ends_at from season
       where starts_at <= $1 and ends_at > $1`,
      [new Date(nowMs)],
    );
    if (current[0])
      done.push(await rebuildSeason(db, current[0], { deadlineMs }));
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
    for (let i = 0; i < pending.length; i += 1) {
      if (Date.now() - started > budgetMs) {
        skipped = pending.length - i;
        break;
      }
      const r = await rebuildSeason(db, pending[i], {
        final: true,
        deadlineMs,
      });
      done.push(r);
      // A season whose days did not all fit stays pending: its days are
      // committed and tomorrow continues from them.
      if (r.incomplete) {
        skipped = pending.length - i;
        break;
      }
    }
    return { rebuilt: done, pending_after: skipped, ms: Date.now() - started };
  } finally {
    await db.end();
  }
}

const ROLLUP_TABLES = [
  ["meta_season_totals", "season_month, mode_group"],
  ["deck_meta_season", "season_month, mode_group, deck_hash"],
  ["card_meta_season", "season_month, mode_group, card_id, form"],
  ["meta_season_band_totals", "season_month, mode_group, trophy_band"],
  ["deck_meta_season_band", "season_month, mode_group, trophy_band, deck_hash"],
  [
    "card_meta_season_band",
    "season_month, mode_group, trophy_band, card_id, form",
  ],
];

/** {meta_rollup_equivalence: {season_month?}} - read-only: the proof
 *  that the persisted population and what it aggregates are what a
 *  from-scratch rebuild over the raw rows would produce, bounded at the
 *  season's pop_through. In one transaction that is rolled back: the
 *  raw population into a temp table; its rows against meta_season_pop
 *  (missing, extra, differing); then the six rollup tables rebuilt from
 *  it into temp shadows of the same names (a temp table shadows the
 *  public one for an unqualified name, so the very statements the
 *  nightly runs write there) and each compared with the live table by
 *  row count and a checksum of the ordered rows. The live tables also
 *  carry the hourly's increments since the rebuild: `hourly_ran` says
 *  whether counters_through moved past pop_through, in which case the
 *  counter checksums are expected to differ. Runs about as long as the
 *  old nightly did; not a routine check. */
export async function metaRollupEquivalence(
  databaseUrl,
  { seasonMonth = null, nowMs = Date.now() } = {},
) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const t0 = Date.now();
  try {
    const { rows: seasons } = await db.query(
      seasonMonth
        ? `select season_month, starts_at, ends_at from season where season_month = $1`
        : `select season_month, starts_at, ends_at from season where starts_at <= $1 and ends_at > $1`,
      [seasonMonth ?? new Date(nowMs)],
    );
    const season = seasons[0];
    if (!season) return { error: "no_season" };
    const month = season.season_month;
    const {
      rows: [state],
    } = await db.query(
      `select pop_through, counters_through from meta_season_state where season_month = $1`,
      [month],
    );
    if (!state?.pop_through) return { season_month: month, error: "no_pop" };
    await db.query("begin");
    try {
      // Not `set transaction read only`: CREATE TABLE AS is refused
      // there even for a temp table. The rollback is the guarantee.
      await db.query("set local work_mem = '64MB'");
      const phases = {};
      const timed = async (name, fn) => {
        const t = Date.now();
        const out = await fn();
        phases[name] = Date.now() - t;
        return out;
      };
      await timed("pop_raw", () =>
        db.query(
          `create temp table pop_raw on commit drop as ${popSelect(
            `from battle_participant bp
             join battle b on b.battle_id = bp.battle_id
             where bp.battle_time >= $1 and bp.battle_time < $2 and b.created_at <= $3`,
          )}`,
          [season.starts_at, season.ends_at, state.pop_through],
        ),
      );
      const {
        rows: [pop],
      } = await timed("pop_diff", () =>
        db.query(
          `select (select count(*)::int from pop_raw) as raw_rows,
                  (select count(*)::int from meta_season_pop where season_month = $1) as pop_rows,
                  (select count(*)::int from pop_raw r
                    where not exists (select 1 from meta_season_pop p
                                       where p.season_month = $1 and p.battle_id = r.battle_id
                                         and p.player_tag = r.player_tag)) as raw_not_in_pop,
                  (select count(*)::int from meta_season_pop p
                    where p.season_month = $1
                      and not exists (select 1 from pop_raw r
                                       where r.battle_id = p.battle_id and r.player_tag = p.player_tag)) as pop_not_in_raw,
                  (select count(*)::int from pop_raw r
                    join meta_season_pop p on p.season_month = $1
                     and p.battle_id = r.battle_id and p.player_tag = r.player_tag
                    where (r.deck_hash, r.outcome, r.type, r.type_class, r.mode_group, r.trophy_band, r.level_gap)
                          is distinct from
                          (p.deck_hash, p.outcome, p.type, p.type_class, p.mode_group, p.trophy_band, p.level_gap)) as differing`,
          [month],
        ),
      );
      for (const [table] of ROLLUP_TABLES)
        await db.query(
          `create temp table ${table} (like public.${table} including indexes) on commit drop`,
        );
      const sql = aggregateSql(month, {
        withPlayers: true,
        pop: "pop_raw pop",
      });
      Object.assign(phases, await runAggregates(db, sql));
      const tables = {};
      for (const [table, key] of ROLLUP_TABLES) {
        const sum = async (schema) => {
          const {
            rows: [r],
          } = await db.query(
            `select count(*)::int as rows, md5(coalesce(string_agg(t::text, '|' order by ${key}), '')) as checksum
             from ${schema}.${table} t where season_month = $1`,
            [month],
          );
          return r;
        };
        const raw = await sum("pg_temp");
        const live = await sum("public");
        tables[table] = {
          raw_rows: raw.rows,
          live_rows: live.rows,
          equal: raw.rows === live.rows && raw.checksum === live.checksum,
          raw_checksum: raw.checksum,
          live_checksum: live.checksum,
        };
      }
      const {
        rows: [after],
      } = await db.query(
        `select counters_through from meta_season_state where season_month = $1`,
        [month],
      );
      await db.query("rollback");
      return {
        season_month: month,
        pop_through: state.pop_through.toISOString(),
        hourly_ran:
          after.counters_through.getTime() !== state.pop_through.getTime(),
        pop,
        tables,
        phases,
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
