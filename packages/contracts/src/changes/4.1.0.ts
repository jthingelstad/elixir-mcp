import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "4.1.0",
  date: "2026-09-19",
  summary: md(
    "The 3.13.0 guards, landed on the field that needed them (feedback #61, #62, #63, the 2026-09-19 regression run: every 3.13.0 item held, and three new defects were a guard sitting beside the number rather than on it).",
    list(
      "`battles_performance` (`group_by: week`) and `battles_trends` weeks carry `trophy_mode_battles` (the Trophy Road and Path of Legends battles played) beside `trophy_battles`, which counts only the ones the game reported a trophy delta for. A loss standing on an arena floor reports none, so `trophy_battles` was lower than the ladder games played, only losses dropped out, and a rate over it flattered exactly the floored player the response had already named. The docs now list it among the denominators, and a note names the weeks where the two counts differ.",
      "`battles_levels` lists EVERY step of `monthly_trend` where the modal arena changes or the mean starting trophies move by 200 or more under `player.population_changes[]` (`{from_month, to_month, arena_changed, from_arena, to_arena, from_trophies, to_trophies, trophy_delta}`; empty when the population held), and the note names all of them. It named the earliest step only and stayed quiet on a later arena crossing, the harder confound and the one #55 was filed for.",
      "`battles_decks` carries `excluded {duels, no_deck}`: a duel has no single deck and was silently outside `total_battles_in_window` and every `share_of_battles` (the docs listed the duel-excluding tools and left this one out). The identity `total_battles_in_window + excluded.duels + excluded.no_deck = battles_performance.battles` now holds over the same window, `total_battles_in_window` is summed over every deck-bearing battle rather than the first hundred decks, and a note says what sits outside the rows whenever the window held a duel.",
    ),
    "Additive; no migration.",
  ),
} satisfies ChangelogEntry;
