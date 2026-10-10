import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.2.0",
  date: "2026-09-24",
  summary: md(
    "Tower troops, a deck's ninth card (Jamie, 2026-09-24; Gym #282).",
    list(
      "`battles_meta_cards` takes `tower_troops: true`: one row per tower troop, with usage share, players, raw and shrunk win rate and the mode split, over the same population, window and mode as the eight-card read (`decided_battles` is the same number).",
      "`cards_card` answers a tower troop by id or name: the catalog row (`type: tower_troop`), when it was first recorded in a deck, `season.all` usage and win rate, and on a clan segment who plays and holds it. Season history, top decks and partners stay the eight deck cards'; `cards_synergy` still pairs deck cards only and says where tower troops are read.",
      "Deck identity (`deck_hash`) has carried the tower troop all along, and full-verbosity deck rows carry `tower_troop`.",
    ),
    "Additive; a minor version for the new input.",
  ),
} satisfies ChangelogEntry;
