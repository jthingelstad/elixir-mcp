# 2026-11-25: net_trophies names its unrated Ranked part

Feedback #391: an agent read one Ranked sitting two ways. The Timeline's
`session_standout` carried `trophy_net: 0` and an empty
`trophy_net_by_mode`, and `battles_performance` over the same window
answered `net_trophies: 390` for the same 21 battles.

Both were as built. Below Ultimate Champion, Ranked reports +30 for a win
and nothing for a loss (cr-agent-api-docs `game-modes.md`), so 390 was 13
wins, not trophies won and lost. A sitting has left that out of its nets
since 2026-11-16 (`docs/notes/2026-11-16-modes-in-the-timeline.md`), and
`battles_performance` still summed every `trophy_change` in its sample.
Neither side said so.

## What changed

- `battles_performance` carries `unrated_ranked_trophies` beside
  `net_trophies`, on a window (`window`, `compare_window`, `before`,
  `after`) and on each weekly row: the sum of `trophy_change` over Ranked
  battles below Ultimate Champion. It is always emitted, 0 when the
  window holds none. `battles_compare` carries it on each player's
  `window`.
- A note fires when it is above 0, naming the amount and saying what it
  is: wins only, league progress, left out of a sitting's nets.
- One SQL seam, `unratedRankedSql` in `packages/tools/src/controls.mjs`,
  reads a battle as unrated Ranked the way `sessionsOf` does: the ranked
  mode group, with a league below 7. A row with no league is read as
  rated on both sides.
- `net_trophies` itself is unchanged. No caller's number moved.

## Left open

Whether `net_trophies` should stop counting what is no standing (Ranked's
unrated +30, and the same question for a challenge's win counter) changes
what the number means, which is Jamie's call: #1242.
