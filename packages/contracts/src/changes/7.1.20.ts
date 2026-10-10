import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.20",
  date: "2026-09-24",
  summary: md(
    "The war tools after the Elixir Gym's fourth run on them, the first on a live war day (feedback #311-#313).",
    list(
      "The glossary's clan_score says the war tools' figure is war trophies going into a race (served as clan_war_trophies), not the clan profile's score, and war_rivals' timing is the going-in figure; the war docs name war_rivals' mean_points, points_weeks and points_vs_ours, not a points field that does not exist (#311).",
      "war_current says its attendance_by_war_day participants count is the race roster, which keeps members who have left the clan, while decks_today counts current members (#312).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
