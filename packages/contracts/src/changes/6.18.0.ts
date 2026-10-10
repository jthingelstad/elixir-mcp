import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.18.0",
  date: "2026-09-23",
  summary: md(
    "The comparisons a battle row always held both halves of, and what its signature proves about how long it ran.",
    list(
      "`me.vs` on every head-to-head row: `crowns`, `deck_level`, `starting_trophies` and `tower_hp`, each as me MINUS the one opponent. These numbers mean little alone and a caller was reaching into two nested objects to difference them - `deck_level` is the level edge in THAT battle from the cards as played, `starting_trophies` is what matchmaking paired, and `tower_hp` is remaining hitpoints on both sides, which is a margin of victory and never a tower level. Null on 2v2 and duels.",
      "`inferred.duration` on head-to-head 1v1 rows: the battle log carries no duration, but the game's clock makes the crown pair a bound. A King Tower is the only way to end before regulation, so a three-crown finish is `at_most_s` 300 with no floor; any other finish ran `at_least_s` 180; and level crowns means overtime expired and the tower-hitpoints tiebreaker resolved it, which is `exact_s` 300. `basis` says which rule fired. Absent on duels (crowns sum over up to three games) and boat battles (no overtime).",
    ),
    "Additive, full verbosity only. Nothing is measured that the record does not hold: duration is a bound the signature PROVES, never a timing.",
  ),
} satisfies ChangelogEntry;
