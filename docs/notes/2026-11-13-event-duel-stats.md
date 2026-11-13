# 2026-11-13 — An event duel counts its games in every battles tool

MCP 13.1.0 (an addition: `duel_decks[].mode`). No migration, no
`/api/v1` change, no stored data changed.

**The defect.** 13.0.2 taught `battles_query` and the battle page that a
duel is known by its round decks as well as its type. Three readers still
knew it only by `DUEL_TYPES` (the two river race duel types), so a battle
the API sends `rounds[]` for under another type (an event's multi-deck
mode, `Competitive_Multideck`, comes as `trail` with an event tag) was
read as one battle with no deck:

- `battles_decks` counted it under `excluded.no_deck` and listed none of
  its round decks in `duel_decks`;
- `battles_performance` counted it as a head-to-head battle, so its
  summed crowns (up to 9) entered `three_crown_rate`;
- `battles_cards` (through `PARTICIPANT_GAMES`, contracts'
  `duelGamesSql`) expanded only river race duels into games, so its cards
  were counted nowhere.

**The fix: one rule, at the source.** `packages/contracts/src/modes.ts`
now holds THE duel rule for every reader: `isDuelBattle(type, hasRounds)`
in JS and `duelSql(typeCol, battleIdCol)` in SQL, a duel by river race
type or by stored round rows. `DUEL_TYPES` stays as the type half and no
reader uses it alone. `isDuel` (battles common), `battles_query`,
`versusOf`, `elixirOf` and the battle page call the JS rule, and
`battles_decks` and `battles_performance` the SQL one. `duelGamesSql`
expands a row's round rows whatever its type (the join is the rule: a
battle has round rows only when the API sent `rounds[]`).

**Modes stay apart.** `duel_decks` groups by deck AND mode group and
names the `mode` on each row, so an event's round decks are event games
and a river race duel's are war games, never one row. `battles_cards`
already split its games by the battle's mode group. War stays weekly
aggregates only; no war surface changed.

**Second derivations.** The syndication story facts read
`participantGamesSql` and now see an event duel's games under `event`,
which their mode list leaves out. The Stats Decks tab passes a mode per
read, so an event duel's round decks appear under Event. The timeline
already read round rows by battle. Clan's scout counts a duel's decks by
`/Duel/` on war rows only, which is right for war.

**Open, not changed here.** Ingest's `outcomeFor` still decides a duel by
games won only for `riverRaceDuel*`; an event duel falls to trophy change,
then summed crowns. How the game decides an event multi-deck duel (by
games or by crowns) could not be verified against the live API: the only
battle log this change could read held no such battle, so neither the
reference nor `outcomeFor` changed (#954). Correcting stored
outcomes, once the rule is verified, is an ops backfill over
`battle_participant` rows whose battle is not a river race duel and has
round rows: recompute games won from `battle_participant_round.crowns`
against the other side's same round, and update `outcome` where it
differs, then refresh the rollups those outcomes feed.

**Tests.** `packages/tools/test/event-duel-games.test.mjs` runs the real
fixtures (a Colosseum duel and an event multi-deck duel for one invented
player) through the pipeline and the three tools; `games.test.mjs` pins
the rule and `duelGamesSql` without a type list. Acceptance
`battles_decks-duel-modes`: each mode's `duel_decks` rows name that mode,
and `battles_decks.excluded.duels` equals `battles_performance`'s
`duel_battles` over the same window.
