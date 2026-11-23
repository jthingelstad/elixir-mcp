# 2026-11-22 — One win rate on every surface

**What was wrong.** `packages/record/src/win-rate-sql.mjs` called itself the
one definition of a win rate (decided wins over decided battles; a decided
battle is a head-to-head win or loss, so boat attacks and draws are in
`battles`, `wins` and `losses` and in no rate). Two readers used it:
`battles_performance`'s window and the stored week form. The rest divided
`wins` by `wins + losses` for themselves, boat attacks included:
`battles_performance`'s `game_mode` and `week` rows, `battles_decks`
(rows and `sort: "win_rate"`), `battles_cards`, `players_summary`
(`last_30_days`, `top_deck`, `best_deck` and its floor), `clans_standings`
(rate, ranking and the `min_battles` floor), Scout's log, and Stats' weekly
chart. So one player's week had one rate in the window and another in the
rows under it, and the public docs (`reading-the-numbers`, "Decided battles
and denominators"; `battles`, "Duels and boat battles") promised the first.

**What changed.**

- Every reader counts with `decidedWinsSql` and `decidedLossesSql` and
  divides with `winRate`. Scout, which reads a live log rather than SQL,
  uses the new `isDecided(outcome, type)` beside them.
- Every row that carries a `win_rate` carries `decided_battles`, so the
  division can be checked from the response.
- `clans_standings` takes its decided counts from the raw rows it already
  reads for crowns (`standings-sql.mjs`, a `rate` CTE): the daily rollup
  does not separate boat attacks, and no migration was needed.
  `players_summary`'s 30 days take theirs from two scalar reads of the
  player's own participant rows.
- Stats' weekly chart draws the week's `win_rate` rather than dividing the
  row's wins and losses again.
- `services/mcp/test/win-rate-one-definition.test.mjs` scans source: no
  wins-over-something division outside `win-rate-sql.mjs`, and every
  `win_rate:` a reader builds is `winRate(...)` or a rate read back.

**Classification.** A correction to documented behaviour plus an additive
field: MCP 15.5.0 (minor). No meaning changed: the definition is the one
the docs and the window already served (feedback #23, 0.39.0 and 0.40.0).

**What moves.** Only rows holding boat attacks or draws. A boat battle
`game_mode` row keeps its wins and losses and has `win_rate: null`. A
member whose battles were lifted over `min_battles` by boat wins is now
`below_floor`. `best_deck`'s floor is five decided battles.

**Left as it is.** `acceptance/bites/*.json` are recorded captures and keep
the old note text until they are next captured. `three_crown_rate` already
had its own denominator (`head_to_head_battles`) and is untouched.

**Product questions raised.** None: the brief and the docs already say what
a win rate is.
