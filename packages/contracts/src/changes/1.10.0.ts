import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.10.0",
  date: "2026-09-13",
  summary:
    "Feed payloads now carry what the Events page always promised: member_role_changed has prev_role, new_role and direction (promoted | demoted), and member_left has the departing role. war_current and the clan pulse's decks_today gain race_finished_at (also top-level on war_current): once your boat has crossed the line, the lists still say who played today but no longer mean who owes the race anything. game_clock gains the next boundaries a routine needs to schedule itself: war_day_closes_at, next_war_day_opens_at, next_training_starts_at and week_ends_at. war_day_open is deprecated: it is a clock fact, and game_clock is where the clock lives; it keeps firing through the deprecation window.",
  tools_added: [],
} satisfies ChangelogEntry;
