import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "15.1.0",
  date: "2026-11-19",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md(
    "elixir_timeline gives newly observed clan arrivals and departures the same item ID on the player and clan timelines. New roster-backed player moves use member_joined and member_left. A later stay has its own ID. Player-only membership changes keep clan_joined and clan_left.",
  ),
} satisfies ChangelogEntry;
