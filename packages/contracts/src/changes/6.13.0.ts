import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.13.0",
  date: "2026-09-21",
  summary: md(
    "The middle rung of adoption cost (the Gym's open question after its 6.10.0 run; Jamie's call 2026-09-21: the win condition dominates the family). A player fielding Evo Royal Hogs bridge spam was shown Evo Royal Hogs cycle on the bottom rung beside Three Musketeers beatdown, because fit knew families and exact labels and nothing between.",
    list(
      "`fit.plays_win_condition` on every `battles_meta_decks` row with `fit_for`: the player already fields one of the row's win conditions, form included (Evo Royal Hogs is not Royal Hogs - the form is what is unlocked and leveled). `fit_for.plays.win_conditions[]` lists theirs as a label speaks them.",
      "The note reads adoption cost off the three booleans in order: exact shape, then the same win condition in another family (the card leveled and learned, played at a different pace), then the same family around a new win condition, then neither.",
      "`war_history.weeks[].in_progress` is on every row, true or false; it was emitted only when true, so an absent flag read as false - the shape of the finished_early defect, caught by the new acceptance suite's first run.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
