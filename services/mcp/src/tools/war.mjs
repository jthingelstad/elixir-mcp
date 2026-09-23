import { gameClock } from "../../../ingest/src/game-clock.mjs";
/** game_clock · war_rivals · war_current · war_history. Conventions
 *  (1.0.0): `applied`, `notes[]` + `docs`, `verbosity`, `live: true` on
 *  war_current for a clan nobody records. */

import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import { periodAt, observedStart } from "../war-period.mjs";
import { warBattlesSql, WAR_BATTLE_TYPES } from "../war-battles-sql.mjs";
import { finishInstant } from "../time.mjs";
import {
  buildMeta,
  ToolFailure,
  TAG_RULE_HINT,
  ON_BEHALF_OF_SCHEMA,
  DISPLAY_NAME_SCHEMA,
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
/** The race's day-by-day (war_period_log, 0130): one entry per closed war
 *  day with every clan in the bracket, the API's own periodLogs. The war
 *  day comes from the policy grid; the name from the week's standings. */
async function warDaysLog(db, clanTag, seasonId, sectionIndex) {
  const { rows } = await db.query(
    `select l.period_index, p.war_day, l.participant_clan_tag, c.participant_name,
            l.points_earned, l.progress_start, l.progress_end, l.progress_earned,
            l.end_of_day_rank, l.defenses_remaining, l.progress_from_defenses
       from war_period_log l
       left join war_period p on p.war_season_id = l.season_id and p.period_index = l.period_index
       left join war_week_clan c on c.clan_tag = l.clan_tag and c.season_id = l.season_id
         and c.section_index = l.section_index and c.participant_clan_tag = l.participant_clan_tag
      where l.clan_tag = $1 and l.season_id = $2 and l.section_index = $3
      order by l.period_index, l.end_of_day_rank nulls last, l.participant_clan_tag`,
    [clanTag, seasonId, sectionIndex],
  );
  const days = new Map();
  for (const r of rows) {
    if (!days.has(r.period_index))
      days.set(r.period_index, {
        war_day: r.war_day,
        period_index: r.period_index,
        standings: [],
      });
    days.get(r.period_index).standings.push({
      clan_tag: r.participant_clan_tag,
      name: r.participant_name,
      points_earned: r.points_earned,
      progress_start: r.progress_start,
      progress_end: r.progress_end,
      // The API verbatim above; the banked value below (feedback #84).
      progress_end_banked: bankedProgress(r),
      progress_earned: r.progress_earned,
      end_of_day_rank: r.end_of_day_rank,
      // 1-based like every other rank on the surface; the API's
      // endOfDayRank is 0-based and -1 means not yet ranked.
      rank:
        Number.isInteger(r.end_of_day_rank) && r.end_of_day_rank >= 0
          ? r.end_of_day_rank + 1
          : null,
      defenses_remaining: r.defenses_remaining,
      progress_from_defenses: r.progress_from_defenses,
    });
  }
  return [...days.values()];
}

/** A regular week's finish line. The API banks a boat's progress at each
 *  war day's close, so a clan's finishTime is the close of the day whose
 *  banked fame reached this (POAP KINGS 136/0: day 3 closed at the line,
 *  finishTime 2026-09-13T09:38:04Z, day 4 earned 0) - not a mid-day
 *  crossing. The race LOG caps fame at exactly 10000 (and the finish
 *  day's progressEndOfDay); the LIVE race reports the boat's progress
 *  past it (10134 as the next day's progressStartOfDay and as the live
 *  fame), and the record keeps the larger - so a live-polled week reads
 *  10134 or 10305 here and a week known from the log alone reads 10000
 *  (probed 2026-09-21). */
const FINISH_LINE = 10000;

/** What a boat had banked at a day's close (feedback #84). The race
 *  log's progressEndOfDay is capped at the line on the day a boat
 *  finishes (10000 where 6811 + 3000 + 323 = 10134), and the next day's
 *  progressStartOfDay carries the real figure - so an iterator walking
 *  progress_end sees +134 on a day that earned nothing. On a clamped row
 *  the sum of the row's own parts is the banked value; on every other
 *  row it is progress_end itself, verbatim. */
function bankedProgress({
  progress_start,
  progress_earned,
  progress_from_defenses,
  progress_end,
}) {
  const parts = [progress_start, progress_earned, progress_from_defenses];
  if (!parts.every(Number.isInteger)) return progress_end ?? null;
  const sum = progress_start + progress_earned + progress_from_defenses;
  return progress_end === FINISH_LINE && sum > FINISH_LINE ? sum : progress_end;
}

/** The note beside a day-by-day whose finishing rows are clamped, or
 *  null when none is: which clan, which day, what was banked. */
function cappedProgressNote(days, field) {
  const capped = [];
  for (const d of days ?? [])
    for (const s of d.standings)
      if (s.progress_end_banked !== s.progress_end)
        capped.push(
          `${s.name ?? s.clan_tag}'s war day ${d.war_day ?? d.period_index} progress_end reads ${s.progress_end} where ${s.progress_end_banked} was banked`,
        );
  if (capped.length === 0) return null;
  return `The race log caps a finished boat at the line, so ${capped.join("; ")} (the row's own progress_start + progress_earned + progress_from_defenses, and the next day's progress_start); progress_end_banked carries the banked value on every ${field} row and equals progress_end wherever no cap fired - walk it, not progress_end.`;
}

/** The note beside participant rows when any carries boat attacks
 *  (feedback #85): a boat battle spends a war deck and is counted inside
 *  decks_used and scoring_decks, and it scores on a different scale, so a
 *  points-per-deck rate is not comparable between the rows that hold
 *  boat decks and the rows that do not. Null when no row does. */
function boatDecksNote(rows, field) {
  const boat = (rows ?? []).filter((r) => r.boat_attacks > 0);
  if (boat.length === 0) return null;
  // The share must be of the denominator this sentence names. 6.15.0
  // named scoring_decks as the rate at risk and then quoted the share
  // against decks_used, which for a member whose week had a finish is a
  // different, larger number - ryguy67 read "1 of 8" where the rate's
  // own denominator made it 1 of 4, exactly double (feedback #89, the
  // Gym's Pass 2 on its own #85).
  //
  // "up to", because boat_attacks is the WEEK's counter: the record
  // cannot say which of them fell on a scoring day, so a boat attack
  // played after the boat finished is outside scoring_decks entirely.
  // The count is therefore a ceiling on the contamination, never a
  // measurement of it, and it is clamped to the denominator.
  const share = (r) =>
    Number.isInteger(r.scoring_decks)
      ? `up to ${Math.min(r.boat_attacks, r.scoring_decks)} of ${r.scoring_decks} scoring decks`
      : `${r.boat_attacks} of ${r.decks_used} decks, scoring_decks unknown`;
  const shown = boat
    .slice(0, 4)
    .map((r) => `${r.name ?? r.player_tag} ${share(r)}`);
  const more = boat.length > 4 ? `, and ${boat.length - 4} more` : "";
  return `boat_attacks are counted INSIDE decks_used and scoring_decks: a boat battle spends a war deck and scores on a different scale from a 1v1 or a duel. ${boat.length} of ${rows.length} ${field} rows have boat_attacks > 0 (${shown.join(", ")}${more}), so points / scoring_decks is not comparable between them and the rest. The per-member count is a ceiling: boat_attacks is the week's counter and the record cannot say which of them fell on a scoring day.`;
}

const weekKey = (r) => `${r.season_id}:${r.section_index}`;

/** Whether a week's boat finished: a regular week whose own standings
 *  row carries a finish instant or fame at the line. Null when the week
 *  has no finish line (Colosseum) or no standings capture. */
function boatFinished({ is_colosseum, fame, finish_time }) {
  if (is_colosseum) return null;
  if (finishInstant(finish_time)) return true;
  if (!Number.isInteger(fame)) return null;
  return fame >= FINISH_LINE;
}

/** The war day whose close carried each week's own boat over the line,
 *  from the race's own day-by-day: the first closed day with progress_end
 *  at or past 10,000. Keyed by weekKey; a week without such a day (not
 *  finished, Colosseum, or recorded before the log was kept) is absent. */
async function finishWarDays(db, clanTag, keys) {
  if (keys.length === 0) return new Map();
  const { rows } = await db.query(
    `select l.season_id, l.section_index, min(p.war_day)::int as war_day
       from war_period_log l
       join war_period p on p.war_season_id = l.season_id and p.period_index = l.period_index
       join unnest($2::int[], $3::int[]) as k(season_id, section_index)
         on k.season_id = l.season_id and k.section_index = l.section_index
      where l.clan_tag = $1 and l.participant_clan_tag = $1
        and l.progress_end >= $4 and p.war_day is not null
      group by l.season_id, l.section_index`,
    [
      clanTag,
      keys.map((k) => k.season_id),
      keys.map((k) => k.section_index),
      FINISH_LINE,
    ],
  );
  return new Map(rows.map((r) => [weekKey(r), r.war_day]));
}

/** Decks each member used on the war days AFTER the finish day, from the
 *  attendance polls: weekKey -> Map(player_tag -> decks). A week the polls
 *  never saw past its finish day is absent (a poll writes every
 *  participant's row, zeros included, so no rows means no sighting, and
 *  the subtraction must not read as zero). */
async function decksAfterFinish(db, clanTag, finishDays) {
  const entries = [...finishDays.entries()];
  if (entries.length === 0) return new Map();
  const { rows } = await db.query(
    `select ad.season_id, ad.section_index, ad.player_tag,
            sum(ad.decks_used_today)::int as decks
       from war_attendance_day ad
       join unnest($2::int[], $3::int[], $4::int[]) as k(season_id, section_index, finish_day)
         on k.season_id = ad.season_id and k.section_index = ad.section_index
      where ad.clan_tag = $1 and ad.war_day > k.finish_day
      group by ad.season_id, ad.section_index, ad.player_tag`,
    [
      clanTag,
      entries.map(([k]) => Number(k.split(":")[0])),
      entries.map(([k]) => Number(k.split(":")[1])),
      entries.map(([, day]) => day),
    ],
  );
  const out = new Map();
  for (const r of rows) {
    const key = weekKey(r);
    if (!out.has(key)) out.set(key, new Map());
    out.get(key).set(r.player_tag, r.decks);
  }
  return out;
}

/** The denominator of a points-per-deck rate (feedback #81): decks_used
 *  less the decks the member played on war days after the boat finished,
 *  which earn nothing. decks_used itself on an unfinished week; null when
 *  the record cannot separate the two (no day-by-day log for the week, or
 *  no poll saw the days past the finish). */
function scoringDecks({ decksUsed, finished, finishDay, after, playerTag }) {
  if (!Number.isInteger(decksUsed)) return null;
  if (finished !== true) return decksUsed;
  if (!Number.isInteger(finishDay) || !after) return null;
  return decksUsed - (after.get(playerTag) ?? 0);
}

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
      "What time it is in Clash Royale, for nobody in particular: current season, week within the season, whether today is a training day or war day, when this day ends, and the next boundaries of each kind (war_day_closes_at, next_war_day_opens_at, next_training_starts_at, week_ends_at, season_ends_at) so a routine can schedule itself. Needs no player and no clan. Use it to decide WHEN to look before deciding who to look at; war_current is the tool for what a specific clan is doing inside this day.",
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
                  bool_or(wk.is_colosseum) as is_colosseum,
                  (w.season_id, w.section_index) = (select season_id, section_index from latest)
                    and bool_and(wk.finished_observed_at is null)
                    as in_progress
           from war_week_clan w
           join war_week wk on wk.clan_tag = w.clan_tag and wk.season_id = w.season_id
             and wk.section_index = w.section_index
           where w.participant_clan_tag = any($2)
           group by w.participant_clan_tag, w.season_id, w.section_index)
         select participant_clan_tag as clan_tag,
                max(name) as name,
                count(*)::int as races_observed,
                count(*) filter (where not in_progress)::int as finished_races,
                count(*) filter (where is_colosseum)::int as colosseum_races,
                count(*) filter (where shared_with_you)::int as races_shared_with_you,
                min(season_id)::int as first_season,
                max(season_id)::int as last_season,
                round(avg(fame) filter (where not in_progress))::int as mean_fame,
                round(percentile_cont(0.5) within group (order by fame)
                  filter (where not in_progress))::int as median_fame,
                max(fame) filter (where not in_progress)::int as max_fame,
                count(*) filter (where fame = 0 and not in_progress)::int as zero_fame_races,
                max(fame) filter (where in_progress)::int as current_race_fame,
                (select w.clan_score from war_week_clan w
                  where w.participant_clan_tag = races.participant_clan_tag
                    and w.clan_score is not null
                  order by w.season_id desc, w.section_index desc limit 1) as clan_score
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
          "Fame statistics (mean_fame, median_fame, max_fame, zero_fame_races) cover the finished races only, and finished_races is their count: races_observed includes the week in progress, so it is not their denominator. current_race_fame is the week in progress; a rival with no finished race has null fame statistics, not zero.",
          rows.some((r) => r.colosseum_races > 0)
            ? "colosseum_races counts the Colosseum weeks among races_observed: a Colosseum week is a period-point contest with no finish line, so its fame pools badly with a regular week's; read the fame statistics beside that count."
            : null,
          "clan_score is the game's own strength number for the clan as last observed in any recorded race (null before 2026-09-17, when the race poll began keeping it).",
          "A rival's roster and war state are not recorded; war_current({ clan_tag, live: true }) asks for a fresh read (queued if none is in hand).",
        ),
        docs: WAR_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  war_current: {
    description:
      "The current (latest recorded) river race for a clan, yours by default: standings across the five clans with banked fame and current-day period_points, per-member points and decks used, the war day and attendance so far. On a war day decks_today names who is untouched, partial and finished (the nudge list); off one it is null with decks_today_reason. verbosity compact keeps standings, the period, the counts and the nudge lists and drops participants. live: true asks for a read of ANY clan, recorded or not: served if in hand, otherwise queued while the record answers with live_status pending.",
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
        // Say what the record knows before pointing at live (feedback
        // #53: a one-member clan's routine was told "live reads the race
        // now" when the game itself has no race for the clan: its log
        // poll was admitted empty and the race read is a 404). A live
        // read would answer the same, and the caller's rule is to spend
        // one only when it changes the answer.
        const {
          rows: [known],
        } = await ctx.db.query(
          `select (select max(last_admitted_at) from poll_state
                    where subject_tag = $1 and endpoint = 'riverracelog') as log_admitted_at,
                  (select max(fetched_at) from collector_fetch_error
                    where entity_key = $1 and endpoint = 'currentriverrace'
                      and http_status = 404 and fetched_at > now() - interval '2 days') as race_404_at`,
          [clanTag],
        );
        const noRace = known?.log_admitted_at && known?.race_404_at;
        throw notRecordedOrPending(
          live,
          noRace
            ? "The game reports no river race for this clan: its race log was read empty and the current race is not found."
            : "No war weeks recorded for this clan yet.",
          args.live
            ? "The live payload was admitted but no race projected; the clan may be between races. Try war_rivals for its history."
            : noRace
              ? `A clan that has not entered a river race has nothing to record and live: true answers the same (race log admitted ${known.log_admitted_at.toISOString()}, race read 404 at ${known.race_404_at.toISOString()}); clans_roster({ clan_tag }) says how many members it has.`
              : "The first riverracelog poll lands within a day of tracking; live: true reads the race now.",
        );
      }
      const wk = weekRows[0];
      const meta = await buildMeta(ctx.db, ctx.account, clanTag, [
        "currentriverrace",
      ]);
      // Grounded time (feedback #8: an agent asserted "the week just
      // finished" from schema alone): the period from the calendar
      // (war_period, the policy grid) gives fields a temporal claim can
      // CITE; the clan's own first sighting of it rides beside, when it
      // has one, as the observation. A stale or missing anchor no
      // longer blanks the day (0105; this session).
      const nowMs = Date.now();
      const p = await periodAt(ctx.db, nowMs);
      const anchor = await observedStart(ctx.db, clanTag, p);
      let period = null;
      let nextWarDayOpensAt = null;
      if (p) {
        period = {
          period_index: p.periodIndex,
          kind: p.kind,
          ...(p.warDay ? { war_day: p.warDay } : {}),
          day_in_week: p.dayInSection,
          started_observed_at: anchor ? anchor.toISOString() : null,
          source_observed_at: meta.source_polls.currentriverrace.observed_at,
          freshness_seconds:
            meta.source_polls.currentriverrace.freshness_seconds,
          period_start_nominal: new Date(p.startMs).toISOString(),
          period_end_nominal: new Date(p.endMs).toISOString(),
          week_end_nominal: new Date(p.weekEndMs).toISOString(),
          // How far this clan's observed start sat from the policy hour,
          // INCLUDING our polling latency: an upper bound on the drift.
          // Null when the recorder has not seen this period open.
          observed_offset_minutes: anchor
            ? Math.round((anchor.getTime() - p.startMs) / 60_000)
            : null,
          next_war_day_opens_at: p.nextWarDayOpensMs
            ? new Date(p.nextWarDayOpensMs).toISOString()
            : null,
        };
        nextWarDayOpensAt = period.next_war_day_opens_at;
      }
      const standings = await ctx.db.query(
        `select participant_clan_tag, participant_name, fame, period_points,
                rank, trophy_change, finish_time, clan_score, repair_points
           from war_week_clan
           where clan_tag = $1 and season_id = $2 and section_index = $3
           order by rank nulls last, fame desc`,
        [clanTag, wk.season_id, wk.section_index],
      );
      // The closed days of the running week (3.15.0), and the API's own
      // word for today beside the grid's kind.
      const daysClosed = compact
        ? null
        : await warDaysLog(ctx.db, clanTag, wk.season_id, wk.section_index);
      const {
        rows: [apiPeriod],
      } = await ctx.db.query(
        `select period_type from poll_state
          where subject_tag = $1 and endpoint = 'currentriverrace'`,
        [clanTag],
      );
      if (period) period.api_period_type = apiPeriod?.period_type ?? null;
      const participation = await ctx.db.query(
        `select wp.player_tag, p.name, wp.points, wp.decks_used, wp.boat_attacks, wp.repair_points,
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
             select distinct wb.war_day, wb.player_tag
             from (${warBattlesSql({ clan: "$1", season: "$2", section: "$3", types: "$4" })}) wb),
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
        [clanTag, wk.season_id, wk.section_index, WAR_BATTLE_TYPES],
      );
      // Our own boat's finish, if it has one this week: standings carry
      // finish_time per participant, and ours is the one that decides
      // whether remaining decks still add fame.
      const own = standings.rows.find(
        (r) => r.participant_clan_tag === clanTag,
      );
      const raceFinishedAt = finishInstant(own?.finish_time);
      // The finish day and what was played after it (feedback #81):
      // points and decks_used sit on one participant row, and the decks
      // inside decks_used from the days after the finish earned nothing.
      const raceFinished = boatFinished({
        is_colosseum: wk.is_colosseum,
        fame: own?.fame,
        finish_time: own?.finish_time,
      });
      const finishDays =
        raceFinished === true
          ? await finishWarDays(ctx.db, clanTag, [wk])
          : new Map();
      const finishWarDay = finishDays.get(weekKey(wk)) ?? null;
      const afterFinish = (
        await decksAfterFinish(ctx.db, clanTag, finishDays)
      ).get(weekKey(wk));
      const decksAfter = afterFinish
        ? [...afterFinish.values()].reduce((a, b) => a + b, 0)
        : null;
      const participants = participation.rows.map((r) => ({
        ...r,
        scoring_decks: scoringDecks({
          decksUsed: r.decks_used,
          finished: raceFinished,
          finishDay: finishWarDay,
          after: afterFinish,
          playerTag: r.player_tag,
        }),
      }));
      const finishedNote =
        raceFinished === true
          ? `This clan's boat finished the race${raceFinishedAt ? ` at ${raceFinishedAt}` : ""}${finishWarDay ? ` (the close of war day ${finishWarDay})` : ""}: decks used after that earn zero points${decksAfter !== null ? ` - ${decksAfter} ${decksAfter === 1 ? "deck was" : "decks were"} played on the war days since, for 0 clan points` : ""} - so participants[].decks_used is not the denominator of a points-per-deck rate; scoring_decks is${finishWarDay && afterFinish ? "" : " (null here: the record cannot separate the two for this week)"}.`
          : null;
      // Today's remaining-decks picture (CLAN-PULSE.md): only while the
      // anchored war-day period is nominally still open.
      let decksToday = null;
      let overCapNote = null;
      let raceFinishedNote = null;
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
             select wb.player_tag, count(distinct wb.battle_id)::int as n
             from (${warBattlesSql({ clan: "$1", season: "$2", section: "$3", warDay: "$4", types: "$5" })}) wb
             group by wb.player_tag)
           select base.player_tag, base.name,
                  least(greatest(coalesce(att.decks_used_today, 0),
                                 coalesce(fought.n, 0)), 4)::int as decks_used,
                  greatest(coalesce(att.decks_used_today, 0),
                           coalesce(fought.n, 0))::int as decks_raw
           from base
           left join att on att.player_tag = base.player_tag
           left join fought on fought.player_tag = base.player_tag
           order by decks_used, base.name nulls last`,
          [
            clanTag,
            wk.season_id,
            wk.section_index,
            period.war_day,
            WAR_BATTLE_TYPES,
          ],
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
          // The boat may already have crossed the line (POAP KINGS did on
          // day 4 at 09:38Z, 2026-09-13, with 40 still "untouched"). The
          // lists stay - who played today is still a fact - but the
          // instant is beside them so no reader nudges toward nothing.
          race_finished_at: raceFinishedAt,
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
        if (raceFinishedAt)
          raceFinishedNote =
            "race_finished_at is set: this clan's boat has crossed the finish line this week, so decks_today reports who played today, not who still owes the race anything.";
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
        race_finished_at: raceFinishedAt,
        finish_war_day: finishWarDay,
        next_war_day_opens_at: nextWarDayOpensAt,
        applied: appliedBlock({
          clan_tag: clanTag,
          verbosity: compact ? "compact" : "full",
          live: args.live === true ? true : undefined,
        }),
        ...(live ? { live_status: liveStatus(live) } : {}),
        standings: standings.rows.map((row) => ({
          ...row,
          finish_time: finishInstant(row.finish_time),
        })),
        ...(compact ? {} : { participants }),
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
              decks_today_reason: !period ? "period_unknown" : "training_day",
            }),
        ...(compact ? {} : { attendance_by_war_day: attendance.rows }),
        ...(daysClosed ? { days_closed: daysClosed } : {}),
        notes: notes(
          livePendingNote(live),
          "points are per-member contributions; fame belongs to the boat (the clan).",
          "standings.clan_score is the game's own strength number for each clan in the bracket (latest observed) and repair_points what repairs cost it; participants[].repair_points is each member's share.",
          daysClosed
            ? "days_closed is the race's own day-by-day (the API's periodLogs): one entry per closed war day with every clan's points_earned, progress, rank (1-based; null while unranked) and end_of_day_rank (the API's 0-based value); the running day is not in it until it closes."
            : null,
          "standings.finish_time is null for a clan that has not finished (the API marks it with epoch zero, never a time).",
          "participants[].decks_used is the RACE WEEK's cumulative count and decks_today.*.decks_used is this policy day's; a duel consumes one deck per round played (two or three) and a 1v1 one, so four decks is two to four battles.",
          finishedNote,
          compact ? null : boatDecksNote(participants, "participants"),
          cappedProgressNote(daysClosed, "days_closed"),
          "standings.fame is cumulative race progress banked at the day close; standings.period_points is the current day's score, so fame can be zero on war day 1 while members already have points.",
          "members_not_in_race names current members the game left out of the race roster: their game-side lastSeen predates the race start (a nudge list; the predicate is the game's).",
          decksToday
            ? "decks_today trails actual play early in a day: cite it as observed so far, never as final."
            : null,
          overCapNote,
          raceFinishedNote,
          "Days follow the 10:00 UTC policy reset for every clan and the period is the calendar's: cite the *_nominal instants; started_observed_at is when the recorder first saw this period open (null when it has not), observed_offset_minutes its distance from the policy hour including polling latency.",
          "period.api_period_type is the API's own word for the day at the last race poll (training, warDay, colosseum); period.kind is the policy grid's, and the two disagree only when the clan's reset has drifted across the boundary.",
          "war_day is 1-based, day_in_week 0-based; attendance_by_war_day is empty before the week's first war day.",
        ),
        docs: CLOCK_DOCS,
        meta,
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
        display_name: DISPLAY_NAME_SCHEMA,
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
            args.display_name,
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
      // The recording horizon is the oldest week the record holds for the
      // clan, whatever window was asked for: the window's own oldest row
      // used to be reported as the horizon, so seasons:1 named the current
      // season as the beginning of history (review 2026-09-19, defect 3).
      const {
        rows: [horizon],
      } = await ctx.db.query(
        `select season_id, section_index from war_week
         where clan_tag = $1 order by season_id, section_index limit 1`,
        [clanTag],
      );
      const {
        rows: [latest],
      } = await ctx.db.query(
        `select season_id, section_index from war_week
         where clan_tag = $1 order by season_id desc, section_index desc limit 1`,
        [clanTag],
      );
      const {
        rows: [clanRow],
      } = await ctx.db.query(`select name from clan where clan_tag = $1`, [
        clanTag,
      ]);
      const { rows: weeks } = await ctx.db.query(
        `select w.season_id, w.section_index, w.is_colosseum, w.finished_observed_at, w.closed_at,
                own.fame as our_fame, own.rank as our_rank, own.trophy_change,
                own.clan_score as our_clan_score, own.repair_points as our_repair_points,
                own.finish_time as our_finish_time,
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
      // Which weeks' boats finished, on which war day, and what each
      // member played after that (feedback #81: finished_early was
      // computed as fame === 10000, which only a week known from the
      // capped log alone ever equals - every live-polled week carries
      // the overshoot - so no served week carried it while the docs
      // promised the flag and the notes named it on every response).
      const finished = new Map(
        weeks.map((w) => [
          weekKey(w),
          boatFinished({
            is_colosseum: w.is_colosseum,
            fame: w.our_fame,
            finish_time: w.our_finish_time,
          }),
        ]),
      );
      const finishDays = await finishWarDays(
        ctx.db,
        clanTag,
        weeks.filter((w) => finished.get(weekKey(w)) === true),
      );
      const afterFinish =
        focus || hasSeason
          ? await decksAfterFinish(ctx.db, clanTag, finishDays)
          : new Map();
      let memberWeeks = null;
      if (focus || hasSeason) {
        // war_days_battled unions TWO observation sources — decksUsedToday
        // polls AND the member's own recorded war battles, the latter
        // resolved by the calendar (0105). Null when the week has NO
        // coverage from either source. One pass: the week's battles are
        // scanned once per week and grouped by player, then joined to the
        // participants; two correlated subqueries per row ran the week
        // scan twice per participant and a 46-member exact week timed
        // out the Lambda (review 2026-09-19, defect 1).
        const weekBattles = warBattlesSql({
          clan: "$1",
          season: "k.season_id",
          section: "k.section_index",
          types: "$6",
        });
        const { rows } = await ctx.db.query(
          `with wp as (
             select wp.player_tag, wp.season_id, wp.section_index,
                    wp.points, wp.decks_used, wp.boat_attacks, wp.repair_points
             from war_participation wp
             where wp.clan_tag = $1
               and ($2::text is null or wp.player_tag = $2)
               and (($4::integer is not null
                     and wp.season_id = $4 and wp.section_index = $5)
                    or ($4::integer is null and wp.season_id > coalesce(
                      (select max(season_id) from war_week where clan_tag = $1), 0) - $3))),
           k as (select distinct season_id, section_index from wp),
           att as (
             select ad.season_id, ad.section_index, ad.player_tag, ad.war_day::int as war_day,
                    ad.decks_used_today > 0 as battled
             from war_attendance_day ad
             join k on k.season_id = ad.season_id and k.section_index = ad.section_index
             where ad.clan_tag = $1),
           fought as (
             select k.season_id, k.section_index, wb.player_tag, wb.war_day::int as war_day
             from k cross join lateral (${weekBattles}) wb),
           covered as (
             select season_id, section_index from att
             union
             select season_id, section_index from fought),
           days as (
             select season_id, section_index, player_tag, war_day from att where battled
             union
             select season_id, section_index, player_tag, war_day from fought),
           per_player as (
             select season_id, section_index, player_tag,
                    count(distinct war_day)::int as war_days_battled,
                    array_agg(distinct war_day order by war_day) as war_days
             from days
             group by season_id, section_index, player_tag)
           select wp.player_tag, p.name, wp.season_id, wp.section_index,
                  wp.points, wp.decks_used, wp.boat_attacks, wp.repair_points,
                  case when cov.season_id is not null
                       then coalesce(pp.war_days_battled, 0) end as war_days_battled,
                  case when cov.season_id is not null
                       then coalesce(pp.war_days, '{}'::int[]) end as war_days
           from wp
           left join player p on p.player_tag = wp.player_tag
           left join per_player pp on pp.season_id = wp.season_id
             and pp.section_index = wp.section_index and pp.player_tag = wp.player_tag
           left join covered cov on cov.season_id = wp.season_id
             and cov.section_index = wp.section_index
           order by wp.season_id desc, wp.section_index desc, wp.points desc,
                    p.name nulls last
           limit ${hasSeason ? 60 : 40}`,
          [
            clanTag,
            focus,
            seasons,
            exactSeason,
            exactSection,
            WAR_BATTLE_TYPES,
          ],
        );
        // war_days: the day indices battled, so "played 3 of 4" can become
        // "missed day 2" (feedback item 30, 2026-09-10). Null when unknown.
        memberWeeks = rows.map((r) => ({
          ...r,
          scoring_decks: scoringDecks({
            decksUsed: r.decks_used,
            finished: finished.get(weekKey(r)),
            finishDay: finishDays.get(weekKey(r)),
            after: afterFinish.get(weekKey(r)),
            playerTag: r.player_tag,
          }),
          war_days: r.war_days_battled === null ? null : (r.war_days ?? []),
        }));
      }
      // The exact week's day-by-day and its standings with the rivals'
      // clan_score and repair_points (3.15.0).
      let days = null;
      let standings = null;
      if (hasSeason && weeks.length > 0) {
        days = await warDaysLog(ctx.db, clanTag, exactSeason, exactSection);
        const { rows } = await ctx.db.query(
          `select participant_clan_tag as clan_tag, participant_name as name, fame, period_points,
                  rank, trophy_change, finish_time, clan_score, repair_points
             from war_week_clan
            where clan_tag = $1 and season_id = $2 and section_index = $3
            order by rank nulls last, fame desc`,
          [clanTag, exactSeason, exactSection],
        );
        standings = rows.map((r) => ({
          ...r,
          finish_time: finishInstant(r.finish_time),
        }));
      }
      // An exact week the record does not hold (feedback #86): the
      // horizon rides this path too, and the empty answer says which
      // side of it the week is on - before recording began, past the
      // latest recorded week, a section no season has, or a gap inside
      // the span - so "unrecorded" and "never existed" are not one payload.
      const missing = hasSeason && weeks.length === 0;
      let missingNote = null;
      if (missing) {
        const at = `${exactSeason}/${exactSection}`;
        const before = (a, b) =>
          a.season_id < b.season_id ||
          (a.season_id === b.season_id && a.section_index < b.section_index);
        const asked = { season_id: exactSeason, section_index: exactSection };
        if (!horizon)
          missingNote = `No war weeks are recorded for ${clanTag} yet, so week ${at} is unrecorded, not absent.`;
        else if (exactSection > 4)
          missingNote = `Season ${exactSeason} has no section ${exactSection}: a season has four or five sections (0-4), so this week never existed; it is not a coverage gap.`;
        else if (before(asked, horizon))
          missingNote = `No week ${at} is recorded for ${clanTag}: recording of this clan's war history begins at season ${horizon.season_id} section ${horizon.section_index} (history_starts_at), so this week is before the horizon - unrecorded, not a week the clan sat out.`;
        else if (before(latest, asked))
          missingNote = `Week ${at} is after the latest recorded week for ${clanTag} (${latest.season_id}/${latest.section_index}): not yet played or not yet observed, not a coverage gap.`;
        else
          missingNote = `Week ${at} falls inside the recorded span for ${clanTag} (${horizon.season_id}/${horizon.section_index} to ${latest.season_id}/${latest.section_index}) but the record does not hold it: a coverage gap, not a week the clan sat out.`;
      }
      // The chronologically-latest unfinished week is the one still being
      // fought; older null-standings weeks are capture gaps.
      return {
        clan_tag: clanTag,
        name: clanRow?.name ?? null,
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
          // Served on every row (6.13.0): an absent flag read as false,
          // which is the finished_early defect's shape.
          in_progress: Boolean(
            w.is_latest_recorded && w.finished_observed_at === null,
          ),
          finished: w.finished_observed_at?.toISOString() ?? null,
          // The API's own close instant (riverracelog createdDate); finished
          // is the recorder's sighting and carries polling latency.
          closed_at: w.closed_at?.toISOString() ?? null,
          our_rank: w.our_rank,
          our_fame: w.our_fame,
          our_clan_score: w.our_clan_score,
          our_repair_points: w.our_repair_points,
          // A regular week whose boat reached the finish line stopped
          // earning member points; decks_used keeps counting. Null on a
          // Colosseum week (no line) or without a standings capture.
          finished_early: finished.get(weekKey(w)),
          finish_war_day: finishDays.get(weekKey(w)) ?? null,
          trophy_change: w.trophy_change,
        })),
        // On both paths (6.15.0): the exact-week path dropped it, so a
        // week before the horizon and a week that never existed answered
        // byte-identical (feedback #86).
        ...(horizon
          ? {
              history_starts_at: {
                season_id: horizon.season_id,
                section_index: horizon.section_index,
              },
            }
          : {}),
        ...(focus ? { member: focus } : {}),
        ...(focus || hasSeason ? { member_weeks: memberWeeks } : {}),
        ...(standings ? { standings } : {}),
        ...(days ? { days } : {}),
        notes: missing
          ? notes(
              missingNote,
              horizon
                ? "history_starts_at is the recording horizon: a week before it is unrecorded, not absent."
                : null,
            )
          : notes(
              "points are per-member contributions; fame belongs to the boat (the clan).",
              "closed_at is the API's own close instant for the week (null on weeks older than the log the API still served when the column arrived); finished is when the recorder saw it closed.",
              hasSeason
                ? "standings carries every clan in the week's bracket with clan_score (the game's strength number, latest observed) and repair_points; finish_time is null for a clan that did not finish (the API marks it with epoch zero, never a time). days is the race's own day-by-day (the API's periodLogs), one entry per closed war day, empty for a week recorded before 2026-09-17 unless the archive backfill reached it; each day's standings carry rank (1-based, like every rank here; null while unranked) beside end_of_day_rank (the API's 0-based value, -1 unranked)."
                : null,
              "in_progress marks the week still being fought; on OLDER weeks a null our_rank/our_fame means the week was observed without a standings capture.",
              hasSeason && !focus
                ? "member_weeks contains every recorded participant for the exact week; null war_days_battled means per-day attendance is unknown, while war_days lists the observed day indices battled."
                : focus
                  ? "member_weeks: null war_days_battled means per-day attendance is unknown for that week (unknown, not zero); war_days lists the day indices battled."
                  : "Pass player_tag for one member's week-by-week participation (member_weeks).",
              "finished_early is true on a regular week whose boat reached the 10,000-fame line, false when it did not, null on a Colosseum week (no finish line) or a week without a standings capture; finish_war_day is the war day whose close carried it over (null when the day-by-day log does not hold the week). Decks used after the finish earn zero points, so decks_used is not the denominator of a points-per-deck rate on a finished week.",
              focus || hasSeason
                ? "member_weeks[].decks_used is the week's cumulative count; a duel consumes one deck per round played (two or three), a 1v1 one and a boat battle one, so decks are not battles. scoring_decks is decks_used less the decks played on the war days after the finish (the denominator for a points-per-deck rate; equal to decks_used on an unfinished week; null when the record cannot separate them); it can overstate by a deck where a poll missed a day's last battle."
                : null,
              boatDecksNote(memberWeeks, "member_weeks"),
              cappedProgressNote(days, "days"),
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
