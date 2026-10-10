import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.9",
  date: "2026-09-23",
  summary: md(
    "The clan tools, after the Elixir Gym's third run on them (feedback #195-#198).",
    list(
      "The clan's own `pre_reset` row keeps the week's donation high-water, as the members' rows have since 6.33.0. A read that landed after the weekly reset had left `donations_per_week` at 10 for the weeks of game days 2026-09-06 and 09-13, where the clan's counter had reached 9,270 and 9,094; ingest keeps the higher value and migration 0161 repairs the stored rows (#195).",
      "`clans_standings` and `clans_participation` name the members whose battles were mostly not captured over the last seven days (below 80% of what the profile's battle counter says they played), so a member at 0 recorded battles with 38 real ones reads as a capture gap, not inactivity (#196).",
      "`clans_timeline`'s profile aggregates leave out a member who left by the clan's read that day. After the 6.36.7 carry-forward their carried profile had counted, putting `members_with_profile` at 49 over 46 members; a note names the days (#197).",
    ),
    "Additive; stored clan pre_reset donations change for weeks read after the reset.",
  ),
} satisfies ChangelogEntry;
