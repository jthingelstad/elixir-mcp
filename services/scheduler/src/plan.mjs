/**
 * The planning tick — DESIGN §5.1-§5.3. Yield-only since 2026-09-05:
 * the legacy heat model retired after the full-day A/B (half the spend
 * at equal-or-better per-fetch yield; NOTES). The heat COLUMN remains
 * in poll_state, dormant.
 *
 * Order within a tick (the ordering IS the design):
 *   1. settle the global token bucket (budget_state singleton row);
 *   2. seed poll_state rows for new subjects;
 *   3. select eligible work: due (past the yield cadence) OR starved
 *      (past the fairness floor). Sort: starved FIRST (floors strictly
 *      dominate), then expected yield (bph x hours overdue), then
 *      overdue, then endpoint/tag for determinism;
 *   4. take at most the bulk share of available tokens, stamp
 *      last_planned_at, decrement tokens, return jobs.
 *
 * The live lane never goes through this planner — its reserve is the
 * budget the planner deliberately does not spend (live_reserve fraction).
 *
 * Two bounds sit on top of the battlelog cadence since 2026-09-09
 * (docs/FETCH-LOOP-AUDIT-2026-09-09.md): a LOSS-AWARE bound from the
 * player's fastest recent log fill (burst_bph, stamped at admission from
 * battle timestamps), and a READER cap for subjects somebody asked about
 * in the last day (last_read_at, stamped at subject resolution). Both
 * only ever shorten a cadence; NULL means "no signal" and the rule is
 * byte-identical to before. The loss bound ships behind an A/B arm
 * (ELIXIR_LOSS_BOUND = off | half | all) so ab_yield can read both arms
 * over the same clock hours.
 */

import { inPreResetWindow, preResetWindowStart } from "@elixir-mcp/contracts";
import { settledPolMonths } from "../../ingest/src/war-clock.mjs";

const MINUTE = 60_000;

// Cadence table (minutes) — §5.3. Data, not code.
export const CADENCE = {
  // Player endpoints: cadence comes from yieldCadenceMinutes (yield_bph
  // signal with explicit unknown-activity defaults); only the fairness
  // floor lives here.
  player_battlelog: { floor: 1440 },
  // No fairness floor for profiles since 2026-09-11 (Jamie: players may
  // be idle and we owe them no snapshot): a profile is polled when the
  // roster says its owner has been in the game since the last one, on
  // an eight-hour minimum, and the pre-reset watcher still forces the
  // one time-critical read.
  player: {},
  // Clan: cadence comes from yieldCadenceMinutes (liveliness and churn
  // stamped by the roster projector, and whether anyone tracks the clan);
  // only the fairness floor lives here. Was a flat 15 minutes - the
  // elixir-bot roster heartbeat inherited verbatim - until 2026-09-11,
  // when 288 clans (258 of them polled only because a ranked player is a
  // member) made it 31% of every fetch the recorder had ever made.
  clan: { floor: 2880 },
  currentriverrace: { every: 30, floor: 120 },
  // Daily log poll: backfill at enrollment IS the first poll; thereafter
  // it heals gaps and delivers final standings (rank/trophyChange).
  riverracelog: { every: 1440, floor: 2880 },
  // Daily global catalog: one fetch serves every tenant (get_card_catalog,
  // level normalization backfills). Missing this starved prod of maxLevel
  // truth — found live 2026-09-03.
  cards: { every: 1440, floor: 2880 },
  // Leaderboards (0068): the default is daily, and a board's own row in
  // ranking_board overrides it. Daily boards are anchored to the
  // board-day (boardDayStartMs), so `every` here only matters for a row
  // that asks for less than a day. The global board was hourly until
  // 0075 (2026-09-11).
  rankings_pol: { every: 1440, floor: 2880 },
  rankings_players: { every: 1440, floor: 2880 },
  // 0069. A season's final board is fetched ONCE (see selectEligible: due
  // while no snapshot for that season exists), so its cadence is moot but
  // the floor keeps a failed fetch retried daily rather than every tick.
  rankings_pol_season: { every: 1440, floor: 1440 },
  rankings_clans_loc: { every: 1440, floor: 2880 },
  rankings_clanwars: { every: 1440, floor: 2880 },
  leaderboards: { every: 1440, floor: 2880 },
  leaderboard: { every: 1440, floor: 2880 },
  events: { every: 1440, floor: 2880 },
  globaltournaments: { every: 1440, floor: 2880 },
};

