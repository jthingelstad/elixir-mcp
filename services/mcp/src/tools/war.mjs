import { gameClock } from "../../../ingest/src/game-clock.mjs";
/** game_clock · war_rivals · war_current · war_history. Conventions
 *  (1.0.0): `applied`, `notes[]` + `docs`, `verbosity`, `live: true` on
 *  war_current for a clan nobody records. */

import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import { anchoredPeriod } from "../../../ingest/src/war-clock.mjs";
import {
  buildMeta,
  ToolFailure,
  TAG_RULE_HINT,
  ON_BEHALF_OF_SCHEMA,
  VERBOSITY,
  subject,
  entitledClan,
  appliedBlock,
  notes,
  docsRef,
  liveRead,
  liveStatus,
  livePendingNote,
  notRecordedOrPending,
} from "./shared.mjs";

const CLOCK_DOCS = docsRef("clocks", "the-policy-day");
const WAR_DOCS = docsRef("battles", "war-weeks-points-and-fame");

const CLAN_TAG_SCHEMA = {
  type: "string",
  description: "Clan tag like #J2RGCRVG. Omit to mean your recorded clan.",
};

/** The clan a clan tool answers about. With live: true any clan tag is
 *  accepted - recorded or not - and a fresh read is served if in hand or
 *  queued (1.7.0, asynchronous), the way players_profile does for a
 *  player. Without it, the clan must be recorded. */
async function clanSubject(ctx, args, endpoint) {
  if (args.live === true) {
    let tag;
    if (args.clan_tag === undefined) {
      tag = await entitledClan(ctx.db, ctx.account, undefined);
    } else {
      try {
        tag = normalizeTag(String(args.clan_tag));
      } catch {
        throw new ToolFailure(
          "invalid_tag",
          `Invalid clan tag: ${args.clan_tag}`,
          TAG_RULE_HINT,
        );
      }
    }
    // 1.7.0: asynchronous - fresh if in hand, else queued and pending.
    const live = await liveRead(ctx, { endpoint, entityKey: tag });
    return { tag, live };
  }
  return {
    tag: await entitledClan(ctx.db, ctx.account, args.clan_tag),
    live: null,
  };
}

