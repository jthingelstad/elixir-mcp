import { seasonIdForMonth } from "../../../../ingest/src/war-clock.mjs";
import {
  TIMEZONE_SCHEMA,
  ToolFailure,
  VERBOSITY,
  appliedBlock,
  buildMeta,
  docsRef,
  livePendingNote,
  liveStatus,
  notes,
  requireEnum,
} from "../shared.mjs";
import {
  AS_OF_SCHEMA,
  BOARD_SCHEMA,
  ENDPOINT_OF,
  FLOOR_NOTE,
  LOCATION_SCHEMA,
  SEASON_SCHEMA,
  boardHorizon,
  boardRow,
  floorOf,
  fullBoardNote,
  liveBoard,
  noSnapshotNote,
  polFinalMissNote,
  seasonArg,
  snapshotBlock,
  snapshotFor,
} from "./common.mjs";

export const rankings_players = {
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
        meta: await buildMeta(ctx.db, ctx.account, "GLOBAL", ["leaderboards"]),
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
};