/**
 * Yield-mode cadence in minutes for one poll_state row. One activity
 * signal drives the player endpoints: yield_bph, the EWMA of observed
 * battles-per-hour (0017, updated at admission).
 *
 *  - battlelog: poll when ~TARGET_BATCH battles are expected to have
 *    accumulated (harvest efficiency), clamped [15m, 1440m]. Unknown
 *    activity seeds at 60m — discovery, not dormancy.
 *  - player: profile stretches with the same signal (a dormant player's
 *    snapshot barely changes), clamped [120m, 4320m].
 *  - currentriverrace: the payload NAMES war days (hint = periodType);
 *    warDay/colosseum poll at 30m, training at 120m, unknown at 30m.
 *  - clan: who cares x how alive it is now (2026-09-11). A TRACKED
 *    clan (an active clan recording) reads every 15m while members are
 *    in the game, 60m when nobody has been for an hour (15m if it is
 *    churning members, >=3 events/day), 4h when nobody for a day. An
 *    INCIDENTAL clan (polled only because a recorded player is in it)
 *    reads at 4h / 12h / 24h on the same three states; its members'
 *    profile polls carry their clan tag, so membership history is never
 *    lost, only coarser. Unknown liveliness (a row never stamped) takes
 *    the active branch: discovery, not dormancy.
 *  - riverracelog / cards: fixed cadences unchanged — flat and cheap.
 */
const TARGET_BATCH = 5;
const DAY = 86_400_000;
/** Membership events per hour (joins, departures, role changes; EWMA on
 *  the clan row's yield_bph) above which a tracked clan keeps its
 *  15-minute cadence even when nobody has been seen this hour: 3 a day. */
export const CLAN_CHURN_BPH = 3 / 24;

/** The battlelog holds ~30 entries (measured: 1,578 of 2,000 payloads had
 *  exactly 30; the rest more). Loss math uses 30. */
export const LOG_CAPACITY = 30;
/** Poll before HALF the fastest observed fill time has elapsed, so a burst
 *  that starts right after a poll still cannot roll the log. Modelled
 *  2026-09-09: loss 3.7% -> 1.0% for +50% battlelog fetches at 0.5. */
export const LOSS_SAFETY = 0.5;
/** A burst older than this no longer bounds the cadence. */
export const BURST_TTL_DAYS = 14;
/** Subjects a reader resolved in the last READ_TTL_HOURS poll at least
 *  every READ_CAP_MINUTES: the players people ask about must not be the
 *  ones parked on the 24h fairness clamp (three of seven were, live). */
export const READ_CAP_MINUTES = 60;
export const READ_TTL_HOURS = 24;
/** A player explicitly present in an account's Tracking list gets a profile
 * at least every eight hours. Clan-wide comprehensive capture can still use
 * the yield cadence for members nobody follows directly. */
export const DIRECT_PROFILE_CAP_MINUTES = 480;
/** The roster gate (2026-09-11, review §4 / §10.2). A clan roster carries
 *  the game's own lastSeen for ~50 players at 2.2 KB; a player whose
 *  lastSeen has not moved since their last battlelog or profile poll has
 *  no new battles and no changed profile, so that poll is skipped. A
 *  session in progress is the one hazard - lastSeen may mark its start -
 *  so a sighting younger than this many hours never gates. Only a roster
 *  admitted AFTER the poll in question can gate it, and only a TRACKED
 *  clan's roster (read every 15-60 min while members play): an incidental
 *  clan's roster is read every 4-24 h, and in the gate's first day those
 *  rosters held back polls of players who then played a whole 25-battle
 *  session before the roster noticed (capture gaps 0.13% -> 1.5%,
 *  2026-09-12). Measured, decided, recorded in NOTES. */
