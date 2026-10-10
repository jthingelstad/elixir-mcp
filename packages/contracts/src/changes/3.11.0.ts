import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.11.0",
  date: "2026-09-17",
  summary:
    "battles_meta_decks, battles_meta_cards and cards_synergy answer a corpus-wide season read (the default window, or season) from the season's rollup instead of a scan of every battle: the same population and the same fields, with players_as_of (when the distinct-player counts were last rebuilt, nightly) and a note saying the counters are hourly. A deck or card first seen since the last rebuild carries players: null until the next one. Segment reads and explicit from/to windows are unchanged and exact to the instant. Additive.",
} satisfies ChangelogEntry;
