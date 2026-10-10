import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.12.0",
  date: "2026-09-26",
  summary: md(
    "`battles_decks` answers a page at a time, in lighter rows (Jamie, 2026-09-26). A player's whole history at limit 30 was about 47,000 characters, next to the 48,000-character result cap, because every row carried eight card objects and the archetype object.",
    list(
      "Rows name their cards in one line (`card_names`, forms prefixed: Evo, Hero) with `archetype_label` and `tower_troop_name`; `cards`, `tower_troop` and `archetype` ride only the one deck asked for.",
      "`deck_hash` returns that one deck: its row with the cards (id, name, form), tower troop and archetype in full, its duel rounds in `duel_decks`, and the window's totals, so its share reads as in the list.",
      "`offset` pages the sorted list; `total_decks` counts it and `next_offset` starts the next page (null on the last). The list is no longer cut at the 100 most-played decks before sorting, so `sort: win_rate` ranks every deck.",
      "`verbosity: compact` drops each row's `modes` and level detail and keeps the record, share, `dominant_mode` and `mean_level_gap`.",
      "`duel_decks` read each round's own `deck_hash` and result (0182).",
    ),
    "The list rows' card objects and archetype object moved to the single-deck read.",
  ),
} satisfies ChangelogEntry;
