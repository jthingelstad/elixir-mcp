/** rankings_players · rankings_clans — the recorded leaderboards (0068).
 *
 *  The CR API shows a ranking as it is this minute and forgets it. The
 *  recorder keeps a snapshot of every board it watches — the global Path
 *  of Legends board hourly, every location daily — so these two tools can
 *  answer "who was #1 on the 3rd", "which clans have the most rated
 *  players", and hand a movement video its frames. `live: true` reads the
 *  game first and records what it read, the way clans_roster does. */

import { normalizeTag } from "@elixir-mcp/contracts";
import { resolveInstant } from "../time.mjs";
import { seasonFromDate } from "../../../ingest/src/war-clock.mjs";
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
  spendLiveQuota,
} from "./shared.mjs";

const BOARD_SCHEMA = {
  type: "string",
  enum: ["pol", "trophy", "pol_final", "mode"],
  default: "pol",
  description:
    "pol is the live Path of Legends board (players above the rating floor, recorded hourly for global); pol_final is a season's FINAL Path of Legends standing at full depth (9,999 places), one per season since S97 - pass `season`; mode is a game-mode leaderboard (Merge Tactics, Touchdown...) - pass its id as `location`, rankings_players with location 'list' names them; trophy is the Trophy Road board, which the API has served EMPTY for recent seasons.",
};

