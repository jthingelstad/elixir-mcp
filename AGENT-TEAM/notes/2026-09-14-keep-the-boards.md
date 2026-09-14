# Keep the Boards — 2026-09-14

Preflight at 10:19Z was mutation eligible and the public status probe was
healthy: 209-second fetch/admission freshness, zero DLQ messages, 1,388
battles in the last hour, and 7,189 capture-audit polls with 100 gaps. The
authenticated read-only migrate `{stats:true}` receipt at 10:20Z found one
global 10:00Z tick receipt, a 10:07:51Z global snapshot with 1,000 entries and
`truncated: false`, 324 active ranking-origin recordings, and 123/262 enabled
regional locations fresh within 26 hours (139 stale). This is day 14 after the
2026-09-07 season roll, so the small-board, held-collection and prior-season
presence boundary check does not apply.

The boards lease `d30580df-51ce-4ec7-a070-a5eb554ea5c8` was checked before
the one authorized collection sync. `node clients/boards/boards.mjs` completed
without skips: global +41/-41, US +32/-32, Japan +44/-44, and the global clan
top-10 +4/-4. Each collection now equals the board returned by its recorded
read; the early-season collapse guard was not invoked.

The freshness gap is not a scheduler backlog: CloudWatch shows 270 jobs
planned at 10:02Z, 350 successful collector submissions by 10:10Z, no
`submit_ingest_error`, and a zero queued/leased/dead ledger at 10:25Z. A fresh
`{stats:true}` receipt still showed 123 fresh locations and an unchanged 2,836
`rankings_pol` receipts. Because non-OK fetches deliberately create no receipt
and the available aggregate does not expose endpoint outcomes, route the next
check to Run Elixir MCP to inspect the collector/result boundary rather than
claiming an ingest rejection.

Leaderboard result: the top 100 turned over 41 players globally, 32 in the
United States, 44 in Japan, and four of the ten most-represented clans changed.
