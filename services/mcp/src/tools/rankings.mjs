/** rankings_players · rankings_clans — the recorded leaderboards (0068).
 *
 *  The CR API shows a ranking as it is this minute and forgets it. The
 *  recorder keeps a snapshot of every board it watches — the global Path
 *  of Legends board hourly, every location daily — so these two tools can
 *  answer "who was #1 on the 3rd", "which clans have the most rated
 *  players", and hand a movement video its frames. `live: true` reads the
 *  game first and records what it read, the way clans_roster does. */

import { resolveInstant } from "../time.mjs";
import {
  ToolFailure,
  TIMEZONE_SCHEMA,
  VERBOSITY,
  zoneFor,
  appliedBlock,
  notes,
  docsRef,
  buildMeta,
  requireEnum,
  spendLiveQuota,
} from "./shared.mjs";

const BOARD_SCHEMA = {
  type: "string",
  enum: ["pol", "trophy"],
  default: "pol",
  description:
    "pol is Path of Legends, the ranked ladder; trophy is the Trophy Road board, which the API has served EMPTY for recent seasons - it is offered so a recorded snapshot can be read if one ever lands.",
};

const LOCATION_SCHEMA = {
  type: "string",
  default: "global",
  description:
    "global (default), a numeric CR location id (57000249), or a two-letter country code (US, JP). The service records every location the API lists.",
};

const AS_OF_SCHEMA = {
  type: "string",
  description:
    "Read the board as it was on or before this instant: an ISO timestamp, or YYYY-MM-DD meaning the end of that day in the account's timezone (or the call's `timezone`). Omitted means the latest snapshot.",
};

const FLOOR_NOTE =
  "Path of Legends lists only players above a rating floor, and a season resets everyone below it: a board is small in a season's first days and fills through the month.";

/** Resolve the location argument to a ranking_board row, or refuse. */
async function boardRow(db, board, location) {
  const raw = String(location ?? "global").trim();
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
      "Use global, a numeric CR location id, or a two-letter country code; rankings_players lists nothing for a location the API does not have.",
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
    `select snapshot_id, season_id, observed_at, last_confirmed_at, entries, truncated
     from ranking_snapshot
     where board = $1 and location_key = $2
       and ($3::timestamptz is null or observed_at <= $3)
     order by observed_at desc limit 1`,
    [row.board, row.location_key, asOf],
  );
  return { snapshot: rows[0] ?? null, asOf };
}

async function liveRead(ctx, row) {
  if (!ctx.live)
    throw new ToolFailure(
      "live_unavailable",
      "The live lane is not configured here.",
      "Call again without live: true.",
    );
  await spendLiveQuota(ctx);
  const result = await ctx.live(ctx.db, {
    endpoint: row.board === "pol" ? "rankings_pol" : "rankings_players",
    entityKey: row.location_key,
  });
  if (!result.ok)
    throw new ToolFailure(
      "live_unavailable",
      result.reason === "rejected"
        ? "The live fetch returned a payload our admission rejected."
        : "No gateway completed the live fetch in time.",
      "Call again without live: true for the recorded view, or retry shortly.",
    );
}

function snapshotBlock(snapshot, row) {
  return {
    observed_at: snapshot.observed_at.toISOString(),
    // "Still this at" - an identical later fetch bumps this instead of
    // writing a twin; the two together are the interval the board held.
    unchanged_until: snapshot.last_confirmed_at.toISOString(),
    season_id: snapshot.season_id,
    entries: snapshot.entries,
    truncated: snapshot.truncated,
    cadence_minutes: row.every_minutes,
  };
}

