/** rankings_players · rankings_clans — the recorded leaderboards (0068).
 *
 *  The CR API shows a ranking as it is this minute and forgets it. The
 *  recorder keeps a snapshot of every board it watches — every board once
 *  a day, in the tick after 10:00Z (the global board was hourly until
 *  2026-09-11) — so these two tools can answer "who was #1 on the 3rd",
 *  "which clans have the most rated players", and hand a season story its
 *  frames. `live: true` asks for a fresh read, served if in hand or
 *  queued (1.7.0), the way clans_roster does. */

import { normalizeTag, gameDay } from "@elixir-mcp/contracts";
import { resolveInstant } from "../time.mjs";
import { zeroSeriesNote } from "../controls.mjs";
import {
  seasonFromDate,
  seasonIdForMonth,
  monthForSeasonId,
  nextSeasonStartMs,
} from "../../../ingest/src/war-clock.mjs";
import {
  ToolFailure,
  TAG_SCHEMA,
  TAG_RULE_HINT,
  TIMEZONE_SCHEMA,
  WINDOW_ARGS,
  VERBOSITY,
  zoneFor,
  appliedBlock,
  notes,
  docsRef,
  buildMeta,
  requireEnum,
  liveRead,
  liveStatus,
  livePendingNote,
  withWindowSugar,
  seasonFieldsForInstants,
} from "./shared.mjs";

const BOARD_SCHEMA = {
  type: "string",
  enum: ["pol", "trophy", "pol_final", "mode"],
  default: "pol",
  description:
    "pol is the live Path of Legends board (the API's top 1,000: everyone above the rating floor while fewer than 1,000 are rated, a top-1,000 slice once the board is full; recorded daily at the 10:00Z reset); pol_final is a season's FINAL Path of Legends standing, the API's 9,999 places (the tail is cut at #9999, mid-tie), one per season since the ranked ladder's first (October 2022, S89 as game_clock counts) - pass `season`; mode is a game-mode leaderboard (Merge Tactics, Touchdown...) - pass its id as `location`, rankings_players with location 'list' names them; trophy is the Trophy Road board, which the API has served EMPTY for recent seasons.",
};

const SEASON_SCHEMA = {
  type: ["integer", "string"],
  description:
    "With board pol_final: which season's final board - the season number as game_clock counts it (135 for August 2026), or the API's own name for the season, the month it started in (2026-08). Omitted means the most recent final we hold. The snapshot carries both spellings.",
};

const LOCATION_SCHEMA = {
  type: "string",
  default: "global",
  description:
    "global (default), a numeric CR location id (57000249), or a two-letter country code (US, JP). With board mode: its leaderboard id, or location 'list' on rankings_players to discover the recorded catalog. The service records every location the API lists.",
};

const AS_OF_SCHEMA = {
  type: "string",
  description:
    "Read the board as it was on or before this instant: an ISO timestamp, or YYYY-MM-DD meaning the end of that day in the account's timezone (or the call's `timezone`). Omitted means the latest snapshot.",
};

/** poll_state endpoint per board, for the freshness in meta. */
const ENDPOINT_OF = {
  pol: "rankings_pol",
  trophy: "rankings_players",
  pol_final: "rankings_pol_season",
  mode: "leaderboard",
  clans: "rankings_clans_loc",
  clanwars: "rankings_clanwars",
};

const FLOOR_NOTE =
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
const depthOf = (board) => BOARD_DEPTH[board] ?? 1000;
const isFull = (snapshot) => snapshot.entries >= depthOf(snapshot.board);

/** The ranked ladder's first season (October 2022) as game_clock counts
 *  it: no Path of Legends final exists before it. */
const FIRST_RANKED_SEASON = seasonIdForMonth("2022-10");

const dayOf = (at) => at.toISOString().slice(0, 10);

/** When recording of a board began: the oldest snapshot on record, or
 *  null for a board never recorded. A fact of the table, not a date in
 *  the code (feedback #72: rankings_players said "recording began
 *  2026-09-11" from a literal, and rankings_timeline said nothing, so an
 *  empty series before the horizon read as "the board did not change"). */
