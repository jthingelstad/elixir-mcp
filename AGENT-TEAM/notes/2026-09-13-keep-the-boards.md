# Keep the Boards — 2026-09-13

Preflight at 2026-09-13T10:20Z was mutation eligible: public status had a
175-second-old fetch and admission, DLQ 0, and 1,707 battles in the last hour.
`jamie` identity is `999153317627`; the authorized read-only `{stats:true}`
receipt counted 537 active recordings and 2,581 `rankings_pol` receipts.

Recorded-board reads: global, US and Japan snapshots were respectively
2026-09-13T10:07:54Z, 10:07:48Z and 10:03:29Z; all were daily-cadence,
untruncated snapshots (global: 1,000 entries). This is six days after the
2026-09-07 season roll, so the three-day small-board/held-collection boundary
check was not applicable.

The first authorized sync exposed two client defects: a 500-place global page
breached the door's 48 kB result cap, and clan collection members arrive as
`clan_tag`, not `player_tag`. US (+59/-57), Japan (+82/-16), and clans (+10)
updated before the global failure; the repaired client paginates at 100 and
recognizes `clan_tag`. Its next full sync reported +0/-0 for global, US, Japan
and global-top-10-clans. No collection was skipped or collapsed.

Focused receipts: `node --test clients/boards/boards.test.mjs
services/migrate/test/migrate.test.mjs` passed (28 tests), and a live global
100-place read returned 100 players with the 10:07:54Z untruncated snapshot.
The proposed read-only ranking-health `{stats:true}` receipt is covered by its
migrate regression test but has not deployed: `npm run verify` repeatedly
fails only on the existing `services/ingest/test/war.test.mjs` war-key and
boat-battle assertions. Do not deploy past that red canonical gate.

Leaderboard result: the global top 100 turned over 61 players; the other three
board-driven collections held steady after synchronization.
