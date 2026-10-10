import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.20.2",
  date: "2026-09-06",
  summary:
    "battles_query gains two addressing modes for the record browser (and agents): battle_id alone fetches ONE battle with both perspectives; deck_hash alone sweeps the corpus for that exact deck and returns deck_stats (battles, W-L, distinct pilots, span - deliberately no pooled win rate; battles_meta_decks has shrunk rates with sample sizes).",
} satisfies ChangelogEntry;
