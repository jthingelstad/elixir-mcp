import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.16.1",
  date: "2026-09-05",
  summary:
    "Leaderboards via live_fetch (agent feedback #6, filed unprompted): /locations/{id}/rankings/players and /locations/{id}/pathoflegend/players join the allowlist - top-100, and every ranked tag accretes into the corpus for immediate use with the player tools.",
} satisfies ChangelogEntry;
