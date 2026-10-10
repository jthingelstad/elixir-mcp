import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.30.0",
  date: "2026-09-23",
  summary: md(
    "The badge tools, after the Elixir Gym's second run on them (feedback #144-#146).",
    list(
      '`badges_rarity` quotes each versioned pair (`RoyalTournamentRank` / `RoyalTournamentRank_v2`) as distinct players holding either, and how many hold both. It used to say to add the two rows, which double-counted a player who holds both. `badges_holders` names the other half of a pair and its count in the same population, so "Royal Tournament Rank" no longer reads as 0 of the top 100 when 73 hold the `_v2` (#144).',
      "On the corpus segment, a note says what `players_considered` counts: every player whose profile the record has read, not only the players recorded now. A holder's `clan_tag` is described as the clan at `observed_at` (#145).",
      'A misspelled badge label is refused with the closest badges by edit distance ("Valkyrie Mastry" suggests MasteryValkyrie), and every miss says `exactly` (#146).',
    ),
    "Notes and refusal text; no value changes.",
  ),
} satisfies ChangelogEntry;
