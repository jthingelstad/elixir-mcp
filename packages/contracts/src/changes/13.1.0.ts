import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.1.0",
  date: "2026-11-13",
  summary: md(
    "A duel is known by its type or by its round decks in every battles tool, not only in `battles_query` (13.0.2). A battle played as games on round decks that is not a `riverRaceDuel*` (an event's multi-deck mode, the 1v1 Duel friendly) was counted as a battle with no deck, and its games counted nowhere. Its games now count in their own mode group, never pooled with a river race duel's.",
    list(
      "`battles_decks`: such a battle counts under `excluded.duels`, not `excluded.no_deck`, and its round decks are listed in `duel_decks`. Each `duel_decks` row now carries `mode` (the mode group its rounds were played in), and a deck played in duels of two modes is two rows.",
      "`battles_performance`: such a battle counts in `duel_battles` and is out of `head_to_head_battles` and `three_crown_rate`, whose crowns are a single game's.",
      "`battles_cards`: each of its rounds is one game in its mode group, with that round's cards and result.",
    ),
    "Additive: one field (`duel_decks[].mode`). The JSON API is unchanged at 5.0.0.",
  ),
} satisfies ChangelogEntry;
