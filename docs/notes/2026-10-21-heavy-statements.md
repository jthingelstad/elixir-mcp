# 2026-10-21 — The status page and the stats snapshot stop reading every receipt

The platform review (2026-10-21, §2 and §3) asked for `/api/public/status`
to be served from an hourly snapshot and for four recurring statements to
come off the micro. `{profile_read}` (`2026-10-21-profile-read.md`) and
the Postgres slow log and `pg_stat_statements` showed where the time went:

| Statement | Before | Cause |
| --- | --- | --- |
| status `latest` | 4,838 calls, mean 282 ms, 41.7M blocks read: the largest reader in the database; 701 ms and 18,029 blocks in the 10-21 profile | `max(fetched_at) filter (where admission = 'admitted')`: Postgres takes the index shortcut for a plain `max`, never a FILTERed one, so it read the whole table |
| status collectors | 50 runs over 1 s (p50 3.6 s), all 10-15 to 10-17 | the LATERAL per collector chose its own walk; on those days it walked each collector's history |
| stats fetch series | 186 runs over 1 s (p50 1.7 s, max 7.9 s); 1,597 ms, 17,837 blocks | every hour, every day of `api_receipt` counted again |
| stats totals | 185 runs over 1 s (p50 1.9 s); 887 ms, 572 of them `player_snapshot_daily` | about 14,500 rows in 69 MB of heap after the October deletions, counted by reading the heap |
| `viewer_ip` scrub | 110 runs over 1 s (p50 1.6 s) | each hour it walked every call older than 30 days, long since cleared, to find the hour still holding an address |

What changed:

- **Status, live, no snapshot.** The only expensive status read was
  `last_admit_s`, a freshness counter that has to stay live, and the
  public docs promise "live counts" (`protocol.md`). So the status page
  is not snapshotted: `latest` is two plain `max()` subqueries, one with
  a WHERE, which walk `api_receipt_fetched` backwards (6 blocks, not
  8,081, on a local copy); the collectors' 24-hour aggregates are one
  CTE over the same index's last day, joined to each gateway. Every field
  stays live and exact, with the same names and meaning; the door keeps
  its 60 s cache header. `packages/tools/test/public-status.test.mjs`
  runs the old and new statements in one snapshot and requires the same
  rows, and pins both plans to the time index.
- **Stats fetch series, by day.** Receipts are only inserted (`fetched_at`
  and `gateway_id` never change; nothing at runtime deletes one), so the
  hourly snapshot recounts only the UTC days the new receipts reached and
  keeps the earlier days. Which receipts are new is told by `receipt_id`
  against a mark at least an hour older than the last refresh, which
  covers a receipt still in flight then. It counts in full, as before,
  when there is no such mark, when `api_receipt`'s delete counter moved,
  when the backfill collector set changed, and once a day regardless. The
  bookkeeping is a new column, `public_stats_cache.state` (0231), never
  served. `services/jobs/test/public-stats.test.mjs` checks each path
  against a full count, including a late receipt and a delete.
- **Indexes.** 0230 `mcp_call_audit_viewer_ip_held`, a partial index on
  `created_at` where `viewer_ip` is not null, so the scrub reads only the
  rows it clears. 0232 `player_snapshot_daily_day` on `snapshot_date`, so
  the snapshot count is an index-only scan of a fresh index (19 blocks
  against a 4,949-block heap scan on a local copy with the same sparse
  heap). Each is its own migration with `lock_timeout` 5 s.
- `{profile_read}` `public_stats` runs `refreshPublicStats` from the
  stored row, as the job does, read-only; `summary.fetches_recounted`
  says whether the next run counts in full (`all`) or from which day.

Every count stays exact; no answer changes. No tool serves these reads,
so the deploy runs no acceptance family: `public-status.mjs` and
`public-stats.mjs` are imported only by the public door, the jobs Lambda
and the migrate ops. Migrations 0230 to 0232; no contract or JSON API
change (MCP 11.13.3, JSON API 3.2.1).

Not done here: `battle` (138 MB heap, about 92,000 rows) and
`player_snapshot_daily` are mostly empty pages since the October
deletions. Only a table rewrite gives them back, which needs a write op
and a window; it is not part of this change.
