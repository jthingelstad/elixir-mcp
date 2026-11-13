# 2026-11-13 — A duel that is not a river race duel shows its games

MCP 13.0.2 (a correction). No migration, no `/api/v1` change, and no
stored data was lost.

**The defect.** A battle page for an event's multi-deck duel (game mode
`Competitive_Multideck`, mode group `event`) said "The record holds no
deck for this side." on both sides. Its public read carried each
player's three round decks under `rounds` and `deck: null`, and
top-level `games: null`.

**The cause.** Not the data layer refactor (0255 to 0258). Ingest has
always stored any battle the API sends `rounds[]` for as one battle with
round rows (`battle_participant_round`: each game's cards, crowns,
towers and leak), whatever its type. But `battles_query` read the round
results only for `isDuel(type)`, which is `/^riverRaceDuel/`
(dd5d54c0, 2026-09-29, from the 6.16.0 round results), so any other
duel came back with `deck.rounds[]` and no `rounds[]`. The battle page
(db442c0b, 2026-10-01) knew the battle for a duel from its round decks,
built `games` only from `me.rounds`, so it had none, and drew each
player's `deck` (null for a duel) in place of a game's deck. Every duel
of another type has read this way since the page shipped; an event's
multi-deck mode made it common.

**The fix.**

- `battles_query` knows a duel by its type or by its round decks, and
  reads the round results, sums the leak, nulls the differential and
  `vs`, and names the duel note for either (`common.mjs` `elixirOf` too).
- The battle page builds one game per round deck either side played,
  with each side's own result where the record holds one, so a game
  with no kept result still shows its decks. It leads with one `score`
  (`scoreOf`): the games won when they agree with the recorded outcome,
  else the crowns with `unit: "crowns"`. The page, the shared post, the
  link preview and the share picture all print it, so none can say a
  result the record does not hold. The meetings and sitting lists mark
  a duel by its round rows too.
- The web view builds the games from the round decks when a read has
  none (a read cached for an hour from before this change), and says
  "The record holds no result for this game." for a game with no result.

**Tests.** `fixtures/player_battlelog/with_event_multideck_duel.json`
(a tagged `trail` battle with three games); `battle-page.test.mjs` reads
it through the page and `battles_query`, a duel whose round results are
blank, and a 1v1 side with no cards (the only case the no-deck line is
for). `apps/web/test/battle-duel-decks.test.jsx` renders the read shaped
as production served it. Acceptance `battles_query-duel-games` fails any
row with round decks and no `rounds[]`.

**Open, not changed here.** Ingest decides a duel's outcome by games
won only for `riverRaceDuel*`; another type with rounds falls through
to trophy change, then summed crowns. Whether an event's multi-deck mode
is decided by games or crowns is not documented in
`cr-agent-api-docs`; the page's `scoreOf` never contradicts the stored
outcome either way. `battles_decks` and `battles_performance` count
duels by `DUEL_TYPES`, so such a battle is excluded as having no deck
rather than listed with its round decks.
