/** badges_rarity · badges_holders — badges as a queryable dimension
 *  (feedback #18 part 2). player_badge is current state per recorded
 *  profile; these read it sideways: which badge is rarest, and who has
 *  one. The population is every player with an observed profile, or a
 *  segment (clan / collection / one player) of it. */

import { badgeLabel } from "../badge-names.mjs";
import { responseMeta } from "@elixir-mcp/contracts";
import {
  ToolFailure,
  SEGMENT_SCHEMA,
  resolveSegment,
  populationBlock,
  appliedBlock,
  notes,
  docsRef,
} from "./shared.mjs";

const BADGE_DOCS = docsRef("glossary");

/** Population filter over player_badge.player_tag from `args.segment`. */
async function badgeScope(ctx, args, params) {
  const seg = await resolveSegment(ctx, args);
  if (seg.kind === "player") {
    params.push(seg.tag);
    return {
      where: `pb.player_tag = $${params.length}`,
      echo: seg.echo,
    };
  }
  if (seg.kind === "clan") {
    params.push(seg.clanTag);
    return {
      where: `pb.player_tag in (select cm.player_tag from clan_membership cm
               where cm.clan_tag = $${params.length} and cm.left_observed_at is null)`,
      echo: seg.echo,
    };
  }
  if (seg.kind === "collection") {
    params.push(seg.collectionId);
    return {
      where: `pb.player_tag in (select m.subject_tag from collection_member m
               where m.collection_id = $${params.length})`,
      echo: seg.echo,
    };
  }
  return { where: null, echo: seg.echo };
}

/** The population, and how fresh its reads are: `observations` is the
 *  oldest and newest PROFILE POLL among the players considered (Gym #91).
 *  It used to be the range of player_badge.observed_at, which the upsert
 *  moves only when a badge CHANGES, so a clan re-read yesterday reported
 *  an oldest observation in April. */
