import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.11.1",
  date: "2026-11-17",
  summary: md(
    "A player's first battle-log read no longer waits for the scheduler when Elixir already has their admitted profile.",
    list(
      "`elixir_follow_player`: adding a player can queue their missing first battle-log read behind a profile that was already admitted in the last day, as well as a profile read on its way. The existing first-read allowances, global rate budget, recording scope and refusal paths still apply.",
    ),
    "A behavior correction. Response shapes and JSON API 5.1.0 are unchanged.",
  ),
} satisfies ChangelogEntry;
