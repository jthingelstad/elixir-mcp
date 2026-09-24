import { responseMeta } from "@elixir-mcp/contracts";
import { sectionsInSeason } from "../../../../ingest/src/war-clock.mjs";
import { WAR_BATTLE_TYPES, warBattlesSql } from "../../war-battles-sql.mjs";
import { finishInstant } from "../../time.mjs";
import {
  DISPLAY_NAME_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  ToolFailure,
  appliedBlock,
  entitledClan,
  notes,
  subject,
} from "../shared.mjs";
import {
  CLAN_SCORE_DEPRECATION,
  warTrophyTiming,
  CLAN_TAG_SCHEMA,
  WAR_DOCS,
  boatDecksNote,
  boatFinished,
  cappedProgressNote,
  decksAfterFinish,
  finishWarDays,
  scoringDecks,
  warDaysLog,
  warTrophyAlias,
  weekKey,
  WAR_FAME_BY_PLACEMENT,
} from "./common.mjs";

export const war_history = {
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
           -- Practice decks on the week's training days (0167, recorded
           -- from 2026-09-24): a week with no training row is unknown.
           trn as (
             select t.season_id, t.section_index, t.player_tag,
                    sum(t.decks_used_today)::int as training_decks
             from war_training_day t
             join k on k.season_id = t.season_id and k.section_index = t.section_index
             where t.clan_tag = $1
             group by t.season_id, t.section_index, t.player_tag),
           trn_cov as (select distinct season_id, section_index from trn),
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
                       then coalesce(pp.war_days, '{}'::int[]) end as war_days,
                  case when tc.season_id is not null
                       then coalesce(trn.training_decks, 0) end as training_decks
           from wp
           left join player p on p.player_tag = wp.player_tag
           left join per_player pp on pp.season_id = wp.season_id
             and pp.section_index = wp.section_index and pp.player_tag = wp.player_tag
           left join covered cov on cov.season_id = wp.season_id
             and cov.section_index = wp.section_index
           left join trn on trn.season_id = wp.season_id
             and trn.section_index = wp.section_index and trn.player_tag = wp.player_tag
           left join trn_cov tc on tc.season_id = wp.season_id
             and tc.section_index = wp.section_index
           order by wp.season_id desc, wp.section_index desc, wp.points desc,
                    p.name nulls last
           limit ${hasSeason ? 60 : 40}`,
        [clanTag, focus, seasons, exactSeason, exactSection, WAR_BATTLE_TYPES],
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
        ...warTrophyAlias(r),
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
      else if (exactSection >= (sectionsInSeason(exactSeason) ?? 5))
        missingNote = seasonHasNoSection(exactSeason, exactSection);
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
        our_clan_war_trophies: w.our_clan_score,
        // DEPRECATED (6.19.0), removed in the next major version: the name says clan score and
        // the number is war trophies (feedback #88).
        our_clan_score: w.our_clan_score,
        our_repair_points: w.our_repair_points,
        // A regular week whose boat reached the finish line stopped
        // earning member points; decks_used keeps counting. Null on a
        // Colosseum week (no line) or without a standings capture.
        // Null while the week is still being fought: it has not
        // failed to reach the line, it has not had the chance, and a
        // consumer filtering finished_early === false to find weeks
        // the clan did not close out would otherwise catch the live
        // one (the Gym's open question 2, 2026-09-22).
        finished_early:
          w.is_latest_recorded && w.finished_observed_at === null
            ? null
            : finished.get(weekKey(w)),
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
            "closed_at is the API's own close instant for the week (null on weeks older than the log the API still served when the column arrived); finished is that same instant where the API gave it, else when the recorder first saw the week closed (Gym #179).",
            // Fame is paid for placement (Gym #180).
            WAR_FAME_BY_PLACEMENT,
            // The default read serves our_clan_score too (Gym #225).
            hasSeason
              ? CLAN_SCORE_DEPRECATION
              : "our_clan_score is our_clan_war_trophies under the old, wrong name (the race payload's clanScore is the clan's WAR trophies): DEPRECATED (6.19.0), kept so nothing breaks today, and removed in the next major version.",
            warTrophyTiming(
              hasSeason ? "clan_war_trophies" : "our_clan_war_trophies",
            ),
            hasSeason
              ? "standings carries every clan in the week's bracket with clan_war_trophies (its WAR trophies going into the week) and repair_points; finish_time is null for a clan that did not finish (the API marks it with epoch zero, never a time). days is the race's own day-by-day (the API's periodLogs), one entry per closed war day, empty for a week recorded before 2026-09-17 unless the archive backfill reached it; each day's standings carry rank (1-based, like every rank here; null while unranked) beside end_of_day_rank (the API's 0-based value, -1 unranked)."
              : null,
            "in_progress marks the week still being fought; on OLDER weeks a null our_rank/our_fame means the week was observed without a standings capture.",
            hasSeason && !focus
              ? "member_weeks contains every recorded participant for the exact week; null war_days_battled means per-day attendance is unknown, while war_days lists the observed day indices battled."
              : focus
                ? "member_weeks: null war_days_battled means per-day attendance is unknown for that week (unknown, not zero); war_days lists the day indices battled."
                : "Pass player_tag for one member's week-by-week participation (member_weeks).",
            "finished_early is true on a regular week whose boat reached the 10,000-fame line, false when it did not, null on a Colosseum week (no finish line), a week whose standings were never recorded, or a week still IN PROGRESS - which has not failed to reach the line, it has not had the chance; finish_war_day is the war day whose close carried it over (null when the day-by-day log does not hold the week). Decks used after the finish earn zero points, so decks_used is not the denominator of a points-per-deck rate on a finished week.",
            focus || hasSeason
              ? "member_weeks[].decks_used is the week's cumulative count; a duel consumes one deck per round played (two or three), a 1v1 one and a boat battle one, so decks are not battles. scoring_decks is decks_used less the decks played on the war days after the finish (the denominator for a points-per-deck rate; equal to decks_used on an unfinished week; null when the record cannot separate them); it can overstate by a deck where a poll missed a day's last battle."
              : null,
            boatDecksNote(memberWeeks, "member_weeks"),
            cappedProgressNote(days, "days"),
            hasSeason
              ? null
              : "history_starts_at is the recording horizon: fewer seasons than requested is coverage, not absence.",
            memberWeeks?.length
              ? "member_weeks[].training_decks is the practice decks played on the week's training days (training battles earn no points and are not in decks_used or war_days); from the race poll since 2026-09-24 and rebuilt from recorded river-race battles before that (a floor where a member's log was not fully captured); null for a week with no practice recorded at all."
              : null,
          ),
      docs: WAR_DOCS,
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};

/** A week the calendar never held (feedback #142: 136/4 read "not yet
 *  played", but S136 has four sections). A season's own count, from the
 *  calendar; the old check was against the largest any season has. */
function seasonHasNoSection(seasonId, section) {
  const n = sectionsInSeason(seasonId);
  const count = n === 4 ? "four" : n === 5 ? "five" : String(n);
  return `Season ${seasonId} has no section ${section}: it has ${count} sections (0-${n - 1}), so this week never existed; it is not a coverage gap.`;
}
