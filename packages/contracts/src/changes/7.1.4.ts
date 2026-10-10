import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.4",
  date: "2026-09-24",
  summary: md(
    "The clan tools after the Elixir Gym's fourth run on them (feedback #236-#243).",
    list(
      "The capture-gap note on `clans_standings` and `clans_participation` measures the response's own window, and says nothing on an empty one; it had measured the last seven days on every window (#236).",
      "`clans_standings` and `clans_participation` name members who joined during the window with the battles they played before joining, and say the rows are today's members (#237).",
      "`clans_timeline` with no window is the last 30 game days, echoed as source default; the whole-history default was refused on size (#239). `season` on the clan series shipped in 7.1.3 (#238).",
      "`clans_members_timeline` serves `truncated`, and `member_count` is described as the rows on the page (#240).",
      "`clans_roster` `recent_events` is the newest twenty by when they happened, and says when it was cut and where to read the rest (#241).",
      "`clans_timeline` says where the clan's donation counter exceeds its member rows in a week a member left: the game keeps the departed member's donations in the counter (#242).",
    ),
    "Additive; clans_timeline's default window changes from all history to 30 game days.",
  ),
} satisfies ChangelogEntry;
