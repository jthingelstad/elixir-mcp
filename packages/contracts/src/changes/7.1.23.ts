import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.23",
  date: "2026-09-24",
  summary: md(
    "Participation tenure is the current stint (Jamie, 2026-09-24; Gym #264).",
    list(
      "`clans_participation` members' `joined_observed_at` and `days_in_clan_observed` count from the member's current stint, so a member back after months away gets a new member's grace. A rejoin within 7 days of leaving continues the stint before it, so leaving cannot reset a member's grace.",
      "`first_joined_at` is the member's first recorded join in the clan, beside it (`clans_roster.first_observed_in_clan` is the same instant).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
