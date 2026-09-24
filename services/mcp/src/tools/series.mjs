/** clans_timeline · clans_members_timeline: the clan's daily series and
 *  its members' (time-series review Part 7, contract 3.12.0). Read from
 *  clan_snapshot_daily and the roster-written rows of
 *  player_snapshot_daily by (clan_tag, snapshot_date); one point per
 *  game day, the day's last observation; every point stamped. */

import { normalizeTag, gameDay } from "@elixir-mcp/contracts";
import {
  PLAYER_METRICS,
  metricSelect,
  KINDS,
  KIND_SCHEMA,
  GRANULARITY_SCHEMA,
  DAY_WINDOW_ARGS,
  STAMP_COLUMNS,
  GAME_DAY_NOTE,
  seriesWindow,
  pointStamps,
  metricValue,
  botSourceNote,
} from "../daily-series.mjs";
import {
  ToolFailure,
  TAG_RULE_HINT,
  TIMEZONE_SCHEMA,
  VERBOSITY,
  entitledClan,
  buildMeta,
  requireEnum,
  appliedBlock,
  notes,
  docsRef,
  zoneFor,
  seasonFieldsForDays,
  SEASON_ARG_SCHEMA,
} from "./shared.mjs";

const CLAN_TAG_SCHEMA = {
  type: "string",
  description: "Clan tag like #J2RGCRVG. Omit to mean your recorded clan.",
};

/** The clan's own metrics (the roster payload's), then the aggregates
 *  computed at read over the members' rows carrying the clan's tag that
 *  day. members_seen counts rows with a roster stamp, so a partial day
 *  reads as partial. The profile-derived aggregates are null on a
 *  member with no recorded profile and off by default. */
const CLAN_METRICS = [
  "clan_score",
  "clan_war_trophies",
  "members",
  "donations_per_week",
  "required_trophies",
];
/** The clan's own attributes on the day row, to ask for (3.15.0): open /
 *  inviteOnly / closed, and the location code. The select always fetched
 *  them; the enum never named them. */
const CLAN_ATTRIBUTES = ["type", "location_id"];
const CLAN_AGGREGATES = [
  "total_member_trophies",
  "avg_member_trophies",
  "members_seen",
  "members_with_profile",
  "members_profile_carried",
];
const CLAN_PROFILE_AGGREGATES = [
  "avg_member_wins",
  "avg_member_collection_level",
  "members_12000_plus",
  "members_14000_plus",
  "members_6_years_plus",
  "members_collection_1000_plus",
];
const ALL_CLAN_METRICS = [
  ...CLAN_METRICS,
  ...CLAN_ATTRIBUTES,
  ...CLAN_AGGREGATES,
  ...CLAN_PROFILE_AGGREGATES,
];
const DEFAULT_CLAN_METRICS = [...CLAN_METRICS, ...CLAN_AGGREGATES];

