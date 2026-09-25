---
name: ops
description: Read live Elixir production safely, and find the migrate op that answers a question. `/ops <question>` picks the read (a migrate op, the public status endpoint, Logs Insights, a call capture) and runs it read-only; `/ops <op>` runs one op from the catalogue. `ops.md` beside this file lists every migrate Lambda op with its payload, its question, whether it only reads or WRITES, and who already names it; a test keeps it equal to the dispatcher. Use when asked why a tool is slow, what production holds, where a job, collector, backfill or feedback item stands, or which op to run. It never authorizes a write.
---

# Ops

The production database is private: no psql path reaches it. What
production holds, how a tool's query plans, and why the pipeline did what
it did are read through the migrate Lambda's ops, the logs, the public
status endpoint and the call captures. This skill says how to run each
safely; `ops.md` is the catalogue of every op. Before it, the runbooks
named about a dozen ops and the rest could be found only by reading
`services/migrate/src/lambda.mjs`.

## Invocation

- `/ops <question>` ("why is clans_standings slow for #J2RGCRVG", "what
  is holding the database"): choose the read from "Choosing the read" and
  `ops.md`, run it, and answer with the numbers and where each came from.
- `/ops <op>` (`/ops capture_audit`): read the op's row in `ops.md`, then
  run it with the payload the question needs. Reads need no checkout
  lease; a write op is a proposal until its owner says go (rule 2).

## Rules

1. **Never verify with writes on live data.** Reads and refusal paths only
   (AGENTS.md rule 9). A write op changes production; it is never a check.
2. **A write op needs its owner's authority.** Each write row in `ops.md`
   names it: an objective runbook that grants the op, or Jamie. Without
   it, put the exact payload in your answer for Jamie. A granted write runs
   under the lease its runbook names. The session's permission check can
   refuse a live write anyway (the Gym's `{service_token_limits}`,
   2026-09-23); then hand Jamie the command.
3. **Never manufacture a request to diagnose** (DECISIONS). Read what the
   record holds: receipts, the job ledger, the audit, the captures. Do not
   pass `live: true`, mint a fetch or requeue a job to see what happens:
   it spends the one rate budget, and an error never advances freshness,
   so it shows nothing the next natural poll will not.
4. **Live diagnostics only through migrate ops** (DECISIONS). An EXPLAIN
   runs the exact SQL the tool serves, never a hand-typed version.
   `{profile_tool}` runs the registry's own handler, so it cannot drift;
   `{explain_participation}`, `{explain_standings}` and `{explain_timeline}`
   import the tool's SQL; `{explain_meta}` and `{explain_series}` carry
   copies, and `{explain_meta}`'s has drifted.
5. **One invocation at a time, and no retries.** The function has reserved
   concurrency 1: a second call gets a 429 while the first runs, and so
   does a deploy's migration step. Set `AWS_MAX_ATTEMPTS=1`: on 2026-09-19
   the CLI retried a timed-out synchronous invoke of the jobs Lambda and
   the job ran twice. Never retry a heavy op on a 429.
6. **Heavy reads run once, on purpose.** Rows marked heavy scan a battle
   table or the corpus on a db.t4g.small. Past 90 s an invocation fires
   `elixir-mcp-migrate-duration` and Run Elixir MCP asks who and why, so
   name the run in your report. Thirteen `{probe}` runs in 25 minutes
   preceded the 2026-09-11 RDS memory recovery.
7. **A backfill is not finished until it is vacuumed, and never runs with
   a deploy** (DECISIONS). A bulk write empties the visibility map, so
   index-only scans read the heap until `{vacuum}` runs; a looping
   backfill holds the function, so the deploy's migration step gets a 429
   and the deploy stops (twice on 2026-09-22). The procedure is the
   `migration` skill's.
8. **Only `{}` migrates.** A payload with no known key, a misspelt op or
   `{"stats": false}`, answers `"error": "unknown_op"` and runs nothing;
   until 2026-09-25 it fell through to the migration runner and applied
   anything pending. `{}` is the deploy's call: never send it by hand.
   Copy the key from `ops.md` and pass `true` or an object.
9. **Results stay out of the repo.** It is public, and results carry
   feedback text, email-hash prefixes, tags and people's timelines; every
   op but `{integration}` also logs its result to the migrate log group.
   Quote only what the question needs.

## Running an op

The function is `elixir-mcp-migrate` (`MigrateFunction` in
`infra/template.yaml`, stack output `MigrateFunctionName`): Node 24, 1 GB,
300 s timeout, reserved concurrency 1, in the private subnets with the
database URL and `ARCHIVE_BUCKET`. Confirm the identity first:
`AWS_PROFILE=cloud-engineer aws sts get-caller-identity` shows
`assumed-role/ProjectsCloudEngineer/projects-cloud-engineer`. Take the
payload from the op's row, and invoke once, synchronously.

**Preferred: the AWS MCP server's `run_script`,** sandboxed and audited
(`~/Projects/AGENTS.md`):

```python
result = await call_boto3(service_name="lambda", operation_name="Invoke",
    region_name="us-east-1", params={"FunctionName": "elixir-mcp-migrate",
    "Payload": json.dumps({"stats": True})})
result
```

Check `api_calls` for exactly one Invoke, and `FunctionError` in the
response. The script cannot set the client's read timeout or retries, so
keep it for ops that finish well inside a minute.

**The CLI,** for heavy ops or where the MCP server is not available:

```sh
AWS_PROFILE=cloud-engineer AWS_MAX_ATTEMPTS=1 aws lambda invoke \
  --region us-east-1 --function-name elixir-mcp-migrate \
  --cli-binary-format raw-in-base64-out --cli-read-timeout 300 \
  --payload '{"capture_audit": {"days": 1}}' /tmp/out.json
```

The read timeout matches the function's own, so the CLI waits instead of
retrying. `StatusCode` 200 means it ran; `"FunctionError": "Unhandled"`
means the op threw, with `errorMessage` in `/tmp/out.json`. Many ops
refuse without throwing and return `{"error": ...}`: read the body.

## The other read paths

**The public status endpoint.**
`curl -s https://elixir.poapkings.com/api/public/status`
(`services/web-api/src/routes/public.mjs`, about 60 s cached): the health
verdict, the budget, the job ledger (`queue`, `jobs.dead`), outbox dead
letters, 24 h capture-audit gaps, and each collector by card name with
heartbeat, version, channel, `yield_24h` and `edge_filtered_24h`. Start a
pipeline question here, then `{stats}`.

**CloudWatch Logs Insights.** `/aws/lambda/elixir-mcp-<name>` for `mcp`,
`web-api`, `scheduler`, `jobs`, `migrate`, `email-relay` and `editor`
(30 days); `/aws/rds/instance/elixir-mcp-enc/postgresql` (14 days).
Stamps are UTC; Jamie reads US Central.

- The doors log one JSON line per request: `http` (method and route),
  `status`, `ms`, `request_id`; MCP adds `rpc` and `tool`, web-api
  `connect_ms` and `timed_out`. Per-tool numbers are `{audit_census}`'s.
- The scheduler's EMF line, one a tick (`ElixirMCP/Ledger`), carries two
  metrics behind the ledger alarms, `OldestQueuedAgeSeconds` and
  `DeadJobs`, and plain properties: `QueuedJobs`, `PlannedJobs`,
  `SessionFollowupJobs`, `ReadCappedJobs`, `RequestedProfileJobs`,
  `NotFoundHeld`, `FetchesHour`, `FetchErrorsHour`, `CeilingHour`,
  `Tokens`, `CollectorsActive`, `CollectorsDraining`. For example:
  `fields @timestamp, QueuedJobs, FetchesHour, CeilingHour | filter ispresent(DeadJobs) | sort @timestamp desc | limit 48`.
- Failures log by name: `call_capture_failed`, `audit_write_failed`,
  `output_schema_mismatch`, `db_connect_failed` (MCP),
  `email_compose_failed` (jobs). The migrate group is every op's result.

**Call captures.** The MCP door writes each tool call's request and
response, gzipped JSON, to the archive bucket (`ArchiveBucket`,
`elixir-mcp-archive-<account id>`) at
`calls/dt=<YYYY-MM-DD>/request_id=<id>.json.gz`, keyed by the call's UTC
day (`services/mcp/src/capture.mjs`). They expire after 90 days, and
`mcp_call_audit.captured` says whether one was written. Take the request
id from the response's meta, the audit row or the door's log line; read
the object in the S3 console or with a GetObject
(`aws s3 cp s3://<bucket>/calls/dt=<day>/request_id=<id>.json.gz - | gunzip`).
`{refusal_census}` and `{controls_census}` read many at once. A Gym
finding's capture becomes a bite through `acceptance/bites/fetch.mjs`.

**Alarms.** Every `elixir-mcp-*` alarm publishes to SNS
`elixir-mcp-alarms`, which feeds the sysadmin `projects-ops-alerts` queue
the sysadmin Operator drains daily. No email, no dashboard, and a custom
metric only to back an alarm (DECISIONS: no one reads CloudWatch by hand).
Firing now: `aws cloudwatch describe-alarms --alarm-name-prefix elixir-mcp- --state-value ALARM`.

**The jobs Lambda** (`elixir-mcp-jobs`) has its own payload keys, such as
`{capture_efficiency}` and `{shape_census}`: scheduled product work,
outside this catalogue; Run Elixir MCP names the ones worth reading.

## Choosing the read

| Question | Read |
| --- | --- |
| Is the pipeline healthy? | the status endpoint, then `{stats}` |
| Why is this tool slow for this call? | `{profile_tool}` with `"explain": true`; the tool's `explain_*` op if it has one |
| Which subjects lose battles to capture gaps? | `{capture_audit}` |
| Why was this subject or board not fetched? | `{poll_state}` |
| What are the dead jobs? | `{ledger}` with `"op": "dead"` |
| How do agents use the tools, and where do they fail? | `{audit_census}`, `{args_census}`, `{call_sequence_census}` |
| Which values were refused? | `{refusal_census}` |
| What feedback is unanswered? | `{feedback_pending}` |
| What is the database doing right now? | `{backends}` |
| Where is the database's weight? | `{tables}` |
| Did the series backfill land? | `{series_status}`, `{series_census_self}` |

## Adding or removing an op

An op lands with its row in `ops.md` in the same commit, and leaves with
it: `services/migrate/test/ops-catalogue.test.mjs` compares the keys
`lambda.mjs` dispatches with the rows and fails `npm run verify` on a
difference either way. The op's doc comment states its payload, its
question, and that it only reads or what it writes; the row carries that,
marks a write plainly and names who may run it.
