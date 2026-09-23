import { seasonIdForMonth } from "../../../../ingest/src/war-clock.mjs";
import {
  TIMEZONE_SCHEMA,
  ToolFailure,
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
  MODE_RATING_NOTE,
  standingsStaleNote,
  LOCATION_SCHEMA,
  SEASON_SCHEMA,
  boardHorizon,
  boardRow,
  depthOf,
  floorOf,
  fullBoardNote,
  isFull,
  liveBoard,
  noSnapshotNote,
  polFinalMissNote,
  seasonArg,
  snapshotBlock,
  snapshotFor,
} from "./common.mjs";

export const rankings_clans = {
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
        board === "pol_final"
          ? null
          : board === "mode"
            ? MODE_RATING_NOTE
            : FLOOR_NOTE,
        standingsStaleNote(snapshot, row, horizon),
      ),
      docs: docsRef("recording", "leaderboards"),
      meta,
    };
  },
};
