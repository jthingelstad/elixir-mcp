import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.9.0",
  date: "2026-09-12",
  summary:
    "NEW TOOL clans_participation: every open member's participation week by week in one call. Per member, columns aligned to the top-level weeks (ISO, 1 to 8, default 5, current week partial): battles, ranked_battles, donations (the weekly counter at week end, null with no snapshot); and columns aligned to the top-level war_weeks: war_decks, war_points, war_decks_by_day (war days 1-4, null where not polled) and war_battles_by_day; verbosity compact keeps war_decks only. Per member: joined_observed_at, tenure_known (false when present at the first roster poll), days_in_clan_observed, last_battle_time, days_since_battle. Per clan: recording_active_since and first_roster_observed_at. Facts and windows only; nothing here scores, ranks or judges.",
  tools_added: ["clans_participation"],
} satisfies ChangelogEntry;
