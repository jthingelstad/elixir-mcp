import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.15.0",
  date: "2026-09-05",
  summary:
    "UNIVERSAL READS: all recorded game data readable by every account (the public-API posture); account data stays private. Collections: curated player/clan groupings (first: 'pros', 11 professional players).",
  tools_added: ["collections_browse", "collections_get"],
  breaking:
    "not_entitled no longer occurs on game-data reads; clan tools accept any recorded clan.",
} satisfies ChangelogEntry;
