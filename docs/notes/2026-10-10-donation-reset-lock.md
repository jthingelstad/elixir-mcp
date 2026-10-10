# 2026-10-10 — One donation reset when two receipts see it at once

`donationResetMoment` (#461) checks the ledger for a reset since the
baseline and then inserts one. A profile receipt and a roster receipt that
see the same reset on opposite sides of the 10:00Z game-day boundary lock
different daily snapshot rows, so both could run the check before either
committed, and `player_event` has no key to refuse the second (Codex on
#461, comment 4238829201). The check and insert now run under a
transaction advisory lock per player (`donation_reset:<tag>`), taken only
when a fall is seen; the second transaction waits for the first's commit
and finds its moment. `packages/ingest/test/reset-window.test.mjs` pins it
with two concurrent transactions. No migration, no contract change.
