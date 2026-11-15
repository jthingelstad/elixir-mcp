# 2026-11-14 — A jobs run fails fast when its database goes away

On 2026-11-12 RDS restarted under a scheduled jobs run (#814). The run
held a bare `pg.Client` with no connect or query timeout, no keepalive
and no `error` listener, so it never learned the connection was gone
and sat to the 900 s Lambda timeout. `elixir-mcp-jobs` has reserved
concurrency 1: for those 15 minutes every scheduled job and the
deploy's own `public-stats` invoke were throttled.

What changed:

- **One factory.** `services/jobs/src/db.mjs` `openJobsClient` is the
  only way a jobs entry point reaches Postgres (all fifteen use it; a
  test fails on a bare `pg.Client` under `services/jobs/src`). It sets a
  10 s connect timeout, TCP keepalive (10 s initial delay), the op's
  `statement_timeout` as a startup parameter (it wins over the
  function's `PGOPTIONS`), and a client `query_timeout` 5 s past it. The
  server cancels a slow statement first, as an ordinary 57014 error;
  the client timer fires only when the server has stopped answering.
- **Aborting the run.** A client `error` (the socket died), a query the
  server never answered, or the run's deadline aborts the run: every
  connection it opened is destroyed, later queries reject, and the
  invocation fails with `jobs_db_aborted: <op>: <cause>` (also logged
  as `jobs_run_aborted`). `end()` is bounded at 2 s, since a goodbye to a
  dead peer never completes.
- **A deadline per run.** The handler runs each event through `runJob`,
  which settles by the deadline whatever the run is waiting on (a
  database answer or an S3 call). The deadline stays 30 s inside the
  Lambda's own clock. The mail runs read it as their clock
  (`runRemainingMs`) instead of the Lambda's, so they stop taking
  recipients 90 s before it and the async retry carries on, as before.

Limits, per op (`JOB_LIMITS`; a combined event takes the widest):

| Ops | Statement | Run | Why |
| --- | --- | --- | --- |
| `collector_upgrades`, `feedback_answers`, `discord_sittings`, `home_feeds` | 30 s | 240 s | every minute or five; each statement reads or stamps a few rows. These are the runs that held the slot on 11-12 |
| `sweep_operational`, `sweep_fleet`, `newsletter_sync`, `clan_evaluate` | 60 s | 300 s | indexed deletes and small reads; the slowest recorded, the `viewer_ip` scrub, was 1.6 s at p50 before 0230 gave it an index (`2026-10-21-heavy-statements.md`); Clan's record reader budgets its own reads at 15 s |
| `retention_trim` | 90 s | 300 s | its batches set 20 s and 60 s locally and the run stops itself at 120 s |
| `email` kinds | 60 s | 600 s | many short statements; a long run stops itself and retries |
| `sweep_payloads`, `public_stats`, `capture_efficiency`, `shape_census`, `archetype_stamp` | 300 s | 600 s | whole-table analytics and the payload sweep's anti-join: the 300 s the function's `PGOPTIONS` has always given them, so nothing that runs today is cut off |

The jobs log was not read for this change (no production reads from
the session that wrote it), so the heavy ops keep the existing ceiling
rather than a guessed tighter one; a dead connection there is caught at
305 s, and the run at 600 s, against 900 s before. Tightening them from
the log's longest statements is #1041.

`services/jobs/test/jobs-db.test.mjs` drives a server that accepts and
never answers, a connection that goes silent mid-run (a TCP proxy that
stops passing bytes without closing), one reset mid-run, a run stuck
past its deadline, and a healthy run keeping its op's limit; each
failing case ends in about a second with an error naming the op.

No schema, contract or JSON API change; nothing a player sees.
