import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.11.0",
  date: "2026-09-21",
  summary: md(
    "The Elixir Gym's war run (feedback #81, #82): `finished_early` was documented, named in every `war_history` note and served on no row - it was computed as fame exactly 10,000, and the record keeps the boat's progress past the line (10,134, 10,305) that the live race reports where the race log caps it - and `war_current` put `points` beside `decks_used` with no word that the decks after the finish earned nothing.",
    list(
      "`war_history.weeks[].finished_early` on every row: true on a regular week whose boat reached the line, false when it did not, null on a Colosseum week (no finish line) or without a standings capture. `finish_war_day` beside it: the war day whose close carried the boat over, from the race's own day-by-day (a finish is a day close; the game banks progress then), null when the log does not hold the week.",
      "`scoring_decks` on `war_history.member_weeks[]` and `war_current.participants[]`: `decks_used` less the decks played on the war days after the finish - the denominator of a points-per-deck rate. Equal to `decks_used` on an unfinished week; null when the record cannot separate the two.",
      "`war_current.finish_war_day`, and a conditional note once the boat has finished naming the instant, the day and the count of decks played since for 0 clan points.",
      "`war_rivals.finished_races` on every row: the count the fame statistics were taken over (`races_observed` includes the week in progress and is not their denominator); a rival with no finished shared race reads null, not zero. The latest recorded week counts as finished once the recorder has seen it close, rather than as in progress until the next week starts.",
    ),
    "Additive. The weekly clan email's fame line reads 'crossed the line early' again; it had read 'boat fame' on every live-polled finished week.",
  ),
} satisfies ChangelogEntry;
