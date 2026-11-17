import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.7.0",
  date: "2026-11-17",
  summary: md(
    "Cheers come in twenty kinds, up from six.",
    list(
      "`elixir_cheers`: an item's `cheers` may now hold any of fourteen more keys besides `well_played`, `on_fire`, `royal`, `wow`, `ha` and `grind`: `love_it`, `good_game`, `congrats`, `clutch`, `high_five`, `champion`, `nailed_it`, `climbing`, `big_brain`, `ice_cold`, `close_one`, `lucky`, `fun_to_watch` and `getting_better`. The six keep their ids. Still counts only, never who, and an agent still never gives a cheer. The ids and what each means are in the docs, timeline#cheers.",
    ),
    "An addition. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
