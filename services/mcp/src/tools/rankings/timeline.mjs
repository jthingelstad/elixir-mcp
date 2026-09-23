import { gameDay, normalizeTag } from "@elixir-mcp/contracts";
import { resolveInstant } from "../../time.mjs";
import { zeroSeriesNote } from "../../controls.mjs";
import {
  TAG_RULE_HINT,
  TAG_SCHEMA,
  ToolFailure,
  WINDOW_ARGS,
  appliedBlock,
  buildMeta,
  docsRef,
  notes,
  requireEnum,
  seasonFieldsForInstants,
  withWindowSugar,
  zoneFor,
} from "../shared.mjs";
import {
  AS_OF_SCHEMA,
  ENDPOINT_OF,
  FLOOR_NOTE,
  MODE_RATING_NOTE,
  LOCATION_SCHEMA,
  boardHorizon,
  boardRow,
  dayOf,
  depthOf,
  seasonStartOf,
} from "./common.mjs";

export const rankings_timeline = {
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
          ? `on_board false means the player was not on the board at that snapshot - below the rating floor, or below the cutoff once the board is full; rank and rating are then null, not zero.${board === "mode" ? "" : " Per-battle rank and rating for a recorded player are on their battles (battles_query.global_rank, battles_query.starting_trophies, battles_query.trophy_change)."}`
          : subject === "clan"
            ? "rated_players counts the clan's players on the board at each snapshot; it moves with the cutoff (board_floor_rating, once board_full) as well as with play, and can fall while every one of the clan's players improves."
            : `floor_rating is the last place's rating: the rating floor while rated_players is below depth, and once the board is full (full: true) the cutoff for the last of its ${depthOf(board).toLocaleString("en-US")} places, which rises as the field plays (floor_delta is its move since the previous point) while rated_players stays pinned at depth.`,
        fullPoints > 0 && subject !== "player"
          ? `${fullPoints} of ${points.length} points are at the board's full ${depthOf(board).toLocaleString("en-US")} places: a player or clan can leave the board without losing rating there, so compare rated_players across dates only against the cutoff.`
          : null,
        board === "mode" ? MODE_RATING_NOTE : FLOOR_NOTE,
      ),
      docs: docsRef("recording", "leaderboards"),
      meta,
    };
  },
};
