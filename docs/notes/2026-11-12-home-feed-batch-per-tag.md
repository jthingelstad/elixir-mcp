# Home's batched player reads: one per tag, on each player's index

2026-11-12, a fix to G1 (`2026-11-12-home-feed-pages.md`).

G1 read every player of a feed in one statement per kind of read
(`player_tag = any($1::text[])`) instead of seven statements a player. After
the deploy, `{explain_timeline}` for an account with 52 players over seven
days ran past the op's 120 s statement timeout inside `prefetchPlayers`.
The planner flattened the array into one join over everyone's week and
probed the player index once for the whole array; each player alone takes
milliseconds on `battle_participant_player_time_cover`.

`prefetchStatements` now runs each player's own statement once per tag:
`unnest($1) with ordinality` cross joined to a lateral of the single-player
statement, fenced with `offset 0` so the planner cannot flatten it. Still one
round trip a kind, each tag a probe of its own index, rows identical to the
player's own statement, in the tags' order.

- `packages/tools/test/prefetch-plan.test.mjs` pins it on session-local
  tables of 3,000 players: one probe node with one loop per tag, no scan of
  `battle_participant` and no hash, for both bases, and rows equal to each
  player's statement alone. The old `any()` form fails it (one loop, not 53).
- `{explain_timeline}` now also returns the plans (not run) of the batched
  wide and late reads when there are two or more players, and returns them
  with the error when the read itself times out.

No product change: Home's feed shows what it showed.
