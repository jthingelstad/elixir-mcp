import {
  TIMEZONE_SCHEMA,
  ToolFailure,
  appliedBlock,
  buildMeta,
  docsRef,
  entitledClan,
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
    // A shared score is a tie the game lists in its own order (feedback
    // #136: 360 clans at the 140,000 ceiling ranked 1..360, previous_rank
    // beside each reading as movement). Counted over the whole snapshot,
    // since a tie runs past the page.
    const pageScores = [...new Set(rows.map((r) => r.score))];
    const { rows: ties } = pageScores.length
      ? await ctx.db.query(
          `select score, count(*)::int as clans, min(rank) as first, max(rank) as last
             from clan_ranking_entry
            where snapshot_id = $1 and score = any($2::int[])
            group by score having count(*) > 1
            order by score desc`,
          [snapshot.snapshot_id, pageScores],
        )
      : { rows: [] };
    // The last place's score, and where the caller's clan stands (Gym
    // #294: finding its own clan took four pages and still could not say
    // how far below the cutoff it sat).
    const {
      rows: [floorRow],
    } = await ctx.db.query(
      `select score from clan_ranking_entry where snapshot_id = $1 order by rank desc limit 1`,
      [snapshot.snapshot_id],
    );
    let ourTag = null;
    try {
      ourTag = await entitledClan(ctx.db, ctx.account, undefined);
    } catch {
      ourTag = null;
    }
    let ourClan = null;
    if (ourTag) {
      const {
        rows: [ours],
      } = await ctx.db.query(
        `select c.name,
                (select e.rank from clan_ranking_entry e
                  where e.snapshot_id = $2 and e.clan_tag = c.clan_tag) as rank,
                (select e.score from clan_ranking_entry e
                  where e.snapshot_id = $2 and e.clan_tag = c.clan_tag) as board_score,
                s.clan_score, s.clan_war_trophies, s.observed_at
           from clan c
           left join lateral (
             select clan_score, clan_war_trophies, observed_at from clan_snapshot_daily
              where clan_tag = c.clan_tag order by observed_at desc limit 1) s on true
          where c.clan_tag = $1`,
        [ourTag, snapshot.snapshot_id],
      );
      if (ours) {
        const score =
          ours.board_score ??
          (board === "clanwars" ? ours.clan_war_trophies : ours.clan_score);
        ourClan = {
          clan_tag: ourTag,
          name: ours.name,
          on_board: ours.rank !== null,
          rank: ours.rank,
          score: score ?? null,
          score_observed_at:
            ours.board_score !== null
              ? snapshot.observed_at.toISOString()
              : (ours.observed_at?.toISOString() ?? null),
          below_floor_by:
            ours.rank === null && score !== null && floorRow
              ? Number(floorRow.score) - Number(score)
              : null,
        };
      }
    }
    return {
      board,
      location,
      applied,
      ...(live ? { live_status: liveStatus(live) } : {}),
      snapshot: {
        ...snapshotBlock(snapshot, row),
        floor_score: floorRow ? Number(floorRow.score) : null,
      },
      our_clan: ourClan,
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
          : "score is the game's own clan score, which is not the sum of member trophies (its formula is the game's and weights the top members); clans_roster.clan_score serves a recorded clan's.",
        ourClan
          ? ourClan.on_board
            ? `our_clan is ${ourClan.name ?? ourClan.clan_tag}, at rank ${ourClan.rank} on this snapshot.`
            : `our_clan is ${ourClan.name ?? ourClan.clan_tag}, not among this board's ${snapshot.entries} places${ourClan.below_floor_by !== null ? `: its score ${ourClan.score} (from its roster read at ${ourClan.score_observed_at}) is ${ourClan.below_floor_by} below floor_score, the last place's` : ""}; no page of this board will list it.`
          : null,
        "previous_rank is the game's own field: where the clan stood at its previous ranking, not at our previous snapshot.",
        tieNote(ties),
        offset + rows.length < snapshot.entries
          ? `Page ${Math.floor(offset / limit) + 1}: pass offset ${offset + limit} for the next places.`
          : null,
      ),
      docs: docsRef("recording", "leaderboards"),
      meta,
    };
  },
};

/** Places on the page that share a score, stated as ties (#136). */
function tieNote(ties) {
  if (ties.length === 0) return null;
  const shown = ties
    .slice(0, 3)
    .map(
      (t) =>
        `${t.clans} clans share score ${Number(t.score).toLocaleString("en-US")} (ranks ${t.first}-${t.last})`,
    );
  const more =
    ties.length > 3
      ? `, and ${ties.length - 3} more tied scores on this page`
      : "";
  return `${shown.join("; ")}${more}: the game lists a tie in its own order, so rank inside it - and rank against previous_rank - is not a standing; quote those clans as tied.`;
}
