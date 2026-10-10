# 2026-10-10 — The roster records a donation reset it sees first

The clan roster writes the same `donations` column on a member's daily
snapshot row as the profile, but only the profile emitted
`donation_reset`. When a roster poll saw the weekly reset before the next
profile poll, it lowered the shared counter silently, and the profile then
compared the new low value with itself: that week's reset moment was lost
(Codex on #261, comment 4175583022).

Both writers now go through one rule in `packages/ingest/src/snapshots.mjs`:
the baseline is the newest **daily** row of either writer observed before
this one (`donationBaselines`; the auxiliary rows stay out, since
`pre_reset` keeps the week's high-water mark), and a fall below it writes
`donation_reset` unless one is already on the ledger with a window ending
at or after that baseline (`donationResetMoment`). So the reset is written
once, whichever poll sees it, and a profile or roster read delivered late
finds the moment already there. The roster emits it under its arena rule:
fresh `api` daily polls only, never a replay or backfill.

`packages/ingest/test/reset-window.test.mjs` pins roster-first, the quiet
clan whose roster sees the reset on the next game day's row, and late and
replayed reads. No migration, no contract change; `donation_reset` is not
a Timeline item, so nobody sees a difference yet. The public recording page
says which observation records it.
