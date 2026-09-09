/** badges_rarity · badges_holders — badges as a queryable dimension
 *  (feedback #18 part 2). player_badge is current state per recorded
 *  profile; these read it sideways: which badge is rarest, and who has
 *  one. The population is every player with an observed profile, or a
 *  clan / collection slice of it. */

import { responseMeta } from "@elixir-mcp/contracts";
import { ToolFailure, entitledClan } from "./shared.mjs";

/** Population filter over player_badge.player_tag (clan / collection). */
async function badgeScope(ctx, args, params) {
  if (args.clan_tag !== undefined && args.collection !== undefined) {
    throw new ToolFailure(
      "bad_request",
      "Pick at most one of clan_tag, collection.",
    );
  }
  if (args.clan_tag !== undefined) {
    const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
    params.push(clanTag);
    return {
      where: `pb.player_tag in (select cm.player_tag from clan_membership cm
               where cm.clan_tag = $${params.length} and cm.left_observed_at is null)`,
      label: clanTag,
    };
  }
  if (args.collection !== undefined) {
    const slug = String(args.collection).toLowerCase().trim();
    const { rows } = await ctx.db.query(
      `select c.collection_id from collection c
       where c.slug = $1 and c.kind = 'player'
         and (c.visibility = 'public' or c.owner_account = $2)`,
      [slug, ctx.account.accountId],
    );
    if (!rows[0])
      throw new ToolFailure(
        "not_found",
        `No player collection '${slug}'.`,
        "collections_browse lists what exists.",
      );
    params.push(rows[0].collection_id);
    return {
      where: `pb.player_tag in (select m.subject_tag from collection_member m
               where m.collection_id = $${params.length})`,
      label: slug,
    };
  }
  return { where: null, label: "recorded_profiles" };
}

/** Everyone in scope with at least one observed badge: the n every
 *  holder_share and rarity claim is over. */
async function population(db, scopeWhere, params) {
  const {
    rows: [r],
  } = await db.query(
    `select count(distinct pb.player_tag)::int as players,
            min(pb.observed_at) as oldest, max(pb.observed_at) as newest
     from player_badge pb ${scopeWhere ? `where ${scopeWhere}` : ""}`,
    params,
  );
  return {
    players_considered: r.players,
    observations: {
      oldest: r.oldest?.toISOString() ?? null,
      newest: r.newest?.toISOString() ?? null,
    },
  };
}

const SCOPE_ARGS = {
  clan_tag: {
    type: "string",
    description: "Scope to a recorded clan's current members.",
  },
  collection: {
    type: "string",
    description: "Scope to a player collection's members (e.g. 'pros').",
  },
};

const KIND_NOTE =
  "kind: one_off badges have no level (awarded once for an event or feat - the genuinely rare class, since most cannot be earned later); tiered badges carry level/max_level and by_level counts holders at each level, so a level-9 mastery is not conflated with a level-1. holder_share = holders / players_considered. Badge names are the API's own identifiers.";

