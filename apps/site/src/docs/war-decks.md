---
slug: war-decks
title: "War decks"
description: "How Elixir answers which four decks a player should field in Clan Wars and what to upgrade for better ones: a deck as its eight cards, the player's own duel rounds, the reductions, the value and its parts, the exact search, and single upgrades priced by re-packing the set."
section: record
order: 19.7
navTitle: "War decks"
icon: layers
lede: "Four decks, thirty-two cards, chosen exactly from what this season's players played, and what to upgrade to make them better."
---

# War decks

## Deck sets

Clan Wars asks a member for four decks with 32 distinct cards, and a card
and its Evolution or Hero form are the same card (the tower troop is not
one of the 32). `battles_deck_sets` answers "which four should I play"
from the record rather than a guess: it reads the decks this season's
recorded players played, keeps the ones the player can field, values
each, and packs the best sets exactly.

A deck here is its eight cards. Clan Wars battles carry no tower troop
(the API sends none on a war battle), while Trophy Road and Path of
Legends battles do, so the same eight cards are several `deck_hash`
values in the record: every one's record pools into the deck's
(`variants` lists them, most played first, and `deck_hash` is the
first). The player's own Clan Wars duel rounds count too: a duel is one
battle with up to three games, each game its own deck, so each round is
a game on its eight cards, won or lost by that round's crowns
(`your_duel_rounds`, and `modes.war.your_duel_rounds`). A war deck the
player plays only in duels is a candidate like any other.

The reductions, in order:

| Step | What it keeps |
| --- | --- |
| The season's decks | eight cards with `min_battles` decided battles over Trophy Road, Path of Legends and Clan Wars and `min_players` repeat players in one of them, or that the player has played five or more times this season (duel rounds included), or a locked deck |
| The caller's shape | no `exclude_cards`, none of a locked deck's cards |
| The player's collection | every card owned (`candidates.not_owned` says how many fell out, and `candidates.one_card_short` names the cards whose absence alone keeps the most decks out); a deck played with an Evolution or Hero form the player has not unlocked stays, played with the base card (`forms_substituted`; still `fit.fieldable`, with `fit.exact_form` false) |
| The player's levels | no card more than four levels under the level they field now, `fit_for.target_level` (`below_level`); above that floor the gap is priced, not refused |

Each remaining deck is valued in log-odds, and every part rides the row
(`value`):

- **corpus_logit**: its record over Trophy Road, Path of Legends and Clan
  Wars (`modes` carries each). Each mode's rate is pulled toward that
  mode's corpus mean as the meta tools' rates are (the formula is on the
  [methodology](/docs/methodology) page; `priors` carries the means), and
  a Trophy Road or Clan Wars rate is
  corrected for its players' level edge (`mean_level_gap`) at 0.5
  log-odds per level, the effect measured on the corpus in both modes.
  Path of Legends equalises levels, so its rows are not corrected. The
  modes are pooled by battles.
- **level_term**: 0.5 per level the player would field the deck above or
  below their target level.
- **form_term**: for each card played as a form the player has not
  unlocked, minus that card's measured form advantage this season (its
  form's rate against its base form's over every mode, in log-odds, never
  a bonus); a card whose forms are too thin to measure takes the season's
  median (`measured: false`).
- **familiarity_term**: 0.05 when the player has played these eight cards
  five or more times this season, a tie-break for a deck they know.

A set's value is its decks' values plus the weakest deck's again, locked
decks included, so a set is never carried by three strong decks and one
weak one: every war day asks for all four. The search is exact (branch
and bound over the best 1,500 candidates); `search.exhausted` false says
it stopped at its budget. When the defaults find no set, the candidates
are widened once (`min_battles` 5, `min_players` 2, no level floor: the
gap is priced by `level_term` and each deck's `fit.lowest_card` shows its
weakest card) and `applied` says so. When no whole set exists even then,
`partial_set` is the best set of fewer decks that does, so the answer is
never a dead end. `alternatives` returns more sets, each differing from
every earlier one in at least two of the decks the search chose, and
`near_misses` names decks worth at least the first set's weakest that it
gave up, with the cards they share with a chosen deck.

Shape the set in conversation: `lock_decks` keeps decks (a `deck_hash`
from `battles_decks`, `battles_meta_decks` or an earlier answer; any
variant names the same eight cards) and fills the rest, so "a different
last war deck" is the other three locked; `exclude_cards` keeps cards
out; `require_cards` puts cards in. The arguments are settled before any
search: a card both required and excluded, a required card the player
does not hold, and locked decks that share cards are refused, naming the
cards. `locked_decks` echoes every locked deck with its fit, so a locked
deck the player cannot field says so. A value is an ordering, not a
forecast: a deck's record is its players', and pilots differ.

## Deck upgrades

`battles_deck_upgrades` is the other half of a war set: not "which four
can I play" but "what should I upgrade so my four get better". It starts
from the player's best set today (the same card sets, values and exact
packing as `battles_deck_sets`, over the decks the player owns every card
of, with no level floor: the gap is what an upgrade closes) and prices
single upgrades:

- **a card raised** toward the level the player fields (`to_level`, at most
  `max_levels` at a time), for every card below that level in a deck that
  could join the set;
- **an Evolution or Hero form unlocked** that a candidate deck plays, which
  takes that card's measured form price off every deck that uses it.

For each option the set is re-packed exactly and `gain` is its value after
minus before, in log-odds: the change in the same set value `battles_deck_sets`
optimises, never a score of its own. `lifts` names the decks of the set
whose value it raises, `set_changes` says whether the upgrade changes which
decks the set holds, and `set_after` shows the set it gives.
Options are priced one at a time and do not add up: take the first, then
ask again. Levels, not gold: the game's upgrade costs are not in the record,
and a card the player does not own is never an option.

One card raised rarely moves a deck whose every card sits two levels under,
so `within_reach` lists the decks outside the set that would join it once
their low cards reach the fielded level: each card at most `max_levels`
under, `raises` naming every card and its levels, `forms` any Evolution or
Hero form it plays that the player has not unlocked, `levels` the total,
and the same `gain` and `set_after`.
