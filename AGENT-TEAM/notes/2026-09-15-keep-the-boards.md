# Keep the Boards — 2026-09-15

Preflight at 10:22Z was observation available and mutation eligible: public
status reported 253-second fetch/admission freshness, DLQ 0, 1,262 battles in
the previous hour, and 7,086 capture-audit polls with 96 gaps. The checked
`boards` lease `c1299c94-a036-40a9-9349-043a3281db49` covered the only live
write, the collection synchronization.

The authenticated, read-only migrate `{stats:true}` receipt returned one
global reset-tick receipt and a 10:07:50Z global Path of Legends snapshot with
1,000 entries and `truncated: false`. It counted 358 active ranking-origin
recordings, which is in the expected top-200-plus-grace range. This is eight
days after the 2026-09-07 season roll, so the three-day small-board,
held-collection and prior-season-presence check is not applicable.

Regional coverage remains the outstanding objective gap: 127 of 262 enabled
locations were fresh within 26 hours and 135 were stale. The same receipt now
attributes 544 natural `rankings_pol` HTTP 404 outcomes in its trailing 24
hours (plus 138 `currentriverrace` and five `player` 404s); the 544 ranked
refusals explain a large share of the missing board receipts without claiming
that every stale location is explained. This is an upstream/result-boundary
coverage watch for Run Elixir MCP, not a reason to alter admission freshness,
the global rate budget or board cadence.

`node clients/boards/boards.mjs` completed without skips or collapse holds.
Its recorded-board reads synchronized all four collections to today's board:
global +39/-39, United States +29/-29, Japan +40/-40, and the global
top-ten clans +3/-3. The global top 100 turned over 39 players; the summit
changed, while all four collections now match their returned recorded boards.
