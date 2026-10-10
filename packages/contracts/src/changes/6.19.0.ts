import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.19.0",
  date: "2026-09-23",
  summary: md(
    "The war family's `clan_score` is WAR TROPHIES, and now says so (feedback #88).",
    list(
      "`clan_war_trophies` joins `war_current.standings[]`, `war_history.standings[]` and `war_rivals` rows, and `weeks[].our_clan_war_trophies` joins `our_clan_score`. It is the number those surfaces always carried.",
      "The race payload spells it `clanScore`, which is the API overloading the key: a clan profile carries BOTH `clanScore` (~129,000) and `clanWarTrophies` (~1,200), and the race reports the second under the first's name. The same overload is already recorded for the war leaderboard. The docs said this field was \"the same figure a clan's profile shows\" - it is that figure divided by about 108, and the sentence invited a cross-family join that was wrong by two orders of magnitude.",
      "`clan_score` and `our_clan_score` are DEPRECATED aliases of the same number, kept so nothing breaks today and removed in 7.0.0 with the other breaking changes.",
    ),
    "Additive. Verified two ways: the API returns both keys on one clan object, and our own week series rises by exactly each week's trophy_change (980, 1000, 1020, 1040, 1060, 1160 across 135/0-136/0), which a clan score does not do.",
  ),
} satisfies ChangelogEntry;
