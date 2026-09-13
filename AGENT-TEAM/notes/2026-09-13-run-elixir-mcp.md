# Run Elixir MCP — 2026-09-13

## Collector efficiency metric — deployed

- **Evidence:** At 05:42Z, CloudWatch recorded 41,170 collector lease calls
  and 9,933 submits in the preceding 24 hours. An admitted fetch necessarily
  needs one of each, so the Admin table's old `door_calls_hour / fetches`
  display made its claimed perfect 1.0 score unreachable.
- **Repair:** `e1a5cb3` normalizes the display against the required lease and
  submit pair, adds a 504-call / 252-fetch UI regression, and ships the
  explanation in What's New and `docs/NOTES.md`.
- **Acceptance:** `npm run verify` passed; `main` was pushed and the
  `elixir-mcp` stack reached `UPDATE_COMPLETE` at 05:48:42Z. The public update
  page served the new explanation. At 05:49Z, status remained green: five
  active collectors, 87-second fetch/admission freshness, 817 battles/hour,
  zero DLQ/dead jobs.
- **Watches:** Retain the legacy `config.poll` fallback until a named Python
  release tolerates its absence and fleet acceptance proves it. Capture audit
  is 97 gaps in 4,961 rolling-day polls and remains with Keep the Record True.