// A member whose profile was not read that day counts with their latest
// earlier read (#111; Jamie 2026-09-23: "it's more accurate data"). A
// profile's wins and collection level only climb, so the last read is
// the best statement of the day, where leaving the member out moved the
// average with the poll schedule. members_profile_carried says how many.
const AGGREGATE_SQL = `
  select sum(s.trophies)::int as total_member_trophies,
         round(avg(s.trophies))::int as avg_member_trophies,
         count(*) filter (where s.roster_observed_at is not null)::int as members_seen,
         count(*) filter (where not st.stayed)::int as members_left_excluded,
         count(*) filter (where st.stayed and (s.profile_observed_at is not null or lp.player_tag is not null))::int as members_with_profile,
         count(*) filter (where st.stayed and s.profile_observed_at is null and lp.player_tag is not null)::int as members_profile_carried,
         round(avg(case when s.profile_observed_at is not null then s.wins else lp.wins end) filter (where st.stayed))::int as avg_member_wins,
         round(avg(case when s.profile_observed_at is not null then s.collection_level else lp.collection_level end) filter (where st.stayed))::int as avg_member_collection_level,
         count(*) filter (where st.stayed and s.trophies >= 12000)::int as members_12000_plus,
         count(*) filter (where st.stayed and s.trophies >= 14000)::int as members_14000_plus,
         count(*) filter (where st.stayed and p.years_played >= 6)::int as members_6_years_plus,
         count(*) filter (where st.stayed and (case when s.profile_observed_at is not null then s.collection_level else lp.collection_level end) >= 1000)::int as members_collection_1000_plus
    from player_snapshot_daily s
    join player p on p.player_tag = s.player_tag
    left join lateral (
      select l.player_tag, l.wins, l.collection_level
        from player_snapshot_daily l
       where l.player_tag = s.player_tag
         and l.snapshot_date < s.snapshot_date
         and l.profile_observed_at is not null
       order by l.snapshot_date desc
       limit 1) lp on s.profile_observed_at is null
    -- A member who left by the clan row's read keeps the clan's tag on
    -- their day row until a roster places them elsewhere; members_seen
    -- counts them, the profile aggregates do not (Gym #197: after the
    -- #111 carry, a leaver's carried profile had put 49 over 46 members).
    cross join lateral (
      select not exists (
               select 1 from clan_membership cm
                where cm.clan_tag = s.clan_tag and cm.player_tag = s.player_tag
                  and cm.left_observed_at <= c.observed_at
                  and cm.left_observed_at > c.observed_at - interval '2 days')
          or exists (
               select 1 from clan_membership cm
                where cm.clan_tag = s.clan_tag and cm.player_tag = s.player_tag
                  and cm.joined_observed_at <= c.observed_at
                  and (cm.left_observed_at is null or cm.left_observed_at > c.observed_at)) as stayed) st
   where s.clan_tag = c.clan_tag and s.snapshot_date = c.day and s.snapshot_kind = c.snapshot_kind`;

function parseTags(list, argName, max) {
  if (list === undefined) return null;
  if (!Array.isArray(list) || list.length === 0 || list.length > max)
    throw new ToolFailure("bad_request", `${argName} takes 1-${max} tags.`);
  return list.map((t) => {
    try {
      return normalizeTag(String(t));
    } catch {
      throw new ToolFailure("invalid_tag", `Invalid tag: ${t}`, TAG_RULE_HINT);
    }
  });
}

/** Roster counters the game zeroes every week (Monday, around 00:00Z). */
const WEEKLY_COUNTERS = new Set(["donations", "donations_received"]);

/** What a weekly counter added across a series: each rise between reads,
 *  and after a drop (the reset) the new reading from zero. Last minus
 *  first read a reset as a loss (Gym #305: Vijay -169 in a week he gave
 *  1,256). A floor: what was given after the last read before a reset
 *  is not in it. */
function counterRise(points, k) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1][k];
    const b = points[i][k];
    if (typeof a !== "number" || typeof b !== "number") continue;
    total += b >= a ? b - a : b;
  }
  return total;
}

