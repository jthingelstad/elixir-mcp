/**
 * The planning tick — DESIGN §5.1-§5.3.
 *
 * Order within a tick (the ordering IS the design):
 *   1. settle the global token bucket (budget_state singleton row);
 *   2. seed poll_state rows for new subjects;
 *   3. select eligible work: due (past the cadence) OR starved
 *      (past the fairness floor). Sort: starved FIRST (floors strictly
 *      dominate), then expected yield (bph x hours overdue), then
 *      overdue, then endpoint/tag for determinism;
 *   4. take at most the bulk share of available tokens, stamp
 *      last_planned_at, decrement tokens, return jobs.
 *
 * The live lane never goes through this planner — its reserve is the
 * budget the planner deliberately does not spend (live_reserve fraction).
 *
 * The player endpoints run the SESSION CLOCK since 2026-09-19 (NOTES that
 * day, "The session clock replayed, and what a week loses"). A battle is
 * about three minutes and the API's log holds 30, so a sitting fills it
 * in ~90 minutes; the recorder was losing 4.3% of all battles (~7,150 a
 * week) to sittings that started inside a long wait. The rule is one a
 * player can be told: while you are playing, your log is read every 30
 * minutes; after a read that found nothing the wait doubles, and never
 * passes the ceiling. Your profile is read once a day, and once after a
 * session. The yield EWMA (0017), the roster gate (2026-09-11), the
 * loss-aware burst bound and its A/B arm (2026-09-09) all retired with
 * it; the replay showed them to sit on the same cost/loss curve, and the
 * ceiling is the one dial. The reader cap (a subject somebody asked about
 * in the last day polls at least hourly) and the requested refresh (0101)
 * still cut through.
 */

import { inPreResetWindow, preResetWindowStart } from "@elixir-mcp/contracts";
import {
  settledPolMonths,
  inSeasonRollWindow,
  seasonRollWindowStartMs,
} from "../../ingest/src/war-clock.mjs";
import { ensureSeasonsAround } from "../../ingest/src/season.mjs";

const MINUTE = 60_000;

