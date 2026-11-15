import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.2.2",
  date: "2026-11-15",
  summary: md(
    "A correction: a player's latest snapshot is the newest observation. Each Monday from 00:10Z, when the weekly donation window closes, to the 10:00Z game-day turn, the reads below served the values frozen at the window's last read, because the window's extra row outranked the day's moving row on its name.",
    list(
      "`players_profile`, `players_summary`, `players_collection` (`collection_level`), `players_search` (`trophies`): the newest row of the player's latest day.",
      "`clans_roster`: each member's trophies and donations, roster columns and lifetime block come from the newest row of their kind.",
      "`battles_compare`: each player's topline, likewise.",
      "`clans_series`: a member carried from an earlier day's profile takes that day's newest profile row.",
    ),
    "No field or argument changed. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
