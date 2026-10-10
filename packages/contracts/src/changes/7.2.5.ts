import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.2.5",
  date: "2026-09-24",
  summary: md(
    "Cards, players and clans after the pre-beta Gym pass (feedback #324-#336).",
    list(
      'A card name shared with a tower-troop catalog entry resolves to the deck card: "Archer Queen" had found an unused tower entry and answered that nobody plays or holds the champion. "Evo Witch" and "Hero Knight" name the card on cards_card and cards_synergy, as cards_archetype already read them. A tower-troop cards_card no longer suggests fit_for or decks[] (#324-#326).',
      "`players_summary` says when the record captured less than 80% of the play the profile counter saw in its 30 days, and serves `last_30_days.capture` and `last_30_days.boat_defenses` (the counts include defenses, which clans_standings leaves out) (#328, #330).",
      "`players_profile.snapshot.progress` marks each bucket `current`; ended buckets are said to be final readings, not the player's standing now (#329). The season-roll note says the seasonal Trophy Road and Path of Legends reset while Trophy Road trophies carry across (#331).",
      "`clans_members_timeline` compact takes the week's pre-reset read into the donations delta (#333). The joined-after-the-window note uses the same current-stint rule as the rows beside it and counts battles played for another clan (#334). The departed-donations note is capped: distinct leavers, not back since, three named, three days (#335).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
