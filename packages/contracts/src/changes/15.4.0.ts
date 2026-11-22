import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "15.4.0",
  date: "2026-11-22",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md(
    "battles_performance returns the count beside its streaks.",
    list(
      "battles_performance: window, compare_window, before and after add streak_battles, the won and lost battles current_streak and longest_win_streak read (boat battles included); decided_battles (PvP only) is not their count.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