export const ROSTER_GATE_SESSION_HOURS = 2;
/** Profile minimum interval once the roster says the player was active. */
export const PROFILE_ACTIVE_MINUTES = 480;

/** Whether a fresh roster shows this player idle since their last poll. */
export function rosterGated(row, now = new Date()) {
  if (row.endpoint !== "player_battlelog" && row.endpoint !== "player")
    return false;
  if (
    !row.roster_tracked ||
    !row.roster_admitted_at ||
    !row.game_last_seen_at ||
    !row.last_admitted_at
  )
    return false;
  const roster = new Date(row.roster_admitted_at).getTime();
  const seen = new Date(row.game_last_seen_at).getTime();
  const polled = new Date(row.last_admitted_at).getTime();
  return (
    roster > polled &&
    seen <= polled &&
    now.getTime() - seen > ROSTER_GATE_SESSION_HOURS * 3600_000
  );
}

/**
 * Minutes the loss-aware bound allows, or null when the row carries no
 * usable burst signal. burst_bph is derived from battle TIMESTAMPS at
 * admission, so unlike the yield EWMA it still knows the true rate after a
 * poll that already overflowed (the EWMA can only ever see 30 / interval).
 */
export function lossBoundMinutes(row, now = new Date()) {
  const burst =
    row.burst_bph === null || row.burst_bph === undefined
      ? null
      : Number(row.burst_bph);
  if (!(burst > 0)) return null;
  const at = row.burst_at ? new Date(row.burst_at).getTime() : 0;
  if (now.getTime() - at > BURST_TTL_DAYS * DAY) return null;
  return Math.max(15, ((LOSS_SAFETY * LOG_CAPACITY) / burst) * 60);
}

/** Whether a reader asked about this subject within READ_TTL_HOURS. */
export function readCapApplies(row, now = new Date()) {
  if (!row.last_read_at) return false;
  const age = now.getTime() - new Date(row.last_read_at).getTime();
  return age < READ_TTL_HOURS * 3600_000;
}

export function yieldCadenceMinutes(row, now = new Date()) {
  const bph =
    row.yield_bph === null || row.yield_bph === undefined
      ? null
      : Number(row.yield_bph);
  if (row.endpoint === "player_battlelog") {
    let cadence;
    if (bph === null) cadence = 60;
    else if (bph <= 0.02) cadence = 1440;
    else cadence = Math.min(1440, Math.max(15, (TARGET_BATCH / bph) * 60));
    const bound = lossBoundMinutes(row, now);
    if (bound !== null) cadence = Math.min(cadence, bound);
    if (readCapApplies(row, now)) cadence = Math.min(cadence, READ_CAP_MINUTES);
    return cadence;
  }
  if (row.endpoint === "player") {
    // With a roster fresher than the last profile poll, the gate decides
    // whether the player was active at all; the cadence is then a flat
    // eight hours (2026-09-11). Without roster information the activity
    // buckets below stand.
    if (
      row.roster_admitted_at &&
      row.last_admitted_at &&
      new Date(row.roster_admitted_at).getTime() >
        new Date(row.last_admitted_at).getTime()
    ) {
      return row.directly_tracked
        ? Math.min(PROFILE_ACTIVE_MINUTES, DIRECT_PROFILE_CAP_MINUTES)
        : PROFILE_ACTIVE_MINUTES;
    }
    // The profile row's OWN yield_bph is never written -- ingest records
    // activity against the battlelog row only -- so this read borrowed NULL
    // forever and every branch below the first was unreachable. Profiles
    // polled every 8h regardless of whether the player had touched the game
    // in a month, roughly 9x the intended rate for a dormant one, and the
    // cohort did it in lockstep (the 2026-09-08 capture spikes).
    const activity =
      row.activity_bph === null || row.activity_bph === undefined
        ? bph
        : Number(row.activity_bph);
    let cadence;
    if (activity === null) cadence = 480;
    else if (activity <= 0.02) cadence = 4320;
    // Active players used to take 120m here, which was 70% of all profile
    // spend (measured 2026-09-09) for a projection that is a DAILY
    // snapshot; the pre-reset watcher forces the one time-critical read.
    else if (activity >= 0.5) cadence = 480;
    else cadence = 1440;
    return row.directly_tracked
      ? Math.min(cadence, DIRECT_PROFILE_CAP_MINUTES)
      : cadence;
  }
  if (row.endpoint === "currentriverrace") {
    return row.hint === "training" ? 120 : 30;
  }
  if (row.endpoint === "clan") {
    const live = row.hint ?? "active";
    const churning = bph !== null && bph >= CLAN_CHURN_BPH;
    if (row.clan_tracked) {
      if (live === "active") return 15;
      if (live === "idle") return churning ? 15 : 60;
      return 240;
    }
    if (live === "active") return 240;
    if (live === "idle") return 720;
    return 1440;
  }
  if (BOARD_ENDPOINTS.has(row.endpoint) && row.board_every != null) {
    return Number(row.board_every);
  }
  return CADENCE[row.endpoint].every;
}

