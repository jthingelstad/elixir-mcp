import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "4.2.0",
  date: "2026-09-19",
  summary: md(
    "Badges as a player says them (Jamie, 2026-09-19: the milestone mail read 'MasterySkeletonWarriors (level 5)'; it is Guards Mastery). The API names a badge by Supercell's internal identifier and carries no display name, so every surface that says a badge now carries a label beside the identifier.",
    list(
      '`elixir_timeline`: the `badge_earned` and `legendary_badge_earned` items gain `facts.badge_label` (`facts.badge` stays the identifier `badges_holders` matches on), and their text reads "took Guards Mastery to level 5" or "earned Beating Death".',
      "`players_profile.badges[]` gains `label`; `badges_rarity.badges[]` and `badges_holders` gain `label`.",
      "Mastery badges resolve the card's internal codename to its shown name (`AxeMan` is Executioner, `RageBarbarian` is Lumberjack, `SkeletonWarriors` is Guards); dated badges say the month (`SeasonalBadge_202509` is Season September 2025).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
