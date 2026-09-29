import { observedStart, periodAt } from "../../war-period.mjs";
import { finishInstant } from "../../time.mjs";
import {
  VERBOSITY,
  appliedBlock,
  buildMeta,
  livePendingNote,
  liveStatus,
  notRecordedOrPending,
  notes,
} from "../shared.mjs";
import {
  CLAN_TAG_SCHEMA,
  CLOCK_DOCS,
  boatDecksNote,
  boatFinished,
  cappedProgressNote,
  clanSubject,
  finishWarDays,
  warDaysLog,
  weekKey,
} from "./common.mjs";

export const war_current = {
  description:
    "The current (latest recorded) river race for a clan, yours by default: standings across the five clans with banked fame and current-day period_points, per-member points and decks used this race week, and the war day. decks_today names who is untouched, partial and finished on every race-week day, day_kind training or war (only war decks score). verbosity compact keeps standings, the period, the counts and the nudge lists and drops participants. live: true asks for a read of ANY clan, recorded or not: served if in hand, otherwise queued while the record answers with live_status pending.",
  inputSchema: {
    type: "object",
    properties: {
      clan_tag: CLAN_TAG_SCHEMA,
      verbosity: VERBOSITY(
        "drops the participants array; keeps standings, period, counts, members_not_in_race and the decks_today lists.",
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
        freshness_seconds: meta.source_polls.currentriverrace.freshness_seconds,
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
                rank, trophy_change, finish_time, clan_score as clan_war_trophies, repair_points
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
    // Our own boat's finish, if it has one this week: standings carry
    // finish_time per participant, and ours is the one that decides
    // whether remaining decks still add fame.
    const own = standings.rows.find((r) => r.participant_clan_tag === clanTag);
    const raceFinishedAt = finishInstant(own?.finish_time);
    // The finish day (feedback #81): decks played after it earn nothing,
    // so decks_used is no points-per-deck denominator on a finished week.
    // How many were played after it is not served: it would split the
    // weekly count at a war day's rollover, which cannot be placed
    // reliably at Elixir's scale (Jamie 2026-09-25).
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
    const participants = participation.rows;
    const finishedNote =
      raceFinished === true
        ? `This clan's boat finished the race${raceFinishedAt ? ` at ${raceFinishedAt}` : ""}${finishWarDay ? ` (the close of war day ${finishWarDay})` : ""}: decks used after that earn zero points, so participants[].decks_used is not the denominator of a points-per-deck rate this week.`
        : null;
    // A training day's war decks (Jamie 2026-09-24): the same four decks,
    // played for reps; they do not score, so they never enter a war day's
    // decks_today. Same table as the war days (0169).
    let trainingDecks = null;
    if (
      period &&
      !period.war_day &&
      Date.now() < Date.parse(period.period_end_nominal)
    ) {
      const trainingDay = (period.period_index % 7) + 1;
      const { rows: trainRows } = await ctx.db.query(
        `select wp.player_tag, p.name, coalesce(t.decks_used_today, 0)::int as decks_used
           from war_participation wp
           join player p on p.player_tag = wp.player_tag
           left join war_attendance_day t
             on t.clan_tag = wp.clan_tag and t.season_id = wp.season_id
            and t.section_index = wp.section_index and t.day_in_section = $4 - 1
            and t.player_tag = wp.player_tag
          where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
            and exists (select 1 from clan_membership cm
                         where cm.clan_tag = wp.clan_tag and cm.player_tag = wp.player_tag
                           and cm.left_observed_at is null)
          order by decks_used desc, p.name nulls last`,
        [clanTag, wk.season_id, wk.section_index, trainingDay],
      );
      // The same picture decks_today draws on a war day (Jamie 2026-09-24:
      // one field for every day of the race week).
      const tPick = (lo, hi) =>
        trainRows
          .filter((r) => r.decks_used >= lo && r.decks_used <= hi)
          .map(({ player_tag, name, decks_used }) => ({
            player_tag,
            name,
            decks_used,
          }));
      trainingDecks = {
        day_kind: "training",
        day_in_section: trainingDay - 1,
        training_day: trainingDay,
        war_day: null,
        race_finished_at: null,
        untouched: tPick(0, 0),
        partial: tPick(1, 3),
        finished: tPick(4, 4),
        counts: {
          untouched: tPick(0, 0).length,
          partial: tPick(1, 3).length,
          finished: tPick(4, 4).length,
          participants: trainRows.length,
        },
      };
    }
    // Today's remaining-decks picture (first designed in docs/archive/CLAN-PULSE.md, now archived): only while the
    // anchored war-day period is nominally still open.
    let decksToday = null;
    let raceFinishedNote = null;
    if (period?.war_day && Date.now() < Date.parse(period.period_end_nominal)) {
      // The game's own counter (decksUsedToday, as the race poll recorded
      // it), like the training days. Jamie 2026-09-25: war facts are
      // weekly, and the recorded war battles placed on the 10:00Z policy
      // day (which this took the larger of) were that per-day
      // attribution; over_cap existed only because the placement
      // overshot a clan's real reset.
      const { rows: dayRows } = await ctx.db.query(
        `select wp.player_tag, p.name,
                least(coalesce(t.decks_used_today, 0), 4)::int as decks_used
           from war_participation wp
           join player p on p.player_tag = wp.player_tag
           left join war_attendance_day t
             on t.clan_tag = wp.clan_tag and t.season_id = wp.season_id
            and t.section_index = wp.section_index and t.war_day = $4
            and t.player_tag = wp.player_tag
          where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
            and exists (select 1 from clan_membership cm
                         where cm.clan_tag = wp.clan_tag and cm.player_tag = wp.player_tag
                           and cm.left_observed_at is null)
          order by decks_used, p.name nulls last`,
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
      decksToday = {
        day_kind: "war",
        day_in_section: period.war_day + 2,
        training_day: null,
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
      };
      if (raceFinishedAt)
        raceFinishedNote =
          "race_finished_at is set: this clan's boat has crossed the finish line this week, so decks_today reports who played today, not who still owes the race anything.";
    }
    if (!decksToday && trainingDecks) decksToday = trainingDecks;
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
            decks_today_reason: !period
              ? "period_unknown"
              : period.war_day
                ? "war_day_over"
                : "training_day",
          }),
      ...(daysClosed ? { days_closed: daysClosed } : {}),
      notes: notes(
        livePendingNote(live),
        "points are per-member contributions; fame belongs to the boat (the clan).",
        // Two groups both called participants (Gym #312).
        participation.rows.some((r) => !r.in_clan)
          ? `participants_count is the race roster, which keeps ${participation.rows.filter((r) => !r.in_clan).length} member(s) who have since left the clan; decks_today.counts.participants counts current members only. For a rate among current members, use decks_today or participants[] with in_clan.`
          : null,
        decksToday?.day_kind === "training"
          ? `Training day ${decksToday.training_day}: decks_today (day_kind training) lists the war decks each member has played so far today. They are the same four decks the war days use, and on a war day each can be played once, so training days are where members get reps in with them; training decks earn no points and never count as war attendance.`
          : null,
        "standings.clan_war_trophies is each bracket clan's WAR trophies going into this race (the race's own trophy_change lands in the next one's figure) and repair_points what repairs cost it; participants[].repair_points is each member's share.",
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
        raceFinishedNote,
        "Days follow the 10:00 UTC policy reset for every clan and the period is the calendar's: cite the *_nominal instants; started_observed_at is when the recorder first saw this period open (null when it has not), observed_offset_minutes its distance from the policy hour including polling latency.",
        // The race closes before the grid (Gym #169, #179).
        "A race closes each war day before the 10:00 UTC grid, in the half hour before it and per race (observed 09:30 to 10:00Z); observed_offset_minutes is when the recorder saw a period open, never when the race closed. war_history.closed_at has past weeks' real closes.",
        "period.api_period_type is the API's own word for the day at the last race poll (training, warDay, colosseum); period.kind is the policy grid's, and the two disagree only when the clan's reset has drifted across the boundary.",
        "war_day is 1-based, day_in_week 0-based. participants[] carries the race week's totals; past war days are not split out, because the API does not say which day a deck was played and a war day's rollover cannot be placed reliably at Elixir's scale.",
      ),
      docs: CLOCK_DOCS,
      meta,
    };
  },
};
