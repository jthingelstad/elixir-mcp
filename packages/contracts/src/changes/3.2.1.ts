import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.2.1",
  date: "2026-09-14",
  summary:
    "Deck meta no longer aggregates every full deck JSON before applying the result limit. It keeps the latest qualifying observation's participant key per deck, then reads the returned decks through that primary key. Counts, unrounded rates, shrinkage, scope, and the latest-observation exemplar are unchanged; full-corpus reads retain the 18-second cancellable query budget.",
} satisfies ChangelogEntry;