const SEASON_SCHEMA = {
  type: "integer",
  minimum: 97,
  description:
    "With board pol_final: which season's final board (numeric season id, e.g. 135 for August 2026). Omitted means the most recent final we hold.",
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
  "Path of Legends lists only players above a rating floor, and a season resets everyone below it: a board is small in a season's first days and fills through the month.";

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
       and ($4::text is null or season_id = $4)
     order by season_id::int desc, observed_at desc limit 1`,
    [
      row.board,
      row.location_key,
      asOf,
      row.board === "pol_final" && args.season !== undefined
        ? String(args.season)
        : null,
    ],
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
    endpoint:
      row.board === "pol"
        ? "rankings_pol"
        : row.board === "mode"
          ? "leaderboard"
          : "rankings_players",
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
        season: SEASON_SCHEMA,
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
      requireEnum(board, ["pol", "trophy", "pol_final", "mode"], "board");
      if (args.live === true && args.as_of !== undefined)
        throw new ToolFailure(
          "bad_request",
          "live: true reads the board as it is now; as_of reads it as it was.",
          "Pass one or the other.",
        );
      const row = await boardRow(ctx.db, board, args.location);
      if (args.live === true && board === "pol_final")
        throw new ToolFailure(
          "bad_request",
          "A season's final board does not change; live: true has nothing to read.",
          "Omit live, or read the live board with board: pol.",
        );
      if (args.live === true) await liveRead(ctx, row);
      const { snapshot, asOf } = await snapshotFor(ctx, args, row);
      const limit = Math.min(500, Math.max(1, Number(args.limit ?? 100)));
      const offset = Math.max(0, Number(args.offset ?? 0));
      const compact = args.verbosity === "compact";
      const applied = appliedBlock({
        board,
        location: row.location_key,
        season:
          snapshot?.season_id && board === "pol_final"
            ? Number(snapshot.season_id)
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
        season: SEASON_SCHEMA,
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
      requireEnum(board, ["pol", "trophy", "pol_final", "mode"], "board");
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
        [ENDPOINT_OF[board]],
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
            "Fetch the ladder from the game first (one live fetch). Not combinable with as_of.",
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
      if (args.live === true) {
        if (!ctx.live)
          throw new ToolFailure(
            "live_unavailable",
            "The live lane is not configured here.",
            "Call again without live: true.",
          );
        await spendLiveQuota(ctx);
        const result = await ctx.live(ctx.db, {
          endpoint: ENDPOINT_OF[board],
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
      if (!snapshot)
        return {
          board,
          location,
          applied,
          snapshot: null,
          clans: [],
          notes: notes(
            "This ladder has not been recorded yet. It is on the schedule; live: true reads it from the game now.",
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
      "How a leaderboard moved: for one player (player_tag) or one clan (clan_tag), their rank and rating at every snapshot of the global Path of Legends board across a window - the season story at hourly resolution; or, with neither, the board's own curve: the rating floor (last place), the summit (#1 and their rating) and the size of the rated field per snapshot. Windows are from/to; omitted means the current season so far. Snapshots where an unchanged board was merely confirmed carry the same values, so a flat stretch is a flat stretch.",
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
            "Most snapshots to return, newest kept; the global board is ~24 a day.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
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
          unchanged_until: r.last_confirmed_at.toISOString(),
          rank: r.rank,
          rating: r.rating,
          clan_tag: r.clan_tag,
          on_board: r.rank !== null,
        }));
      } else if (subject === "clan") {
        const { rows } = await ctx.db.query(
          `select s.observed_at, s.last_confirmed_at,
                  count(e.player_tag)::int as rated_players,
                  min(e.rank) as best_rank,
                  (array_agg(e.player_tag order by e.rank))[1] as best_player_tag
           from ranking_snapshot s
           left join ranking_entry e on e.snapshot_id = s.snapshot_id and e.clan_tag = $3
           where s.board = $1 and s.location_key = $2 and s.observed_at between $4 and $5
           group by s.snapshot_id, s.observed_at, s.last_confirmed_at
           order by s.observed_at desc limit $6`,
          [board, row.location_key, tagArg, from, to, limit],
        );
        points = rows.reverse().map((r) => ({
          observed_at: r.observed_at.toISOString(),
          unchanged_until: r.last_confirmed_at.toISOString(),
          rated_players: r.rated_players,
          best_rank: r.best_rank,
          best_player_tag: r.best_player_tag,
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
        points = rows.reverse().map((r) => ({
          observed_at: r.observed_at.toISOString(),
          unchanged_until: r.last_confirmed_at.toISOString(),
          rated_players: r.entries,
          floor_rating: r.floor_rating,
          first: {
            player_tag: r.first_tag,
            name: r.first_name,
            rating: r.first_rating,
          },
          truncated: r.truncated,
        }));
      }
      return {
        board,
        location: { key: row.location_key, label: row.label },
        applied,
        points,
        notes: notes(
          "One point per recorded snapshot; a snapshot is written only when the board changed, so the interval observed_at..unchanged_until is how long that state held.",
          subject === "player"
            ? "on_board false means the player was below the rating floor at that snapshot; rank and rating are then null, not zero. Per-battle rank and rating for a recorded player are on their battles (globalRank, startingTrophies, trophyChange)."
            : subject === "clan"
              ? "rated_players counts the clan's players above the floor at each snapshot; it rises through a season as more cross it."
              : "floor_rating is the last place's rating - the tide of the season; rated_players is the size of the field above it.",
          FLOOR_NOTE,
        ),
        docs: docsRef("recording", "leaderboards"),
        meta,
      };
    },
  },

  game_events: {
    description:
      "What was ON: the in-game events (modes, challenges, side modes) the API listed as running, recorded daily since 2026-09-11 with the days each was seen. The API shows only today's and gives no dates, so this is the season's calendar built from sightings - the thing that explains a spike of some mode in a battle log. Default window: the current season so far.",
    inputSchema: {
      type: "object",
      properties: {
        ...WINDOW_ARGS,
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
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
      const { rows } = await ctx.db.query(
        `select e.event_tag, e.title, e.description, e.first_seen_at, e.last_seen_at,
                array_agg(d.day::text order by d.day) as days
         from game_event e
         join game_event_day d on d.event_tag = e.event_tag
         where d.day between $1::date and $2::date
         group by e.event_tag
         order by max(d.day) desc, min(d.day) desc
         limit $3`,
        [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), limit],
      );
      const { rows: running } = await ctx.db.query(
        `select max(day)::text as latest_day from game_event_day`,
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
          },
          limit,
        }),
        latest_sighting_day: running[0]?.latest_day ?? null,
        events: rows.map((r) => ({
          event_tag: r.event_tag,
          title: r.title,
          description: r.description,
          days_seen: r.days,
          first_seen_at: r.first_seen_at.toISOString(),
          last_seen_at: r.last_seen_at.toISOString(),
          running_on_latest_day: r.days.includes(running[0]?.latest_day),
        })),
        notes: notes(
          "days_seen is the UTC days /events listed the event; the API gives no start or end, so an event's span is its first and last sighting, at daily resolution.",
          "Sightings began 2026-09-11; nothing before that date is known.",
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
