# 2026-10-21 — The stats snapshot reads one snapshot, and is exact as of its as_of

`2026-10-21-stats-migration-guard.md` made the hourly stats refresh
count its fetch series in full once a migration has been applied. Codex
pointed out on #636 that, under read committed, a migration could still
commit between the refresh's ledger read and its recount. The payload
then mixed two instants, under an `as_of` (the time of the write) later
than both.

The refresh now runs every read in one `repeatable read read only`
transaction (`refreshInOneSnapshot` in `services/jobs/src/public-stats.mjs`).
Its `as_of` is that transaction's instant. A migration that lands during
the refresh is invisible to it, ledger row and deletion alike. The
payload is the record exactly as it stood at `as_of`, and the next
refresh sees the ledger move and counts in full. The write follows the
read transaction and never replaces a stored snapshot newer than its
own, so a slow refresh cannot overwrite a later one.

`services/jobs/test/public-stats.test.mjs` commits a receipt-deleting
migration from a second connection right after the refresh reads the
ledger. It requires the payload to equal the record before the
migration, with an `as_of` before the commit, and the next refresh to
count in full. Under read committed the test fails. A second test
covers the older-never-replaces-newer write.

No migration, contract or JSON API change (MCP 11.13.3, JSON API 3.2.1).
No tool reads the snapshot, so the deploy runs no acceptance family.
