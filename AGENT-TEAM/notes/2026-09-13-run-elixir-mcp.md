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

## Operational review — healthy, bounded collector-door watch

- **Evidence (09:42–09:52Z):** preflight was observation-available and
  mutation-eligible from clean `main`; public status reported five active
  collectors, 277-second fetch/admission freshness, 409 battles in the prior
  hour, empty email DLQ/dead work, and 92 capture gaps in 5,345 rolling-day
  battle-log polls. Migrate `{stats:true}` reported 219 battle-log polls in
  the prior hour, with 6,254 entries filtered before submission and one gap.
  All 15 `elixir-mcp-*` alarms were OK; the stack was `UPDATE_COMPLETE`; RDS
  was available on `db.t4g.micro` with 20–100 GB autoscaling. OAuth discovery
  served 200 and the MCP door returned its expected unauthenticated 405.
- **Collector-door review:** CloudWatch showed a historical burst of 8,554
  unauthenticated and 354 rate-limited lease requests in the preceding 24
  hours, from two already-active collector egresses. It ended without a
  replay, restart, or source change: the final 401 was 01:47Z and final 429
  02:07Z; the eight-hour trailing read contained only 18 401s and 80 429s
  from that finished interval, while all five collectors were later active
  and admitting work. Keep this as a natural watch; do not churn a healthy
  fleet or treat a tokenless historical request as a reason to weaken the
  bearer-token door.
- **Cost and preview:** the preceding-day web-api duration was 4,626
  Lambda-seconds, dominated by normal collector lease/submit traffic; RDS
  FreeableMemory stayed above 88 MiB and swap later settled around 26 MiB.
  The account-wide `elixir-clan-estimated-charges` alarm remained in ALARM but
  is not scoped to this stack; Elixir MCP's own estimated-charges alarm was
  OK. The Discord preview launchd service was running, connected as its agent
  on contract 1.9.0, retained its event cursor/run ledger, had both monthly
  budget lanes below their caps, and naturally delivered a feed post at 07:01Z
  plus three ask turns after 09:27Z. No source or runtime change was warranted.

## Operational review — preview activation handoff

- **Evidence (17:43–17:47Z):** clean synchronized preflight; public status
  had five active collectors, 30-second fetch/admission freshness, 767
  battles/hour, zero queue/DLQ/dead work, and 409 measured requests in the
  3,600/hour global budget. All 15 Elixir MCP alarms were OK. The 24-hour web
  API duration was 5,094 Lambda-seconds; RDS stayed available on
  `db.t4g.micro`, with hourly minimum FreeableMemory 126–141 MiB and maximum
  SwapUsage 25–29 MiB. The stats receipt found 114/262 regional Path of
  Legends locations fresh while the global daily board was current; hand this
  separate coverage issue to Keep the Boards.
- **Preview finding:** `com.poapkings.elixir-mcp-discord.poapkings` is the
  only installed, running launchd service and its state holds an agent
  principal, contract 1.9.0, cursor 2197, no channel problem and both budget
  lanes below cap. Ship It! and Elixir Kings have their intended instance
  directories and routines but no state ledger or launchd plist. Their
  documented read-only `setup --check` reports all four setup seams unresolved:
  Elixir agent connection, Claude key, Discord application/server, and channel
  bindings. No credential values were read.
- **Handoff:** Jamie should complete interactive setup for both instances,
  invite/bind each Discord bot, start its launchd label, and confirm the first
  probe's agent principal, current contract, cursor, two budget lanes and
  feedback delivery. Do not restart POAP KINGS, create credentials, or replay
  old events. No server source change or deploy is appropriate.
