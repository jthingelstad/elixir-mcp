import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.0.1",
  date: "2026-09-25",
  summary: md(
    "War facts are weekly aggregates on every war tool (Jamie, 2026-09-25). The API does not say which day a war deck was played, and each race rolls its day at its own moment in the half hour before 10:00 UTC, which cannot be placed reliably across every clan Elixir records. 9.0.0 said war_history kept separately observed attendance; it was the same per-day split, and it goes too.",
    list(
      "`war_history.member_weeks[]` drops `war_days_battled`, `war_days`, `training_decks` and `scoring_decks`; it carries the game's weekly counters `points`, `decks_used`, `boat_attacks` and `repair_points`.",
      "`war_current` drops `attendance_by_war_day` and `participants[].scoring_decks`; the finished-race note still names the finish and says `decks_used` is not a points-per-deck denominator that week. `decks_today`, the game's own count for the day in progress, stays.",
      "`clans_participation` drops `war_scoring_decks`. `war_decks` is `null` where the member has no race row for the week (a recorded war battle alone used to answer 0).",
      "The boat-decks note quotes a member's boat attacks against the week's `decks_used`.",
    ),
    "A patch under the agent-facing rule (DECISIONS: majors track domain shifts): an agent reads the current declaration, and an absent field withdraws a claim.",
  ),
} satisfies ChangelogEntry;
