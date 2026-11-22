import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "15.2.0",
  date: "2026-11-22",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md(
    "battles_performance reports a window's close games, how often the player was three-crowned, and the longest win streak beside the current one.",
    list(
      "battles_performance: window, compare_window, before and after add close_wins and close_losses (single-game head-to-head wins and losses by exactly one crown; duels and boat battles never count), three_crowned_against_rate (over head_to_head_battles; null when there are none) and longest_win_streak (the longest run of wins among the window's decided battles, in battle order).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
