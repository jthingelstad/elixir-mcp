/** badges_rarity · badges_holders — badges as a queryable dimension
 *  (feedback #18 part 2). player_badge is current state per recorded
 *  profile; these read it sideways: which badge is rarest, and who has
 *  one. The corpus is the players recorded now (6.30.1), or a segment
 *  (clan / collection / one player) is named. */

import { badgeLabel } from "../badge-names.mjs";
import { responseMeta } from "@elixir-mcp/contracts";
import {
  ToolFailure,
  SEGMENT_SCHEMA,
  resolveSegment,
  populationBlock,
  RECORDED_PLAYERS_SQL,
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
    // A clan's current members who are RECORDED now (Gym #183; Jamie
    // 2026-09-23: a player known only from a battle stub is a ghost
    // entry and never in a metric). A stale read under an old clan tag
    // is left out, and the coverage note says how many members counted.
    return {
      where: `pb.player_tag in (select cm.player_tag from clan_membership cm
               where cm.clan_tag = $${params.length} and cm.left_observed_at is null)
              and pb.player_tag in (${RECORDED_PLAYERS_SQL})`,
      echo: seg.echo,
      clanTag: seg.clanTag,
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
  // The corpus is the players recorded now (Jamie, 2026-09-23, Gym
  // #145): a profile the record no longer polls stays in player_badge
  // with the badges and clan of its last read, as old as March, and
  // pooled in it nearly doubled players_considered.
  return {
    where: `pb.player_tag in (${RECORDED_PLAYERS_SQL})`,
    echo: seg.echo,
    corpus: true,
  };
}

/** How much of a clan a clan segment could read (Gym #183): a clan
 *  recorded at roster level has members whose badges were never read,
 *  and a share over the rest must not read as "every member". */
async function clanCoverageNote(db, scope, considered) {
  if (!scope.clanTag) return null;
  const {
    rows: [m],
  } = await db.query(
    `select count(*)::int as n from clan_membership
      where clan_tag = $1 and left_observed_at is null`,
    [scope.clanTag],
  );
  if (!m || considered >= m.n) return null;
  return `players_considered (${considered}) is ${considered} of this clan's ${m.n} current members: the others are not recorded now or their profiles were never read, so their badges are unknown, not absent, and holder_share is over the ${considered}.`;
}

/** The parameters a scope's where clause uses: one for a named segment,
 *  none for the corpus. */
const scopeArity = (scope) => (scope.corpus ? 0 : 1);

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

/** The versioned pairs among `names` (RoyalTournamentRank beside
 *  RoyalTournamentRank_v2), as [original, versioned]. */
function versionPairs(names) {
  const set = new Set(names);
  return names
    .filter((n) => /_v\d+$/.test(n) && set.has(n.replace(/_v\d+$/, "")))
    .map((n) => [n.replace(/_v\d+$/, ""), n]);
}

/** Distinct holders of either identifier in each pair, and of both, in
 *  the same population (Gym #144): the two holder sets overlap by an
 *  amount only the record knows - in POAP KINGS both Royal Tournament
 *  Rank rows were one player, while the corpus Classic pair was disjoint -
 *  so "add them" was sometimes right and sometimes a double count. */
async function pairCounts(db, pairs, scopeWhere, scopeParams) {
  if (pairs.length === 0) return [];
  const params = [...scopeParams, pairs.flat()];
  const { rows } = await db.query(
    `select base, count(*)::int as either, count(*) filter (where k > 1)::int as both
       from (select regexp_replace(pb.name, '_v\\d+$', '') as base, pb.player_tag,
                    count(distinct pb.name) as k
               from player_badge pb
              where pb.name = any($${params.length}::text[])
                ${scopeWhere ? `and ${scopeWhere}` : ""}
              group by 1, 2) x
      group by base`,
    params,
  );
  const by = new Map(rows.map((r) => [r.base, r]));
  return pairs.map(([a, b]) => ({
    pair: `${a} / ${b}`,
    either: by.get(a)?.either ?? 0,
    both: by.get(a)?.both ?? 0,
  }));
}

const players = (n) => `${n} distinct player${n === 1 ? "" : "s"}`;
const holdBoth = (n) => `${n} ${n === 1 ? "holds" : "hold"} both`;

/** A versioned identifier beside its original (Gym #92, #144): said, with
 *  the distinct count, so "rarest" is read neither off the legacy row
 *  alone nor off a sum that counts one player twice. */
function versionPairNote(counts) {
  return counts.length
    ? `Versioned pairs listed separately, one badge a player would name the same way: ${counts.map((c) => `${c.pair} is held by ${players(c.either)} (${holdBoth(c.both)})`).join("; ")}; quote the distinct count, not a sum of the two rows, when saying how rare it is.`
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
  // A typo (Gym #146: "Valkyrie Mastry", "Gaurds Mastery") contains no
  // label and is inside none, so it had no candidates: the nearest by
  // edit distance over label and identifier, within about one slip per
  // six letters.
  const want = squash(badge);
  const budget = Math.max(2, Math.floor(want.length / 6));
  const typoNear = all
    .map((n) => ({
      name: n.name,
      d: Math.min(
        editDistance(want, squash(badgeLabel(n.name))),
        editDistance(want, squash(n.name)),
      ),
    }))
    .filter((x) => x.d <= budget)
    .sort((a, z) => a.d - z.d || a.name.localeCompare(z.name))
    .map((x) => x.name);
  const candidates = [
    ...new Set([...near.map((n) => n.name), ...labelNear, ...typoNear]),
  ].slice(0, 8);
  throw new ToolFailure(
    "not_found",
    candidates.length
      ? `No badge is named or labelled exactly '${badge}'. Did you mean: ${candidates.map((n) => `${n} (${badgeLabel(n)})`).join(", ")}?`
      : `No badge is named or labelled exactly '${badge}', and none is close to it.`,
    "badges_rarity lists every badge observed in the recorded population, identifier and label.",
  );
}

/** Levenshtein distance, two rows; badge names are short. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length];
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
      const scopeParams = params.slice(0, scopeArity(scope));
      const pop = await population(ctx.db, scope.where, params);
      const { rows } = await ctx.db.query(
        `select pb.name,
                count(*)::int as holders,
                bool_and(pb.level is null) as one_off,
                max(pb.max_level) as max_level,
                jsonb_object_agg(coalesce(pb.level::text, 'none'), n) filter (where pb.level is not null) as by_level_raw,
                min(pb.observed_at) as oldest, max(pb.observed_at) as newest,
                count(*) over ()::int as badges_total
         from (select pb.name, pb.level, pb.max_level, pb.observed_at,
                      count(*) over (partition by pb.name, pb.level)::int as n
               from player_badge pb ${where.length ? `where ${where.join(" and ")}` : ""}) pb
         group by pb.name
         order by count(*) asc, pb.name
         limit ${limit}`,
        params,
      );
      const corpus = !scope.corpus
        ? null
        : await populationBlock(ctx.db, {
            playersInWindow: pop.players_considered,
          });
      // A limited page is cut from the rarest end (Gym #193): the pair
      // note reads every badge in the population, not just the page's, so
      // a legacy row listed alone still carries its versioned twin's
      // distinct count, and the page says it was cut.
      const badgesTotal = rows[0]?.badges_total ?? 0;
      const cut = badgesTotal > rows.length;
      const onPage = new Set(rows.map((r) => r.name));
      const pairs = !cut
        ? versionPairs(rows.map((r) => r.name))
        : versionPairs(
            (
              await ctx.db.query(
                `select distinct pb.name from player_badge pb
                  ${where.length ? `where ${where.join(" and ")}` : ""}`,
                params,
              )
            ).rows.map((r) => r.name),
          ).filter(([a, b]) => onPage.has(a) || onPage.has(b));
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
          // One player is not a population (Gym #257): every badge they
          // hold reads holders 1, share 1, sorted "rarest first".
          scope.echo?.kind === "player" || scope.echo?.player_tag
            ? "This segment is one player, so every badge listed is one they hold (holders 1, holder_share 1) and the order says nothing about rarity. For how rare a badge is, read badges_rarity over segment 'corpus' or a clan, and badges_holders for who holds it."
            : null,
          cut
            ? `This page lists ${rows.length} of ${badgesTotal} badges held here, the rarest first (limit ${limit}); the other ${badgesTotal - rows.length} are more common and not listed. Rarity is within the RECORDED population, not the game.`
            : "Rarity is within the RECORDED population, not the game: a badge nobody here holds does not appear at all.",
          KIND_NOTE,
          "by_level counts holders per level on a tiered badge; holder_share = holders / players_considered.",
          LABEL_NOTE,
          versionPairNote(
            await pairCounts(ctx.db, pairs, scope.where, scopeParams),
          ),
          OBSERVATIONS_NOTE,
          corpus ? corpusNote(pop, corpus) : null,
          await clanCoverageNote(ctx.db, scope, pop.players_considered),
        ),
        docs: BADGE_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  badges_holders: {
    description:
      "Who holds a badge: every recorded player in a named population (segment 'mine', 'corpus' or an object) with the named badge, with level and progress where tiered, names not just tags, and their clan as of the last profile read. The badge is its API identifier or its label (badges_rarity lists both); a near-miss or a label two badges share is refused with candidates rather than guessed.",
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
      // The badge's kind from the whole record (Gym #184): an empty
      // answer had said kind null, even for a tiered badge.
      const {
        rows: [kindRow],
      } = await ctx.db.query(
        `select bool_and(level is null) as one_off from player_badge where name = $1`,
        [exact.name],
      );
      const recordedKind =
        kindRow?.one_off === null || kindRow?.one_off === undefined
          ? null
          : kindRow.one_off
            ? "one_off"
            : "tiered";
      if (args.min_level !== undefined) {
        // A one-off badge has no level: min_level used to answer 0
        // holders and holder_share 0 (Gym #184).
        if (recordedKind === "one_off")
          throw new ToolFailure(
            "bad_request",
            `min_level applies to tiered badges only: ${exact.name} is a one-off badge with no level.`,
            "Omit min_level to list its holders.",
          );
        params.push(Number(args.min_level));
        where.push(`pb.level >= $${params.length}`);
      }
      const pop = await population(
        ctx.db,
        scope.where,
        params.slice(0, scopeArity(scope)),
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
      const corpus = !scope.corpus
        ? null
        : await populationBlock(ctx.db, {
            playersInWindow: pop.players_considered,
          });
      return {
        badge: exact.name,
        label: badgeLabel(exact.name),
        kind:
          recordedKind ??
          (rows.length === 0 ? null : oneOff ? "one_off" : "tiered"),
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
          await siblingNote(
            ctx.db,
            exact.name,
            scope.where,
            params.slice(0, scopeArity(scope)),
          ),
          KIND_NOTE,
          "holder_share = holders_total / players_considered (the whole population, not this page).",
          "A holder's observed_at is the last profile poll that read the badge; since is when the record first saw it at this level and progress. A since at the start of recording, or just after the player joined, is a first sighting, not when the badge was earned.",
          "A holder's clan_tag is their clan at observed_at, not necessarily today's: a player the record no longer polls keeps the clan of that last read.",
          LABEL_NOTE,
          OBSERVATIONS_NOTE,
          corpus ? corpusNote(pop, corpus) : null,
          await clanCoverageNote(ctx.db, scope, pop.players_considered),
        ),
        docs: BADGE_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};

/** The other half of a versioned pair, when the record holds it (Gym
 *  #144): "Royal Tournament Rank" resolves to the legacy identifier, 1
 *  holder in the corpus, while 746 hold the _v2 - the label a person
 *  says carries no version. Not merged: said, with both counts. */
async function siblingNote(db, name, scopeWhere, scopeParams) {
  const sibling = /_v\d+$/.test(name)
    ? name.replace(/_v\d+$/, "")
    : `${name}_v2`;
  const {
    rows: [held],
  } = await db.query(`select 1 from player_badge where name = $1 limit 1`, [
    sibling,
  ]);
  if (!held) return null;
  const [pair] = /_v\d+$/.test(name) ? [[sibling, name]] : [[name, sibling]];
  const [c] = await pairCounts(db, [pair], scopeWhere, scopeParams);
  const {
    rows: [s],
  } = await db.query(
    `select count(*)::int as n from player_badge pb
      where pb.name = $${scopeParams.length + 1}${scopeWhere ? ` and ${scopeWhere}` : ""}`,
    [...scopeParams, sibling],
  );
  return `Versioned pair: ${c.pair} are two identifiers for one badge a player names the same way (${badgeLabel(sibling)} is the other). In this population ${s.n} ${s.n === 1 ? "holds" : "hold"} ${sibling}, and ${players(c.either)} ${c.either === 1 ? "holds" : "hold"} either (${holdBoth(c.both)}).`;
}

/** What the corpus counts (Gym #145): the players recorded now, with a
 *  profile the record has read - not every profile it ever read. */
function corpusNote(pop, corpus) {
  return `players_considered counts the players recorded now whose profile the record has read (${pop.players_considered} of the ${corpus.recorded_players} recorded now): a player no longer recorded is left out, since the record stopped reading their badges. population.players_in_window is the same count.`;
}
