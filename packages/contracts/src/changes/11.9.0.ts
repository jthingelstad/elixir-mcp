import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.9.0",
  date: "2026-10-11",
  summary: md(
    "elixir_timeline items say where they lead. On a full read, each item carries follow: the reads that expand it into its story, each a tool and the arguments to call it with, built from the item itself.",
    list(
      "elixir_timeline: items[].follow (full verbosity) lists { tool, args } addresses. A sitting leads to its own evidence read (this window and basis) and battles_performance over its span; a promotion, arena move, new best or wins milestone to the battle that proved it and players_summary; a badge to players_profile; a card to players_collection and cards_card; a roster move to players_summary and clans_roster; a bracket to war_rivals; a finished race or week to war_history for that week; a return to players_summary and the last ten battles. Account items lead nowhere.",
      "Every address is a tool the caller may call, with arguments that tool's input schema accepts. They are addresses, not advice. Compact reads leave follow out.",
    ),
    "An addition: no field changed or removed. JSON API 3.1.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
