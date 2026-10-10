import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.14.0",
  date: "2026-09-05",
  summary:
    "First agent feedback actioned: whole-clan Pilot Scores in one call; name-to-tag search; include_curve flag.",
  tools_added: ["clans_pilot_scores", "players_search"],
} satisfies ChangelogEntry;
