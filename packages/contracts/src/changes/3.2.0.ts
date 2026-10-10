import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.2.0",
  date: "2026-09-14",
  summary:
    "Heavy MCP reads (battles_meta_decks, battles_meta_cards and clans_standings) now share an 18-second query budget, shortened when Lambda has less time left. PostgreSQL cancels over-budget work and returns query_timeout with an executable retry and meta.request_id instead of losing the connection at Lambda's 25-second limit; failed calls remain audited. Corpus meta reuses its population scan for the same unrounded shrinkage prior, avoiding a redundant corpus pass without changing denominators. clans_roster not_recorded names the exact live:true retry and explains that it does not start an ongoing watch. clans_standings discovery explicitly names the one-call 24-hour member scan and the existing trophy/streak boundary.",
} satisfies ChangelogEntry;
