# Keep the Boards — 2026-09-19

Preflight was observation-available and mutation-eligible. Its public status
receipt reported 197-second fetch and admission freshness, no DLQ messages,
1,145 battles in the prior hour, and 8,008 capture-audit polls with 117 gaps.
The later public read at 10:18Z remained healthy (34-second freshness, five
active collectors, empty queued/leased/dead jobs).

The authenticated, read-only migrate `{stats:true}` receipt found exactly one
global Path of Legends tick receipt in today's 10:00Z--10:15Z window. Its
global snapshot was observed at 10:07:53Z with 1,000 entries and
`truncated: false`. This is 12 days after the 2026-09-07 season roll, so the
three-day small-board, held-collection, and prior-season-presence checks do
not apply.

Regional coverage remains incomplete: 145 of 262 enabled locations were fresh
within 26 hours (117 stale). The same receipt attributes 640 natural
`rankings_pol` HTTP 404 outcomes in the trailing 24 hours, alongside 158
`currentriverrace` and six `player` 404s. Keep this as Run Elixir MCP's
upstream/result-boundary watch; do not change admission freshness, cadence, or
the global rate budget from this aggregate.

The receipt counted 467 active ranking-origin recordings, above the objective's
approximately-400 alert line. The approved aggregate gives no per-presence
provenance; source inspection confirms the count is backed by seasonal global
top-200 `ranking_presence` rows with the documented roll-plus-three-day
`sticky_until` rule. Treat this as a bounded retention-versus-natural-churn
diagnosis for the next authorized read path, not proof that the recording
policy is wrong.

Lease `1d6f749e-11c7-4b2c-8ff6-f68e5779b937` was checked immediately before
the only write. `node clients/boards/boards.mjs` completed with no skips or
collapse holds: global +54/-54, United States +42/-42, Japan +54/-54, and
global top-ten clans +5/-5. The post-sync `--dry-run --json` receipt returned
zero additions and removals for every collection, proving each equals the
recorded board read at 10:18Z.

Leaderboard result: the global and Japan top 100 each turned over 54 players,
the United States top 100 turned over 42, and five of the ten most-represented
global clans changed.
