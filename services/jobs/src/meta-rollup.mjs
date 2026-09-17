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
 *    sums), of the card pairs, and of `final`. Bounded by a wall-clock
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

/** How far behind now() the hourly increment reads, so an ingest
 *  transaction open at the read is not passed over. */
export const INCREMENT_LAG_MS = 5 * 60_000;
/** The nightly run stops starting new seasons after this. */
const NIGHTLY_BUDGET_MS = 200_000;

/** The aggregate statements, shared by the rebuild (into empty rows)
 *  and the increment (added onto existing ones). `pop` must exist. */
function aggregateSql(month, { withPlayers }) {
  const players = withPlayers ? "count(distinct player_tag)::int" : "null";
  return {
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
     select m.mode_group, pop.deck_hash, pop.player_tag, pop.outcome, pop.battle_time
     from pop cross join lateral (values (pop.mode_group), ('all')) m(mode_group)
     where pop.type_class = 'pvp' and pop.deck_hash is not null
       and pop.outcome in ('win', 'loss')`,
    decks: `insert into deck_meta_season
       (season_month, mode_group, deck_hash, battles, wins, losses, players, first_used, last_used)
     select '${month}', mode_group, deck_hash,
            count(*)::int,
            count(*) filter (where outcome = 'win')::int,
            count(*) filter (where outcome = 'loss')::int,
            ${players},
            min(battle_time), max(battle_time)
     from dec
     group by mode_group, deck_hash
     on conflict (season_month, mode_group, deck_hash) do update set
       battles = deck_meta_season.battles + excluded.battles,
       wins = deck_meta_season.wins + excluded.wins,
       losses = deck_meta_season.losses + excluded.losses,
       first_used = least(deck_meta_season.first_used, excluded.first_used),
       last_used = greatest(deck_meta_season.last_used, excluded.last_used)`,
    // (deck, player) pairs first, as the card meta tool does: one row per
    // card per deck from deck_card, never one probe per participant.
    deckPlayers: `create temp table dp on commit drop as
     select mode_group, deck_hash, player_tag,
            count(*)::int as battles,
            count(*) filter (where outcome = 'win')::int as wins
     from dec group by mode_group, deck_hash, player_tag`,
    cards: `insert into card_meta_season
       (season_month, mode_group, card_id, form, battles, wins, losses, players)
     select '${month}', dp.mode_group, dc.card_id, f.form,
            sum(dp.battles)::int, sum(dp.wins)::int, sum(dp.battles - dp.wins)::int,
            ${withPlayers ? "count(distinct dp.player_tag)::int" : "null"}
     from dp
     join deck_card dc on dc.deck_hash = dp.deck_hash
     cross join lateral (values (dc.form::smallint), (-1::smallint)) f(form)
     group by dp.mode_group, dc.card_id, f.form
     on conflict (season_month, mode_group, card_id, form) do update set
       battles = card_meta_season.battles + excluded.battles,
       wins = card_meta_season.wins + excluded.wins,
       losses = card_meta_season.losses + excluded.losses`,
    pairs: `insert into card_pair_season
       (season_month, mode_group, card_a, form_a, card_b, form_b, co_battles, wins, players)
     select '${month}', dp.mode_group, a.card_id, fa.form, b.card_id, fb.form,
            sum(dp.battles)::int, sum(dp.wins)::int, count(distinct dp.player_tag)::int
     from dp
     join deck_card a on a.deck_hash = dp.deck_hash
     join deck_card b on b.deck_hash = dp.deck_hash and b.card_id > a.card_id
     cross join lateral (values (a.form::smallint), (-1::smallint)) fa(form)
     cross join lateral (values (b.form::smallint), (-1::smallint)) fb(form)
     where not (fa.form = -1 and fb.form = -1)
     group by dp.mode_group, a.card_id, fa.form, b.card_id, fb.form`,
  };
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
    await db.query(
      `create temp table pop on commit drop as
       select bp.player_tag, bp.deck_hash, bp.outcome, bp.battle_time,
              bp.type, bp.type_class, ${MODE_GROUP_CASE} as mode_group
       from battle_participant bp
       where bp.battle_time >= $1 and bp.battle_time < $2`,
      [season.starts_at, season.ends_at],
    );
    for (const table of [
      "meta_season_totals",
      "deck_meta_season",
      "card_meta_season",
      "card_pair_season",
    ])
      await db.query(`delete from ${table} where season_month = $1`, [month]);
    const sql = aggregateSql(month, { withPlayers: true });
    await db.query(sql.totals, [DUEL_TYPES]);
    await db.query(sql.decided);
    await db.query(sql.decks);
    await db.query(sql.deckPlayers);
    await db.query(sql.cards);
    await db.query(sql.pairs);
    const {
      rows: [counts],
    } = await db.query(
      `select (select count(*)::int from deck_meta_season where season_month = $1) as decks,
              (select count(*)::int from card_meta_season where season_month = $1) as cards,
              (select count(*)::int from card_pair_season where season_month = $1) as pairs,
              (select decided from meta_season_totals where season_month = $1 and mode_group = 'all') as decided`,
      [month],
    );
    await db.query(
      `insert into meta_season_state (season_month, counters_through, rebuilt_at, final)
       values ($1, $2, $2, $3)
       on conflict (season_month) do update set
         counters_through = excluded.counters_through,
         rebuilt_at = excluded.rebuilt_at,
         final = excluded.final`,
      [month, cursor, final],
    );
    await db.query("commit");
    return { season_month: month, final, ms: Date.now() - t0, ...counts };
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

/** The counters for the running season, from battles created since
 *  the cursor. Nothing until the first nightly rebuild has run. */
export async function metaRollupHourly(
  databaseUrl,
  { nowMs = Date.now() } = {},
) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const t0 = Date.now();
  try {
    const { rows } = await db.query(
      `select s.season_month, s.starts_at, s.ends_at, st.counters_through
       from season s join meta_season_state st on st.season_month = s.season_month
       where s.starts_at <= $1 and s.ends_at > $1 and not st.final`,
      [new Date(nowMs)],
    );
    const season = rows[0];
    if (!season)
      return { season_month: null, battles: 0, reason: "no_rollup_yet" };
    const upto = new Date(nowMs - INCREMENT_LAG_MS);
    if (upto <= season.counters_through)
      return {
        season_month: season.season_month,
        battles: 0,
        reason: "cursor_ahead",
      };
    await db.query("begin");
    try {
      await db.query("set local work_mem = '64MB'");
      const { rowCount } = await db.query(
        `create temp table pop on commit drop as
         select bp.player_tag, bp.deck_hash, bp.outcome, bp.battle_time,
                bp.type, bp.type_class, ${MODE_GROUP_CASE} as mode_group
         from battle b
         join battle_participant bp on bp.battle_id = b.battle_id
         where b.created_at > $1 and b.created_at <= $2
           and bp.battle_time >= $3 and bp.battle_time < $4`,
        [season.counters_through, upto, season.starts_at, season.ends_at],
      );
      const sql = aggregateSql(season.season_month, { withPlayers: false });
      if (rowCount > 0) {
        await db.query(sql.totals, [DUEL_TYPES]);
        await db.query(sql.decided);
        await db.query(sql.decks);
        await db.query(sql.deckPlayers);
        await db.query(sql.cards);
      }
      await db.query(
        `update meta_season_state set counters_through = $2 where season_month = $1`,
        [season.season_month, upto],
      );
      await db.query("commit");
      return {
        season_month: season.season_month,
        battles: rowCount,
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
