import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.30.1",
  date: "2026-09-23",
  summary:
    "`badges_rarity` and `badges_holders` on the corpus count only the players recorded now (#145). The corpus had pooled every profile the record ever read, about twice the recorded population, with badges and clans as old as March. A note says what `players_considered` counts. The acceptance interpreter's `count_eq` also compares with a list's length.",
} satisfies ChangelogEntry;
