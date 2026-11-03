# 2026-11-03 — A sitting's trophy net by mode

Feedback #381 and #382 (the POAP KINGS Discord agent): a ranked sitting's
`session_standout` said `trophy_net` 0 while `battles_performance` over
the same window said `net_trophies` 150 and 180. Both were right.
`sessionsOf` sums `trophy_change` on `ladder` battles only (Trophy Road,
`PvP`), and `battles_performance` sums every battle that reported one:
Trophy Road, Path of Legends (`ranked`) and the seasonal Trophy Road past
14,000 (`trail` with an event tag, so `event`). Nothing on the item said
which.

`sessionsOf` now also keeps `trophy_net_by_mode`, keyed by mode group, for
every group with a battle that reported a numeric `trophy_change`, and the
sitting's facts carry it. `trophy_net`, `trophy_net_peak`, the trophy
rungs and the clan entry's standouts are unchanged: which sittings stand
out is a product rule, and this change only says what each one moved.
`battle_session` goes to schema 3 and `session_standout` to 4.

#382 also asked about `arena_changed` arriving at `evidence.status`
`unknown` and again, proved, at revision 2. That is the documented growth
of one story (id stays, revision advances), already in `/docs/timeline`;
the answer says how to act on it. No change to when items are served. The
timeline page sits at the `elixir_docs` result cap, so two of its
sentences were tightened to make room for the new key.

MCP 11.15.0 (additive). No schema, migration or JSON API change.
