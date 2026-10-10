import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.20.0",
  date: "2026-09-05",
  summary:
    "Observed meta + segment trends (META-INTEL 2-3, grounded in recorded data only). battles_meta_decks and battles_meta_cards aggregate any segment - the corpus, a clan, a player, or a collection like 'pros' - with EB-shrunk win rates, distinct-pilot counts, and usage shares; evolution forms never merge. battles_trends gives weekly series for the same segments. No tier lists, no opinions: sample sizes ride every number.",
  tools_added: ["battles_meta_decks", "battles_meta_cards", "battles_trends"],
} satisfies ChangelogEntry;
