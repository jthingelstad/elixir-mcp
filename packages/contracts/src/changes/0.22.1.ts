import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.22.1",
  date: "2026-09-06",
  summary:
    "Hardening from five agent-persona test passes. Unknown enum values (mode, outcome, sort, metric, granularity) and impossible card ids now REFUSE with valid-value hints instead of returning silent empty results; players_timeline garbage dates get a structured error instead of 'failed unexpectedly'; last_n_battles: 0 refuses instead of quietly serving all-time stats; battles_query echoes limit_applied so the 50-row clamp is visible. war_history gains finished_early (a regular week that hit the 10,000-fame finish line stops earning member points - per-deck math there is invalid) and history_starts_at (the recording horizon); war_current documents that war_day is 1-based and day_in_week 0-based. member_left feed events now carry the departed member's last-known name.",
} satisfies ChangelogEntry;
