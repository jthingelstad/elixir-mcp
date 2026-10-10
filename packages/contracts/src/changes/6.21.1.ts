import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.21.1",
  date: "2026-09-23",
  summary: md(
    "Two note wordings from 6.21.0, and the duel repair done.",
    list(
      "`battles_query`'s `vs` note says again that `starting_trophies` is what matchmaking paired on ladder, and the unequal-towers note says the tower levels differ.",
      "The recorded duels are recomputed on games won: 140 duels, 280 player-days of daily totals.",
    ),
    "Wording and data; no shape change.",
  ),
} satisfies ChangelogEntry;
