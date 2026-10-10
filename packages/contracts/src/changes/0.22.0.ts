import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.22.0",
  date: "2026-09-06",
  summary:
    "Clan Pulse: a daily clan_pulse feed event per added clan (24h battle activity, top players, members quiet >=5 recorded days, war-day deck counts, roster changes - facts, never judgments) plus a real-time war_day_open event when a new war day is first observed. war_current gains decks_today: named untouched/partial/finished lists for the current war day - the nudge list. Built for scheduled agent clan-management routines: read elixir_events from your cursor, drill with war_current and clans_roster.",
} satisfies ChangelogEntry;
