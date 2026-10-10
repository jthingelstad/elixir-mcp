import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.9.1",
  date: "2026-09-26",
  summary: md(
    "`battles_decks.duel_decks` is lighter: at most 8 decks, each with `card_names` (one string) and `archetype_label` in place of card objects and the archetype object. At 9.9.0 a player's whole history of duels pushed a 30-deck page past the 48,000-character result cap (acceptance gym 151.3).",
  ),
} satisfies ChangelogEntry;