export const rankingsTools = {
  rankings_players: {
    description:
      "A recorded leaderboard, the global Path of Legends board by default: every placed player with rank, rating, name and clan, as of the latest snapshot or any earlier instant (as_of). The global board is recorded hourly, every other location daily, so this answers who was where and when - the API itself only ever shows now. Paged with limit and offset because a whole board can run to a thousand places. verbosity compact returns rank, tag and rating only. live: true reads the game first (one live fetch) and records what it read.",
    inputSchema: {
      type: "object",
      properties: {
        board: BOARD_SCHEMA,
        location: LOCATION_SCHEMA,
        as_of: AS_OF_SCHEMA,
        timezone: TIMEZONE_SCHEMA,
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        offset: { type: "integer", minimum: 0, default: 0 },
        live: {
          type: "boolean",
          default: false,
          description:
            "Fetch the board from the game first (one live fetch). Not combinable with as_of.",
        },
        verbosity: VERBOSITY("rank, player_tag and rating only."),
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const board = args.board ?? "pol";
      requireEnum(board, ["pol", "trophy"], "board");
      if (args.live === true && args.as_of !== undefined)
        throw new ToolFailure(
          "bad_request",
          "live: true reads the board as it is now; as_of reads it as it was.",
          "Pass one or the other.",
        );
      const row = await boardRow(ctx.db, board, args.location);
      if (args.live === true) await liveRead(ctx, row);
      const { snapshot, asOf } = await snapshotFor(ctx, args, row);
      const limit = Math.min(500, Math.max(1, Number(args.limit ?? 100)));
      const offset = Math.max(0, Number(args.offset ?? 0));
      const compact = args.verbosity === "compact";
      const applied = appliedBlock({
        board,
        location: row.location_key,
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
        [board === "pol" ? "rankings_pol" : "rankings_players"],
        { timezone: args.timezone },
      );
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
          snapshot: null,
          players: [],
          notes: notes(
            asOf
              ? "No snapshot of this board exists on or before as_of; recording began 2026-09-11."
              : "This board has not been recorded yet. It is on the schedule; live: true reads it from the game now.",
            board === "trophy"
              ? "The Trophy Road board has been served empty by the API for recent seasons; Path of Legends (board: pol) is the competitive ranking."
              : FLOOR_NOTE,
          ),
          docs: docsRef("recording", "leaderboards"),
          meta,
        };
      }
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
        snapshot: snapshotBlock(snapshot, row),
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
          FLOOR_NOTE,
          snapshot.truncated
            ? "The API offered more places than this snapshot holds (truncated: true); the tail of the board is missing."
            : null,
          offset + rows.length < snapshot.entries
            ? `Page ${Math.floor(offset / limit) + 1}: pass offset ${offset + limit} for the next ${Math.min(limit, snapshot.entries - offset - rows.length)} places.`
            : null,
          "rating is Path of Legends elo on the pol board; per-battle rating and rank for a recorded player are on their battles (startingTrophies, trophyChange, globalRank).",
        ),
        docs: docsRef("recording", "leaderboards"),
        meta,
      };
    },
  },

  rankings_clans: {
    description:
      "Which clans have the most players on a recorded leaderboard - the global Path of Legends board by default: per clan the number of rated players, its best-placed player and their rank, over the WHOLE board (every player above the rating floor), not a top-100 slice, because at that depth sixty clans tie at one player and there is no ranking to find. Ties at the cutoff go to the clan whose best player is placed highest. as_of reads an earlier snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        board: BOARD_SCHEMA,
        location: LOCATION_SCHEMA,
        as_of: AS_OF_SCHEMA,
        timezone: TIMEZONE_SCHEMA,
        limit: { type: "integer", minimum: 1, maximum: 200, default: 25 },
        live: {
          type: "boolean",
          default: false,
          description:
            "Fetch the board from the game first (one live fetch). Not combinable with as_of.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const board = args.board ?? "pol";
      requireEnum(board, ["pol", "trophy"], "board");
      if (args.live === true && args.as_of !== undefined)
        throw new ToolFailure(
          "bad_request",
          "live: true reads the board as it is now; as_of reads it as it was.",
          "Pass one or the other.",
        );
      const row = await boardRow(ctx.db, board, args.location);
      if (args.live === true) await liveRead(ctx, row);
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
        [board === "pol" ? "rankings_pol" : "rankings_players"],
        { timezone: args.timezone },
      );
      if (!snapshot) {
        return {
          board,
          location: { key: row.location_key, label: row.label },
          applied,
          snapshot: null,
          clans: [],
          notes: notes(
            "This board has not been recorded yet. It is on the schedule; live: true reads it from the game now.",
          ),
          docs: docsRef("recording", "leaderboards"),
          meta,
        };
      }
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
        snapshot: snapshotBlock(snapshot, row),
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
          "Counted over every placed player in the snapshot; rated_players rises through a season as more of a clan's players cross the floor, so compare clans within one snapshot, not counts across dates.",
          "Ties in rated_players are ordered by best_rank, the rank of the clan's best-placed player.",
          FLOOR_NOTE,
        ),
        docs: docsRef("recording", "leaderboards"),
        meta,
      };
    },
  },
};
