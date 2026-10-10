import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.8.0",
  date: "2026-09-26",
  summary: md(
    "War decks as their eight cards, duels included (feedback #363 and #364). Clan Wars battles carry no tower troop, so the same eight cards were a Trophy Road `deck_hash` and a separate Clan Wars one, and a deck's war record never pooled with its ladder record; a war deck played only in duels (a duel has no `deck_hash`) was invisible, so a player was told to find a fourth deck they already had.",
    list(
      "`battles_deck_sets` and `battles_deck_upgrades`: a deck is its eight cards; every tower troop's variant pools into its record (`variants`), and the player's own Clan Wars duel rounds count as their games on those cards, won or lost by each round's crowns (`your_duel_rounds`, `modes.war.your_duel_rounds`). A duel-only war deck is a candidate, and can be locked by the `deck_hash` an answer gives it.",
      "`battles_deck_sets`: arguments are settled before any search: a card both required and excluded, a required card not in the collection and locked decks sharing cards (all of them, by name) are refused; `locked_decks` echoes every locked deck with its fit; the set's value counts its locked decks, the weakest twice; `partial_set` and `candidates.one_card_short` answer when no whole set exists; `fit.fieldable` is true when every card is owned, with `fit.exact_form` false for a form played as its base card; candidates are gated on the three competitive modes, not casual play.",
      "`battles_deck_upgrades`: options are priced most promising first (the decks in the set count most), a deck's ceiling keeps cards already above the fielded level, and the pool widens only when no set packs.",
      "`battles_query`: `with_card`, `with_cards` and `against_card` match a duel on its rounds' decks (`with_cards` on one round's).",
      "Attested facts: `member_away.until` may lie ahead (up to a year; an away with an end date was refused); `role_change_made` refuses the same role on both sides; `award_standing.previous_player_tag` is normalised.",
    ),
    "Additive: new fields and wider acceptance; `fit.fieldable` on a form-substituted deck changed from false to true, which is the correction.",
  ),
} satisfies ChangelogEntry;
