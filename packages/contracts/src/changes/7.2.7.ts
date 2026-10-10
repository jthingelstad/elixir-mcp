import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.2.7",
  date: "2026-09-24",
  summary: md(
    "The new-user journey before beta (feedback #348, #349).",
    list(
      '`battles_meta_decks` rows with 2-5 players carry `top_player_battles`, the busiest player\'s battles, and a note names each row one player carries (80% or more of its battles). `min_players: 2` let a 57-0 run read as "3 players, 57-2", the answer a "what deck should I play" read would lead with (#348).',
      "`battles_meta_cards` without fit_for no longer points at a `decks[]` it does not have.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
