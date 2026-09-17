/**
 * Player snapshot projector — DESIGN §4.5.
 *
 * One row per recorded player per GAME day ('daily'; the day whose
 * 10:00Z start the observation falls after, gameDay() in contracts and
 * game_day() in SQL, 0126 - the table moved off the UTC calendar day on
 * 2026-09-17, time-series review 3.2); the watchers force a second row
 * in the hour before the weekly donation reset ('pre_reset') and in the
 * hour before the season rolls ('season_roll', 0111: the last
 * leagueStatistics.currentSeason and Path of Legends standing before
 * they reset, and under the game day the last row of the old season) —
 * same function, different kind. Later polls in a day overwrite: a
 * snapshot is "state at capture", and the pre-reset peak lives in the
 * prior day's row plus the extra row.
 *
 * Diff events come from comparing against the LATEST snapshot observation
 * (the DB is the baseline, same as roster tenure): donation_reset when
 * the weekly counter falls, and the ledger milestones below. First sight
 * emits nothing. The baseline is the newest row by observed_at, today's
 * included: until 2026-09-15 it was the newest PRIOR day's row, and since
 * today's row is rewritten on every poll, every later poll that day
 * re-diffed against yesterday and re-emitted the same moment (Aaqib Javed
 * "promoted to Master 2" at 07:22Z and again at 16:22Z on 2026-09-14).
 */

import { gameDay, inPreResetWindow } from "@elixir-mcp/contracts";
import { inSeasonRollWindow } from "./war-clock.mjs";
import { ensureSeason } from "./season.mjs";
import { snapshotColumns } from "./snapshot-columns.mjs";
import { payloadHash } from "./hash.mjs";
import { emitEvent } from "./events.mjs";

/**
 * Badges are CURRENT STATE, not a daily blob (§7.2). ~139 per player
 * per day would be the largest thing we write to say almost nothing;
 * this touches only the ones that actually moved.
 */
/**
 * Badges, and the two feed topics they produce.
 *
 * The upsert already fired only on a real change; what it threw away was WHICH
 * change, so nothing could ever be notified. It now reads the prior state in
 * the same statement (a data-modifying CTE sees the pre-modification snapshot)
 * and reports what moved.
 *
 * THE TIER SPLIT IS ELIXIR-BOT'S, and it is a naming rule, not a field: a
 * badge with NO level is awarded once and never again (the Legendary badges
 * and one-off event badges); a badge WITH a level is mastery grind, and it is
 * the bulk of the volume. Because the two are separate topics, a reader that
 * only wants the notable ones asks for the notable ones -- it cannot silently
 * drop a tier by hardcoding a name, which is exactly how elixir-bot lost its
 * entire Legendary back catalogue.
 *
 * FIRST OBSERVATION EMITS NOTHING. A newly added player arrives with a full
 * badge shelf, every row of it "new". elixir-bot documents this as its flood
 * class (engine/emitters/player.py); with 50 tracked players it is the
 * difference between a feed and an outage.
 */
