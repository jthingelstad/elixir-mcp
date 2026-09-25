/** Shared by the warTools tools in this directory: the helpers,
 *  argument schemas and notes more than one of them uses. Split out of
 *  tools/war.mjs (2026-09-23), one file per tool. */

import { normalizeTag } from "@elixir-mcp/contracts";
import { finishInstant } from "../../time.mjs";
import {
  TAG_RULE_HINT,
  ToolFailure,
  docsRef,
  entitledClan,
  liveRead,
} from "../shared.mjs";

export const CLOCK_DOCS = docsRef("clocks", "the-policy-day");

/** The war family's `clan_score` is the API's `clanScore` ON A RACE
 *  PAYLOAD, and there it means WAR TROPHIES - not the ~129,000 clan
 *  score a profile shows (feedback #88). Our own series proved it
 *  independently of the API: our_clan_score ran 980, 1000, 1020, 1040,
 *  1060, 1160 across 135/0-136/0, rising by exactly each week's
 *  trophy_change. The overload is the API's and is already recorded for
 *  the war BOARD (cr-agent-api-docs locations.md); the race payload is
 *  where it was inherited silently.
 *
 *  6.19.0 served the honest name, clan_war_trophies, beside the old
 *  one; 9.1.0 removed the old one (Jamie 2026-09-25). */
export const WAR_TROPHIES_NOTE =
  "clan_war_trophies is the clan's WAR trophies, which is what the race payload's clanScore actually carries - not the clan score a profile shows (that is ~100x larger; clans_roster serves it as clan_score and clans_timeline serves both as separate metrics).";
/** When the figure is from (feedback #140): the race payload carries a
 *  clan's war trophies as they stood going into the race, and the week's
 *  trophy_change lands only in the next race's figure - 26 of 26 chained
 *  closed weeks in the Gym's check, and clans_timeline agrees. */
export const warTrophyTiming = (field = "clan_war_trophies") =>
  `${field} is the figure the race payload carried during the week, going into it: the week's own trophy_change is not included, so after a closed week the clan stood at ${field} + trophy_change, the next week's figure.`;
/** How a war day pays fame (Gym #180, 28 of 28 scoring rows over four
 *  weeks and two brackets): by the day's placement on points, not by the
 *  points, so fame measures where a clan finished each day, not how much
 *  it played. Only the observed payouts are stated. */
export const WAR_FAME_BY_PLACEMENT =
  "A war day's fame (war_history.progress_earned) is paid by the clan's placement that day on points, not by the points: observed 3,000 for first, 1,800 for second and 1,000 for third. So fame, and war_rivals.mean_fame, measures where a clan placed each day, not how much it played: compare points for effort (war_rivals.mean_points, war_rivals.points_vs_ours).";
export const WAR_DOCS = docsRef("battles", "war-weeks-points-and-fame");

export const CLAN_TAG_SCHEMA = {
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
export async function warDaysLog(db, clanTag, seasonId, sectionIndex) {
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
export function cappedProgressNote(days, field) {
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
 *  decks_used, and it scores on a different scale, so a
 *  points-per-deck rate is not comparable between the rows that hold
 *  boat decks and the rows that do not. Null when no row does. */
export function boatDecksNote(rows, field) {
  const boat = (rows ?? []).filter((r) => r.boat_attacks > 0);
  if (boat.length === 0) return null;
  // Both are the week's counters, so the share is of the week's decks.
  // 6.15.0 to 9.0.0 quoted it against scoring_decks (feedback #89); that
  // denominator split the week at the finish day's rollover and went
  // with every other day split (Jamie 2026-09-25).
  const shown = boat
    .slice(0, 4)
    .map(
      (r) =>
        `${r.name ?? r.player_tag} ${r.boat_attacks} of ${r.decks_used} decks`,
    );
  const more = boat.length > 4 ? `, and ${boat.length - 4} more` : "";
  return `boat_attacks are counted INSIDE decks_used: a boat battle spends a war deck and scores on a different scale from a 1v1 or a duel. ${boat.length} of ${rows.length} ${field} rows have boat_attacks > 0 (${shown.join(", ")}${more}), so a points-per-deck figure is not comparable between them and the rest.`;
}

export const weekKey = (r) => `${r.season_id}:${r.section_index}`;

/** Whether a week's boat finished: a regular week whose own standings
 *  row carries a finish instant or fame at the line. Null when the week
 *  has no finish line (Colosseum) or no standings capture. */
export function boatFinished({ is_colosseum, fame, finish_time }) {
  if (is_colosseum) return null;
  if (finishInstant(finish_time)) return true;
  if (!Number.isInteger(fame)) return null;
  return fame >= FINISH_LINE;
}

/** The war day whose close carried each week's own boat over the line,
 *  from the race's own day-by-day: the first closed day with progress_end
 *  at or past 10,000. Keyed by weekKey; a week without such a day (not
 *  finished, Colosseum, or recorded before the log was kept) is absent. */
export async function finishWarDays(db, clanTag, keys) {
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

export async function clanSubject(ctx, args, endpoint) {
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