async function boardHorizon(db, row) {
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
function noSnapshotNote(row, asOf, horizon, noun = "board") {
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
function polFinalMissNote(requested, nowMs = Date.now()) {
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
function fullBoardNote(snapshot, floor) {
  if (!isFull(snapshot)) return null;
  const depth = depthOf(snapshot.board).toLocaleString("en-US");
  const whose = snapshot.truncated
    ? `the API offered more than the ${depth} the recorder keeps (truncated: true)`
    : `the API serves ${depth} and offered nothing past them (truncated: false)`;
  const value = floor === null || floor === undefined ? "" : ` (${floor})`;
  return `This board holds ${depth} places and is full (${whose}): floor_rating${value} is the last place's rating, a cutoff that moves, not a qualification threshold - a player or clan can leave the board without losing rating, and rankings_clans' rated_players compared across dates moves with the cutoff as well as with play.`;
}

/** The season argument as the record files it: the game clock's ordinal.
 *  A month (2026-08, the API's own name) resolves to the ordinal; a number
 *  is taken as one already. */
function seasonArg(value) {
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
async function boardRow(db, board, location) {
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
async function snapshotFor(ctx, args, row) {
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
    `select snapshot_id, board, season_month, observed_at, last_confirmed_at, entries, truncated
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
async function liveBoard(ctx, row) {
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

function snapshotBlock(snapshot, row, floor) {
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
  };
}

/** The last place's rating on a player board: the floor while the board
 *  is below depth, the cutoff once it is full. */
async function floorOf(db, snapshot) {
  const { rows } = await db.query(
    `select min(rating) as floor from ranking_entry where snapshot_id = $1`,
    [snapshot.snapshot_id],
  );
  return rows[0]?.floor ?? null;
}

export const rankingsTools = {
  rankings_players: {
    description:
      "A recorded leaderboard, the global Path of Legends board by default: every placed player with rank, rating, name and clan, as of the latest snapshot or any earlier instant (as_of). Every board is recorded daily at the 10:00Z reset, so this answers who was where and when - the API itself only ever shows now. Paged with limit and offset because a whole board can run to a thousand places. verbosity compact returns rank, tag and rating only. live: true asks for a fresh read: served if in hand, otherwise queued while the latest snapshot answers with live_status pending.",
    inputSchema: {
      type: "object",
      properties: {
        board: BOARD_SCHEMA,
        location: LOCATION_SCHEMA,
        season: SEASON_SCHEMA,
        as_of: AS_OF_SCHEMA,
        timezone: TIMEZONE_SCHEMA,
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        offset: { type: "integer", minimum: 0, default: 0 },
        live: {
          type: "boolean",
          default: false,
          description:
            "Ask for a read of the board no older than a minute: served if in hand, otherwise queued while the latest snapshot answers with live_status pending. Not combinable with as_of.",
        },
        verbosity: VERBOSITY("rank, player_tag and rating only."),
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const board = args.board ?? "pol";
      requireEnum(board, ["pol", "trophy", "pol_final", "mode"], "board");
      if (args.live === true && args.as_of !== undefined)
        throw new ToolFailure(
          "bad_request",
          "live: true reads the board as it is now; as_of reads it as it was.",
          "Pass one or the other.",
        );
      if (
        board === "mode" &&
        String(args.location).trim().toLowerCase() === "list"
      ) {
        if (args.live === true || args.as_of !== undefined)
          throw new ToolFailure(
            "bad_request",
            "Mode discovery reads the recorded catalog, not a board snapshot.",
            'Call rankings_players({ board: "mode", location: "list" }) without live or as_of.',
          );
        const { rows } = await ctx.db.query(
          `select location_key, label, enabled from ranking_board
           where board = 'mode' order by location_key`,
        );
        return {
          board,
          boards: rows.map((r) => ({
            location: r.location_key,
            name: r.label,
            enabled: r.enabled,
          })),
          applied: appliedBlock({ board, location: "list" }),
          notes: notes(
            "These are the recorded mode-board ids; a board's presence does not establish battle-log coverage for that mode.",
          ),
          docs: docsRef("recording", "leaderboards"),
          meta: await buildMeta(ctx.db, ctx.account, "GLOBAL", [
            "leaderboards",
          ]),
        };
      }
      const row = await boardRow(ctx.db, board, args.location);
      if (args.live === true && board === "pol_final")
        throw new ToolFailure(
          "bad_request",
          "A season's final board does not change; live: true has nothing to read.",
          "Omit live, or read the live board with board: pol.",
        );
      const live = args.live === true ? await liveBoard(ctx, row) : null;
      const { snapshot, asOf } = await snapshotFor(ctx, args, row);
      const limit = Math.min(500, Math.max(1, Number(args.limit ?? 100)));
      const offset = Math.max(0, Number(args.offset ?? 0));
      const compact = args.verbosity === "compact";
      // A final's season is echoed whether or not it resolved (feedback
      // #73): the ordinal the record filed it under, or null with the
      // argument as given beside it, so a miss says which season missed.
      const seasonRequested =
        board === "pol_final" && args.season !== undefined
          ? seasonIdForMonth(seasonArg(args.season))
          : null;
      const applied = appliedBlock({
        board,
        location: row.location_key,
        season:
          board === "pol_final"
            ? snapshot
              ? seasonIdForMonth(snapshot.season_month)
              : null
            : undefined,
        season_requested:
          board === "pol_final" && args.season !== undefined
            ? args.season
            : undefined,
        as_of: asOf ? asOf.toISOString() : undefined,
        limit,
        offset,
        live: args.live === true ? true : undefined,
        verbosity: compact ? "compact" : "full",
      });
      const meta = await buildMeta(
        ctx.db,
        ctx.account,
        row.location_key,
        [ENDPOINT_OF[board]],
        { timezone: args.timezone },
      );
      const horizon = await boardHorizon(ctx.db, row);
      if (horizon) meta.recorded_since = horizon.toISOString();
      if (!snapshot) {
        return {
          board,
          location: {
            key: row.location_key,
            label: row.label,
            kind: row.location_kind,
            country_code: row.country_code,
          },
          applied,
          ...(live ? { live_status: liveStatus(live) } : {}),
          snapshot: null,
          players: [],
          notes: notes(
            livePendingNote(live),
            board === "pol_final"
              ? polFinalMissNote(seasonRequested)
              : noSnapshotNote(row, asOf, horizon),
            board === "trophy"
              ? "The Trophy Road board has been served empty by the API for recent seasons; Path of Legends (board: pol) is the competitive ranking."
              : board === "pol_final"
                ? null
                : FLOOR_NOTE,
          ),
          docs: docsRef("recording", "leaderboards"),
          meta,
        };
      }
      const floor = await floorOf(ctx.db, snapshot);
      const { rows } = await ctx.db.query(
        `select rank, player_tag, name, rating, clan_tag, clan_name
         from ranking_entry where snapshot_id = $1
         order by rank limit $2 offset $3`,
        [snapshot.snapshot_id, limit, offset],
      );
      return {
        board,
        location: {
          key: row.location_key,
          label: row.label,
          kind: row.location_kind,
          country_code: row.country_code,
        },
        applied,
        ...(live ? { live_status: liveStatus(live) } : {}),
        snapshot: snapshotBlock(snapshot, row, floor),
        players: rows.map((r) =>
          compact
            ? { rank: r.rank, player_tag: r.player_tag, rating: r.rating }
            : {
                rank: r.rank,
                player_tag: r.player_tag,
                name: r.name,
                rating: r.rating,
                clan_tag: r.clan_tag,
                clan_name: r.clan_name,
              },
        ),
        notes: notes(
          livePendingNote(live),
          fullBoardNote(snapshot, floor),
          board === "pol_final"
            ? "A season final is the settled standing: the API serves its top 9,999 places and the record keeps them all."
            : FLOOR_NOTE,
          snapshot.truncated
            ? "The API offered more places than this snapshot holds (truncated: true); the tail of the board is missing."
            : null,
          offset + rows.length < snapshot.entries
            ? `Page ${Math.floor(offset / limit) + 1}: pass offset ${offset + limit} for the next ${Math.min(limit, snapshot.entries - offset - rows.length)} places.`
            : null,
          "rating on the pol board is the player's Path of Legends rating: the same number the profile carries as pol_trophies (players_timeline, players_profile), verified equal on the live API; per-battle rating and rank for a recorded player are on their battles (startingTrophies, trophyChange, globalRank).",
        ),
        docs: docsRef("recording", "leaderboards"),
        meta,
      };
    },
  },

  rankings_clans: {
    description:
      "Which clans have the most players on a recorded leaderboard - the global Path of Legends board by default: per clan the number of rated players, its best-placed player and their rank, over the WHOLE recorded board (up to its 1,000 places; every rated player while fewer are rated), not a top-100 slice, because at that depth sixty clans tie at one player and there is no ranking to find. Ties at the cutoff go to the clan whose best player is placed highest. as_of reads an earlier snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        board: BOARD_SCHEMA,
        location: LOCATION_SCHEMA,
        season: SEASON_SCHEMA,
        as_of: AS_OF_SCHEMA,
        timezone: TIMEZONE_SCHEMA,
        limit: { type: "integer", minimum: 1, maximum: 200, default: 25 },
        live: {
          type: "boolean",
          default: false,
          description:
            "Ask for a read of the board no older than a minute: served if in hand, otherwise queued while the latest snapshot answers with live_status pending. Not combinable with as_of.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const board = args.board ?? "pol";
      requireEnum(board, ["pol", "trophy", "pol_final", "mode"], "board");
      if (args.live === true && args.as_of !== undefined)
        throw new ToolFailure(
          "bad_request",
          "live: true reads the board as it is now; as_of reads it as it was.",
          "Pass one or the other.",
        );
      const row = await boardRow(ctx.db, board, args.location);
      const live = args.live === true ? await liveBoard(ctx, row) : null;
      const { snapshot, asOf } = await snapshotFor(ctx, args, row);
      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 25)));
      const applied = appliedBlock({
        board,
        location: row.location_key,
        as_of: asOf ? asOf.toISOString() : undefined,
        limit,
        live: args.live === true ? true : undefined,
      });
      const meta = await buildMeta(
        ctx.db,
        ctx.account,
        row.location_key,
        [ENDPOINT_OF[board]],
        { timezone: args.timezone },
      );
      const horizon = await boardHorizon(ctx.db, row);
      if (horizon) meta.recorded_since = horizon.toISOString();
      if (!snapshot) {
        return {
          board,
          location: { key: row.location_key, label: row.label },
          applied,
          ...(live ? { live_status: liveStatus(live) } : {}),
          snapshot: null,
          clans: [],
          notes: notes(
            livePendingNote(live),
            board === "pol_final"
              ? polFinalMissNote(
                  args.season !== undefined
                    ? seasonIdForMonth(seasonArg(args.season))
                    : null,
                )
              : noSnapshotNote(row, asOf, horizon),
          ),
          docs: docsRef("recording", "leaderboards"),
          meta,
        };
      }
      const floor = await floorOf(ctx.db, snapshot);
      const { rows } = await ctx.db.query(
        `select e.clan_tag, max(e.clan_name) as clan_name,
                count(*)::int as rated_players,
                min(e.rank) as best_rank,
                (array_agg(e.player_tag order by e.rank))[1] as best_player_tag,
                (array_agg(e.name order by e.rank))[1] as best_player_name,
                count(*) over ()::int as clans_total
         from ranking_entry e
         where e.snapshot_id = $1 and e.clan_tag is not null
         group by e.clan_tag
         order by rated_players desc, best_rank asc
         limit $2`,
        [snapshot.snapshot_id, limit],
      );
      const { rows: unclanned } = await ctx.db.query(
        `select count(*)::int as n from ranking_entry where snapshot_id = $1 and clan_tag is null`,
        [snapshot.snapshot_id],
      );
      return {
        board,
        location: {
          key: row.location_key,
          label: row.label,
          kind: row.location_kind,
          country_code: row.country_code,
        },
        applied,
        ...(live ? { live_status: liveStatus(live) } : {}),
        snapshot: snapshotBlock(snapshot, row, floor),
        // The field the counts were taken over (3.16.0): the placed
        // players in this snapshot, so a rated_players of 12 reads as 12
        // of that many, not of the game.
        field_size: snapshot.entries,
        clans_total: rows[0]?.clans_total ?? 0,
        players_without_clan: unclanned[0]?.n ?? 0,
        clans: rows.map((r, i) => ({
          rank: i + 1,
          clan_tag: r.clan_tag,
          clan_name: r.clan_name,
          rated_players: r.rated_players,
          best_rank: r.best_rank,
          best_player_tag: r.best_player_tag,
          best_player_name: r.best_player_name,
        })),
        notes: notes(
          livePendingNote(live),
          `Counted over every placed player in the snapshot (field_size: ${snapshot.entries}${isFull(snapshot) ? `, the board's full ${depthOf(board).toLocaleString("en-US")}` : ""}); rated_players moves with the cutoff as well as with play - it can fall while every one of the clan's players improves - so compare clans within one snapshot, not counts across dates.`,
          fullBoardNote(snapshot, floor),
          "Ties in rated_players are ordered by best_rank, the rank of the clan's best-placed player.",
          board === "pol_final" ? null : FLOOR_NOTE,
        ),
        docs: docsRef("recording", "leaderboards"),
        meta,
      };
    },
  },

  rankings_clan_ladder: {
    description:
      "A recorded CLAN leaderboard by location: clans (clan score) or clanwars (clan war trophies), 1,000 places each, global by default, recorded daily for global, the United States and Japan and for any location enabled since. Per clan: rank, previous rank, score, member count, badge and home location. as_of reads an earlier snapshot. This is the clan-side analogue of rankings_players; rankings_clans is a different thing - the clans most REPRESENTED on a player board.",
    inputSchema: {
      type: "object",
      properties: {
        board: {
          type: "string",
          enum: ["clans", "clanwars"],
          default: "clans",
          description:
            "clans ranks by clan score; clanwars by clan war trophies.",
        },
        location: LOCATION_SCHEMA,
        as_of: AS_OF_SCHEMA,
        timezone: TIMEZONE_SCHEMA,
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        offset: { type: "integer", minimum: 0, default: 0 },
        live: {
          type: "boolean",
          default: false,
          description:
            "Ask for a read of the ladder no older than a minute: served if in hand, otherwise queued while the latest snapshot answers with live_status pending. Not combinable with as_of.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const board = args.board ?? "clans";
      requireEnum(board, ["clans", "clanwars"], "board");
      if (args.live === true && args.as_of !== undefined)
        throw new ToolFailure(
          "bad_request",
          "live: true reads the ladder as it is now; as_of reads it as it was.",
          "Pass one or the other.",
        );
      const row = await boardRow(ctx.db, board, args.location);
      const live =
        args.live === true
          ? await liveRead(ctx, {
              endpoint: ENDPOINT_OF[board],
              entityKey: row.location_key,
            })
          : null;
      const { snapshot, asOf } = await snapshotFor(ctx, args, row);
      const limit = Math.min(500, Math.max(1, Number(args.limit ?? 100)));
      const offset = Math.max(0, Number(args.offset ?? 0));
      const applied = appliedBlock({
        board,
        location: row.location_key,
        as_of: asOf ? asOf.toISOString() : undefined,
        limit,
        offset,
        live: args.live === true ? true : undefined,
      });
      const meta = await buildMeta(
        ctx.db,
        ctx.account,
        row.location_key,
        [ENDPOINT_OF[board]],
        { timezone: args.timezone },
      );
      const location = {
        key: row.location_key,
        label: row.label,
        kind: row.location_kind,
        country_code: row.country_code,
      };
      const horizon = await boardHorizon(ctx.db, row);
      if (horizon) meta.recorded_since = horizon.toISOString();
      if (!snapshot)
        return {
          board,
          location,
          applied,
          ...(live ? { live_status: liveStatus(live) } : {}),
          snapshot: null,
          clans: [],
          notes: notes(
            livePendingNote(live),
            noSnapshotNote(row, asOf, horizon, "ladder"),
          ),
          docs: docsRef("recording", "leaderboards"),
          meta,
        };
      const { rows } = await ctx.db.query(
        `select rank, previous_rank, clan_tag, name, score, members, badge_id, location_id
         from clan_ranking_entry where snapshot_id = $1 order by rank limit $2 offset $3`,
        [snapshot.snapshot_id, limit, offset],
      );
      return {
        board,
        location,
        applied,
        ...(live ? { live_status: liveStatus(live) } : {}),
        snapshot: snapshotBlock(snapshot, row),
        clans: rows.map((r) => ({
          rank: r.rank,
          previous_rank: r.previous_rank,
          clan_tag: r.clan_tag,
          name: r.name,
          score: r.score,
          members: r.members,
          badge_id: r.badge_id,
          location_id: r.location_id,
        })),
        notes: notes(
          livePendingNote(live),
          board === "clanwars"
            ? "score is clan war trophies on this board."
            : "score is clan score - the sum the game ranks clans by - on this board.",
          "previous_rank is the game's own field: where the clan stood at its previous ranking, not at our previous snapshot.",
          offset + rows.length < snapshot.entries
            ? `Page ${Math.floor(offset / limit) + 1}: pass offset ${offset + limit} for the next places.`
            : null,
        ),
        docs: docsRef("recording", "leaderboards"),
        meta,
      };
    },
  },

  rankings_timeline: {
    description:
      "How a leaderboard moved: for one player (player_tag) or one clan (clan_tag), their rank and rating at every snapshot of the global Path of Legends board across a window (one a day since 2026-09-11, only when the board moved); or, with neither, the board's own curve: the last place's rating (the floor while the board is below its 1,000 places, the cutoff once full), the summit (#1) and the size of the field per snapshot. Windows are from/to; omitted means the current season so far. A flat stretch is confirmed, not repeated; a window before the first snapshot says so (applied.window.covers).",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: {
          ...TAG_SCHEMA,
          description:
            "A player: their rank and rating per snapshot. Omit with clan_tag for a clan, or both for the board itself.",
        },
        clan_tag: {
          type: "string",
          description:
            "A clan: how many rated players it had and its best-placed player per snapshot.",
        },
        board: { type: "string", enum: ["pol", "mode"], default: "pol" },
        location: LOCATION_SCHEMA,
        ...WINDOW_ARGS,
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 2000,
          default: 800,
          description:
            "Most snapshots to return, newest kept; the global board is one a day since 2026-09-11, and only when it moved.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, rawArgs) {
      const args = withWindowSugar(rawArgs);
      const board = args.board ?? "pol";
      requireEnum(board, ["pol", "mode"], "board");
      const row = await boardRow(ctx.db, board, args.location);
      const tz = zoneFor(ctx, args);
      const to =
        args.to !== undefined
          ? resolveInstant(tz, args.to, { endOfDay: true })
          : new Date();
      const from =
        args.from !== undefined
          ? resolveInstant(tz, args.from)
          : new Date(seasonStartOf(to));
      if (!from || !to)
        throw new ToolFailure(
          "bad_request",
          "Could not read from/to as dates.",
          AS_OF_SCHEMA.description,
        );
      const limit = Math.min(2000, Math.max(1, Number(args.limit ?? 800)));
      let subject = null;
      let tagArg = null;
      if (args.player_tag !== undefined) {
        try {
          tagArg = normalizeTag(String(args.player_tag));
        } catch {
          throw new ToolFailure(
            "invalid_tag",
            `Invalid player tag: ${args.player_tag}`,
            TAG_RULE_HINT,
          );
        }
        subject = "player";
      } else if (args.clan_tag !== undefined) {
        try {
          tagArg = normalizeTag(String(args.clan_tag));
        } catch {
          throw new ToolFailure(
            "invalid_tag",
            `Invalid clan tag: ${args.clan_tag}`,
            TAG_RULE_HINT,
          );
        }
        subject = "clan";
      }
      const seasonFields = await seasonFieldsForInstants(ctx.db, from, to, {
        flavor: "series",
      });
      // The recording horizon against the window (feedback #72): a
      // window that starts before the board's first snapshot is clipped
      // to it, and the clip is said in the echo (covers) and in a note,
      // the way the week buckets say partial - so an empty series before
      // the horizon never reads as a board that did not change.
      const horizon = await boardHorizon(ctx.db, row);
      // A window that ends before the first snapshot is unrecorded
      // outright; one that starts a day or more before it is clipped. A
      // start inside the horizon's first day is the first day's snapshot.
      const beforeHorizon =
        horizon !== null &&
        (to <= horizon || horizon.getTime() - from.getTime() >= 86_400_000);
      // covers is the recorded part of the window; null when none of it is.
      const covers = !beforeHorizon
        ? undefined
        : to <= horizon
          ? null
          : { from: horizon.toISOString(), to: to.toISOString() };
      const applied = appliedBlock({
        board,
        location: row.location_key,
        subject: subject ?? "board",
        tag: tagArg ?? undefined,
        window: {
          from: from.toISOString(),
          to: to.toISOString(),
          source:
            args.from !== undefined || args.to !== undefined
              ? "argument"
              : "default",
          ...(beforeHorizon ? { partial: true, covers } : {}),
          ...seasonFields.echo,
        },
        limit,
      });
      const meta = await buildMeta(
        ctx.db,
        ctx.account,
        row.location_key,
        [ENDPOINT_OF[board]],
        { timezone: args.timezone },
      );
      if (horizon) meta.recorded_since = horizon.toISOString();
      const horizonNote =
        horizon === null
          ? "This board has never been recorded, so the series is empty: nothing is known about it, not that it did not change."
          : beforeHorizon
            ? to <= horizon
              ? `No snapshots exist before ${dayOf(horizon)} (recording of this board began then) and this window ends ${dayOf(to)}, so the series is empty: the board is unrecorded for the window, not unchanged.`
              : `No snapshots exist before ${dayOf(horizon)} (recording of this board began then); this window starts ${dayOf(from)}, so the series covers ${dayOf(horizon)} onward (applied.window.covers), not the window you asked for.`
            : null;
      let points;
      if (subject === "player") {
        const { rows } = await ctx.db.query(
          `select s.observed_at, s.last_confirmed_at, e.rank, e.rating, e.clan_tag, e.clan_name
           from ranking_snapshot s
           left join ranking_entry e on e.snapshot_id = s.snapshot_id and e.player_tag = $3
           where s.board = $1 and s.location_key = $2 and s.observed_at between $4 and $5
           order by s.observed_at desc limit $6`,
          [board, row.location_key, tagArg, from, to, limit],
        );
        points = rows.reverse().map((r) => ({
          observed_at: r.observed_at.toISOString(),
          day: gameDay(r.observed_at),
          unchanged_until: r.last_confirmed_at.toISOString(),
          rank: r.rank,
          rating: r.rating,
          clan_tag: r.clan_tag,
          on_board: r.rank !== null,
        }));
      } else if (subject === "clan") {
        const { rows } = await ctx.db.query(
          `select s.observed_at, s.last_confirmed_at, s.entries,
                  count(e.player_tag)::int as rated_players,
                  min(e.rank) as best_rank,
                  (array_agg(e.player_tag order by e.rank))[1] as best_player_tag,
                  (select min(rating) from ranking_entry f where f.snapshot_id = s.snapshot_id) as floor_rating
           from ranking_snapshot s
           left join ranking_entry e on e.snapshot_id = s.snapshot_id and e.clan_tag = $3
           where s.board = $1 and s.location_key = $2 and s.observed_at between $4 and $5
           group by s.snapshot_id, s.observed_at, s.last_confirmed_at, s.entries
           order by s.observed_at desc limit $6`,
          [board, row.location_key, tagArg, from, to, limit],
        );
        points = rows.reverse().map((r) => ({
          observed_at: r.observed_at.toISOString(),
          day: gameDay(r.observed_at),
          unchanged_until: r.last_confirmed_at.toISOString(),
          rated_players: r.rated_players,
          best_rank: r.best_rank,
          best_player_tag: r.best_player_tag,
          // The board's state beside the clan's count (6.2.0): once the
          // board is full, rated_players moves with this cutoff too.
          board_full: r.entries >= depthOf(board),
          board_floor_rating: r.floor_rating,
        }));
      } else {
        const { rows } = await ctx.db.query(
          `select s.observed_at, s.last_confirmed_at, s.entries, s.truncated,
                  (select min(rating) from ranking_entry e where e.snapshot_id = s.snapshot_id) as floor_rating,
                  (select player_tag from ranking_entry e where e.snapshot_id = s.snapshot_id and e.rank = 1) as first_tag,
                  (select name from ranking_entry e where e.snapshot_id = s.snapshot_id and e.rank = 1) as first_name,
                  (select rating from ranking_entry e where e.snapshot_id = s.snapshot_id and e.rank = 1) as first_rating
           from ranking_snapshot s
           where s.board = $1 and s.location_key = $2 and s.observed_at between $3 and $4
           order by s.observed_at desc limit $5`,
          [board, row.location_key, from, to, limit],
        );
        let previousFloor = null;
        points = rows.reverse().map((r) => {
          const point = {
            observed_at: r.observed_at.toISOString(),
            day: gameDay(r.observed_at),
            unchanged_until: r.last_confirmed_at.toISOString(),
            rated_players: r.entries,
            depth: depthOf(board),
            full: r.entries >= depthOf(board),
            floor_rating: r.floor_rating,
            // The cutoff's move since the previous point (6.2.0): on a
            // full board this is how far the tail was cut, without a
            // second call.
            floor_delta:
              previousFloor === null || r.floor_rating === null
                ? null
                : r.floor_rating - previousFloor,
            first: {
              player_tag: r.first_tag,
              name: r.first_name,
              rating: r.first_rating,
            },
            truncated: r.truncated,
          };
          previousFloor = r.floor_rating;
          return point;
        });
      }
      const fullPoints = points.filter((p) => p.full ?? p.board_full).length;
      return {
        board,
        location: { key: row.location_key, label: row.label },
        applied,
        points,
        notes: notes(
          horizonNote,
          subject === "player" ? null : zeroSeriesNote(points, "rated_players"),
          seasonFields.seasonNotes,
          "One point per recorded snapshot; a snapshot is written only when the board changed, so the interval observed_at..unchanged_until is how long that state held; day is the game day (10:00Z grid) the snapshot fell in.",
          subject === "player"
            ? "on_board false means the player was not on the board at that snapshot - below the rating floor, or below the cutoff once the board is full; rank and rating are then null, not zero. Per-battle rank and rating for a recorded player are on their battles (globalRank, startingTrophies, trophyChange)."
            : subject === "clan"
              ? "rated_players counts the clan's players on the board at each snapshot; it moves with the cutoff (board_floor_rating, once board_full) as well as with play, and can fall while every one of the clan's players improves."
              : `floor_rating is the last place's rating: the rating floor while rated_players is below depth, and once the board is full (full: true) the cutoff for the last of its ${depthOf(board).toLocaleString("en-US")} places, which rises as the field plays (floor_delta is its move since the previous point) while rated_players stays pinned at depth.`,
          fullPoints > 0 && subject !== "player"
            ? `${fullPoints} of ${points.length} points are at the board's full ${depthOf(board).toLocaleString("en-US")} places: a player or clan can leave the board without losing rating there, so compare rated_players across dates only against the cutoff.`
            : null,
          FLOOR_NOTE,
        ),
        docs: docsRef("recording", "leaderboards"),
        meta,
      };
    },
  },

  game_events: {
    description:
      "What was ON: the in-game events (modes, challenges, side modes) the API listed as running, recorded from daily sightings (sparser before 2026-09-11) with the days each was seen. The API shows only today's and gives no dates, so this is the season's calendar built from sightings - the thing that explains a spike of some mode in a battle log. Default window: the current season so far.",
    inputSchema: {
      type: "object",
      properties: {
        ...WINDOW_ARGS,
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
    async handler(ctx, rawArgs) {
      const args = withWindowSugar(rawArgs);
      const tz = zoneFor(ctx, args);
      const to =
        args.to !== undefined
          ? resolveInstant(tz, args.to, { endOfDay: true })
          : new Date();
      const from =
        args.from !== undefined
          ? resolveInstant(tz, args.from)
          : new Date(seasonStartOf(to));
      if (!from || !to)
        throw new ToolFailure(
          "bad_request",
          "Could not read from/to as dates.",
          AS_OF_SCHEMA.description,
        );
      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50)));
      // game_days_seen (3.17.0, call 6): a sighting is one /events read,
      // and game_event_day keeps only its UTC day; the read's instant is
      // on its receipt, so the game day (10:00Z grid) is the receipt's.
      // A UTC day with no receipt on record (the elixir-bot backfill's
      // sparser reads) keeps the UTC day as its game day.
      const { rows } = await ctx.db.query(
        `with sighting as (
           select distinct (r.fetched_at at time zone 'UTC')::date as day,
                  game_day(r.fetched_at) as game_day
           from api_receipt r
           where r.endpoint = 'events' and r.admission = 'admitted'
             and r.fetched_at >= $1::date - interval '1 day'
             and r.fetched_at < $2::date + interval '2 days')
         select e.event_tag, e.title, e.description, e.first_seen_at, e.last_seen_at,
                array_agg(distinct d.day::text order by d.day::text) as days,
                array_agg(distinct coalesce(s.game_day, d.day)::text order by coalesce(s.game_day, d.day)::text) as game_days,
                exists (select 1 from game_event_day x
                         where x.event_tag = e.event_tag
                           and x.day = (select max(day) from game_event_day)) as running_on_latest
         from game_event e
         join game_event_day d on d.event_tag = e.event_tag
         left join sighting s on s.day = d.day
         where d.day between $1::date and $2::date
         group by e.event_tag
         order by max(d.day) desc, min(d.day) desc
         limit $3`,
        // `to` is the exclusive instant (a date-only to resolves to the
        // NEXT midnight), so the last day inside it is the day before.
        [
          from.toISOString().slice(0, 10),
          new Date(to.getTime() - 1).toISOString().slice(0, 10),
          limit,
        ],
      );
      const seasonFields = await seasonFieldsForInstants(ctx.db, from, to, {
        flavor: "plain",
      });
      // The horizon is a fact of the table, not a date in the code: the
      // daily sightings began 2026-09-11, and the elixir-bot backfill
      // (2026-09-15) placed earlier, sparser reads before them.
      const { rows: running } = await ctx.db.query(
        `select max(day)::text as latest_day, min(day)::text as first_day from game_event_day`,
      );
      return {
        applied: appliedBlock({
          window: {
            from: from.toISOString(),
            to: to.toISOString(),
            source:
              args.from !== undefined || args.to !== undefined
                ? "argument"
                : "default",
            ...seasonFields.echo,
          },
          limit,
        }),
        first_sighting_day: running[0]?.first_day ?? null,
        latest_sighting_day: running[0]?.latest_day ?? null,
        events: rows.map((r) => ({
          event_tag: r.event_tag,
          title: r.title,
          description: r.description,
          game_days_seen: r.game_days,
          first_seen_at: r.first_seen_at.toISOString(),
          last_seen_at: r.last_seen_at.toISOString(),
          // A fact of the table, not of the window asked (3.17.0: a
          // window ending before the latest sighting said false).
          running_on_latest_day: r.running_on_latest,
        })),
        notes: notes(
          seasonFields.seasonNotes,
          "game_days_seen is the game days (the 10:00Z grid the series tools use; a read before 10:00Z belongs to the day before) on which /events listed the event; the API gives no start or end, so an event's span is its first and last sighting, at daily resolution.",
          `Sightings began ${running[0]?.first_day ?? "when recording did"}; nothing before that date is known, and days without a read are unknown, not empty.`,
          "The game-mode leaderboards (rankings_players with board: mode) are the same modes' standings; a title here and a board name there usually match.",
        ),
        docs: docsRef("recording", "leaderboards"),
        meta: await buildMeta(ctx.db, ctx.account, "GLOBAL", ["events"], {
          timezone: args.timezone,
        }),
      };
    },
  },
};

/** The start of the season containing `at`, as a millisecond timestamp:
 *  the default window for a timeline is "this season so far". */
function seasonStartOf(at) {
  return seasonFromDate(at.getTime()).seasonStartMs;
}
