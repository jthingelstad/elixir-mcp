import {
  seasonFromDate,
  nominalPeriodBoundsMs,
  periodInfo,
  monthKey,
} from "./war-clock.mjs";
const DAY_MS = 24 * 3600_000;
export function gameClock(atMs = Date.now()) {
  // Every value below is calendar math over the policy grid. No clan is
  // consulted, and none should be: borrowing an arbitrary clan's river
  // race to learn the date is exactly the workaround this replaces, and
  // it is how a season bug reaches a consumer that has no clan at all.
  const season = seasonFromDate(atMs);
  const { startMs: periodStartMs } = nominalPeriodBoundsMs(atMs, 0);
  const dayInSection = Math.floor(
    (periodStartMs - season.seasonStartMs) / DAY_MS - season.sectionIndex * 7,
  );
  const periodIndex = season.sectionIndex * 7 + dayInSection;
  const info = periodInfo(periodIndex);
  const nextSeason = seasonFromDate(
    seasonFromDate(atMs).seasonStartMs + 40 * DAY_MS,
  );

  return {
    as_of: new Date(atMs).toISOString(),
    season_id: season.seasonId,
    // The API's own name for the same season (0070): the month it started in.
    season_month: monthKey(season.seasonStartMs),
    season_started_at: new Date(season.seasonStartMs).toISOString(),
    season_ends_at: new Date(nextSeason.seasonStartMs).toISOString(),
    week: season.sectionIndex + 1,
    section_index: season.sectionIndex,
    period_index: periodIndex,
    day_kind: info.kind,
    war_day: info.warDay,
    day_started_at: new Date(periodStartMs).toISOString(),
    day_ends_at: new Date(periodStartMs + DAY_MS).toISOString(),
    notes: [
      "Days roll at 10:00 UTC, the same hour the season rolls.",
      "A season runs first Monday of the month to first Monday of the next; weeks are the Mondays between.",
      "The final week of a season is Colosseum; its practice days still report as training.",
      "season_id is the season number the API's war data carries (riverrace seasonId) and the record files everything under; season_month is the API's name for the same season on its Path of Legends finals. The in-game Pass shows a third number (a lower one) that the API does not use anywhere.",
    ],
  };
}