export const warTools = {
  game_clock: {
    description:
      "What time it is in Clash Royale, for nobody in particular: current season, week within the season, whether today is a training day or war day, and when each next rolls over. Needs no player and no clan. Use it to decide WHEN to look before deciding who to look at; war_current is the tool for what a specific clan is doing inside this day.",
    inputSchema: {
      type: "object",
      properties: {
        at: {
          type: "string",
          description:
            "ISO 8601 instant to describe instead of now, e.g. to learn what day a recorded battle fell on.",
        },
      },
      additionalProperties: false,
    },
    async handler(_ctx, args = {}) {
      let atMs = Date.now();
      if (args.at !== undefined) {
        const parsed = Date.parse(args.at);
        if (Number.isNaN(parsed))
          throw new ToolFailure(
            "bad_request",
            `Could not read '${args.at}' as a date.`,
            "Use an ISO 8601 instant, e.g. 2026-09-08T12:00:00Z.",
          );
        atMs = parsed;
      }
      const clock = gameClock(atMs);
      return {
        ...clock,
        applied: appliedBlock({ at: new Date(atMs).toISOString() }),
        docs: CLOCK_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  war_rivals: {
    description:
      "The Scouting Report: observed war history for rival clans. Every recorded river race captures all five bracket clans, so rivals accumulate fingerprints across every race they shared with a recorded clan. Defaults to your clan's current bracket. Pure aggregation of stored observations: races seen, fame record, zero-fame races, seasons spanned.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description:
            "Your clan (the anchor whose bracket is meant). Omit for your recorded clan.",
        },
        rival_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description: "Specific rival clans; omit for the current bracket.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      let rivals = [];
      if (args.rival_tags?.length) {
        for (const raw of args.rival_tags) {
          try {
            rivals.push(normalizeTag(String(raw)));
          } catch {
            throw new ToolFailure(
              "invalid_tag",
              `Invalid clan tag: ${raw}`,
              TAG_RULE_HINT,
            );
          }
        }
      } else {
        const { rows } = await ctx.db.query(
          `select participant_clan_tag from war_week_clan
           where clan_tag = $1 and participant_clan_tag <> $1
             and (season_id, section_index) = (
               select season_id, section_index from war_week
               where clan_tag = $1
               order by season_id desc, section_index desc limit 1)`,
          [clanTag],
        );
        rivals = rows.map((r) => r.participant_clan_tag);
        if (rivals.length === 0)
          throw new ToolFailure(
            "not_recorded",
            "No bracket recorded for this clan yet.",
          );
      }
      // Observer-scoped duplication is by design in the war tables; rival
      // stats dedupe on (season, section, rival) BEFORE aggregating so a
      // race two recorded clans both saw counts once (META-INTEL §10).
      const { rows } = await ctx.db.query(
        `with latest as (
           select season_id, section_index from war_week
           where clan_tag = $1
           order by season_id desc, section_index desc limit 1),
         races as (
           select w.participant_clan_tag, w.season_id, w.section_index,
                  max(w.fame) as fame,
                  max(w.participant_name) as name,
                  bool_or(w.clan_tag = $1) as shared_with_you,
                  (w.season_id, w.section_index) = (select season_id, section_index from latest)
                    as in_progress
           from war_week_clan w
           where w.participant_clan_tag = any($2)
           group by w.participant_clan_tag, w.season_id, w.section_index)
         select participant_clan_tag as clan_tag,
                max(name) as name,
                count(*)::int as races_observed,
                count(*) filter (where shared_with_you)::int as races_shared_with_you,
                min(season_id)::int as first_season,
                max(season_id)::int as last_season,
                round(avg(fame) filter (where not in_progress))::int as mean_fame,
                round(percentile_cont(0.5) within group (order by fame)
                  filter (where not in_progress))::int as median_fame,
                max(fame) filter (where not in_progress)::int as max_fame,
                count(*) filter (where fame = 0 and not in_progress)::int as zero_fame_races,
                max(fame) filter (where in_progress)::int as current_race_fame
         from races group by participant_clan_tag
         order by mean_fame desc nulls last`,
        [clanTag, rivals],
      );
      return {
        clan_tag: clanTag,
        applied: appliedBlock({
          clan_tag: clanTag,
          rival_tags: rivals,
          source: args.rival_tags?.length ? "argument" : "current_bracket",
        }),
        rivals: rows,
        notes: notes(
          "races_observed counts our sightings in races shared with recorded clans, not the rival's full history; a race seen by two recorded clans counts once.",
          "Fame statistics cover finished races only; current_race_fame is the week in progress.",
          "A rival's roster and war state are not recorded; war_current({ clan_tag, live: true }) asks for a fresh read (queued if none is in hand).",
        ),
        docs: WAR_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  war_current: {
    description:
      "The current (latest recorded) river race for a clan, yours by default: standings across the five clans with banked fame and current-day period_points, per-member points and decks used, the war day and attendance so far. On a war day decks_today names who is untouched, partial and finished (the nudge list); off one it is null with decks_today_reason. verbosity compact keeps standings, the period, the counts and the nudge lists (name + tag) and drops the participants array. live: true asks for a read of ANY clan, recorded or not: served if in hand, otherwise queued while the record answers with live_status pending.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: CLAN_TAG_SCHEMA,
        verbosity: VERBOSITY(
          "drops the participants array and attendance history; keeps standings, period, counts, members_not_in_race and the decks_today lists.",
        ),
        live: {
          type: "boolean",
          description:
            "Ask for a read of this clan's race no older than two minutes; works for a clan nobody records. Served if in hand, otherwise queued while the record answers with live_status pending.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const { tag: clanTag, live } = await clanSubject(
        ctx,
        args,
        "currentriverrace",
      );
      const compact = args.verbosity === "compact";
      const { rows: weekRows } = await ctx.db.query(
        `select season_id, section_index, is_colosseum from war_week
         where clan_tag = $1 order by season_id desc, section_index desc limit 1`,
        [clanTag],
      );
      if (!weekRows[0]) {
        throw notRecordedOrPending(
          live,
          "No war weeks recorded for this clan yet.",
          args.live
            ? "The live payload was admitted but no race projected; the clan may be between races. Try war_rivals for its history."
            : "The first riverracelog poll lands within a day of tracking; live: true reads the race now.",
        );
      }
      const wk = weekRows[0];
      const meta = await buildMeta(ctx.db, ctx.account, clanTag, [
        "currentriverrace",
      ]);
      // Grounded time (feedback #8: an agent asserted "the week just
      // finished" from schema alone): the current period anchor gives
      // fields a temporal claim can CITE instead of infer.
      const { rows: anchorRows } = await ctx.db.query(
        `select period_index, first_observed_at from war_period_anchor
         where clan_tag = $1 order by first_observed_at desc limit 1`,
        [clanTag],
      );
      let period = null;
      let nextWarDayOpensAt = null;
      if (anchorRows[0]) {
        const anchor = anchorRows[0].first_observed_at;
        // ONE derivation, shared with the clan_pulse feeder.
        const p = anchoredPeriod(anchorRows[0].period_index, anchor.getTime());
        const info = p.info;
        period = {
          period_index: p.periodIndex,
          kind: info.kind,
          ...(info.warDay ? { war_day: info.warDay } : {}),
          day_in_week: info.dayInSection,
          started_observed_at: anchor.toISOString(),
          source_observed_at: meta.source_polls.currentriverrace.observed_at,
          freshness_seconds:
            meta.source_polls.currentriverrace.freshness_seconds,
          nominal_period_elapsed: !p.openNow,
          period_start_nominal: new Date(p.startMs).toISOString(),
          period_end_nominal: new Date(p.endMs).toISOString(),
          week_end_nominal: new Date(p.weekEndMs).toISOString(),
          // How far this clan's observed start sat from the policy hour,
          // INCLUDING our polling latency: an upper bound on the drift.
          observed_offset_minutes: p.observedOffsetMinutes,
          next_war_day_opens_at: p.nextWarDayOpensMs
            ? new Date(p.nextWarDayOpensMs).toISOString()
            : null,
        };
        nextWarDayOpensAt = period.next_war_day_opens_at;
      }
      const standings = await ctx.db.query(
        `select participant_clan_tag, participant_name, fame, period_points,
                rank, trophy_change, finish_time
           from war_week_clan
           where clan_tag = $1 and season_id = $2 and section_index = $3
           order by rank nulls last, fame desc`,
        [clanTag, wk.season_id, wk.section_index],
      );
      const participation = await ctx.db.query(
        `select wp.player_tag, p.name, wp.points, wp.decks_used, wp.boat_attacks,
                  exists (select 1 from clan_membership cm
                          where cm.clan_tag = wp.clan_tag and cm.player_tag = wp.player_tag
                            and cm.left_observed_at is null) as in_clan
           from war_participation wp join player p on p.player_tag = wp.player_tag
           where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
           order by wp.points desc,
                    exists (select 1 from clan_membership cm2
                            where cm2.clan_tag = wp.clan_tag and cm2.player_tag = wp.player_tag
                              and cm2.left_observed_at is null) desc,
                    p.name nulls last`,
        [clanTag, wk.season_id, wk.section_index],
      );
      // WHO IS IN THE CLAN BUT NOT IN THE RACE. Verified against the live
      // API 2026-09-09: the game seeds the race roster from members SEEN
      // since the race began, so the omitted members are the ones whose
      // lastSeen predates the race start (written up in cr-agent-api-docs).
      const notInRace = await ctx.db.query(
        `select cm.player_tag, p.name
         from clan_membership cm
         left join player p on p.player_tag = cm.player_tag
         where cm.clan_tag = $1 and cm.left_observed_at is null
           and not exists (
             select 1 from war_participation wp
             where wp.clan_tag = cm.clan_tag and wp.player_tag = cm.player_tag
               and wp.season_id = $2 and wp.section_index = $3)
         order by p.name nulls last`,
        [clanTag, wk.season_id, wk.section_index],
      );
      // Battled = decksUsedToday observed >0 at any poll, OR a recorded
      // war battle by that member that day — polls alone undercount
      // when the cadence misses a member's play window (round-3).
      const attendance = await ctx.db.query(
        `with att as (
             select war_day, player_tag, decks_used_today > 0 as battled
             from war_attendance_day
             where clan_tag = $1 and season_id = $2 and section_index = $3),
           fought as (
             select distinct b.war_day, bp.player_tag
             from battle b join battle_participant bp on bp.battle_id = b.battle_id
             where bp.clan_tag = $1 and b.season_id = $2 and b.section_index = $3
               and b.war_day is not null),
           merged as (
             select war_day, player_tag, bool_or(battled) as battled from (
               select war_day, player_tag, battled from att
               union all
               select war_day, player_tag, true from fought) x
             group by war_day, player_tag)
           select war_day,
                  count(*) filter (where battled)::int as battled,
                  count(*)::int as participants
           from merged
           group by war_day order by war_day`,
        [clanTag, wk.season_id, wk.section_index],
      );
      // Today's remaining-decks picture (CLAN-PULSE.md): only while the
      // anchored war-day period is nominally still open.
      let decksToday = null;
      let overCapNote = null;
      if (
        period?.war_day &&
        Date.now() < Date.parse(period.period_end_nominal)
      ) {
        const { rows: dayRows } = await ctx.db.query(
          `with base as (
             select wp.player_tag, p.name
             from war_participation wp join player p on p.player_tag = wp.player_tag
             where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
               and exists (select 1 from clan_membership cm
                           where cm.clan_tag = wp.clan_tag and cm.player_tag = wp.player_tag
                             and cm.left_observed_at is null)),
           att as (
             select player_tag, decks_used_today from war_attendance_day
             where clan_tag = $1 and season_id = $2 and section_index = $3 and war_day = $4),
           fought as (
             select bp.player_tag, count(distinct b.battle_id)::int as n
             from battle b join battle_participant bp on bp.battle_id = b.battle_id
             where bp.clan_tag = $1 and b.season_id = $2 and b.section_index = $3
               and b.war_day = $4
             group by bp.player_tag)
           select base.player_tag, base.name,
                  least(greatest(coalesce(att.decks_used_today, 0),
                                 coalesce(fought.n, 0)), 4)::int as decks_used,
                  greatest(coalesce(att.decks_used_today, 0),
                           coalesce(fought.n, 0))::int as decks_raw
           from base
           left join att on att.player_tag = base.player_tag
           left join fought on fought.player_tag = base.player_tag
           order by decks_used, base.name nulls last`,
          [clanTag, wk.season_id, wk.section_index, period.war_day],
        );
        const pick = (lo, hi) =>
          dayRows
            .filter((r) => r.decks_used >= lo && r.decks_used <= hi)
            .map(({ player_tag, name, decks_used }) => ({
              player_tag,
              name,
              decks_used,
            }));
        // A day holds four decks. Following the 10:00Z POLICY reset rather
        // than each clan's drifted start means battles in the drift gap
        // land on the previous policy day; the first sign is somebody
        // counting FIVE decks. Surface it instead of rounding it away.
        const overCap = dayRows
          .filter((r) => r.decks_raw > 4)
          .map((r) => ({
            player_tag: r.player_tag,
            name: r.name,
            decks_observed: r.decks_raw,
          }));
        decksToday = {
          war_day: period.war_day,
          untouched: pick(0, 0),
          partial: pick(1, 3),
          finished: pick(4, 4),
          counts: {
            untouched: pick(0, 0).length,
            partial: pick(1, 3).length,
            finished: pick(4, 4).length,
            participants: dayRows.length,
          },
          ...(overCap.length > 0 ? { over_cap: overCap } : {}),
        };
        if (overCap.length > 0)
          overCapNote =
            "over_cap lists members observed with more than four decks in this policy day: this clan's real reset drifts far enough from the policy hour to move battles across the boundary.";
      }
      return {
        clan_tag: clanTag,
        season_id: wk.season_id,
        section_index: wk.section_index,
        is_colosseum: wk.is_colosseum,
        // What KIND of day this is, beside season_id and mirroring
        // game_clock (playtest round, 2026-09-09).
        day_kind: period?.kind ?? null,
        war_day: period?.war_day ?? null,
        next_war_day_opens_at: nextWarDayOpensAt,
        applied: appliedBlock({
          clan_tag: clanTag,
          verbosity: compact ? "compact" : "full",
          live: args.live === true ? true : undefined,
        }),
        ...(live ? { live_status: liveStatus(live) } : {}),
        standings: standings.rows.map((row) => ({
          ...row,
          finish_time: row.finish_time?.toISOString() ?? null,
        })),
        ...(compact ? {} : { participants: participation.rows }),
        participants_count: participation.rows.length,
        member_count:
          participation.rows.filter((r) => r.in_clan).length +
          notInRace.rows.length,
        members_not_in_race: notInRace.rows.map((r) => ({
          player_tag: r.player_tag,
          name: r.name,
          reason: "not_in_race_roster",
        })),
        ...(period ? { period } : {}),
        // decks_today is an ANSWER when it is null, not an omission.
        decks_today: decksToday,
        ...(decksToday
          ? {}
          : {
              decks_today_reason: !period
                ? "period_unknown"
                : period.war_day
                  ? "war_day_over"
                  : "training_day",
            }),
        ...(compact ? {} : { attendance_by_war_day: attendance.rows }),
        notes: notes(
          livePendingNote(live),
          "points are per-member contributions; fame belongs to the boat (the clan).",
          "standings.fame is cumulative race progress banked at the day close; standings.period_points is the current day's score, so fame can be zero on war day 1 while members already have points.",
          "members_not_in_race names current members the game left out of the race roster: their game-side lastSeen predates the race start (a nudge list; the predicate is the game's).",
          decksToday
            ? "decks_today trails actual play early in a day: cite it as observed so far, never as final."
            : null,
          overCapNote,
          "Days follow the 10:00 UTC policy reset for every clan: cite the *_nominal instants; started_observed_at is when the recorder first saw the period, observed_offset_minutes its distance from the policy hour including polling latency.",
          "war_day is 1-based, day_in_week 0-based; attendance_by_war_day is empty before the week's first war day.",
        ),
        docs: CLOCK_DOCS,
        meta: {
          ...meta,
          ...(period?.nominal_period_elapsed
            ? {
                completeness_note:
                  "The latest observed period has passed its nominal end. A new period is not asserted until observed; check period.source_observed_at and game_clock for the policy clock.",
              }
            : {}),
        },
      };
    },
  },

  war_history: {
    description:
      "Recorded war weeks for a clan, yours by default: final ranks and boat fame. With player_tag (or on_behalf_of), returns one member's per-week points, decks and war days battled. With season_id and section_index together, returns that exact week plus every recorded participant in member_weeks. seasons says how far back otherwise; from/to are not needed here.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: CLAN_TAG_SCHEMA,
        player_tag: {
          type: "string",
          description: "Focus one member's participation (member_weeks).",
        },
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        seasons: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          default: 3,
          description: "How many seasons back.",
        },
        season_id: {
          type: "integer",
          minimum: 0,
          description:
            "Exact season to read; supply section_index too. Returns every recorded participant for that week unless player_tag focuses one.",
        },
        section_index: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          description:
            "Exact section (week) within season_id; supply season_id too.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      let focus = null;
      // on_behalf_of alone is enough: an agent asked "how did I do in war"
      // by a human it knows means focus THAT member, not the whole clan.
      if (args.player_tag || args.on_behalf_of)
        focus = (
          await subject(
            ctx.db,
            ctx.account,
            args.player_tag,
            "summary",
            args.on_behalf_of,
          )
        ).tag;
      const seasons = Number(args.seasons ?? 3);
      if (!Number.isInteger(seasons) || seasons < 1 || seasons > 12)
        throw new ToolFailure(
          "bad_request",
          `seasons must be an integer from 1 to 12 (got ${args.seasons}).`,
        );
      const hasSeason = args.season_id !== undefined;
      const hasSection = args.section_index !== undefined;
      if (hasSeason !== hasSection)
        throw new ToolFailure(
          "bad_request",
          "season_id and section_index must be supplied together.",
        );
      const exactSeason = hasSeason ? Number(args.season_id) : null;
      const exactSection = hasSection ? Number(args.section_index) : null;
      const { rows: weeks } = await ctx.db.query(
        `select w.season_id, w.section_index, w.is_colosseum, w.finished_observed_at,
                own.fame as our_fame, own.rank as our_rank, own.trophy_change,
                (w.season_id, w.section_index) =
                  (select season_id, section_index from war_week
                   where clan_tag = $1
                   order by season_id desc, section_index desc limit 1) as is_latest_recorded
         from war_week w
         left join war_week_clan own on own.clan_tag = w.clan_tag
           and own.season_id = w.season_id and own.section_index = w.section_index
           and own.participant_clan_tag = w.clan_tag
         where w.clan_tag = $1
           and (($3::integer is not null
                 and w.season_id = $3 and w.section_index = $4)
                or ($3::integer is null and w.season_id > coalesce(
                  (select max(season_id) from war_week where clan_tag = $1), 0) - $2))
         order by w.season_id desc, w.section_index desc`,
        [clanTag, seasons, exactSeason, exactSection],
      );
      let memberWeeks = null;
      if (focus || hasSeason) {
        // war_days_battled unions TWO observation sources — decksUsedToday
        // polls AND the member's own recorded war battles. Null when the
        // week has NO coverage from either source.
        const { rows } = await ctx.db.query(
          `select wp.player_tag, p.name, wp.season_id, wp.section_index,
                  wp.points, wp.decks_used, wp.boat_attacks,
                  case when exists (select 1 from war_attendance_day cov
                                    where cov.clan_tag = wp.clan_tag
                                      and cov.season_id = wp.season_id
                                      and cov.section_index = wp.section_index)
                         or exists (select 1 from battle_participant bpc
                                    join battle bc on bc.battle_id = bpc.battle_id
                                    where bpc.clan_tag = wp.clan_tag
                                      and bc.season_id = wp.season_id
                                      and bc.section_index = wp.section_index
                                      and bc.war_day is not null)
                       then (select count(distinct d.war_day)::int from (
                               select ad.war_day from war_attendance_day ad
                               where ad.clan_tag = wp.clan_tag and ad.season_id = wp.season_id
                                 and ad.section_index = wp.section_index and ad.player_tag = wp.player_tag
                                 and ad.decks_used_today > 0
                               union
                               select b.war_day from battle_participant bp2
                               join battle b on b.battle_id = bp2.battle_id
                               where bp2.player_tag = wp.player_tag and bp2.clan_tag = wp.clan_tag
                                 and b.season_id = wp.season_id and b.section_index = wp.section_index
                                 and b.war_day is not null) d)
                       end as war_days_battled,
                  (select array_agg(distinct d.war_day order by d.war_day) from (
                               select ad.war_day from war_attendance_day ad
                               where ad.clan_tag = wp.clan_tag and ad.season_id = wp.season_id
                                 and ad.section_index = wp.section_index and ad.player_tag = wp.player_tag
                                 and ad.decks_used_today > 0
                               union
                               select b.war_day from battle_participant bp2
                               join battle b on b.battle_id = bp2.battle_id
                               where bp2.player_tag = wp.player_tag and bp2.clan_tag = wp.clan_tag
                                 and b.season_id = wp.season_id and b.section_index = wp.section_index
                                 and b.war_day is not null) d) as war_days
           from war_participation wp
           left join player p on p.player_tag = wp.player_tag
           where wp.clan_tag = $1
             and ($2::text is null or wp.player_tag = $2)
             and (($4::integer is not null
                   and wp.season_id = $4 and wp.section_index = $5)
                  or ($4::integer is null and wp.season_id > coalesce(
                    (select max(season_id) from war_week where clan_tag = $1), 0) - $3))
           order by wp.season_id desc, wp.section_index desc, wp.points desc,
                    p.name nulls last
           ${hasSeason ? "" : "limit 40"}`,
          [clanTag, focus, seasons, exactSeason, exactSection],
        );
        // war_days: the day indices battled, so "played 3 of 4" can become
        // "missed day 2" (feedback item 30, 2026-09-10). Null when unknown.
        memberWeeks = rows.map((r) => ({
          ...r,
          war_days: r.war_days_battled === null ? null : (r.war_days ?? []),
        }));
      }
      // The chronologically-latest unfinished week is the one still being
      // fought; older null-standings weeks are capture gaps.
      return {
        clan_tag: clanTag,
        applied: appliedBlock({
          clan_tag: clanTag,
          seasons: hasSeason ? undefined : seasons,
          season_id: exactSeason ?? undefined,
          section_index: exactSection ?? undefined,
          member: focus ?? undefined,
        }),
        weeks: weeks.map((w) => ({
          season_id: w.season_id,
          section_index: w.section_index,
          is_colosseum: w.is_colosseum,
          in_progress:
            w.is_latest_recorded && w.finished_observed_at === null
              ? true
              : undefined,
          finished: w.finished_observed_at?.toISOString() ?? null,
          our_rank: w.our_rank,
          our_fame: w.our_fame,
          // A regular week that hit the 10,000-fame finish line stopped
          // earning member points; decks_used keeps counting.
          ...(w.our_fame === 10000 && !w.is_colosseum
            ? { finished_early: true }
            : {}),
          trophy_change: w.trophy_change,
        })),
        ...(!hasSeason && weeks.length > 0
          ? {
              history_starts_at: {
                season_id: weeks[weeks.length - 1].season_id,
                section_index: weeks[weeks.length - 1].section_index,
              },
            }
          : {}),
        ...(focus ? { member: focus } : {}),
        ...(focus || hasSeason ? { member_weeks: memberWeeks } : {}),
        notes: notes(
          "points are per-member contributions; fame belongs to the boat (the clan).",
          "in_progress marks the week still being fought; on OLDER weeks a null our_rank/our_fame means the week was observed without a standings capture.",
          hasSeason && !focus
            ? "member_weeks contains every recorded participant for the exact week; null war_days_battled means per-day attendance is unknown, while war_days lists the observed day indices battled."
            : focus
              ? "member_weeks: null war_days_battled means per-day attendance is unknown for that week (unknown, not zero); war_days lists the day indices battled."
              : "Pass player_tag for one member's week-by-week participation (member_weeks).",
          "finished_early marks regular weeks where the boat hit the 10,000-fame line: decks used after the finish earn zero points, so per-deck math there is invalid.",
          hasSeason
            ? null
            : "history_starts_at is the recording horizon: fewer seasons than requested is coverage, not absence.",
        ),
        docs: WAR_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
