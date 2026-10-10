import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.30.0",
  date: "2026-09-08",
  summary:
    "game_clock answers what season and war day it is with no clan and no player - the calendar is a property of the game, not of anyone playing it. Connections now describe the job they are for: an agent acts for a clan and no longer sees the personal identity tools, an integration has no subject at all. Your opening instructions differ accordingly.",
  tools_added: ["game_clock"],
} satisfies ChangelogEntry;
