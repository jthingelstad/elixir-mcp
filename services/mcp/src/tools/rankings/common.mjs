/** Shared by the rankingsTools tools in this directory: the helpers,
 *  argument schemas and notes more than one of them uses. Split out of
 *  tools/rankings.mjs (2026-09-23), one file per tool. */

import { resolveInstant } from "../../time.mjs";
import {
  monthForSeasonId,
  nextSeasonStartMs,
  seasonFromDate,
  seasonIdForMonth,
} from "../../../../ingest/src/war-clock.mjs";
import { ToolFailure, liveRead, zoneFor } from "../shared.mjs";

export const BOARD_SCHEMA = {
  type: "string",
  enum: ["pol", "trophy", "pol_final", "mode"],
  default: "pol",
  description:
    "pol is the live Path of Legends board (the API's top 1,000: everyone above the rating floor while fewer than 1,000 are rated, a top-1,000 slice once the board is full; recorded daily at the 10:00Z reset); pol_final is a season's FINAL Path of Legends standing, the API's 9,999 places (the tail is cut at #9999, mid-tie), one per season since the ranked ladder's first (October 2022, S89 as game_clock counts) - pass `season`; mode is a game-mode leaderboard (Merge Tactics, Touchdown...) - pass its id as `location`, rankings_players with location 'list' names them; trophy is the Trophy Road board, which the API has served EMPTY for recent seasons.",
};

export const SEASON_SCHEMA = {
  type: ["integer", "string"],
  description:
    "With board pol_final: which season's final board - the season number as game_clock counts it (135 for August 2026), or the API's own name for the season, the month it started in (2026-08). Omitted means the most recent final we hold. The snapshot carries both spellings.",
};

export const LOCATION_SCHEMA = {
  type: "string",
  default: "global",
  description:
    "global (default), a numeric CR location id (57000249), or a two-letter country code (US, JP). With board mode: its leaderboard id, or location 'list' on rankings_players to discover the recorded catalog. The service records every location the API lists.",
};

export const AS_OF_SCHEMA = {
  type: "string",
  description:
    "Read the board as it was on or before this instant: an ISO timestamp, or YYYY-MM-DD meaning the end of that day in the account's timezone (or the call's `timezone`). Omitted means the latest snapshot.",
};

/** poll_state endpoint per board, for the freshness in meta. */
export const ENDPOINT_OF = {
  pol: "rankings_pol",
  trophy: "rankings_players",
  pol_final: "rankings_pol_season",
  mode: "leaderboard",
  clans: "rankings_clans_loc",
  clanwars: "rankings_clanwars",
};

export const FLOOR_NOTE =
  "Path of Legends lists players above a rating floor, at most 1,000 places: a board is small in a season's first days and grows as players cross the floor, and once it holds 1,000 it is full - from then on floor_rating is the 1,000th place's rating, a cutoff that rises with play, not a qualification threshold.";

/** How many places a board holds (6.2.0, feedback #71/#76). The cut is
 *  the API's, per board: probed 2026-09-20 on the live global Path of
 *  Legends board, limit=5 returns a cursor, limit=1000 and limit=2000
 *  both return 1,000 rows with no cursor, and a cursor placed at
 *  position 1000 returns an empty page. A season final is served at
 *  9,999 the same way (S135 ends in a nine-way tie cut at #9999). A
 *  board below its depth is the whole rated field (Iceland reads 2); a
 *  board at depth is a slice, and its last rating is a cutoff that moves
 *  with play - which the standing notes had called a floor. */
const BOARD_DEPTH = { pol_final: 9999 };
export const depthOf = (board) => BOARD_DEPTH[board] ?? 1000;
export const isFull = (snapshot) => snapshot.entries >= depthOf(snapshot.board);

/** The ranked ladder's first season (October 2022) as game_clock counts
 *  it: no Path of Legends final exists before it. */
const FIRST_RANKED_SEASON = seasonIdForMonth("2022-10");

export const dayOf = (at) => at.toISOString().slice(0, 10);

/** When recording of a board began: the oldest snapshot on record, or
 *  null for a board never recorded. A fact of the table, not a date in
 *  the code (feedback #72: rankings_players said "recording began
 *  2026-09-11" from a literal, and rankings_timeline said nothing, so an
 *  empty series before the horizon read as "the board did not change"). */
export async function boardHorizon(db, row) {
  const { rows } = await db.query(
    `select min(observed_at) as since from ranking_snapshot
     where board = $1 and location_key = $2`,
    [row.board, row.location_key],
  );
  return rows[0]?.since ?? null;
}

/** The note for a board with no snapshot to read. as_of before the
 *  horizon and a board never recorded are different facts, and only the
 *  latter has a live read to offer - never on pol_final, where a final
 *  does not change and live is refused (feedback #73). */
