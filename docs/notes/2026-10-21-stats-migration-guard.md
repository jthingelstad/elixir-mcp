# 2026-10-21 — The stats snapshot counts in full after any migration

The hourly stats snapshot keeps the earlier days of its fetch series and
recounts only the days new receipts reached
(`2026-10-21-heavy-statements.md`). It counted in full when
`api_receipt`'s delete counter (`pg_stat_user_tables.n_tup_del`) had
moved. Codex pointed out on #627 that the counter does not prove much:
statistics reach other sessions a second or more after the commit. So a
refresh just after a deletion could keep the deleted receipt in an
earlier day. The next hour, or the daily full count, would have put it
right.

Only a migration deletes receipts, and the migrate Lambda commits each
migration's `schema_migrations` row in the same transaction as its SQL.
The refresh now also records the highest applied migration id and counts
in full when it has changed. A refresh that can see a deletion therefore
also sees that the ledger has moved. The delete counter stays as a guard
for a deletion made any other way. Each deploy that applies a migration
costs one full count, the read every hour cost before #627.

`services/jobs/test/public-stats.test.mjs` deletes a receipt in a
transaction with a ledger row. It then sets the stored counter to the
current value, as a refresh in that second would see it, and requires a
full count equal to counting from scratch. Without the new guard the
test fails.

No migration, contract or JSON API change (MCP 11.13.3, JSON API 3.2.1).
No tool reads the snapshot, so the deploy runs no acceptance family.
