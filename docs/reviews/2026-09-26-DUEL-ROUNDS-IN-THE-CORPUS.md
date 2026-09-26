# Duel rounds in the corpus (the rest of feedback #363)

2026-09-26, overnight. A plan for Jamie to approve or change, not work in
flight.

## Where it stands

Feedback #363 (King Thing's agent, 2026-09-26 04:20Z): duels hold as many
war games as the 1v1s do, and a war deck played only in duels is
invisible downstream. What shipped the same night:

- 9.8.0: `battles_deck_sets` and `battles_deck_upgrades` work on card sets
  (a war battle carries no tower troop, so the same eight cards were two
  identities), and the **player's own** duel rounds count as their games.
- 9.8.0: `battles_query` card filters match a duel's round decks.
- 9.9.x: `battles_decks.duel_decks`. 9.10.0: `exclude_decks`.

What did not: **every other player's** duel rounds. `deck_meta_season`,
`card_meta_season` and everything built on them (`battles_meta_decks`,
`battles_meta_cards`, `cards_card`, the deck-set candidates' corpus
records) count 1v1 war battles only, and `battles_cards` reads round 0.
For war that is roughly half the games.

## The shape of the change

1. **Store a round's deck at ingest** (expand, no rewrite). Add nullable
   `deck_hash` and `outcome` to `battle_participant_round` (adding a
   nullable column with no default does not rewrite the table).
   `projectDecks` stops skipping rounds: a round's eight cards hash
   tower-less (`deckHash({ cards })`, the identity a 1v1 war battle
   already has) and get their `deck`/`deck_card` rows. `outcome` is the
   round's crowns against the opponent's in the same round (`win`,
   `loss`, or `draw` when equal).
2. **Backfill as an op**, never a migration. `{duel_round_decks}` walks
   recorded duels by `battle_time` in batches (the cards are already in
   `battle_participant_card` with `round > 0`, the crowns in
   `battle_participant_round`), writes the deck rows and the two columns,
   and reports a cursor so a timed-out run resumes. The census rule
   stands: migrations never rewrite big tables (the 2026-09-15 incident).
3. **The rollup reads rounds beside the population.** A second population
   table, `meta_season_pop_round` (season_month, game_day, battle_id,
   player_tag, round, deck_hash, outcome, battle_time, type), filled by
   the same day-sealing loop, `mode_group` always `war`, `level_gap` null
   (a round has no per-side level stamp; the 1v1 war rows keep theirs).
   The deck and card aggregates take `pop union all pop_round` for the
   `war` and `all` groups, and each row gains `duel_rounds` (how many of
   its battles were rounds), which is the war 1v1 / duel-round split the
   feedback asked for, without a new mode group.
4. **Tools, then docs.** `battles_meta_decks` and `battles_meta_cards` in
   war count rounds, with `duel_rounds` on each row and a note;
   `cards_card` the same; `battles_cards` reads rounds with their own
   outcomes; `battles_deck_sets` drops its own-rounds special case (the
   corpus now has them, so keeping it would count the player's rounds
   twice). Contract minor; the war docs page says what a game is.

## What needs a decision

- **Count rounds as war games in the corpus meta** (#363 asks for it).
  The alternative, rounds only on the player's own surfaces, is what
  shipped tonight.
- **Round order as deck slot** (#363 item 4). Unverified: whether round 1
  is always the player's first war deck. Check it on the record (a
  player's round-1 decks across their duels) and in cr-agent-api-docs
  before naming "deck 1-4" anywhere.

## Risks

- **The nightly rollup's time.** It was 495 s on 2026-09-19 and heading
  for the 900 s Lambda ceiling (interface review); rounds add rows.
  Measure one day's `pop_round` fill before the first nightly, and keep
  the per-day sealing so a night never rebuilds the season.
- **A deck identity per round** grows `deck` by the number of distinct
  round decks not already played 1v1 in war. Most are (the tower-less
  identity is the war identity), so the growth should be small; the
  backfill op reports it.
- **Draw rounds.** Rare; kept as `draw` and left out of decided counts,
  as 1v1 draws are.

About two sessions: ingest and backfill (with Jamie around for the op),
then the rollup and tools with an acceptance deploy.