export async function projectPlayerBadges(
  db,
  { playerTag, payload, fetchedAt },
) {
  if (!Array.isArray(payload.badges) || payload.badges.length === 0)
    return { changed: 0, feedEvents: [] };
  const rows = payload.badges.filter(
    (badge) => badge && typeof badge.name === "string" && badge.name,
  );
  if (rows.length === 0) return { changed: 0, feedEvents: [] };
  const { rows: changed } = await db.query(
    `with prior as (
       select name, level from player_badge where player_tag = $1
     ),
     upserted as (
       insert into player_badge (player_tag, name, level, max_level, progress, target, observed_at)
       select $1, b.name, b.level, b.max_level, b.progress, b.target, $3::timestamptz
       from jsonb_to_recordset($2::jsonb)
         as b(name text, level int, max_level int, progress int, target int)
       on conflict (player_tag, name) do update set
         level = excluded.level, max_level = excluded.max_level,
         progress = excluded.progress, target = excluded.target,
         observed_at = excluded.observed_at
       where player_badge.observed_at < excluded.observed_at
         and (player_badge.level is distinct from excluded.level
           or player_badge.progress is distinct from excluded.progress
           or player_badge.target is distinct from excluded.target
           or player_badge.max_level is distinct from excluded.max_level)
       returning name, level, max_level
     )
     select u.name, u.level as new_level, u.max_level, p.level as prior_level,
            (p.name is null) as is_new,
            (select count(*) from prior) as prior_count
       from upserted u left join prior p on p.name = u.name`,
    [
      playerTag,
      JSON.stringify(
        rows.map((badge) => ({
          name: badge.name,
          level: badge.level ?? null,
          max_level: badge.maxLevel ?? null,
          progress: badge.progress ?? null,
          target: badge.target ?? null,
        })),
      ),
      fetchedAt,
    ],
  );

  // The ledger gets one named row per badge moment; the first observation
  // writes nothing (a new tracking arrives with a whole shelf, and that is
  // history, not news). Progress inside a level is recorded, never a row.
  const firstObservation = Number(changed[0]?.prior_count ?? 0) === 0;
  if (!firstObservation) {
    for (const row of changed) {
      const level = row.new_level;
      let type = null;
      if (row.is_new && level === null) type = "legendary_badge_earned";
      else if (row.is_new && level !== null) type = "badge_earned";
      else if (row.prior_level !== null && level > row.prior_level)
        type = "badge_earned";
      if (!type) continue;
      await emitEvent(db, type, {
        tag: playerTag,
        windowEnd: fetchedAt,
        payload: {
          name: row.name,
          ...(level !== null ? { level } : {}),
          ...(row.max_level !== null && row.max_level !== undefined
            ? { max_level: row.max_level }
            : {}),
          ...(row.prior_level !== null && row.prior_level !== undefined
            ? { prior_level: row.prior_level }
            : {}),
        },
      });
    }
  }
  return { changed: changed.length };
}

