import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.15.0",
  date: "2026-09-22",
  summary: md(
    "The Elixir Gym's second war run (feedback #84-#86), on the day-by-day and the exact-week path of `war_history`.",
    list(
      "`days[].standings[].progress_end_banked` (and on `war_current.days_closed[]`): the race log caps a finished boat's progressEndOfDay at the line, so the finishing day read 10000 where 6811 + 3000 + 323 = 10134 was banked and the next day's progress_start carried it - the one row in twenty where the array's own arithmetic broke, and a walk over progress_end showed +134 on a day that earned nothing. `progress_end` stays the API's value; `progress_end_banked` is the banked one on every row, equal to it wherever no cap fired; a conditional note names the clamped rows.",
      "A conditional note on `war_history.member_weeks[]` and `war_current.participants[]` whenever a row carries `boat_attacks > 0`: boat attacks are counted INSIDE `decks_used` and `scoring_decks`, a boat battle spends a war deck and scores on a different scale, so `points / scoring_decks` is not comparable between those rows and the rest (the rate the 6.11.0 note sanctions pooled the two: a member with four boat decks ranked last of 26 on it). The decks note now lists a boat battle among what consumes a deck; the docs do too.",
      "`history_starts_at` on the exact-week path as well (it was served only with `seasons`), and an empty exact week says which side of the horizon it is on: before recording began, after the latest recorded week, a section no season has (0-4), or a gap inside the span - a week before the horizon and a week that never existed answered byte-identical.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
