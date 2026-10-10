import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.21.0",
  date: "2026-09-06",
  summary:
    "Private player nicknames: elixir_nickname stores YOUR name for a player (account-scoped, never visible to anyone else). players_search matches nicknames and ranks them first - 'tyler' resolves to the player you call Tyler; players_summary and clans_roster carry the nickname alongside the real name.",
  tools_added: ["elixir_nickname"],
} satisfies ChangelogEntry;