async function population(db, scopeWhere, params) {
  const {
    rows: [r],
  } = await db.query(
    `select count(*)::int as players,
            min(lp.at) as oldest, max(lp.at) as newest
     from (select distinct pb.player_tag from player_badge pb
           ${scopeWhere ? `where ${scopeWhere}` : ""}) pl
     left join lateral (
       select s.profile_observed_at as at from player_snapshot_daily s
        where s.player_tag = pl.player_tag and s.profile_observed_at is not null
        order by s.snapshot_date desc, s.snapshot_kind desc limit 1) lp on true`,
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

const KIND_NOTE =
  "one_off badges have no level (awarded once for an event or feat, the genuinely rare class); tiered badges carry level/max_level.";
const LABEL_NOTE =
  "Badge names are the API's own identifiers and label is the badge as a player says it (MasterySkeletonWarriors is Guards Mastery). A versioned identifier says its version (RoyalTournamentRank_v2 is 'Royal Tournament Rank (v2)'): the original and the _v2 are two badges, often held by the same player.";
const OBSERVATIONS_NOTE =
  "observations.oldest/newest are the oldest and newest profile poll among players_considered: how fresh the reads behind these counts are.";

/** A versioned identifier beside its original in one list (Gym #92):
 *  said, so "rarest" is not read off the legacy one alone. */
function versionPairNote(names) {
  const set = new Set(names);
  const pairs = names
    .filter((n) => /_v\d+$/.test(n) && set.has(n.replace(/_v\d+$/, "")))
    .map((n) => `${n.replace(/_v\d+$/, "")} / ${n}`);
  return pairs.length
    ? `Versioned pairs listed separately: ${pairs.join(", ")}. They are different identifiers for one badge a player would name the same way; count their holders together, not the legacy row alone, when saying how rare it is.`
    : null;
}

/** The badge an argument names: its identifier, case-insensitive, or
 *  its label (Gym #93: "Valkyrie Mastery", the label the notes tell an
 *  agent to say, was refused as "No recorded player holds" it while all
 *  46 members did). A label two identifiers share is refused with both,
 *  never guessed; a miss is refused about the ARGUMENT, with the nearest
 *  identifiers and labels. */
async function resolveBadge(db, badge) {
  const { rows: near } = await db.query(
    `select distinct name from player_badge where name ilike $1 order by name limit 8`,
    [`%${badge}%`],
  );
  const lower = badge.toLowerCase();
  const exact = near.find((n) => n.name.toLowerCase() === lower);
  if (exact) return { name: exact.name, via_label: false };
  const { rows: all } = await db.query(
    `select distinct name from player_badge order by name`,
  );
  const squash = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byLabel = all.filter(
    (n) => squash(badgeLabel(n.name)) === squash(badge),
  );
  if (byLabel.length === 1) return { name: byLabel[0].name, via_label: true };
  if (byLabel.length > 1)
    throw new ToolFailure(
      "bad_request",
      `'${badge}' is the label of ${byLabel.length} badges: ${byLabel.map((n) => n.name).join(", ")}.`,
      "Pass one identifier as badge.",
    );
  const labelNear = all
    .filter((n) => squash(badgeLabel(n.name)).includes(squash(badge)))
    .map((n) => n.name);
  const candidates = [
    ...new Set([...near.map((n) => n.name), ...labelNear]),
  ].slice(0, 8);
  throw new ToolFailure(
    "not_found",
    candidates.length
      ? `No badge is named or labelled exactly '${badge}'. Did you mean: ${candidates.map((n) => `${n} (${badgeLabel(n)})`).join(", ")}?`
      : `No badge is named or labelled '${badge}' in the record.`,
    "badges_rarity lists every badge observed in the recorded population, identifier and label.",
  );
}

export const badgesTools = {
  badges_rarity: {
    description:
      "Every badge observed across recorded profiles with its holder count, rarest first: the 'what is the rarest badge' question over a named population (segment 'mine', 'corpus' or {clan_tag | player_tag | collection}), with players_considered so the strength of the claim is in the payload. One-off badges are told apart from tiered ones, and tiered badges break down by level.",
    inputSchema: {
      type: "object",
      properties: {
        segment: SEGMENT_SCHEMA,
        kind: {
          type: "string",
          enum: ["one_off", "tiered"],
          description: "Only this class of badge.",
        },
        limit: { type: "integer", minimum: 1, maximum: 300, default: 200 },
      },
      required: ["segment"],
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
      const corpus = scope.where
        ? null
        : await populationBlock(ctx.db, {
            playersInWindow: pop.players_considered,
          });
      return {
        applied: appliedBlock({ segment: scope.echo, kind: args.kind, limit }),
        ...(corpus ? { population: corpus } : {}),
        ...pop,
        badges: rows.map((r) => ({
          name: r.name,
          label: badgeLabel(r.name),
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
        notes: notes(
          "Rarity is within the RECORDED population, not the game: a badge nobody here holds does not appear at all.",
          KIND_NOTE,
          "by_level counts holders per level on a tiered badge; holder_share = holders / players_considered.",
          LABEL_NOTE,
          versionPairNote(rows.map((r) => r.name)),
          OBSERVATIONS_NOTE,
        ),
        docs: BADGE_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  badges_holders: {
    description:
      "Who holds a badge: every recorded player in a named population (segment 'mine', 'corpus' or an object) with the named badge, with level and progress where tiered, names not just tags, and their current clan. The badge is its API identifier or its label (badges_rarity lists both); a near-miss or a label two badges share is refused with candidates rather than guessed.",
    inputSchema: {
      type: "object",
      properties: {
        badge: {
          type: "string",
          minLength: 1,
          maxLength: 60,
          description:
            "The badge: its API identifier (MasteryWitch, BeatingDeathBadge) or its label (Witch Mastery).",
        },
        segment: SEGMENT_SCHEMA,
        min_level: {
          type: "integer",
          minimum: 1,
          description: "Tiered badges: only holders at this level or above.",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: ["badge", "segment"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const badge = String(args.badge ?? "").trim();
      if (!badge) throw new ToolFailure("bad_request", "badge is empty.");
      const params = [];
      const scope = await badgeScope(ctx, args, params);
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      const exact = await resolveBadge(ctx.db, badge);
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
      // The page first, then each row's last profile poll (Gym #91): the
      // stored stamp moves only when the badge changes, so it is `since`,
      // and `observed_at` is the newest read, as everywhere else.
      const { rows } = await ctx.db.query(
        `select h.*, greatest(lp.at, h.since) as observed_at
         from (select pb.player_tag, p.name, pb.level, pb.max_level, pb.progress, pb.target,
                      pb.observed_at as since, p.last_known_clan_tag as clan_tag,
                      count(*) over ()::int as holders_total
               from player_badge pb join player p on p.player_tag = pb.player_tag
               where ${where.join(" and ")}
               order by pb.level desc nulls last, pb.progress desc nulls last, p.name nulls last
               limit ${limit}) h
         left join lateral (
           select s.profile_observed_at as at from player_snapshot_daily s
            where s.player_tag = h.player_tag and s.profile_observed_at is not null
            order by s.snapshot_date desc, s.snapshot_kind desc limit 1) lp on true
         order by h.level desc nulls last, h.progress desc nulls last, h.name nulls last`,
        params,
      );
      const oneOff = rows.length > 0 && rows.every((r) => r.level === null);
      const corpus = scope.where
        ? null
        : await populationBlock(ctx.db, {
            playersInWindow: pop.players_considered,
          });
      return {
        badge: exact.name,
        label: badgeLabel(exact.name),
        kind: rows.length === 0 ? null : oneOff ? "one_off" : "tiered",
        applied: appliedBlock({
          badge: exact.name,
          segment: scope.echo,
          min_level: args.min_level,
          limit,
        }),
        ...(corpus ? { population: corpus } : {}),
        ...pop,
        holders_total: rows[0]?.holders_total ?? 0,
        holder_share:
          pop.players_considered > 0
            ? Number(
                (
                  (rows[0]?.holders_total ?? 0) / pop.players_considered
                ).toFixed(3),
              )
            : null,
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
          since: r.since.toISOString(),
        })),
        notes: notes(
          exact.via_label
            ? `'${badge}' is the label of ${exact.name}; answered for ${exact.name}.`
            : null,
          KIND_NOTE,
          "holder_share = holders_total / players_considered (the whole population, not this page).",
          "A holder's observed_at is the last profile poll that read the badge; since is when the record first saw it at this level and progress. A since at the start of recording, or just after the player joined, is a first sighting, not when the badge was earned.",
          LABEL_NOTE,
          OBSERVATIONS_NOTE,
        ),
        docs: BADGE_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
