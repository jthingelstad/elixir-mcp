# Run Elixir MCP — 2026-09-07 04:44Z

Preflight was clean: `main` matched `origin/main`, the checkout lease was
free, and the public status reader was healthy. The live snapshot at 04:41Z
reported a 247-second latest admission, 121 battles in the preceding hour,
zero email-DLQ messages, and an empty ledger (zero queued, leased, or dead
jobs). Ram Rider, Tesla, and Wall Breakers were all active, heartbeating
within 22 seconds; their prior-hour fetch counts were 60, 55, and 12.

The 48-hour probe shows the post-deploy fleet continuously harvesting: the
most recent complete hours admitted 75, 105, 137, and 98 battles from 88,
118, 127, and 131 fetches. The scheduled 07:00Z clan pulse emitted one digest
on 2026-09-06; the five-minute scheduler had zero errors and throttles for
the latest six hours. All 13 stack alarms were `OK`, including estimated
charges ($0.86 against the $40 threshold). RDS is available on
`db.t4g.micro`, has roughly 16.4 GiB free of its 20-GiB floor (100-GiB
autoscaling maximum), low single-digit CPU, and recent PITR at 04:35Z.
`AWS_PROFILE=jamie node infra/scripts/smoke.mjs` passed all OAuth, MCP
refusal, API-edge, and web-route checks.

Watch: capture audit reports 3 known rolling-log gaps across 2,192 eligible
polls in the last 24 hours. The pipeline is fresh and the public aggregate
does not identify subjects, so no cadence change was made from aggregate
evidence alone; Keep the Record True should inspect this data-quality signal
before any source change.

Operational-doc fix: `run-elixir-mcp.md` and the team README now point to the
DB-backed collector health signal. The old per-gateway CloudWatch metrics were
removed by the ratified zero-trust collector door, so retaining them as a
required run check made the objective impossible to execute accurately.
