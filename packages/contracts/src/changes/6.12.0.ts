import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.12.0",
  date: "2026-09-21",
  summary: md(
    "The corpus meta on a week's window, and a compact size for the meta tools (feedback #77-#80: every 7-day corpus read of `battles_meta_decks` and `battles_meta_cards` timed out, and four full payloads crossed a turn's ceiling).",
    list(
      "A corpus read whose window sits inside the running season without being the whole of it now answers from the season's population table (the rows the nightly rebuild aggregates, level gap on the row), filled through the nightly's cursor, which a note names; the same numbers the raw scan gave, in a second or two instead of a timeout. The table is kept for the running season and the one before it, so a window may span the roll; one that starts past the cursor or reaches an older season scans the raw rows as before.",
      "`verbosity: 'compact'` on `battles_meta_decks` and `battles_meta_cards` is a real size: a deck row keeps `deck_hash`, `archetype_label`, `card_names` (one string), the counts, `usage_share`, `win_rate`, `shrunk_win_rate`, `players`, `dominant_mode` and `fit` without its upgrade path; a card row the counts, rates and `held`; both drop `modes`, the instants, the level gap, the card and archetype objects, `methodology` and `modes_in_window`. Scalars and flags are unchanged between sizes.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
