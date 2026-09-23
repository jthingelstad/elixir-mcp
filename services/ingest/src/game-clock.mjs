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

  // The next boundaries, so a reader can schedule ITSELF ("call me three
  // hours before the next close") instead of being told the time by a
  // feed row (review 2026-09-13: the clock is the agent's, never the
  // feed's). Walk the policy grid forward a fortnight; period indices
  // reset each season, so each step re-derives its season.
  const kindAt = (ms) => {
    const s = seasonFromDate(ms);
    return periodInfo(Math.floor((ms - s.seasonStartMs) / DAY_MS)).kind;
  };
  // "Next training" means the next training BLOCK, the one after the coming
  // war days, not tomorrow when tomorrow is merely training day two.
  let nextWarDayOpensMs = null;
  let nextTrainingStartsMs = null;
  let warSeen = info.kind === "war";
  for (let k = 1; k <= 14; k += 1) {
    const ms = periodStartMs + k * DAY_MS;
    const kind = kindAt(ms);
    if (kind === "war") {
      warSeen = true;
      if (nextWarDayOpensMs === null) nextWarDayOpensMs = ms;
    } else if (warSeen && nextTrainingStartsMs === null) {
      nextTrainingStartsMs = ms;
    }
    if (nextWarDayOpensMs !== null && nextTrainingStartsMs !== null) break;
  }
  const weekEndsMs =
    season.seasonStartMs + (season.sectionIndex + 1) * 7 * DAY_MS;

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
    war_day_closes_at:
      info.kind === "war"
        ? new Date(periodStartMs + DAY_MS).toISOString()
        : null,
    next_war_day_opens_at: new Date(nextWarDayOpensMs).toISOString(),
    next_training_starts_at: new Date(nextTrainingStartsMs).toISOString(),
    week_ends_at: new Date(weekEndsMs).toISOString(),
    notes: [
      "war_day_closes_at is this day's end on a war day and null on a training day; next_war_day_opens_at is the next war day to open after this one; next_training_starts_at is when the next training block begins, after the coming war days. Schedule from these; nothing in the event feed announces the time.",
      "Days roll at 10:00 UTC, the same hour the season rolls.",
      // The policy grid, not the race (Gym #169: POAP KINGS' war days
      // closed at 09:34-09:38Z while this still said the day was open).
      "A clan's race closes each war day before this grid, somewhere in the half hour before 10:00 UTC and per race (observed 09:30 to 10:00Z): war_day_closes_at is the policy boundary, not the moment a race stops taking battles, so do not schedule a last attack for its final half hour. war_current carries a race's observed close.",
      "A season runs first Monday of the month to first Monday of the next; weeks are the Mondays between.",
      "The final week of a season is Colosseum; its practice days still report as training.",
      "season_id is the season number the API's war data carries (riverrace seasonId) and the record files everything under; season_month is the API's name for the same season on its Path of Legends finals. The in-game Pass shows a third number (a lower one) that the API does not use anywhere.",
    ],
  };
}
