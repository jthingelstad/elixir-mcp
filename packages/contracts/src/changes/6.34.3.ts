import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.34.3",
  date: "2026-09-23",
  summary:
    "game_clock says that a clan's race closes each war day before the 10:00Z grid, in the half hour before it and per race (observed 09:30 to 10:00Z). `war_day_closes_at` is the policy boundary, not the moment a race stops taking battles, and war_current carries a race's observed close. The values are unchanged (feedback #169).",
} satisfies ChangelogEntry;
