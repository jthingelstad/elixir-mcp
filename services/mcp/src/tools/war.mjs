import { gameClock } from "../../../ingest/src/game-clock.mjs";
/** war_rivals · war_current · war_history — moved verbatim from the
 *  single-file registry (review item 8). */

import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import { anchoredPeriod } from "../../../ingest/src/war-clock.mjs";
import {
  buildMeta,
  ToolFailure,
  TAG_RULE_HINT,
  ON_BEHALF_OF_SCHEMA,
  subject,
  entitledClan,
} from "./shared.mjs";

export const warTools = {
  game_clock: {
    description:
      "What time it is in Clash Royale, for nobody in particular: current season, week within the season, whether today is a training day or war day, and when each next rolls over. Needs no player and no clan — it is a property of the game, not of anyone playing it. Use it to decide WHEN to look before deciding who to look at; war_current is the tool for what a specific clan is doing inside this day.",
    inputSchema: {
      type: "object",
      properties: {
        at: {
          type: "string",
          description:
            "ISO 8601 instant to describe instead of now. Useful for checking what a recorded battle's day was.",
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

      return {
        ...gameClock(atMs),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  war_rivals: {
    description:
      "The Scouting Report (META-INTEL §10): observed war history for rival clans — every recorded river race captures all five bracket clans, so rivals accumulate fingerprints across every race they ever shared with a recorded clan. Defaults to your clan's current bracket. Pure aggregation of stored observations: races seen, fame record, zero-fame races, seasons spanned.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description:
            "Your clan (entitlement anchor); defaults to your recorded clan.",
        },
        rival_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description:
            "Specific rival clans; defaults to your current bracket.",
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
        rivals: rows,
        basis:
          "Observed in races shared with recorded clans — a rival's races_observed is our sightings, not their full history. Fame stats cover finished races only; current_race_fame is the in-progress week. Races seen by two recorded clans count once.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  war_current: {
    description:
      "The current (latest recorded) river race for a recorded clan (defaults to YOURS): standings across the five clans, per-member points/decks used, war day and attendance so far. period.source_observed_at and freshness_seconds expose the current-race poll; nominal_period_elapsed warns when the observed policy window ended without inventing a new observation. day_kind and war_day say what kind of day it is without a second call (mirroring game_clock), and next_war_day_opens_at when war is not open. On a live war day, decks_today names who is untouched/partial/finished - the nudge list for clan management; off one it is null with decks_today_reason, because a zeroed roster on a training day looks exactly like a clan that no-showed.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const { rows: weekRows } = await ctx.db.query(
        `select season_id, section_index, is_colosseum from war_week
         where clan_tag = $1 order by season_id desc, section_index desc limit 1`,
        [clanTag],
      );
      if (!weekRows[0]) {
        throw new ToolFailure(
          "not_recorded",
          "No war weeks recorded for this clan yet.",
          "The first riverracelog poll lands within a day of enrollment.",
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
        // ONE derivation, shared with the clan_pulse feeder. Both used to
        // rebuild these from the primitives; the other copy drifted.
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
          // so a consumer can judge the size of the effect on its own
          // clan instead of taking our word for it. Includes our polling
          // latency, so it is an upper bound on the true drift.
          observed_offset_minutes: p.observedOffsetMinutes,
          next_war_day_opens_at: p.nextWarDayOpensMs
            ? new Date(p.nextWarDayOpensMs).toISOString()
            : null,
          as_observed_note:
            "Elixir MCP follows the 10:00 UTC POLICY reset for every clan. Clash Royale matches clans into races of five as matchmaking fills, so a clan's real period start drifts off that hour by its own amount; a multi-clan service cannot honour every clan's start and still have war_day mean one comparable window. *_nominal are therefore policy-grid instants, identical across clans, and are the fields to cite. started_observed_at is when the recorder first saw this period open (true start is at or before it) and observed_offset_minutes is its distance from the policy hour, INCLUDING our polling latency - use them to correct for a single clan's drift if you need to. Consequence worth knowing: battles played between a clan's real start and the policy hour are attributed to the previous policy day. war_day is 1-based (day 1 = first war day); day_in_week is 0-based (0 = first training day). Never infer from day counts or event schemas.",
        };
        nextWarDayOpensAt = period.next_war_day_opens_at;
      }
      // One client is one connection: pg queues concurrent queries on it
      // anyway, so Promise.all bought no parallelism and only tripped the
      // deprecation (docs/ENGINEERING.md: one client, one query at a time).
      const standings = await ctx.db.query(
        `select participant_clan_tag, participant_name, fame, rank, trophy_change, finish_time
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
      // anchored war-day period is nominally still open — a stale anchor
      // must never present an old day as "today". Attendance polls are
      // unioned with recorded war battles (polls alone undercount,
      // round-3); duels make battle counts a floor, so greatest() keeps
      // the poll number authoritative when present.
      let decksToday = null;
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
        // decks_raw is the uncapped count, used only to detect the
        // over-cap case; members carry the capped display value.
        const pick = (lo, hi) =>
          dayRows
            .filter((r) => r.decks_used >= lo && r.decks_used <= hi)
            .map(({ player_tag, name, decks_used }) => ({
              player_tag,
              name,
              decks_used,
            }));
        // A day holds four decks, so the display value is capped. That
        // cap was silently swallowing its own evidence: following the
        // 10:00Z POLICY reset rather than each clan's drifted start
        // means battles in the drift gap land on the previous policy
        // day, and the first way that would show is somebody counting
        // FIVE decks in a day. Surface it instead of rounding it away -
        // this is the measurement of what the policy grid costs.
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
          note: `Decks used TODAY per current member in this week's race roster: riverrace polls unioned with recorded war battles. Early in a war day the counts trail actual play - cite as 'observed so far', never as final. Days are the 10:00 UTC POLICY day, the same window for every clan; see period.as_observed_note.${overCap.length > 0 ? " over_cap lists members observed with MORE than four decks in this policy day - a sign that this clan's real reset drifts far enough from the policy hour to move battles across the boundary." : ""}`,
        };
      }
      return {
        clan_tag: clanTag,
        season_id: wk.season_id,
        section_index: wk.section_index,
        is_colosseum: wk.is_colosseum,
        // What KIND of day this is, beside season_id and mirroring
        // game_clock. On a training day this tool returns a full roster of
        // zeroed points and decks and a bracket at fame 0 - shaped exactly
        // like a clan that no-showed a war day. The only discriminator was
        // period.kind, below a 900-character note; a leader read the payload
        // as "the entire clan no-showed" and was saved only by having called
        // game_clock in the same batch (playtest round, 2026-09-09).
        day_kind: period?.kind ?? null,
        war_day: period?.war_day ?? null,
        next_war_day_opens_at: nextWarDayOpensAt,
        standings: standings.rows,
        participants: participation.rows,
        ...(period ? { period } : {}),
        // decks_today is an ANSWER when it is null, not an omission. It
        // used to vanish from the payload entirely off a war day while the
        // description still promised it as "the nudge list", so a leader
        // could not tell "nobody owes attacks today" from "this broke".
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
        attendance_by_war_day: attendance.rows,
        note: "points are per-member contributions; fame belongs to the boat (clan). standings mirror the game's own race payload: a zero-fame opponent can be real (an inactive bracket). participants list everyone in the race roster this week, sorted by points then current members first; in_clan is false for those who have since left. attendance_by_war_day counts race participants (not just current members); battled unions poll observations with recorded battles - it is empty before this week's first war day, which day_kind tells you apart from a capture gap.",
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
      'Recorded war weeks for a recorded clan (defaults to YOURS): final ranks, boat fame, and (optionally) one member\u2019s per-week points and decks — "did I miss a war day?" lives here.',
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
        player_tag: {
          type: "string",
          description: "Focus one member’s participation.",
        },
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        seasons: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          default: 3,
          description: "How many seasons back.",
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
      const { rows: weeks } = await ctx.db.query(
        `select w.season_id, w.section_index, w.is_colosseum, w.finished_observed_at,
                own.fame as our_fame, own.rank as our_rank, own.trophy_change
         from war_week w
         left join war_week_clan own on own.clan_tag = w.clan_tag
           and own.season_id = w.season_id and own.section_index = w.section_index
           and own.participant_clan_tag = w.clan_tag
         where w.clan_tag = $1
           and w.season_id > coalesce((select max(season_id) from war_week where clan_tag = $1), 0) - $2
         order by w.season_id desc, w.section_index desc`,
        [clanTag, seasons],
      );
      let memberWeeks = null;
      if (focus) {
        // Same season window as the weeks list. war_days_battled unions
        // TWO observation sources — decksUsedToday polls AND the member's
        // own recorded war battles (sparse polls miss decksUsedToday
        // windows; round-3 cross-check caught the undercount). Null when
        // the week has NO coverage from either source — a zero there
        // would be indistinguishable from "sat out every day".
        const { rows } = await ctx.db.query(
          `select wp.season_id, wp.section_index, wp.points, wp.decks_used, wp.boat_attacks,
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
                       end as war_days_battled
           from war_participation wp
           where wp.clan_tag = $1 and wp.player_tag = $2
             and wp.season_id > coalesce((select max(season_id) from war_week where clan_tag = $1), 0) - $3
           order by wp.season_id desc, wp.section_index desc limit 40`,
          [clanTag, focus, seasons],
        );
        memberWeeks = rows;
      }
      // The chronologically-latest unfinished week is the one still being
      // fought; older null-standings weeks are capture gaps. The
      // distinction matters to a skeptical reader (round-3 finding).
      const newest = weeks[0];
      return {
        clan_tag: clanTag,
        weeks: weeks.map((w) => ({
          season_id: w.season_id,
          section_index: w.section_index,
          is_colosseum: w.is_colosseum,
          in_progress:
            w === newest && w.finished_observed_at === null ? true : undefined,
          finished: w.finished_observed_at?.toISOString() ?? null,
          our_rank: w.our_rank,
          our_fame: w.our_fame,
          // A regular week that hit the 10,000-fame finish line stopped
          // earning member points; decks_used keeps counting (war
          // auditor pass, 2026-09-06) - per-deck math there is wrong.
          ...(w.our_fame === 10000 && !w.is_colosseum
            ? { finished_early: true }
            : {}),
          trophy_change: w.trophy_change,
        })),
        ...(weeks.length > 0
          ? {
              history_starts_at: {
                season_id: weeks[weeks.length - 1].season_id,
                section_index: weeks[weeks.length - 1].section_index,
              },
            }
          : {}),
        ...(focus ? { member: focus, member_weeks: memberWeeks } : {}),
        // war_days_battled lives on member_weeks, which only exist when a
        // player_tag was supplied. Stating it unconditionally sent a leader
        // hunting for a field that was never going to be in the response
        // (playtest round, 2026-09-09).
        note:
          "points are per-member contributions; fame belongs to the boat (clan). in_progress marks the week still being fought (nulls there mean not-finished-yet); on OLDER weeks null our_rank/our_fame means the week was observed without a standings capture." +
          (focus
            ? " member_weeks carries this member's week-by-week participation; null war_days_battled there means per-day attendance is unknown for that week (unknown, not zero)."
            : " Pass player_tag for one member's week-by-week participation (member_weeks).") +
          " finished_early marks regular weeks where the boat hit the 10,000-fame finish line: decks used after the finish earn ZERO points, so per-deck efficiency math on those weeks is invalid. history_starts_at is the recording horizon - weeks before it were never observed, so fewer seasons than requested is coverage, not absence.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
