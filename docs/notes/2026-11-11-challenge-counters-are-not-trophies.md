# 2026-11-11 — A challenge's win counter is not trophies

Feedback #384 (the POAP KINGS Discord agent): a `session_standout`'s
`best_win.opponent.starting_trophies` read like a ladder standing on
event sittings, where it was the challenge's win counter. Read live, a
Classic Challenge row (`trail`, game mode
`Challenge_AllCards_EventDeck_NoSet`) carries `starting_trophies` 1-5 on
both sides and `trophy_change` +1 on the winner; a seasonal Trophy Road
row (`trail`, game mode `Ladder`) carries real trophies (14,120, +30).
Both are mode group `event`, so the echoed `mode` could not tell them
apart.

`trophiesAreStanding(type, event_tag, game_mode_name)` in
`packages/tools/src/controls.mjs` says when the two fields are a standing:
Trophy Road and Path of Legends; war and casual rows (each side's Trophy
Road count); event content only under the Ladder ruleset; never a
`challenge` or `tournament` row (the reference: tournament
`startingTrophies` is the tournament score). `sittingDetails` rates only
those wins for `best_win`, and `sessionsOf` sums only those deltas into
`trophy_net_by_mode`. The win counter was never a rating, so the fix
makes `best_win` what its docs say ("the win over the highest-rated
opponent"); a challenge-only sitting has no `best_win`, as a Classic 1v1
sitting (no `starting_trophies`) already had none. No guard field was
added: once the counter is never rated, nothing beside the value is
ambiguous ("absence over a guess").

Left alone: `battles_query` and the timeline evidence serve the raw row,
`mode_group` and `game_mode` beside it, and `reading-the-numbers` now says
what `starting_trophies` is in an event run. `battles_performance`'s
`net_trophies` with `mode: event` still sums a challenge's +1s with the
seasonal Trophy Road's deltas; that is a separate change.

MCP 11.18.7 (a correction). No schema, migration or JSON API change.
