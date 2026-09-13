# Run Elixir MCP — 2026-09-12

## Collector configuration compatibility — accepted

- **Finding:** released Python 2.0.30 collectors threw `poll error: 'poll'`
  on every loop after the door's check-in transition removed `config.poll`.
  The public pipeline was green, but three collectors carried all work and the
  two Python gateways had become `draining`.
- **Repair:** `21ccc5f` restores the historical fallback object in the door,
  adds a response-shape regression, corrects the operator guide and records
  the compatibility behavior in What's New. `npm run verify` passed and the
  CloudFormation stack reached `UPDATE_COMPLETE` at 01:46Z.
- **Acceptance:** both affected gateways were recovered only after the server
  fix deployed. Public status then reported five active collectors, 23-second
  fetch/admission freshness, 702 battles in the previous hour, and zero DLQ or
  dead jobs. The local Python collector admitted seven fetches in its first
  minute.
- **Cost/doors:** all 15 Elixir alarms are OK; OAuth discovery served. The
  RDS `db.t4g.micro` is available with 20–100 GB autoscaling. Over the reviewed
  day, freeable memory averaged about 103–150 MiB and swap fell from roughly
  60–70 MiB overnight to 17–27 MiB later in the day. The latest estimated
  monthly charge was $20.50; the web API recorded 0 errors in the latest daily
  period.
- **Watch:** retain `config.poll` until a named Python release tolerates its
  absence and fleet acceptance proves it. Do not treat a source release alone
  as permission to remove the server compatibility path.
