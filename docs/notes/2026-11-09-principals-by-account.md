# 2026-11-09 — The agent list reads each agent's own calls (0238)

`GET /api/me/principals`, which Settings reads to list an owner's
agents, ran a p50 of 1.35-5.3 s. For each agent it counts the calls of
the last seven days, the last call, and the address, country and client
it last connected with, all from `mcp_call_audit`, and that table had no
index led by `account_id`: every subquery read the whole call log
(132,340 rows, a 48 MB heap, table census 2026-11-09) once per agent.

- **Migration 0238** adds `mcp_call_audit_by_account` on
  `(account_id, created_at desc)`. On a scratch table of the same rows
  and size it is 5.3 MB and built in 41 ms cached; the micro adds the
  cold read of the heap. Plain `create index` in the ladder, with
  `lock_timeout` 5 s and `statement_timeout` 30 s: reads go on, call-log
  inserts wait for the build.
- **`last_seen`** read every call the agent ever made into four
  `array_agg`s to take the newest of each. Each is now the newest row
  that has it, read from the top of the index (`order by created_at desc
  limit 1`), so a busy agent costs a few rows, not its history. Same values (a tie between two calls stamped in the same microsecond was arbitrary before and still is).
  `services/web-api/test/principals.test.mjs` compares the list with the
  old statement for every principal on a scratch database and checks the
  count can read the index.

No answer, contract or `/api/v1` shape changes; no new metric. Read it
back after the deploy with `npm run web-latency -- --days 1`
(`GET /api/me/principals`).
