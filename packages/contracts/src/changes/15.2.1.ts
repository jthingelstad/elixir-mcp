import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "15.2.1",
  date: "2026-11-22",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md(
    "battles_performance's longest_win_streak description now says which battles it reads; the number is unchanged.",
    list(
      "battles_performance: longest_win_streak reads the same won and lost battles as current_streak, boat battles included, so it is never shorter than a winning current_streak. decided_battles (PvP only) is not its count.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
