import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.19.1",
  date: "2026-09-05",
  summary:
    "Metadata truth pass for the added-means-recorded structure: every description now matches behavior (no stale watch/claim/entitled-scope language); server instructions teach the add + notify + events_pending flow. players_search now searches the WHOLE recorded corpus (universal reads) - your players and clanmates rank first, then everyone recorded (source: claim | clanmate | corpus).",
} satisfies ChangelogEntry;
