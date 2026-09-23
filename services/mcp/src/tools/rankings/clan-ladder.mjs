import {
  TIMEZONE_SCHEMA,
  ToolFailure,
  appliedBlock,
  buildMeta,
  docsRef,
  livePendingNote,
  liveRead,
  liveStatus,
  notes,
  requireEnum,
} from "../shared.mjs";
import {
  AS_OF_SCHEMA,
  ENDPOINT_OF,
  LOCATION_SCHEMA,
  boardHorizon,
  boardRow,
  noSnapshotNote,
  snapshotBlock,
  snapshotFor,
} from "./common.mjs";

export const rankings_clan_ladder = {
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
};
