import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.20.0",
  date: "2026-09-23",
  summary: md(
    "The badge tools, after the Elixir Gym's first run on them (feedback #91-#94).",
    list(
      "`badges_holders` rows gain `since`: when the record first saw the badge at this level. `observed_at` is now the last profile poll that read the badge, as everywhere else. It used to be the stored change time, so 38 of 46 clan rows read as 17 days stale when every member had been re-read within a day. `observations` on both tools is the oldest and newest profile poll among the players considered.",
      "A versioned identifier says its version in its `label`. `RoyalTournamentRank_v2` is `Royal Tournament Rank (v2)`, and the single holder of the legacy badge no longer reads as the rarest badge in the game. `badges_rarity` notes a versioned pair when it lists both. `2v2` badges read `2v2 League Rank`, not `2v 2`.",
      "`badges_holders` takes a badge's label as well as its identifier. A label two badges share is refused with both identifiers. A miss is refused about the argument, with candidates, instead of 'no recorded player holds'.",
      "`badges_holders` serves `holder_share` (holders_total / players_considered) as its notes promised, and publishes its `outputSchema`.",
    ),
    "Additive: `since`, `holder_share`; `observed_at` keeps its documented meaning.",
  ),
} satisfies ChangelogEntry;
