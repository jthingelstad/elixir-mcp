import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.5.0",
  date: "2026-09-25",
  summary: md(
    "`battles_deck_sets` answers a maxed account. At 9.4.0 a player who fields level 16 got no set: of 889 season decks, 419 were refused for an Evolution or Hero form not unlocked and 334 for a card two levels under, leaving 3. A deck played with a form the player lacks now stays, played with the base card: `forms_substituted` names each card and `value.form_term` subtracts that card's measured form advantage this season (its form's shrunk rate against its base form's, over every mode, never a bonus; the season's median where a card's forms are too thin, `measured: false`). The level floor is four levels under the fielded level, not two: above it `level_term` prices the gap. When the default gates pack nothing, the candidates widen once (`min_battles` 5, `min_players` 2) and `applied` says which answered. `candidates.form_not_unlocked` gives way to `candidates.forms_substituted`.",
  ),
} satisfies ChangelogEntry;