/**
 * The loss bound's A/B arm. `half` applies it to the stable half of the
 * population whose jitter phase is below 1 (a hash, so the arms are the
 * same subjects every tick and ab_yield can split receipts the same way);
 * `all` promotes it; anything else is off.
 */
export function lossBoundArm(env = process.env) {
  const v = env.ELIXIR_LOSS_BOUND;
  return v === "all" || v === "half" ? v : "off";
}

export function inLossBoundArm(subjectTag, arm) {
  if (arm === "all") return true;
  if (arm === "half") return jitterFactor(subjectTag, "player_battlelog") < 1;
  return false;
}

/**
 * Per-subject phase offset, so cohorts cannot stay in lockstep.
 *
 * Every cadence above is a pure function of a subject's state, and due-ness
 * is `now - reference >= cadence`. Two subjects seeded in the same moment
 * with the same state are therefore due in the same moment, forever. Adding
 * a batch of clans enrolls their members together, and the whole cohort
 * polls as one — observed live 2026-09-08 as three spikes at 23:00, 07:00
 * and 15:00 UTC, exactly 8h apart and 3.4x the hourly baseline.
 *
 * That is bad beyond the ugly graph: it wastes the token bucket in bursts
 * while leaving it idle between, it makes every spike compete with the live
 * lane's reserve, and it concentrates load on whichever collector wins the
 * lease race.
 *
 * The offset is a STABLE hash of (subject, endpoint), not a random number.
 * Re-rolling each tick would leave the cohort clustered on average and merely
 * add noise; a stable factor also makes planning reproducible, which the
 * deterministic tie-break in this file depends on. Because it is
 * multiplicative, subjects drift apart a little further every cycle -- two
 * subjects at the extremes separate by 0.3 x cadence per poll, so a cohort
 * is fully de-phased within a few cycles rather than merely smeared.
 *
 * Applied to CADENCE only, never to the fairness floor: a floor is a
 * guarantee about the worst case, not a schedule to be nudged.
 */
export const JITTER_SPREAD = 0.3; // +/-15%

