import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.6.0",
  date: "2026-09-11",
  summary:
    "The card collection is recorded. players_collection reads a player's cards and tower troops from the record (levels on the 1-16 scale, counts, forms), not from a payload cache that went empty two hours after each profile poll - since 0071 it had answered cards: [] for most players most of the day. cards_catalog and cards_synergy read the same recorded catalog. TWO NEW FEED TOPICS on the player stream, coalesced like the badge topics: card_unlocked (a card the player did not have appeared) and card_leveled (a level went up); counts ticking toward the next level are recorded but never announced, and a player's first observed collection is silent. Collections fill as profiles are polled; nothing is backfilled.",
  tools_added: [],
} satisfies ChangelogEntry;