// Cadence table (minutes) — §5.3. Data, not code.
export const CADENCE = {
  // Player endpoints: the session clock (sessionCadenceMinutes); only
  // the fairness floor lives here, and it is a guarantee about the worst
  // case under a starved budget, never the schedule.
  player_battlelog: { floor: 1440 },
  // No fairness floor for profiles (2026-09-11): the daily read is the
  // cadence, the pre-reset watcher forces the one time-critical read.
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
 * Cadence in minutes for one poll_state row.
 *
 *  - battlelog: THE SESSION CLOCK. `empty_streak` is stamped at
 *    admission (pipeline.mjs): 0 when the log delivered battles, else one
 *    more than before. The wait is SESSION_FOLLOWUP_MINUTES x 2^streak,
 *    never above SESSION_CEILING_MINUTES; a row never stamped (a new
 *    subject) waits one follow-up - discovery, not dormancy. The reader
 *    cap can only shorten it.
 *  - player: once a day (PROFILE_DAILY_MINUTES; the snapshot is keyed by
 *    the game day), eight hours for a directly tracked player (a
 *    published promise), and a requested refresh - ingest asks after a
 *    session (pipeline.mjs, requestProfileAfterSession) or on arena
 *    evidence (0101) - is owed now.
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
const DAY = 86_400_000;
/** Membership events per hour (joins, departures, role changes; EWMA on
 *  the clan row's yield_bph) above which a tracked clan keeps its
 *  15-minute cadence even when nobody has been seen this hour: 3 a day. */
export const CLAN_CHURN_BPH = 3 / 24;

/** While a player is playing, the log is read this often. A battle is
 *  ~3 minutes and the log holds 30, so a sitting fills it in ~90 minutes;
 *  30 keeps every read inside a third of that. */
export const SESSION_FOLLOWUP_MINUTES = 30;
/** After a read that found nothing the wait doubles, and never passes
 *  this. Jamie, 2026-09-19: "start more aggressive" - the two-hour
 *  ceiling was the replay's zero-loss setting (9 over-capacity intervals
 *  in a week against 1,041; 2.75x the battlelog polls). Change it here
 *  and in the recording docs together; it is a published promise. */
export const SESSION_CEILING_MINUTES = 120;
/** The profile's day. */
export const PROFILE_DAILY_MINUTES = 1440;
/** Subjects a reader resolved in the last READ_TTL_HOURS poll at least
 *  every READ_CAP_MINUTES: the players people ask about must not be the
 *  ones parked on the ceiling. */
export const READ_CAP_MINUTES = 60;
export const READ_TTL_HOURS = 24;
/** A player explicitly present in an account's Tracking list gets a profile
 * at least every eight hours. Clan-wide comprehensive capture can still use
 * the daily cadence for members nobody follows directly. */
export const DIRECT_PROFILE_CAP_MINUTES = 480;

/** Whether ingest asked for this profile and no admission has served it
 *  yet (0101; and after a session since 2026-09-19). The in-flight window
 *  applies as it does to a floor. */
export function refreshRequested(row, now = new Date()) {
  if (row.endpoint !== "player" || !row.refresh_requested_at) return false;
  const asked = new Date(row.refresh_requested_at).getTime();
  const admitted = row.last_admitted_at
    ? new Date(row.last_admitted_at).getTime()
    : 0;
  const planned = row.last_planned_at
    ? new Date(row.last_planned_at).getTime()
    : 0;
  return (
    asked > admitted &&
    now.getTime() - planned >= IN_FLIGHT_SUPPRESSION_MINUTES * MINUTE
  );
}

/** Whether a reader asked about this subject within READ_TTL_HOURS. */
export function readCapApplies(row, now = new Date()) {
  if (!row.last_read_at) return false;
  const age = now.getTime() - new Date(row.last_read_at).getTime();
  return age < READ_TTL_HOURS * 3600_000;
}

/** The session clock's own wait for a battlelog row, before the cap. */
export function sessionWaitMinutes(row) {
  const streak =
    row.empty_streak === null || row.empty_streak === undefined
      ? 0
      : Math.max(0, Number(row.empty_streak));
  return Math.min(
    SESSION_CEILING_MINUTES,
    SESSION_FOLLOWUP_MINUTES * 2 ** Math.min(streak, 16),
  );
}

export function yieldCadenceMinutes(row, now = new Date()) {
  const bph =
    row.yield_bph === null || row.yield_bph === undefined
      ? null
      : Number(row.yield_bph);
  if (row.endpoint === "player_battlelog") {
    let cadence = sessionWaitMinutes(row);
    if (readCapApplies(row, now)) cadence = Math.min(cadence, READ_CAP_MINUTES);
    return cadence;
  }
  if (row.endpoint === "player") {
    return row.directly_tracked
      ? Math.min(PROFILE_DAILY_MINUTES, DIRECT_PROFILE_CAP_MINUTES)
      : PROFILE_DAILY_MINUTES;
  }
  if (row.endpoint === "currentriverrace") {
    return row.period_type === "training" ? 120 : 30;
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

// A subject the API answers 404 for (a location with no Path of Legends
// board, a clan the game has no race for) never admits, so the
// starvation floor found it "starved" every fifteen minutes forever:
// on 2026-09-19 that was 632 rankings_pol and 158 currentriverrace
// fetches a day, five percent of the one budget, each answered 404
// (location 57000006: ten plans in two and a half hours). While the
// last word from the API is 404 and nothing has admitted since, the
// subject is due once a day and never starved; a requested refresh and
// the pre-reset watcher still cut through.
const NOT_FOUND_BACKOFF_MINUTES = 1440;
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

async function selectEligible(db, now) {
  // reference freshness = the later of last plan and last admission; due
  // and starved both respect a short in-flight window so a pending job
  // isn't re-enqueued every tick.
  const { rows } = await db.query(
    `
    with state as (
      select ps.subject_tag, ps.endpoint, ps.last_planned_at, ps.last_admitted_at,
             ps.yield_bph, ps.hint, ps.period_type, ps.last_read_at,
             ps.refresh_requested_at, ps.empty_streak,
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
             greatest(coalesce(ps.last_planned_at, 'epoch'), coalesce(ps.last_admitted_at, 'epoch')) as reference,
             -- The API's last 404 for this subject inside the error
             -- table's seven-day retention (0143 indexes the lookup).
             (select max(e.fetched_at) from collector_fetch_error e
               where e.endpoint = ps.endpoint and e.entity_key = ps.subject_tag
                 and e.http_status = 404) as last_not_found_at
      from poll_state ps
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
           yield_bph, hint, period_type, last_read_at, refresh_requested_at, empty_streak,
           directly_tracked, clan_tracked, board_every, last_not_found_at
    from state`,
  );

  const nowMs = now.getTime();
  // The two watchers (§5.3): in the hour before the Monday-00:10Z
  // donation reset, and in the hour before the season rolls (first
  // Monday 10:00Z; 0111), profile polls are forced for every recorded
  // player not yet captured inside the window — the counter and the
  // season's league standing are irrecoverable after.
  const preReset = inPreResetWindow(now) || inSeasonRollWindow(now.getTime());
  const windowStartMs = inPreResetWindow(now)
    ? preResetWindowStart(now).getTime()
    : inSeasonRollWindow(now.getTime())
      ? seasonRollWindowStartMs(now.getTime())
      : 0;

  const eligible = [];
  let notFoundHeld = 0;
  for (const r of rows) {
    const cadence = CADENCE[r.endpoint];
    if (!cadence) continue;
    // Ingest asked for this profile: after a session, or on arena
    // evidence (0101). Direct evidence of activity, ranked with the
    // floors: one fetch, owed now. Served once an admission passes the
    // stamp.
    const requested = refreshRequested(r, now);
    const referenceMs = r.reference.getTime();
    const row = r;
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
    // Would the rule without the reader cap have made it due? Only the
    // difference is attributable to the cap (the metric that proves it).
    const dueUncapped = dailyBoard
      ? due
      : nowMs - referenceMs >=
        yieldCadenceMinutes({ ...row, last_read_at: null }, now) * jitter;
    const admittedMs = r.last_admitted_at ? r.last_admitted_at.getTime() : 0;
    const plannedMs = r.last_planned_at ? r.last_planned_at.getTime() : 0;
    const forcedPreReset =
      preReset &&
      r.endpoint === "player" &&
      admittedMs < windowStartMs &&
      plannedMs < windowStartMs;
    const notFoundMs = r.last_not_found_at ? r.last_not_found_at.getTime() : 0;
    const notFound = notFoundMs > admittedMs;
    if (notFound && !forcedPreReset && !requested) {
      if (
        nowMs - notFoundMs < NOT_FOUND_BACKOFF_MINUTES * MINUTE ||
        nowMs - plannedMs < IN_FLIGHT_SUPPRESSION_MINUTES * MINUTE
      ) {
        notFoundHeld += 1;
        continue;
      }
    }
    const starved =
      forcedPreReset ||
      requested ||
      (!notFound &&
        cadence.floor !== undefined &&
        nowMs - admittedMs >= cadence.floor * MINUTE &&
        nowMs - plannedMs >= IN_FLIGHT_SUPPRESSION_MINUTES * MINUTE);
    if (!due && !starved && !notFound) continue;
    const overdueMs = nowMs - referenceMs;
    eligible.push({
      subject_tag: r.subject_tag,
      endpoint: r.endpoint,
      starved,
      requested,
      // A battlelog read at the session follow-up: the player was playing
      // at the last read. The share of these is the session clock's work.
      followup:
        r.endpoint === "player_battlelog" &&
        due &&
        sessionWaitMinutes(r) === SESSION_FOLLOWUP_MINUTES,
      readCapped: due && !dueUncapped && !starved && readCapApplies(row, now),
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
  eligible.notFoundHeld = notFoundHeld;
  return eligible;
}

/**
 * Read-only view of what the next tick would find due, for the Status
 * page's "work waiting" gauge. Same query and same rules as the tick;
 * nothing is stamped or spent.
 */
export async function eligibleNow(db, now = new Date()) {
  return selectEligible(db, now);
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
export async function planTick(db, now = new Date()) {
  const { tokens, liveReserve } = await settleBudget(db, now);
  await seedPollState(db, now);
  // The season rollover (0104): the running season and the next one are
  // rows before the roll, so the tools' default window never finds a
  // gap. Two idempotent inserts a tick.
  await ensureSeasonsAround(db, now.getTime());

  const bulkBudget = Math.floor(tokens * (1 - liveReserve));
  if (bulkBudget <= 0)
    return {
      jobs: [],
      tokens,
      bulkBudget,
      followup: 0,
      readCapped: 0,
      requested: 0,
    };

  const eligible = await selectEligible(db, now);
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
    followup: selected.filter((j) => j.followup).length,
    readCapped: selected.filter((j) => j.readCapped).length,
    requested: selected.filter((j) => j.requested).length,
    notFoundHeld: eligible.notFoundHeld ?? 0,
  };
}