export function jitterFactor(subjectTag, endpoint) {
  // FNV-1a. Cheap, stable across processes, and well distributed over the
  // short ASCII keys we hash -- tags and endpoint names.
  let h = 2166136261;
  const key = `${subjectTag}:${endpoint}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const frac = (h >>> 0) / 4294967296;
  return 1 + (frac - 0.5) * JITTER_SPREAD;
}

const IN_FLIGHT_SUPPRESSION_MINUTES = 15;
export const BUCKET_CAP_SECONDS = 300; // small carryover; never a quota multiplier

/** A daily leaderboard is read once per board-day, and the board-day
 *  starts at 10:00Z: the hour the Path of Legends season rolls, so a
 *  season's last daily snapshot is the board as it stood going into the
 *  roll (Jamie, 2026-09-11: daily at the reset, not hourly). A board
 *  whose row says less than a day keeps its own cadence (0068). */
export const BOARD_DAY_ANCHOR_HOUR_UTC = 10;

/** Start of the current board-day: the most recent 10:00Z. */
export function boardDayStartMs(nowMs) {
  const d = new Date(nowMs);
  const today = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    BOARD_DAY_ANCHOR_HOUR_UTC,
  );
  return nowMs >= today ? today : today - DAY;
}

/** Endpoints planned from ranking_board rows rather than recordings, with
 *  the endpoint -> board name the row is found under (0068/0069). */
const BOARD_OF = {
  rankings_pol: "pol",
  rankings_players: "trophy",
  rankings_clans_loc: "clans",
  rankings_clanwars: "clanwars",
  leaderboard: "mode",
};
const BOARD_ENDPOINTS = new Set(Object.keys(BOARD_OF));
/** SQL for the same map, so the eligibility query and the seed agree. */
const BOARD_OF_SQL = `case ps.endpoint
  when 'rankings_pol' then 'pol' when 'rankings_players' then 'trophy'
  when 'rankings_clans_loc' then 'clans' when 'rankings_clanwars' then 'clanwars'
  when 'leaderboard' then 'mode' end`;

export async function settleBudget(db, now) {
  const {
    rows: [b],
  } = await db.query(
    "select tokens, rate_per_sec, live_reserve, settled_at from budget_state",
  );
  const elapsedSec = Math.max(
    0,
    (now.getTime() - b.settled_at.getTime()) / 1000,
  );
  const cap = Number(b.rate_per_sec) * BUCKET_CAP_SECONDS;
  const tokens = Math.min(
    cap,
    Number(b.tokens) + Number(b.rate_per_sec) * elapsedSec,
  );
  await db.query("update budget_state set tokens = $1, settled_at = $2", [
    tokens,
    now,
  ]);
  return { tokens, liveReserve: Number(b.live_reserve) };
}

async function seedPollState(db, now = new Date()) {
  // Player endpoints for actively recorded players; clan endpoint for
  // followed clans (clan auto-follow: derived from recorded players'
  // profile stamps, §4.2).
  // scope decides whether we go and get the battles. 'activity' on a
  // player is profile-only; 'comprehensive' adds the battlelog. Same
  // word, same meaning as on a clan (0043).
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    select r.subject_tag, e.endpoint
    from recording r cross join (values ('player_battlelog'), ('player')) e(endpoint)
    where r.subject_type = 'player' and r.status = 'active'
      and (e.endpoint = 'player' or r.scope = 'comprehensive')
    on conflict do nothing`);
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    select distinct p.last_known_clan_tag, 'clan'
    from recording r
    join player p on p.player_tag = r.subject_tag
    where r.subject_type = 'player' and r.status = 'active'
      and p.last_known_clan_tag is not null
    on conflict do nothing`);
  // The global card catalog is subject-less: one GLOBAL row.
  await db.query(`
    insert into poll_state (subject_tag, endpoint) values ('GLOBAL', 'cards')
    on conflict do nothing`);
  // Leaderboards (0068/0069): one row per enabled board, keyed by the
  // board's location_key (a location, or a game-mode board's id). Disabled
  // boards fall out through the eligibility clause.
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    select b.location_key,
           case b.board
             when 'pol' then 'rankings_pol' when 'trophy' then 'rankings_players'
             when 'clans' then 'rankings_clans_loc' when 'clanwars' then 'rankings_clanwars'
             when 'mode' then 'leaderboard' end
    from ranking_board b
    where b.enabled and b.board in ('pol', 'trophy', 'clans', 'clanwars', 'mode')
    on conflict do nothing`);
  // The subject-less daily reads (0069), GLOBAL like the card catalog.
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    values ('GLOBAL', 'leaderboards'), ('GLOBAL', 'events'), ('GLOBAL', 'globaltournaments')
    on conflict do nothing`);
  // Season finals (0069, keyed by month since 0070): a row per settled
  // season under the API's own name for it - `2022-10`, the ranked
  // ladder's first, through the month that rolled most recently. The
  // current season's board is not final until it rolls; the tick after
  // the roll adds its row.
  await db.query(
    `
    insert into poll_state (subject_tag, endpoint)
    select m, 'rankings_pol_season' from unnest($1::text[]) m
    on conflict do nothing`,
    [settledPolMonths(now.getTime())],
  );
  // Clan recording (V1.5): the clan's own heartbeat + riverrace capture
  // for EVERY clan scope; player endpoints for every OPEN member only at
  // scope 'comprehensive' (0023). Roster-driven: joins get seeded
  // on the tick after the roster observes them; leavers (and members of
  // clans downgraded to 'activity') fall out via the eligibility clause
  // (their poll_state rows go dormant).
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    select r.subject_tag, e.endpoint
    from recording r cross join (values ('clan'), ('currentriverrace'), ('riverracelog')) e(endpoint)
    where r.subject_type = 'clan' and r.status = 'active'
    on conflict do nothing`);
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    select cm.player_tag, e.endpoint
    from recording r
    join clan_membership cm on cm.clan_tag = r.subject_tag and cm.left_observed_at is null
    cross join (values ('player_battlelog'), ('player')) e(endpoint)
    where r.subject_type = 'clan' and r.status = 'active'
      and r.scope = 'comprehensive'
    on conflict do nothing`);
}

async function selectEligible(db, now, arm) {
  // reference freshness = the later of last plan and last admission; due
  // and starved both respect a short in-flight window so a pending job
  // isn't re-enqueued every tick.
  const { rows } = await db.query(
    `
    with state as (
      select ps.subject_tag, ps.endpoint, ps.last_planned_at, ps.last_admitted_at,
             ps.yield_bph, ps.hint, ps.burst_bph, ps.burst_at, ps.last_read_at,
             -- Activity is only ever recorded on the battlelog row (ingest
             -- writes yield_bph there and nowhere else), so a profile row
             -- has to borrow it. Without this the 'player' cadence saw NULL
             -- forever and every profile polled on the 480m branch.
             (select b.yield_bph from poll_state b
               where b.subject_tag = ps.subject_tag
                 and b.endpoint = 'player_battlelog') as activity_bph,
             exists (select 1 from claim c
                     where c.player_tag = ps.subject_tag) as directly_tracked,
             -- A clan someone asked us to record, as opposed to one we read
             -- only because a recorded player is in it (the clan cadence).
             (ps.endpoint = 'clan' and exists (
                select 1 from recording r
                where r.subject_type = 'clan' and r.subject_tag = ps.subject_tag
                  and r.status = 'active')) as clan_tracked,
             -- A leaderboard's own cadence (0068): the global board is
             -- hourly, everything else daily unless its row says otherwise.
             (select b.every_minutes from ranking_board b
               where b.location_key = ps.subject_tag
                 and b.board = ${BOARD_OF_SQL}) as board_every,
             -- The roster gate's two inputs (2026-09-11): the game's own
             -- lastSeen for this player, and when their clan's roster was
             -- last admitted. Null for anything that is not a player row.
             pl.game_last_seen_at,
             (select cps.last_admitted_at from poll_state cps
               where cps.subject_tag = pl.last_known_clan_tag
                 and cps.endpoint = 'clan') as roster_admitted_at,
             -- Only a tracked clan's roster is fresh enough to gate
             -- (2026-09-12); an incidental one is read every 4-24 h.
             (ps.endpoint in ('player_battlelog', 'player') and exists (
                select 1 from recording r
                where r.subject_type = 'clan' and r.subject_tag = pl.last_known_clan_tag
                  and r.status = 'active')) as roster_tracked,
             greatest(coalesce(ps.last_planned_at, 'epoch'), coalesce(ps.last_admitted_at, 'epoch')) as reference
      from poll_state ps
      left join player pl on pl.player_tag = ps.subject_tag
        and ps.endpoint in ('player_battlelog', 'player')
      where (ps.endpoint in ('player_battlelog', 'player') and (
               exists (
                 select 1 from recording r
                 where r.subject_type = 'player' and r.subject_tag = ps.subject_tag and r.status = 'active'
                   and (ps.endpoint = 'player' or r.scope = 'comprehensive'))
               or exists (
                 select 1 from recording r
                 join clan_membership cm on cm.clan_tag = r.subject_tag
                   and cm.player_tag = ps.subject_tag and cm.left_observed_at is null
                 where r.subject_type = 'clan' and r.status = 'active'
                   and r.scope = 'comprehensive')))
         or (ps.endpoint = 'clan' and (
               exists (
                 select 1 from recording r join player p on p.player_tag = r.subject_tag
                 where r.subject_type = 'player' and r.status = 'active'
                   and p.last_known_clan_tag = ps.subject_tag)
               or exists (
                 select 1 from recording r
                 where r.subject_type = 'clan' and r.subject_tag = ps.subject_tag and r.status = 'active')))
         or (ps.endpoint in ('cards', 'leaderboards', 'events', 'globaltournaments')
             and ps.subject_tag = 'GLOBAL')
         or (ps.endpoint in ('rankings_pol', 'rankings_players', 'rankings_clans_loc', 'rankings_clanwars', 'leaderboard')
             and exists (
               select 1 from ranking_board b
               where b.location_key = ps.subject_tag and b.enabled
                 and b.board = ${BOARD_OF_SQL}))
         -- A season's final is wanted exactly until we hold it.
         or (ps.endpoint = 'rankings_pol_season' and not exists (
               select 1 from ranking_snapshot s
               where s.board = 'pol_final' and s.season_month = ps.subject_tag))
         or (ps.endpoint in ('currentriverrace', 'riverracelog') and exists (
               select 1 from recording r
               where r.subject_type = 'clan' and r.subject_tag = ps.subject_tag and r.status = 'active'))
    )
    select subject_tag, endpoint, last_planned_at, last_admitted_at, reference,
           yield_bph, hint, burst_bph, burst_at, last_read_at,
           -- The 2026-09-08 borrow computed this in the CTE and never
           -- re-selected it here, so yieldCadenceMinutes saw undefined,
           -- fell back to the profile row's own NULL yield_bph, and every
           -- profile kept polling on the 480 branch (measured: 33/h before,
           -- 35/h after). Found by the 2026-09-09 fetch-loop audit.
           activity_bph, directly_tracked, clan_tracked, board_every,
           game_last_seen_at, roster_admitted_at, roster_tracked
    from state`,
  );

  const nowMs = now.getTime();
  // Season-roll watcher (§5.3, V1): in the hour before the Monday-00:10Z
  // donation reset, profile polls are forced for every recorded player not
  // yet captured inside the window — the counter is irrecoverable after.
  const preReset = inPreResetWindow(now);
  const windowStartMs = preReset ? preResetWindowStart(now).getTime() : 0;

  const eligible = [];
  let gated = 0;
  for (const r of rows) {
    const cadence = CADENCE[r.endpoint];
    if (!cadence) continue;
    // The roster gate: a fresh roster that shows this player idle since
    // their last poll means the poll would return what we hold.
    if (rosterGated(r, now)) {
      gated += 1;
      continue;
    }
    const referenceMs = r.reference.getTime();
    // Control-arm subjects never see their burst signal; the reader cap
    // ships to everyone (it is cheap and the freshness win is the point).
    const row = inLossBoundArm(r.subject_tag, arm)
      ? r
      : { ...r, burst_bph: null, burst_at: null };
    const jitter = jitterFactor(r.subject_tag, r.endpoint) * MINUTE;
    // A daily board is due once per board-day, anchored, not once per
    // elapsed day: every daily board reads in the tick after 10:00Z.
    const dailyBoard =
      BOARD_ENDPOINTS.has(r.endpoint) &&
      r.board_every != null &&
      Number(r.board_every) >= 1440;
    const due = dailyBoard
      ? referenceMs < boardDayStartMs(nowMs)
      : nowMs - referenceMs >= yieldCadenceMinutes(row, now) * jitter;
    // Would the unbounded rule have made it due? Only the difference is
    // attributable to the bounds (the metric that proves them).
    const dueUnbounded = dailyBoard
      ? due
      : nowMs - referenceMs >=
        yieldCadenceMinutes(
          { ...row, burst_bph: null, burst_at: null, last_read_at: null },
          now,
        ) *
          jitter;
    const admittedMs = r.last_admitted_at ? r.last_admitted_at.getTime() : 0;
    const plannedMs = r.last_planned_at ? r.last_planned_at.getTime() : 0;
    const forcedPreReset =
      preReset &&
      r.endpoint === "player" &&
      admittedMs < windowStartMs &&
      plannedMs < windowStartMs;
    const starved =
      forcedPreReset ||
      (cadence.floor !== undefined &&
        nowMs - admittedMs >= cadence.floor * MINUTE &&
        nowMs - plannedMs >= IN_FLIGHT_SUPPRESSION_MINUTES * MINUTE);
    if (!due && !starved) continue;
    const overdueMs = nowMs - referenceMs;
    eligible.push({
      subject_tag: r.subject_tag,
      endpoint: r.endpoint,
      starved,
      bounded:
        due && !dueUnbounded && !starved && lossBoundMinutes(row, now) !== null,
      readCapped: due && !dueUnbounded && !starved && readCapApplies(row, now),
      overdueMs,
      expectedYield:
        (r.yield_bph === null ? 0.5 : Number(r.yield_bph)) *
        (overdueMs / 3600_000),
    });
  }

  // Starved first (fairness floors strictly dominate everything), then
  // expected harvest (bph x hours-overdue: a busy subject a little
  // overdue outranks a dormant one long overdue - floors bound the
  // wait), then most-overdue, then deterministic tie-break.
  eligible.sort(
    (a, b) =>
      Number(b.starved) - Number(a.starved) ||
      b.expectedYield - a.expectedYield ||
      b.overdueMs - a.overdueMs ||
      a.endpoint.localeCompare(b.endpoint) ||
      a.subject_tag.localeCompare(b.subject_tag),
  );
  eligible.gated = gated;
  return eligible;
}

/**
 * Read-only view of what the next tick would find due, for the Status
 * page's "work waiting" gauge. Same query and same rules as the tick;
 * nothing is stamped or spent.
 */
export async function eligibleNow(db, now = new Date(), arm = lossBoundArm()) {
  return selectEligible(db, now, arm);
}

/** Count eligible rows by endpoint, and how many are starved (past a
 *  fairness floor rather than merely due). */
export function queueSummary(eligible) {
  const by_endpoint = {};
  let starved = 0;
  for (const e of eligible) {
    by_endpoint[e.endpoint] = (by_endpoint[e.endpoint] ?? 0) + 1;
    if (e.starved) starved += 1;
  }
  return { due: eligible.length, starved, by_endpoint };
}

/**
 * One planning tick. Returns the jobs to enqueue on the bulk lane.
 * @param {import('pg').Client} db
 * @param {Date} now injectable for tests
 */
export async function planTick(
  db,
  now = new Date(),
  { arm = lossBoundArm() } = {},
) {
  const { tokens, liveReserve } = await settleBudget(db, now);
  await seedPollState(db, now);

  const bulkBudget = Math.floor(tokens * (1 - liveReserve));
  if (bulkBudget <= 0)
    return { jobs: [], tokens, bulkBudget, bounded: 0, readCapped: 0 };

  const eligible = await selectEligible(db, now, arm);
  const selected = eligible.slice(0, bulkBudget);

  for (const job of selected) {
    await db.query(
      `update poll_state set last_planned_at = $3 where subject_tag = $1 and endpoint = $2`,
      [job.subject_tag, job.endpoint, now],
    );
  }
  if (selected.length > 0) {
    await db.query("update budget_state set tokens = tokens - $1", [
      selected.length,
    ]);
  }

  return {
    jobs: selected.map((j) => ({
      endpoint: j.endpoint,
      entity_key: j.subject_tag,
      lane: "bulk",
    })),
    tokens,
    bulkBudget,
    bounded: selected.filter((j) => j.bounded).length,
    readCapped: selected.filter((j) => j.readCapped).length,
    gated: eligible.gated ?? 0,
  };
}
