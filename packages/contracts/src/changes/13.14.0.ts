import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.14.0",
  date: "2026-11-18",
  summary: md(
    "Elixir Drop games appear on the player’s Timeline.",
    list(
      "elixir_timeline adds drop_game in the attested section. Each game carries its own ID, mode, score, answer count and card highlights. A game is visible to its player and followers and cannot be syndicated.",
    ),
    "Additive MCP change. JSON API 5.1.0 stays at its existing contract.",
  ),
} satisfies ChangelogEntry;
