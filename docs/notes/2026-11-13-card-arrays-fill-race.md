# 2026-11-13 — The card-array history fill never overwrites ingest

Codex, reviewing #916, found a race in `{card_arrays}` (0255). No
migration or contract change.

**The race.** A fill update builds a participant's arrays from the card
rows as they stood when its statement started. Suppose ingest is
enriching the same participant at that moment:

1. Ingest holds the participant row's lock, has changed a card row and
   filled the arrays.
2. The fill waits for that lock.
3. Ingest commits, and the fill writes its stale arrays over the ones
   ingest just wrote.

IS DISTINCT FROM did not stop this. The census would then fail, and
running the fill again could not repair the row, because the fill
selects only rows that are still null.

**The fix.** The fillers in `packages/ingest/src/card-arrays.mjs` take
`unfilledOnly`, and the history fill always passes it. The option adds
"the target is still null" to the update's WHERE clause. Postgres
re-checks that clause against the newest row version after the wait, so
a row that ingest filled in the meantime is skipped. This holds for
participants, rounds and decks.

Ingest needs no guard. It locks the owning row (the participant upsert)
before it writes any card row, so two ingests of one participant run one
after the other, and the second reads the first's committed rows.

**The test.** `services/migrate/test/card-arrays.test.mjs` runs the race
on two connections. Unguarded, the fill writes one stale row and the
census counts it. Guarded, the fill writes nothing and the census passes.