export async function projectPlayerSnapshot(
  db,
  { playerTag, payload, fetchedAt, receiptId = null, kind = "daily" },
) {
  const day = gameDay(fetchedAt);

  // Two baselines, both PROFILE observations (rows the profile wrote:
  // profile_observed_at set; since 2026-09-17 the roster writes rows too,
  // and a roster-only row carries no wins or league to diff against).
  // `prev` is the newest such row from an EARLIER day: the day-level
  // questions (did a counter move since yesterday's snapshot, 0077) are
  // asked of it. `latest` is the newest profile observation of any day,
  // today's rewritten row included, and strictly before this poll: the
  // moments are diffed against it, so a moment is written once, by the
  // first poll that sees it, and never again by the polls that follow it
  // the same day.
  const SNAPSHOT_BASELINE = `select snapshot_date, profile_observed_at as observed_at, donations, battle_count,
            arena_id, best_trophies, wins, collection_level, pol_league
     from player_snapshot_daily`;
  const { rows: prevRows } = await db.query(
    `${SNAPSHOT_BASELINE}
     where player_tag = $1 and profile_observed_at is not null
       and (snapshot_date, snapshot_kind) < ($2::date, $3)
     order by snapshot_date desc, snapshot_kind desc limit 1`,
    [playerTag, day, kind],
  );
  const prev = prevRows[0];
  const { rows: latestRows } = await db.query(
    `${SNAPSHOT_BASELINE}
     where player_tag = $1 and profile_observed_at < $2::timestamptz
     order by profile_observed_at desc limit 1`,
    [playerTag, fetchedAt],
  );
  const latest = latestRows[0];
  // The arena is a SHARED column and the roster writes it at its own
  // cadence, emitting arena_changed itself (series.mjs): the arena
  // baseline is the newest observation of either writer, so a move the
  // roster already wrote is never written twice.
  if (latest) {
    const { rows: arenaRows } = await db.query(
      `select arena_id from player_snapshot_daily
       where player_tag = $1 and observed_at < $2::timestamptz
       order by observed_at desc limit 1`,
      [playerTag, fetchedAt],
    );
    if (arenaRows[0]) latest.arena_id = arenaRows[0].arena_id;
  }

  // The typed columns (0123); the objects the contract serves are
  // rendered from them (snapshot-columns.mjs).
  const cols = snapshotColumns(payload);
  // The season names are the API's months; a month the calendar lacks
  // gets its row (pure arithmetic, 0104), anything else is not a season.
  const monthOrNull = (id) =>
    typeof id === "string" && /^\d{4}-\d{2}$/.test(id) ? id : null;
  const prevMonth = monthOrNull(cols.prev_season_month);
  const bestMonth = monthOrNull(cols.best_season_month);
  for (const m of new Set([prevMonth, bestMonth]))
    if (m) await ensureSeason(db, m);
  // The profile's write. The columns it shares with the roster
  // (trophies, donations, donations_received, arena_id) take this
  // observation only when it is the row's newest; everything else is
  // the profile's own and guarded on profile_observed_at, so a delayed
  // profile poll behind a fresher roster keeps its lifetime block and
  // leaves the roster's numbers alone. observed_at never regresses.
  const { rowCount: written } = await db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, trophies,
        donations, donations_received, collection_hash, observed_at, profile_observed_at,
        arena_id, best_trophies, favorite_card_id,
        battle_count, wins, losses, three_crown_wins, star_points, exp_points, collection_level,
        pol_league, pol_trophies, pol_rank, pol_best_league, pol_best_trophies, pol_best_rank,
        season_trophies, season_best_trophies,
        prev_season_month, prev_season_rank, prev_season_trophies, prev_season_best_trophies,
        best_season_month, best_season_trophies, best_season_rank,
        total_donations, challenge_cards_won, challenge_max_wins,
        tournament_cards_won, tournament_battle_count, king_tower_level, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22, $23, $24,
             $25, $26, $27, $28, $29, $30, $31, $32, $33,
             $34, $35, $36, $37, $38, $39, 'api')
     on conflict (player_tag, snapshot_date, snapshot_kind) do update set
       trophies = case when excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
                       then excluded.trophies else player_snapshot_daily.trophies end,
       donations = case when excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
                        then excluded.donations else player_snapshot_daily.donations end,
       donations_received = case when excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
                                 then excluded.donations_received else player_snapshot_daily.donations_received end,
       arena_id = case when excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
                       then excluded.arena_id else player_snapshot_daily.arena_id end,
       collection_hash = excluded.collection_hash,
       observed_at = greatest(excluded.observed_at, player_snapshot_daily.observed_at),
       profile_observed_at = excluded.profile_observed_at,
       source = excluded.source,
       best_trophies = excluded.best_trophies,
       favorite_card_id = excluded.favorite_card_id,
       battle_count = excluded.battle_count, wins = excluded.wins, losses = excluded.losses,
       three_crown_wins = excluded.three_crown_wins, star_points = excluded.star_points,
       exp_points = excluded.exp_points, collection_level = excluded.collection_level,
       pol_league = excluded.pol_league, pol_trophies = excluded.pol_trophies, pol_rank = excluded.pol_rank,
       pol_best_league = excluded.pol_best_league, pol_best_trophies = excluded.pol_best_trophies,
       pol_best_rank = excluded.pol_best_rank,
       season_trophies = excluded.season_trophies, season_best_trophies = excluded.season_best_trophies,
       prev_season_month = excluded.prev_season_month, prev_season_rank = excluded.prev_season_rank,
       prev_season_trophies = excluded.prev_season_trophies,
       prev_season_best_trophies = excluded.prev_season_best_trophies,
       best_season_month = excluded.best_season_month, best_season_trophies = excluded.best_season_trophies,
       best_season_rank = excluded.best_season_rank,
       total_donations = excluded.total_donations,
       challenge_cards_won = excluded.challenge_cards_won, challenge_max_wins = excluded.challenge_max_wins,
       tournament_cards_won = excluded.tournament_cards_won,
       tournament_battle_count = excluded.tournament_battle_count,
       king_tower_level = excluded.king_tower_level,
       created_at = now()
     where (player_snapshot_daily.profile_observed_at is null
            or excluded.profile_observed_at >= player_snapshot_daily.profile_observed_at)
       and ((player_snapshot_daily.collection_hash, player_snapshot_daily.best_trophies,
             player_snapshot_daily.favorite_card_id, player_snapshot_daily.battle_count,
             player_snapshot_daily.wins, player_snapshot_daily.losses,
             player_snapshot_daily.three_crown_wins, player_snapshot_daily.star_points,
             player_snapshot_daily.exp_points, player_snapshot_daily.collection_level,
             player_snapshot_daily.pol_league, player_snapshot_daily.pol_trophies,
             player_snapshot_daily.pol_rank, player_snapshot_daily.pol_best_league,
             player_snapshot_daily.pol_best_trophies, player_snapshot_daily.pol_best_rank,
             player_snapshot_daily.season_trophies, player_snapshot_daily.season_best_trophies,
             player_snapshot_daily.prev_season_month, player_snapshot_daily.prev_season_rank,
             player_snapshot_daily.prev_season_trophies, player_snapshot_daily.prev_season_best_trophies,
             player_snapshot_daily.best_season_month, player_snapshot_daily.best_season_trophies,
             player_snapshot_daily.best_season_rank, player_snapshot_daily.total_donations,
             player_snapshot_daily.challenge_cards_won, player_snapshot_daily.challenge_max_wins,
             player_snapshot_daily.tournament_cards_won, player_snapshot_daily.tournament_battle_count,
             player_snapshot_daily.king_tower_level)
            is distinct from
            (excluded.collection_hash, excluded.best_trophies, excluded.favorite_card_id,
             excluded.battle_count, excluded.wins, excluded.losses, excluded.three_crown_wins,
             excluded.star_points, excluded.exp_points, excluded.collection_level,
             excluded.pol_league, excluded.pol_trophies, excluded.pol_rank,
             excluded.pol_best_league, excluded.pol_best_trophies, excluded.pol_best_rank,
             excluded.season_trophies, excluded.season_best_trophies,
             excluded.prev_season_month, excluded.prev_season_rank,
             excluded.prev_season_trophies, excluded.prev_season_best_trophies,
             excluded.best_season_month, excluded.best_season_trophies, excluded.best_season_rank,
             excluded.total_donations, excluded.challenge_cards_won, excluded.challenge_max_wins,
             excluded.tournament_cards_won, excluded.tournament_battle_count,
             excluded.king_tower_level)
         or (excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
             and (player_snapshot_daily.trophies, player_snapshot_daily.donations,
                  player_snapshot_daily.donations_received, player_snapshot_daily.arena_id)
                 is distinct from
                 (excluded.trophies, excluded.donations, excluded.donations_received, excluded.arena_id)))`,
    [
      playerTag,
      day,
      kind,
      payload.trophies ?? null,
      payload.donations ?? null,
      payload.donationsReceived ?? null,
      Array.isArray(payload.cards) ? payloadHash(payload.cards) : null,
      fetchedAt,
      // Ids only; names and icons resolve from the catalog at read time.
      payload.arena?.id ?? null,
      payload.bestTrophies ?? null,
      payload.currentFavouriteCard?.id ?? null,
      cols.battle_count,
      cols.wins,
      cols.losses,
      cols.three_crown_wins,
      cols.star_points,
      cols.exp_points,
      cols.collection_level,
      cols.pol_league,
      cols.pol_trophies,
      cols.pol_rank,
      cols.pol_best_league,
      cols.pol_best_trophies,
      cols.pol_best_rank,
      cols.season_trophies,
      cols.season_best_trophies,
      prevMonth,
      cols.prev_season_rank,
      cols.prev_season_trophies,
      cols.prev_season_best_trophies,
      bestMonth,
      cols.best_season_trophies,
      cols.best_season_rank,
      // The lifetime block's remainder (review 1.3): the class wins is in.
      intOrNull(payload.totalDonations),
      intOrNull(payload.challengeCardsWon),
      intOrNull(payload.challengeMaxWins),
      intOrNull(payload.tournamentCardsWon),
      intOrNull(payload.tournamentBattleCount),
      intOrNull(payload.kingTowerLevel),
    ],
  );

  // In a watcher's hour, also pin the extra row: the daily row will be
  // overwritten by later polls the same game day; this one won't.
  if (kind === "daily") {
    const at = Date.parse(fetchedAt);
    for (const [extra, inside] of [
      ["pre_reset", inPreResetWindow(new Date(at))],
      ["season_roll", inSeasonRollWindow(at)],
    ]) {
      if (!inside) continue;
      await projectPlayerSnapshot(db, {
        playerTag,
        payload,
        fetchedAt,
        receiptId,
        kind: extra,
      });
    }
  }

  if (
    latest &&
    typeof payload.donations === "number" &&
    typeof latest.donations === "number" &&
    payload.donations < latest.donations
  ) {
    await emitEvent(db, "donation_reset", {
      tag: playerTag,
      receiptId,
      windowStart: latest.observed_at.toISOString(),
      windowEnd: fetchedAt,
      payload: {
        donations_before: latest.donations,
        donations_after: payload.donations,
      },
    });
  }

  // Did the snapshot say anything new (0077)? The day row is rewritten
  // on every poll so observed_at is honest; this is whether a counter a
  // reader looks at moved since the previous snapshot.
  const moved =
    !prev ||
    prev.battle_count !== (payload.battleCount ?? null) ||
    prev.donations !== (payload.donations ?? null) ||
    prev.wins !== (payload.wins ?? null) ||
    prev.best_trophies !== (payload.bestTrophies ?? null);
  // The arena catalog: ids are opaque (54000144 is Spirit Square), and the
  // profile payload is the only place the name travels.
  if (payload.arena?.id && typeof payload.arena.name === "string") {
    await db.query(
      `insert into arena (arena_id, name, observed_at) values ($1, $2, $3)
       on conflict (arena_id) do update
         set name = excluded.name, observed_at = excluded.observed_at
       where arena.name is distinct from excluded.name`,
      [payload.arena.id, payload.arena.name, fetchedAt],
    );
  }
  if (kind === "daily")
    await ledgerMilestones(db, {
      playerTag,
      prev: latest,
      payload,
      fetchedAt,
      receiptId,
    });

  // State on the player, written when it differs (review 2.1): the
  // frozen Clan Wars 1 counters and the retired road's high score are
  // not a series. Once per player in practice.
  let frozen = 0;
  if (kind === "daily") {
    const { rowCount } = await db.query(
      `update player set war_day_wins = coalesce($2, war_day_wins),
              clan_cards_collected = coalesce($3, clan_cards_collected),
              legacy_trophy_road_high_score = coalesce($4, legacy_trophy_road_high_score)
       where player_tag = $1
         and (war_day_wins is distinct from coalesce($2, war_day_wins)
              or clan_cards_collected is distinct from coalesce($3, clan_cards_collected)
              or legacy_trophy_road_high_score is distinct from coalesce($4, legacy_trophy_road_high_score))`,
      [
        playerTag,
        intOrNull(payload.warDayWins),
        intOrNull(payload.clanCardsCollected),
        intOrNull(payload.legacyTrophyRoadHighScore),
      ],
    );
    frozen = rowCount;
  }
  const polSeason =
    kind === "daily"
      ? await projectPolSeason(db, { playerTag, payload, fetchedAt })
      : 0;

  return {
    day,
    kind,
    hadPrevious: Boolean(prev),
    moved,
    written,
    frozen,
    polSeason,
    facts: written + frozen + polSeason,
  };
}

const intOrNull = (v) => (Number.isInteger(v) ? v : null);

/**
 * lastPathOfLegendSeasonResult is the previous season's final standing,
 * carried on every profile poll of the following month (review 2.1).
 * Fill-once on player_pol_season under the season whose ends_at is the
 * latest at or before the poll: the one that has rolled. A profile with
 * no last result (a new account) writes nothing; the API's null rank
 * (not globally ranked) is kept as null.
 */
async function projectPolSeason(db, { playerTag, payload, fetchedAt }) {
  const last = payload.lastPathOfLegendSeasonResult;
  if (!last || typeof last !== "object") return 0;
  if (
    !Number.isInteger(last.leagueNumber) &&
    !Number.isInteger(last.trophies) &&
    !Number.isInteger(last.rank)
  )
    return 0;
  const { rowCount } = await db.query(
    `insert into player_pol_season (player_tag, season_month, league, trophies, rank, observed_at)
     select $1, s.season_month, $2, $3, $4, $5::timestamptz
     from season s where s.ends_at <= $5::timestamptz
     order by s.ends_at desc limit 1
     on conflict (player_tag, season_month) do nothing`,
    [
      playerTag,
      intOrNull(last.leagueNumber),
      intOrNull(last.trophies),
      intOrNull(last.rank),
      fetchedAt,
    ],
  );
  return rowCount;
}

/**
 * Snapshot-derived moments, written to the ledger with their values so the
 * timeline can name them (review 2026-09-13 Part IV). Thresholds are the
 * disclosed rungs: a personal best counts at each 500 band, career wins at
 * each thousand, collection level at each fifth level; an arena change and a
 * ranked promotion count as themselves. A season reset dropping the league
 * is not a demotion worth a row.
 *
 * `prev` is the latest observation before this poll (any day); absent means
 * this is the player's first snapshot, and everything would read as a
 * milestone. Same flood guard as the badges.
 */
const BEST_TROPHIES_BAND = 500;
const CAREER_WINS_STEP = 1000;
const crossed = (before, after, step) =>
  typeof before === "number" &&
  typeof after === "number" &&
  Math.floor(after / step) > Math.floor(before / step);
/**
 * Collection level steps widen with the level: every 5 below 100, every
 * 50 to 1,000, every 100 above. A maxed account gains five levels in a
 * day and was writing a "milestone" daily (2026-09-16); a beginner's
 * first hundred are the ones worth a nod one by one.
 */
export const collectionLevelStep = (level) =>
  level < 100 ? 5 : level < 1000 ? 50 : 100;

/**
 * The battle that DID it (Jamie, 2026-09-15: "you can identify and speak
 * to the specific battle that DID result in someone leveling up"; and on
 * the result: "facts being attached to a timeline event is a huge win for
 * the LLM to tell an actual story, not just that a fact occurred, but why
 * and what happened"). Four moments are thresholds the battle stream can
 * locate; each carries the battle as `facts` and its instant as
 * occurred_at. The rule for every one of them is absence over a guess:
 * when the record does not hold the crossing, the moment carries no
 * battle and stays estimated.
 *
 * ARENA. Trophy Road arenas have floors: reach the floor and you are in,
 * and a loss never takes you below it again (a loss on the floor is
 * reported with no trophyChange at all; a loss just above it is clamped;
 * the top floor, 14,000, ends Trophy Road). So the promotion is the WIN
 * whose result first reaches the floor - checked on six crossings of
 * 6,000 on 2026-09-15, one of them (x.x.hari.x.x, 5,970 +30 against a
 * 5,976 opponent still in the old arena) confirmed by a profile read
 * fourteen minutes later showing the new arena at exactly 6,000. The
 * opponent's own arena is not the condition, though near a gate it is
 * usually the next one: matchmaking pairs a climber with the players
 * sitting on the floor above. The floor comes from the record: the lowest
 * trophies any snapshot has shown in that arena (gated players sit on it),
 * and, cheaper still, any loss in this player's own window reported with
 * no trophy change while the battle named the new arena.
 *
 * BEST-TROPHIES BAND. The same shape with the band (a multiple of 500) as
 * the floor: the first Trophy Road win whose result reaches it.
 *
 * RANKED. A Path of Legends battle carries leagueNumber stamped with the
 * league the player was in when it started (TDuck, 2026-09-15: the
 * promoting win at 04:34Z stamped 1, every battle after it stamped 2).
 * Rating is not on the battle, so the promotion is the last battle in the
 * window stamped with the league below the new one - and it must be a
 * win, or the crossing is not in the record.
 *
 * CAREER WINS. The Nth win is the Nth win only if the record holds every
 * win between the two snapshots: the wins counted in the window must
 * equal the lifetime counter's rise, or the battle is not named.
 */
async function windowBattles(db, { playerTag, since, until }) {
  const { rows } = await db.query(
    `select me.battle_id, me.battle_time, me.type, me.side, b.arena, b.league_number,
            me.outcome, me.crowns, me.trophy_change, me.starting_trophies
       from battle_participant me
       join battle b on b.battle_id = me.battle_id
      where me.player_tag = $1
        and me.battle_time > $2::timestamptz and me.battle_time <= $3::timestamptz
      order by me.battle_time, me.battle_id`,
    [playerTag, since, until],
  );
  return rows;
}

/** The chosen battle as facts: who it was against, the score, the change. */
async function describeBattle(db, playerTag, b) {
  const { rows: others } = await db.query(
    `select bp.player_tag, p.name, bp.side, bp.crowns, bp.starting_trophies
       from battle_participant bp left join player p on p.player_tag = bp.player_tag
      where bp.battle_id = $1 and bp.player_tag <> $2
      order by bp.side, bp.player_tag`,
    [b.battle_id, playerTag],
  );
  const opponents = others.filter((o) => o.side !== b.side);
  const opponent =
    opponents.length === 1
      ? {
          player_tag: opponents[0].player_tag,
          name: opponents[0].name ?? null,
          starting_trophies: opponents[0].starting_trophies ?? null,
        }
      : null;
  return {
    battle_id: b.battle_id,
    battle_time: b.battle_time.toISOString(),
    type: b.type,
    opponent,
    ...(opponent
      ? {}
      : {
          opponents: opponents.map((o) => ({
            player_tag: o.player_tag,
            name: o.name ?? null,
          })),
        }),
    crowns: b.crowns,
    crowns_against: opponents[0]?.crowns ?? null,
    trophy_change: b.trophy_change,
    ...(typeof b.starting_trophies === "number" &&
    typeof b.trophy_change === "number"
      ? { trophies_after: b.starting_trophies + b.trophy_change }
      : {}),
  };
}

/** The first Trophy Road win whose result reaches `floor`. */
function firstWinReaching(battles, floor) {
  return battles.find(
    (b) =>
      b.type === "PvP" &&
      b.outcome === "win" &&
      typeof b.starting_trophies === "number" &&
      typeof b.trophy_change === "number" &&
      b.starting_trophies < floor &&
      b.starting_trophies + b.trophy_change >= floor,
  );
}

async function arenaFloor(db, battles, { arenaId, arenaName }) {
  const {
    rows: [{ floor: snapshotFloor }],
  } = await db.query(
    `select min(trophies)::int as floor from player_snapshot_daily
      where arena_id = $1 and trophies is not null`,
    [arenaId],
  );
  const candidates = [snapshotFloor];
  for (const b of battles)
    if (
      arenaName &&
      b.type === "PvP" &&
      b.arena === arenaName &&
      b.outcome === "loss" &&
      b.trophy_change === null &&
      typeof b.starting_trophies === "number"
    )
      candidates.push(b.starting_trophies);
  const floors = candidates.filter((f) => typeof f === "number");
  return floors.length ? Math.min(...floors) : null;
}

async function promotionBattle(db, { playerTag, battles, arenaId, arenaName }) {
  if (battles.length === 0) return null;
  const floor = await arenaFloor(db, battles, { arenaId, arenaName });
  if (floor === null) return null;
  const win = firstWinReaching(battles, floor);
  if (!win) return null;
  return { ...(await describeBattle(db, playerTag, win)), arena_floor: floor };
}

async function bandBattle(db, { playerTag, battles, band }) {
  const win = firstWinReaching(battles, band);
  return win ? describeBattle(db, playerTag, win) : null;
}

async function rankedBattle(db, { playerTag, battles, league }) {
  const stamped = battles.filter(
    (b) => b.type === "pathOfLegend" && b.league_number === league - 1,
  );
  const last = stamped.at(-1);
  if (!last || last.outcome !== "win") return null;
  return describeBattle(db, playerTag, last);
}

async function nthWinBattle(db, { playerTag, battles, prevWins, wins, step }) {
  const won = battles.filter((b) => b.outcome === "win");
  if (won.length !== wins - prevWins) return null;
  const nth = won[step - prevWins - 1];
  return nth ? describeBattle(db, playerTag, nth) : null;
}

/**
 * The arena moment, from whichever writer saw the move first: the profile
 * (ledgerMilestones) or, since 2026-09-17, the roster (series.mjs), which
 * reads the member's arena up to 96 times a day where the profile reads
 * it every eight hours. `battles` is the window's battle list when the
 * caller already read it; otherwise it is read here.
 */
export async function arenaChangedMoment(
  db,
  { playerTag, from, to, toName, windowStart, windowEnd, receiptId, battles },
) {
  const list =
    battles ??
    (await windowBattles(db, {
      playerTag,
      since: windowStart,
      until: windowEnd,
    }));
  const promotion = await promotionBattle(db, {
    playerTag,
    battles: list,
    arenaId: to,
    arenaName: toName,
  });
  await emitEvent(db, "arena_changed", {
    tag: playerTag,
    windowStart,
    windowEnd,
    receiptId,
    occurredAt: promotion?.battle_time ?? null,
    payload: {
      from,
      to,
      to_name: toName,
      ...(promotion ? { promoted_by: promotion } : {}),
    },
  });
}

async function ledgerMilestones(
  db,
  { playerTag, prev, payload, fetchedAt, receiptId },
) {
  if (!prev) return;
  const windowStart = prev.observed_at
    ? prev.observed_at.toISOString()
    : fetchedAt;
  const write = (type, extra) =>
    emitEvent(db, type, {
      tag: playerTag,
      windowStart,
      windowEnd: fetchedAt,
      receiptId,
      payload: extra,
    });

  // The window's battles are read once, lazily: most polls cross nothing.
  let battles = null;
  const inWindow = async () =>
    (battles ??= await windowBattles(db, {
      playerTag,
      since: windowStart,
      until: fetchedAt,
    }));
  const pinned = (type, extra, battle, key) =>
    emitEvent(db, type, {
      tag: playerTag,
      windowStart,
      windowEnd: fetchedAt,
      receiptId,
      occurredAt: battle?.battle_time ?? null,
      payload: { ...extra, ...(battle ? { [key]: battle } : {}) },
    });

  const arena = payload.arena?.id ?? null;
  if (arena !== null && prev.arena_id !== null && arena !== prev.arena_id)
    await arenaChangedMoment(db, {
      playerTag,
      from: prev.arena_id,
      to: arena,
      toName: payload.arena?.name ?? null,
      windowStart,
      windowEnd: fetchedAt,
      receiptId,
      battles: await inWindow(),
    });

  if (crossed(prev.best_trophies, payload.bestTrophies, BEST_TROPHIES_BAND)) {
    const band =
      Math.floor(payload.bestTrophies / BEST_TROPHIES_BAND) *
      BEST_TROPHIES_BAND;
    const crossing = await bandBattle(db, {
      playerTag,
      battles: await inWindow(),
      band,
    });
    await pinned(
      "best_trophies_band",
      { best: payload.bestTrophies, band },
      crossing,
      "crossed_by",
    );
  }

  if (crossed(prev.wins, payload.wins, CAREER_WINS_STEP)) {
    const step = Math.floor(payload.wins / CAREER_WINS_STEP) * CAREER_WINS_STEP;
    const nth = await nthWinBattle(db, {
      playerTag,
      battles: await inWindow(),
      prevWins: prev.wins,
      wins: payload.wins,
      step,
    });
    await pinned(
      "career_wins_step",
      { wins: payload.wins, step },
      nth,
      "crossed_by",
    );
  }

  if (
    typeof payload.collectionLevel === "number" &&
    crossed(
      prev.collection_level,
      payload.collectionLevel,
      collectionLevelStep(payload.collectionLevel),
    )
  )
    await write("collection_level_step", {
      level: payload.collectionLevel,
      step: collectionLevelStep(payload.collectionLevel),
    });

  const league = payload.currentPathOfLegendSeasonResult?.leagueNumber ?? null;
  if (
    typeof league === "number" &&
    typeof prev.pol_league === "number" &&
    league > prev.pol_league
  ) {
    const promotion = await rankedBattle(db, {
      playerTag,
      battles: await inWindow(),
      league,
    });
    await pinned(
      "ranked_promotion",
      { from: prev.pol_league, to: league },
      promotion,
      "promoted_by",
    );
  }
}