export function noSnapshotNote(row, asOf, horizon, noun = "board") {
  if (asOf && horizon)
    return `No snapshot of this ${noun} exists on or before as_of; recording began ${dayOf(horizon)}.`;
  return row.board === "pol_final"
    ? null
    : `This ${noun} has not been recorded yet. It is on the schedule; live: true reads it from the game now.`;
}

/** Why a season's final board is not here (feedback #73): a season that
 *  has not happened, the one in progress, one before the ranked ladder
 *  began (the number a player reads off the in-game Pass), or a settled
 *  season whose row the schedule has not fetched yet. One sentence each,
 *  and none offers live: true, which pol_final refuses. */
export function polFinalMissNote(requested, nowMs = Date.now()) {
  const current = seasonFromDate(nowMs).seasonId;
  if (requested === null)
    return `No season final has been recorded yet; every settled season since S${FIRST_RANKED_SEASON} (October 2022) is on the schedule.`;
  if (requested > current)
    return `Season ${requested} has not happened; the current season is ${current} (game_clock).`;
  if (requested === current)
    return `Season ${current} is in progress; its final board is fetched after it rolls on ${dayOf(new Date(nextSeasonStartMs(nowMs)))}.`;
  if (requested < FIRST_RANKED_SEASON)
    return `Season ${requested} is before the ranked ladder began (S${FIRST_RANKED_SEASON}, October 2022), so no Path of Legends final exists for it. If this number came from a player's in-game Pass, that is a different numbering the API does not use; game_clock names the API's season.`;
  return `Season ${requested}'s final board (${monthForSeasonId(requested)}) has not been recorded yet; it is on the schedule.`;
}

/** The note a full board carries (6.2.0): whose cut it is, and what the
 *  last place's rating means once the field is pinned at depth. */
export function fullBoardNote(snapshot, floor) {
  if (!isFull(snapshot)) return null;
  const depth = depthOf(snapshot.board).toLocaleString("en-US");
  const whose = snapshot.truncated
    ? `the API offered more than the ${depth} the recorder keeps (truncated: true)`
    : `the API serves ${depth} and offered nothing past them (truncated: false)`;
  const value = floor === null || floor === undefined ? "" : ` (${floor})`;
  const leave =
    snapshot.board === "mode"
      ? "a player can leave the board without losing rating."
      : "a player or clan can leave the board without losing rating, and rankings_clans.rated_players compared across dates moves with the cutoff as well as with play.";
  return `This board holds ${depth} places and is full (${whose}): floor_rating${value} is the last place's rating, a cutoff that moves, not a qualification threshold - ${leave}`;
}

/** The season argument as the record files it: the game clock's ordinal.
 *  A month (2026-08, the API's own name) resolves to the ordinal; a number
 *  is taken as one already. */
export function seasonArg(value) {
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return monthForSeasonId(raw);
  throw new ToolFailure(
    "bad_request",
    `Could not read season='${raw}'.`,
    SEASON_SCHEMA.description,
  );
}

/** Resolve the location argument to a ranking_board row, or refuse. */
export async function boardRow(db, board, location) {
  const raw = String(
    board === "pol_final" ? "global" : (location ?? "global"),
  ).trim();
  const key = raw.toLowerCase();
  const { rows } = await db.query(
    `select board, location_key, label, location_kind, country_code, every_minutes, record_top, enabled
     from ranking_board
     where board = $1 and (location_key = $2 or upper(coalesce(country_code, '')) = upper($3))
     order by (location_key = $2) desc limit 1`,
    [board, key, raw],
  );
  // Trophy Road is its own case (Gym #176): the API has served it empty
  // for recent seasons, so a missing board is the API's, not the tag's.
  if (!rows[0] && board === "trophy")
    throw new ToolFailure(
      "not_found",
      `No trophy board is recorded for '${raw}': the API has served the Trophy Road leaderboard empty for recent seasons, so there is nothing to record at any location.`,
      'Path of Legends is the competitive ranking: rankings_players({ board: "pol", location }) with the same location.',
    );
  if (!rows[0])
    throw new ToolFailure(
      "not_found",
      `No ${board} board for location '${raw}'.`,
      board === "mode"
        ? 'Call rankings_players({ board: "mode", location: "list" }) for the recorded leaderboard ids, then pass one as location.'
        : 'Call rankings_players({ location: "global" }) or pass a numeric CR location id or a two-letter country code.',
    );
  return rows[0];
}