export const seriesTools = {
  clans_timeline: {
    description:
      "A clan's daily series, yours by default, one point per game day from the roster: clan_score, clan_war_trophies, members, donations_per_week, required_trophies, and the aggregates over that day's member rows (total_member_trophies, avg_member_trophies, members_seen, members_with_profile); the profile-derived aggregates (avg_member_wins, avg_member_collection_level, the 12000+/14000+/6-years+/collection-1000+ counts) are metrics to ask for. kind selects the pre_reset or season_roll row; granularity week keeps the last row of each ISO week. verbosity compact keeps day and the five clan metrics.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: CLAN_TAG_SCHEMA,
        metrics: {
          type: "array",
          items: { type: "string", enum: ALL_CLAN_METRICS },
          description:
            "Which series to return; default the five clan metrics and the three roster aggregates.",
        },
        ...DAY_WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        timezone: TIMEZONE_SCHEMA,
        granularity: GRANULARITY_SCHEMA,
        kind: KIND_SCHEMA,
        verbosity: VERBOSITY("day and the five clan metrics per point."),
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const tz = zoneFor(ctx, args);
      const win = await seriesWindow(ctx, args);
      // A bare call is the last 30 game days, not the whole history (Gym
      // #239: the default read ran 68,431 characters and was refused).
      if (win.source === "unbounded") {
        win.from = gameDay(Date.now() - 29 * 86_400_000);
        win.source = "default";
        win.defaultNote =
          "No window was given, so this is the last 30 game days; pass from (series_available_from is the first day on record), days or season for more.";
      }
      requireEnum(args.granularity, ["day", "week"], "granularity");
      requireEnum(args.kind, KINDS, "kind");
      requireEnum(args.verbosity, ["full", "compact"], "verbosity");
      for (const m of args.metrics ?? [])
        requireEnum(m, ALL_CLAN_METRICS, "metric");
      const compact = args.verbosity === "compact";
      const metrics = compact
        ? CLAN_METRICS
        : Array.isArray(args.metrics) && args.metrics.length > 0
          ? args.metrics
          : DEFAULT_CLAN_METRICS;
      const kind = args.kind ?? "daily";
      const where = [`c.clan_tag = $1`, `c.snapshot_kind = $2`];
      const params = [clanTag, kind];
      if (win.from) {
        params.push(win.from);
        where.push(`c.day >= $${params.length}::date`);
      }
      if (win.to) {
        params.push(win.to);
        where.push(`c.day <= $${params.length}::date`);
      }
      const { rows: epoch } = await ctx.db.query(
        `select min(day)::text as first from clan_snapshot_daily where clan_tag = $1 and snapshot_kind = 'daily'`,
        [clanTag],
      );
      const availableFrom = epoch[0]?.first ?? null;
      const needAggregates = metrics.some(
        (m) => !CLAN_METRICS.includes(m) && !CLAN_ATTRIBUTES.includes(m),
      );
      const weekly = args.granularity === "week";
      const cols = `c.day, c.snapshot_kind, c.observed_at, c.source, c.clan_score, c.clan_war_trophies,
                    c.members, c.donations_per_week, c.required_trophies, c.type, c.location_id
                    ${needAggregates ? ", a.*" : ""}`;
      const fromSql = `from clan_snapshot_daily c
                       ${needAggregates ? `left join lateral (${AGGREGATE_SQL}) a on true` : ""}`;
      const { rows } = await ctx.db.query(
        weekly
          ? `select distinct on (date_trunc('week', c.day)) ${cols},
                    to_char(c.day, 'IYYY-"W"IW') as iso_week
             ${fromSql} where ${where.join(" and ")}
             order by date_trunc('week', c.day), c.day desc`
          : `select ${cols} ${fromSql} where ${where.join(" and ")} order by c.day`,
        params,
      );
      // The game day still in progress (Gym #111): its profile-derived
      // points cover only the members polled so far, and the early-polled
      // skew heavy, so the point is partial, not merely noisy.
      const today = gameDay(new Date());
      const points = (weekly ? rows.sort((a, z) => a.day - z.day) : rows).map(
        (r) => ({
          day: r.day.toISOString().slice(0, 10),
          ...(weekly ? { iso_week: r.iso_week } : {}),
          kind: r.snapshot_kind,
          observed_at: r.observed_at.toISOString(),
          source: r.source,
          ...(r.day.toISOString().slice(0, 10) === today
            ? { partial: true }
            : {}),
          ...Object.fromEntries(metrics.map((m) => [m, r[m] ?? null])),
        }),
      );
      // The clan's weekly donation counter keeps a departed member's
      // donations; its member rows do not (Gym #242: 10,240 against the
      // rows' 10,121, the 119 a member who left mid-week). Said where the
      // two differ in a week someone left.
      let counterNote = null;
      if (metrics.includes("donations_per_week") && rows.length) {
        const days = rows.map((r) => r.day.toISOString().slice(0, 10));
        const { rows: gaps } = await ctx.db.query(
          `select c.day::text as day, c.donations_per_week as counter,
                  (select coalesce(sum(s.donations), 0)::int from player_snapshot_daily s
                    where s.clan_tag = c.clan_tag and s.snapshot_date = c.day
                      and s.snapshot_kind = c.snapshot_kind) as rows_sum,
                  (select string_agg(coalesce(p.name, cm.player_tag), ', ' order by cm.left_observed_at)
                     from clan_membership cm join player p on p.player_tag = cm.player_tag
                    where cm.clan_tag = c.clan_tag
                      and cm.left_observed_at >= date_trunc('week', c.day)::date + interval '10 hours'
                      and cm.left_observed_at < c.day + interval '34 hours') as leavers
             from clan_snapshot_daily c
            where c.clan_tag = $1 and c.snapshot_kind = $2 and c.day = any($3::date[])`,
          [clanTag, kind, days],
        );
        const off = gaps.filter(
          (g) =>
            Number.isInteger(g.counter) && g.counter > g.rows_sum && g.leavers,
        );
        if (off.length)
          counterNote = `donations_per_week is the game's clan counter, which keeps a departed member's donations for the week while the member rows do not: ${off
            .slice(0, 6)
            .map(
              (g) =>
                `on ${g.day} it reads ${g.counter} against ${g.rows_sum} over the member rows, and ${g.leavers} left that week`,
            )
            .join("; ")}.`;
      }
      const leaverDays = rows
        .filter((r) => r.members_left_excluded > 0)
        .map(
          (r) =>
            `${r.day.toISOString().slice(0, 10)} (${r.members_left_excluded})`,
        );
      const thinDays = rows
        .filter(
          (r) =>
            Number.isInteger(r.members_with_profile) &&
            Number.isInteger(r.members) &&
            r.members_with_profile < r.members,
        )
        .map(
          (r) =>
            `${r.day.toISOString().slice(0, 10)} (${r.members_with_profile} of ${r.members})`,
        );
      const seasonFields = await seasonFieldsForDays(
        ctx.db,
        win.from ?? availableFrom ?? new Date().toISOString().slice(0, 10),
        win.to,
      );
      return {
        clan_tag: clanTag,
        applied: appliedBlock({
          window: {
            from: win.from,
            to: win.to,
            source: win.source,
            ...(tz ? { timezone: tz } : {}),
            ...win.echoExtra,
            ...seasonFields.echo,
          },
          granularity: weekly ? "week" : "day",
          kind,
          metrics,
          verbosity: compact ? "compact" : "full",
        }),
        series_available_from: availableFrom,
        series: points,
        notes: notes(
          win.notBegunNote ?? null,
          win.defaultNote ?? null,
          counterNote,
          win.floorNote,
          availableFrom && win.from && win.from < availableFrom
            ? `Requested from ${win.from}, but the clan's series begins ${availableFrom}.`
            : null,
          metrics.includes("members_seen")
            ? "members_seen counts the member rows the roster wrote that day, including members who left during the day (their row keeps the clan's tag until the next roster places them elsewhere), so it can read above members; a day it reads below members is a partial day (the roster was polled, but not every member's row is on the game day's grid yet)."
            : null,
          metrics.some((m) => CLAN_PROFILE_AGGREGATES.includes(m))
            ? "The profile-derived aggregates average over members with a recorded profile as of that day; members_with_profile is that denominator. A member whose profile was not read that day counts with their latest earlier read (members_profile_carried says how many); wins and collection level only climb, so a carried value may be slightly behind. A member who left by the clan's read that day is in members_seen but not in these. members_6_years_plus reads the player's current players_profile.years_played, not the day's."
            : null,
          metrics.some((m) => CLAN_PROFILE_AGGREGATES.includes(m)) &&
            thinDays.length
            ? `On ${thinDays.slice(0, 8).join(", ")}${thinDays.length > 8 ? ` and ${thinDays.length - 8} more days` : ""} some members had no profile read on or before that day, so the profile-derived values there (the members_*_plus counts too) cover only members_with_profile of them: a count below members may be members never read, not members below the line.`
            : null,
          metrics.some(
            (m) =>
              m === "members_with_profile" ||
              m === "members_profile_carried" ||
              CLAN_PROFILE_AGGREGATES.includes(m),
          ) && leaverDays.length
            ? `Members who left by the clan's read on ${leaverDays.slice(0, 8).join(", ")}${leaverDays.length > 8 ? ` and ${leaverDays.length - 8} more days` : ""} are not in members_with_profile or the profile-derived values built over it that day; members_seen still counts their row, which keeps the clan's tag until a roster places them elsewhere.`
            : null,
          points.some((p) => p.partial)
            ? `The point for ${today} is the game day still in progress (partial: true): its profile-derived values cover the members polled so far.`
            : null,
          botSourceNote(points),
          ...seasonFields.seasonNotes,
          GAME_DAY_NOTE,
        ),
        docs: docsRef("recording", "daily-series"),
        meta: await buildMeta(ctx.db, ctx.account, clanTag, ["clan"], {
          timezone: tz,
        }),
      };
    },
  },

  clans_members_timeline: {
    description:
      "The members' daily series for a clan, yours by default: for every player the roster placed in the clan in the window (or player_tags), one point per game day with the roster's metrics (trophies, donations, donations_received, arena_id, clan_rank, previous_clan_rank, game_last_seen_at) and, for members whose profile is recorded, any profile metric of players_timeline. Names are the current ones. kind selects the pre_reset or season_roll row; granularity week keeps each ISO week's last row. verbosity compact keeps each member's first and last point and the delta.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: CLAN_TAG_SCHEMA,
        player_tags: {
          type: "array",
          items: { type: "string" },
          maxItems: 50,
          description:
            "A subset of members; omit for every player the roster placed in the clan in the window.",
        },
        metrics: {
          type: "array",
          items: { type: "string", enum: PLAYER_METRICS },
          description:
            "Which series to return; default trophies and donations.",
        },
        ...DAY_WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        timezone: TIMEZONE_SCHEMA,
        granularity: GRANULARITY_SCHEMA,
        kind: KIND_SCHEMA,
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 50,
          description:
            "Most members to return, in tag order (the first N by tag, not the most active); a clan with more than N members with points sets truncated. Pass player_tags to choose whom, or raise limit to 50 for a whole clan.",
        },
        verbosity: VERBOSITY(
          "per member the first and last point and the delta of each numeric metric, no series.",
        ),
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const tz = zoneFor(ctx, args);
      const win = await seriesWindow(ctx, args);
      requireEnum(args.granularity, ["day", "week"], "granularity");
      requireEnum(args.kind, KINDS, "kind");
      requireEnum(args.verbosity, ["full", "compact"], "verbosity");
      for (const m of args.metrics ?? [])
        requireEnum(m, PLAYER_METRICS, "metric");
      const tags = parseTags(args.player_tags, "player_tags", 50);
      const limit = Number(args.limit ?? 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        throw new ToolFailure("bad_request", "limit must be 1-50.");
      const compact = args.verbosity === "compact";
      const metrics =
        Array.isArray(args.metrics) && args.metrics.length > 0
          ? args.metrics
          : ["trophies", "donations"];
      const kind = args.kind ?? "daily";
      const where = [`s.clan_tag = $1`, `s.snapshot_kind = $2`];
      const params = [clanTag, kind];
      if (tags) {
        params.push(tags);
        where.push(`s.player_tag = any($${params.length}::text[])`);
      }
      if (win.from) {
        params.push(win.from);
        where.push(`s.snapshot_date >= $${params.length}::date`);
      }
      if (win.to) {
        params.push(win.to);
        where.push(`s.snapshot_date <= $${params.length}::date`);
      }
      // The members first (bounded), then their rows: one query at a
      // time, and the limit is on members, not on points.
      const { rows: memberRows } = await ctx.db.query(
        `select s.player_tag, p.name, count(*)::int as points
           from player_snapshot_daily s join player p on p.player_tag = s.player_tag
          where ${where.join(" and ")}
          group by s.player_tag, p.name order by s.player_tag limit ${limit + 1}`,
        params,
      );
      const truncated = memberRows.length > limit;
      const members = memberRows.slice(0, limit);
      const chosen = members.map((m) => m.player_tag);
      params.push(chosen);
      where.push(`s.player_tag = any($${params.length}::text[])`);
      const weekly = args.granularity === "week";
      const cols = `s.player_tag, s.snapshot_date, ${STAMP_COLUMNS.split(", ")
        .map((c) => `s.${c}`)
        .join(", ")}, ${metricSelect("s.")}`;
      const { rows } = chosen.length
        ? await ctx.db.query(
            weekly
              ? `select distinct on (s.player_tag, date_trunc('week', s.snapshot_date)) ${cols},
                        to_char(s.snapshot_date, 'IYYY-"W"IW') as iso_week
                   from player_snapshot_daily s where ${where.join(" and ")}
                  order by s.player_tag, date_trunc('week', s.snapshot_date), s.snapshot_date desc`
              : `select ${cols} from player_snapshot_daily s where ${where.join(" and ")}
                  order by s.player_tag, s.snapshot_date`,
            params,
          )
        : { rows: [] };
      const byTag = new Map(members.map((m) => [m.player_tag, []]));
      for (const r of rows)
        byTag.get(r.player_tag)?.push({
          day: r.snapshot_date.toISOString().slice(0, 10),
          ...(weekly ? { iso_week: r.iso_week } : {}),
          ...pointStamps(r),
          clan_tag: r.clan_tag,
          ...Object.fromEntries(metrics.map((m) => [m, metricValue(r, m)])),
        });
      const allPoints = [...byTag.values()].flat();
      const numeric = (v) => typeof v === "number";
      const seasonFields = await seasonFieldsForDays(
        ctx.db,
        win.from ??
          allPoints.map((p) => p.day).sort()[0] ??
          new Date().toISOString().slice(0, 10),
        win.to,
      );
      const rosterOnly = allPoints.filter(
        (p) => p.profile_observed_at === null,
      ).length;
      return {
        clan_tag: clanTag,
        applied: appliedBlock({
          window: {
            from: win.from,
            to: win.to,
            source: win.source,
            ...(tz ? { timezone: tz } : {}),
            ...win.echoExtra,
            ...seasonFields.echo,
          },
          granularity: weekly ? "week" : "day",
          kind,
          metrics,
          limit,
          verbosity: compact ? "compact" : "full",
        }),
        // Rows on this page; truncated says whether more members had
        // points (Gym #240: truncated was promised and never served).
        member_count: members.length,
        truncated,
        members: members.map((m) => {
          const points = byTag.get(m.player_tag) ?? [];
          const first = points[0] ?? null;
          const last = points.at(-1) ?? null;
          return {
            player_tag: m.player_tag,
            name: m.name ?? null,
            points: points.length,
            ...(compact
              ? {
                  first,
                  last,
                  delta:
                    first && last
                      ? Object.fromEntries(
                          metrics
                            .filter(
                              (k) => numeric(first[k]) && numeric(last[k]),
                            )
                            .map((k) => [
                              k,
                              WEEKLY_COUNTERS.has(k)
                                ? counterRise(points, k)
                                : last[k] - first[k],
                            ]),
                        )
                      : null,
                }
              : { series: points }),
          };
        }),
        notes: notes(
          win.notBegunNote ?? null,
          win.floorNote,
          truncated
            ? `More than ${limit} members had points in the window; the first ${limit} by tag are here - pass player_tags to choose, or raise limit (max 50).`
            : null,
          rosterOnly > 0
            ? `${rosterOnly} of ${allPoints.length} points are roster-only (profile_observed_at null): the roster's metrics are the day's, the profile metrics null there.`
            : null,
          metrics.includes("donations")
            ? "donations is the weekly counter as of each point; it climbs all week and drops to 0 around the start of Monday UTC. In compact, delta.donations (and delta.donations_received) is what the counter added across the window, a reset counted from zero, never last minus first; it is a floor, since what was given after the last read before a reset is not in it. kind: pre_reset is the week's highest value the record read, a lower bound on the week's total: donations made after the last read before the reset are not in it, so it can sit below that week's rise in the members' lifetime total_donations."
            : null,
          "A member's point carries clan_tag: the clan the day's last roster placed them in, so a member who moved clans that day is under the later clan's tag.",
          botSourceNote(allPoints),
          ...seasonFields.seasonNotes,
          GAME_DAY_NOTE,
        ),
        docs: docsRef("recording", "daily-series"),
        meta: await buildMeta(ctx.db, ctx.account, clanTag, ["clan"], {
          timezone: tz,
        }),
      };
    },
  },
};
