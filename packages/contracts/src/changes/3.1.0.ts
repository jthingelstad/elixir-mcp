import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.1.0",
  date: "2026-09-14",
  summary:
    "Mode-board discovery now works: rankings_players({board: 'mode', location: 'list'}) returns the recorded leaderboard ids, names and enabled state, and an unknown mode points back to that executable discovery call. elixir_changelog now delivers complete history in bounded pages: limit (1..20, default 20), offset and next_offset (null at the end), with total and the unchanged exclusive since filter. Follow next_offset with the same since to reach every release. The live-quota guide derives its tool names from the registry; timeline documentation distinguishes player notables from clan standouts and removes the retired feed retention promise.",
} satisfies ChangelogEntry;
