import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.31.1",
  date: "2026-09-23",
  summary:
    "On a raw window the meta tools apply the meta population to the battles they consider, not only to the decided ones. `excluded.considered` then equals `decided_battles` plus the excluded buckets again, as on a season read (6.31.0 had counted an event battle as considered and then in no bucket).",
} satisfies ChangelogEntry;
