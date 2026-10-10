import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.9.0",
  date: "2026-09-04",
  summary:
    "Domain-first tool names (players_*, battles_*, war_*, elixir_*...) and four service tools.",
  tools_added: [
    "elixir_watch_player",
    "elixir_watch_clan",
    "elixir_data_insights",
    "elixir_collectors",
  ],
  breaking:
    "ALL tools renamed to domain-prefixed names; old get_* names removed with no aliases.",
} satisfies ChangelogEntry;
