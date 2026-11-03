# 2026-11-03 — Database storage moves to Dagu

The stack's third alarm, `elixir-mcp-db-storage` (FreeStorageSpace under
2 GiB), is removed. Otto's hourly `check-cloud-metrics` Dagu job (otto-ops,
`config/cloud-metrics.yaml`) watches the same metric as the read-only
`cloud-auditor`. It posts to #needs-jamie when free storage is under the
same 2 GiB, or when a line through the last week of hourly minimums
reaches 2 GiB within 7 days. That line starts again after storage
autoscaling adds space. The job also watches the three dead-letter queues
whose alarms went earlier the same day (any visible message). It posts a
problem once, and once more when it clears.

The stack keeps two alarms, `elixir-mcp-ledger-dead-jobs` and
`elixir-mcp-scheduler-missing`, and `services/mcp/test/infra-controls.test.mjs`
pins them. The account's ten free alarms are a budget shared by every
project.

The 2026-09-24 rule "a custom metric exists only to back an alarm" now
reads "backs an alarm, a dashboard or a Dagu check" (Jamie, 2026-11-03:
the rule predates Dagu and Grafana). That settles the custom metrics the
first cut left behind no alarm.

No tool, contract, schema, grant or retention changes.

Authorized by Jamie on 2026-11-03: "Approved: rebalance alarms to 7 (move
elixir-mcp-db-storage to Dagu, add a Librarian sign-in failure alarm, drop
the poster's critical list so every alarm goes to #needs-jamie) and build
the hourly check-cloud-metrics Dagu job". Restore the alarm by reverting
this change.