/** The snapshot to read: latest, or the last one observed at or before as_of. */
export async function snapshotFor(ctx, args, row) {
  let asOf = null;
  if (args.as_of !== undefined) {
    asOf = resolveInstant(zoneFor(ctx, args), args.as_of, { endOfDay: true });
    if (!asOf)
      throw new ToolFailure(
        "bad_request",
        `Could not read as_of='${args.as_of}' as a date.`,
        AS_OF_SCHEMA.description,
      );
  }
  const { rows } = await ctx.db.query(
    `select snapshot_id, board, season_month, observed_at, last_confirmed_at, entries, truncated,
            standings_changed_at
     from ranking_snapshot
     where board = $1 and location_key = $2
       and ($3::timestamptz is null or observed_at <= $3)
       and ($4::text is null or season_month = $4)
     order by season_month desc, observed_at desc limit 1`,
    [
      row.board,
      row.location_key,
      asOf,
      row.board === "pol_final" && args.season !== undefined
        ? seasonArg(args.season)
        : null,
    ],
  );
  return { snapshot: rows[0] ?? null, asOf };
}

/** live: true on a board (1.7.0, asynchronous): fresh if a read inside
 *  the API's cache window is in hand, else queued; the recorded snapshot
 *  answers either way, with live_status. */
export async function liveBoard(ctx, row) {
  return liveRead(ctx, {
    endpoint:
      row.board === "pol"
        ? "rankings_pol"
        : row.board === "mode"
          ? "leaderboard"
          : "rankings_players",
    entityKey: row.location_key,
  });
}

export function snapshotBlock(snapshot, row, floor) {
  return {
    observed_at: snapshot.observed_at.toISOString(),
    // "Still this at" - an identical later fetch bumps this instead of
    // writing a twin; the two together are the interval the board held.
    unchanged_until: snapshot.last_confirmed_at.toISOString(),
    // The season the board stood in, both spellings: the API's month is
    // the key (0109); the ordinal is the game clock's name for it.
    season_id: String(seasonIdForMonth(snapshot.season_month)),
    season_month: snapshot.season_month,
    entries: snapshot.entries,
    // The places the board holds and whether it holds them all (6.2.0):
    // at depth the field is a slice and the last rating is a cutoff.
    depth: depthOf(row.board),
    full: isFull(snapshot),
    ...(floor === undefined ? {} : { floor_rating: floor }),
    truncated: snapshot.truncated,
    cadence_minutes: row.every_minutes,
    // A mode board's snapshot is rewritten when a placed player changes
    // clan, so observed_at can be today on an event that closed weeks
    // ago; this is when rank or rating last moved (0158, feedback #137).
    ...(row.board === "mode"
      ? {
          standings_changed_at:
            snapshot.standings_changed_at?.toISOString() ?? null,
        }
      : {}),
  };
}

/** A mode board is its event's own leaderboard (feedback #137): the Path
 *  of Legends notes were riding it, calling its rating pol_trophies and
 *  its cutoff one that rises with play. */
export const MODE_RATING_NOTE =
  "rating on a mode board is that event's own leaderboard rating, not a Path of Legends rating: it is not comparable to one, or to another board's rating.";

/** Says so when a mode board's standings have stopped moving while its
 *  snapshots still refresh (feedback #137): two days without a rank or
 *  rating change on a daily board. When they have not moved since the
 *  board's first snapshot, the date is when RECORDING began, not when
 *  they last moved (Gym #175: 21 of 32 boards read 09-11, the record's
 *  first day), and nothing has refreshed on a one-snapshot board. */
export function standingsStaleNote(snapshot, row, horizon = null) {
  const changed = snapshot?.standings_changed_at;
  if (row.board !== "mode" || !changed) return null;
  const held = snapshot.last_confirmed_at.getTime() - changed.getTime();
  if (held < 2 * 86_400_000) return null;
  const day = (d) => d.toISOString().slice(0, 10);
  if (horizon && changed.getTime() <= horizon.getTime())
    return `This board's ranks and ratings have not moved since recording began on ${day(horizon)} (recorded_since): when they last moved before that is unknown, and the record has confirmed them unchanged through ${day(snapshot.last_confirmed_at)}, so it reads as a closed event, not today's leaderboard.`;
  return `This board's ranks and ratings have not moved since ${day(changed)} (standings_changed_at); only names and clans have refreshed since (observed_at ${day(snapshot.observed_at)}), so it reads as a closed event, not today's leaderboard.`;
}

/** The last place's rating on a player board: the floor while the board
 *  is below depth, the cutoff once it is full. */
export async function floorOf(db, snapshot) {
  const { rows } = await db.query(
    `select min(rating) as floor from ranking_entry where snapshot_id = $1`,
    [snapshot.snapshot_id],
  );
  return rows[0]?.floor ?? null;
}

/** The start of the season containing `at`, as a millisecond timestamp:
 *  the default window for a timeline is "this season so far". */
export function seasonStartOf(at) {
  return seasonFromDate(at.getTime()).seasonStartMs;
}
