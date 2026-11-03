# 2026-11-03 — Three alarms

The account keeps CloudWatch alarms only where someone acts on them. The
stack keeps `elixir-mcp-ledger-dead-jobs`, `elixir-mcp-scheduler-missing`
and `elixir-mcp-db-storage`, unchanged, and removes the other 22:
`-collector-errors`, `-collector-latency-p95`, `-db-connections`, `-db-cpu`,
`-db-ebs-byte-balance`, `-db-freeable-memory`, `-discord-undelivered`,
`-dlq-email`, `-dlq-timeline-discord`, `-dlq-timeline-sync`,
`-door-handled-failures`, `-door-throttles`, `-email-compose-failed`,
`-jobs-errors`, `-ledger-oldest-job`, `-mcp-errors`, `-mcp-latency-p95`,
`-scheduler-errors`, `-season-war-id-mismatch`, `-site-certificate-expiry`,
`-war-battle-unresolved` and `-web-api-errors` (all `elixir-mcp-`). They
fed one line of the daily ops digest and nobody acted on them.

The alarm topic and its queue subscription stay (the three alarms and
SES's bounce and complaint events use it). The metric filters and the
scheduler's and jobs' EMF metrics the removed alarms read stay too, for
Grafana's Elixir dashboards; that leaves custom metrics behind no alarm,
which the 2026-09-24 decision rules out, and removing them is a separate
change. `services/mcp/test/infra-controls.test.mjs` now pins the three.
No tool, contract, schema, grant or retention changes.

Authorized by Jamie on 2026-11-03: "Approved: cut CloudWatch alarms to the
~8 listed (backup heartbeat, Release Notes overdue + failed queue, Drop
refresh age, elixir-mcp db storage, scheduler missing, dead jobs) and
delete the rest, one PR per repo". Restore an alarm by reverting this
change.
