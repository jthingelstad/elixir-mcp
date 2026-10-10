import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.20.0",
  date: "2026-10-02",
  summary:
    "Elixir stops autonomous leaderboard capture and elite-player enrollment. Personal profile ranks and requested player/clan recordings remain. Ultimate Champions and Card of the Week have ended; sent-email history remains available. Existing global history awaits a reviewed purge.",
  breaking:
    "Live leaderboard requests now refuse with live_unavailable. Raw leaderboard paths are removed from live_fetch. Historical ranking tools remain temporarily readable pending removal.",
} satisfies ChangelogEntry;
