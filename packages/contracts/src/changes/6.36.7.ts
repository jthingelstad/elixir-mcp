import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.7",
  date: "2026-09-23",
  summary: md(
    "Two decisions on held Gym findings (Jamie, 2026-09-23).",
    list(
      "A clan segment on the badge tools counts the clan's current members who are recorded now, the corpus rule of 6.30.1. A player known only from a battle stub is a ghost entry and is never in a metric. The coverage note still says how many members counted (#183).",
      "`clans_timeline` and `clans_members_timeline` count a member whose profile was not read that day with their latest earlier read, so the profile-derived aggregates stop moving with the poll schedule. `members_with_profile` counts members with a profile as of the day, and the new `members_profile_carried` says how many of them were carried (#111).",
    ),
    "Additive; the profile-derived values change on days a member was not polled.",
  ),
} satisfies ChangelogEntry;