export const badgesTools = {
  badges_rarity: {
    description:
      "Every badge observed across recorded profiles with its holder count, rarest first: the 'what is the rarest badge' question over the whole population (or one clan / collection) in one call, with players_considered so the strength of the claim is in the payload. One-off badges (no level) are told apart from tiered ones, and tiered badges break down by level.",
    inputSchema: {
      type: "object",
      properties: {
        ...SCOPE_ARGS,
        kind: {
          type: "string",
          enum: ["one_off", "tiered"],
          description: "Only this class of badge.",
        },
        limit: { type: "integer", minimum: 1, maximum: 300, default: 200 },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const scope = await badgeScope(ctx, args, params);
      const where = scope.where ? [scope.where] : [];
      if (args.kind === "one_off") where.push("pb.level is null");
      else if (args.kind === "tiered") where.push("pb.level is not null");
      else if (args.kind !== undefined)
        throw new ToolFailure("bad_request", `kind must be one_off or tiered.`);
      const limit = Math.min(Math.max(Number(args.limit ?? 200), 1), 300);
      const pop = await population(ctx.db, scope.where, params);
      const { rows } = await ctx.db.query(
        `select pb.name,
                count(*)::int as holders,
                bool_and(pb.level is null) as one_off,
                max(pb.max_level) as max_level,
                jsonb_object_agg(coalesce(pb.level::text, 'none'), n) filter (where pb.level is not null) as by_level_raw,
                min(pb.observed_at) as oldest, max(pb.observed_at) as newest
         from (select pb.name, pb.level, pb.max_level, pb.observed_at,
                      count(*) over (partition by pb.name, pb.level)::int as n
               from player_badge pb ${where.length ? `where ${where.join(" and ")}` : ""}) pb
         group by pb.name
         order by count(*) asc, pb.name
         limit ${limit}`,
        params,
      );
      return {
        segment: scope.label,
        ...pop,
        badges: rows.map((r) => ({
          name: r.name,
          kind: r.one_off ? "one_off" : "tiered",
          holders: r.holders,
          holder_share:
            pop.players_considered > 0
              ? Number((r.holders / pop.players_considered).toFixed(3))
              : null,
          ...(r.one_off
            ? {}
            : {
                max_level: r.max_level,
                by_level: Object.fromEntries(
                  Object.entries(r.by_level_raw ?? {})
                    .map(([k, v]) => [Number(k), v])
                    .sort((a, z) => a[0] - z[0]),
                ),
              }),
        })),
        note:
          "Rarity is within the RECORDED population, not the game: players_considered is everyone in scope with an observed profile, and a badge nobody here holds does not appear at all. " +
          KIND_NOTE,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  badges_holders: {
    description:
      "Who holds a badge: every recorded player in scope with the named badge, with level/progress where tiered, names not just tags, and their current clan. Names must match the API's badge identifier exactly (badges_rarity lists them); a near-miss is refused with candidates rather than guessed.",
    inputSchema: {
      type: "object",
      properties: {
        badge: {
          type: "string",
          minLength: 1,
          maxLength: 60,
          description:
            "Badge name as the API spells it, e.g. MasteryWitch, BeatingDeathBadge.",
        },
        ...SCOPE_ARGS,
        min_level: {
          type: "integer",
          minimum: 1,
          description: "Tiered badges: only holders at this level or above.",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: ["badge"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const badge = String(args.badge ?? "").trim();
      if (!badge) throw new ToolFailure("bad_request", "badge is empty.");
      const params = [];
      const scope = await badgeScope(ctx, args, params);
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      // Exact, case-insensitive; a substring match is a suggestion, not an
      // answer (MasteryWitch vs MasteryWitchMother is the Witch/Mother Witch
      // trap in badge form).
      const { rows: names } = await ctx.db.query(
        `select distinct name from player_badge where name ilike $1 order by name limit 8`,
        [`%${badge}%`],
      );
      const exact = names.find(
        (n) => n.name.toLowerCase() === badge.toLowerCase(),
      );
      if (!exact) {
        throw new ToolFailure(
          "not_found",
          names.length
            ? `No badge named exactly '${badge}'. Did you mean: ${names.map((n) => n.name).join(", ")}?`
            : `No recorded player holds a badge named '${badge}'.`,
          "badges_rarity lists every badge name observed in the recorded population.",
        );
      }
      params.push(exact.name);
      const where = [`pb.name = $${params.length}`];
      if (scope.where) where.push(scope.where);
      if (args.min_level !== undefined) {
        params.push(Number(args.min_level));
        where.push(`pb.level >= $${params.length}`);
      }
      const pop = await population(
        ctx.db,
        scope.where,
        params.slice(0, scope.where ? 1 : 0),
      );
      const { rows } = await ctx.db.query(
        `select pb.player_tag, p.name, pb.level, pb.max_level, pb.progress, pb.target,
                pb.observed_at, p.last_known_clan_tag as clan_tag,
                count(*) over ()::int as holders_total
         from player_badge pb join player p on p.player_tag = pb.player_tag
         where ${where.join(" and ")}
         order by pb.level desc nulls last, pb.progress desc nulls last, p.name nulls last
         limit ${limit}`,
        params,
      );
      const oneOff = rows.length > 0 && rows.every((r) => r.level === null);
      return {
        badge: exact.name,
        kind: rows.length === 0 ? null : oneOff ? "one_off" : "tiered",
        segment: scope.label,
        ...pop,
        holders_total: rows[0]?.holders_total ?? 0,
        limit_applied: limit,
        holders: rows.map((r) => ({
          player_tag: r.player_tag,
          name: r.name,
          name_known: r.name !== null,
          ...(r.level === null
            ? {}
            : {
                level: r.level,
                max_level: r.max_level,
                progress: r.progress,
                target: r.target,
              }),
          clan_tag: r.clan_tag,
          observed_at: r.observed_at.toISOString(),
        })),
        note: KIND_NOTE,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
