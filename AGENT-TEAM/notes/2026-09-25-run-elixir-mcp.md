# Run Elixir MCP — acceptance catalogue safety and coverage

## Production receipt

- Preflight at the start of the run reported `OBSERVATION=available` and
  `MUTATION=eligible`; the `run` lease `03cce4a6-34b1-46a2-b072-fcc7d3f87ca2`
  was held for this change.
- `https://elixir.poapkings.com/api/public/status` was green before the
  change: 1,003 battles in the preceding hour, all queues and DLQs at zero,
  30 capture gaps over 21,620 polls, and five fresh collector heartbeats. A
  later read remained green (885 battles/hour; queues, DLQs and dead jobs
  zero).
- `elixir-mcp-migrate {stats:true}` reported 444,126 battles. The last-hour
  battle-log filter had 848 polls, 25,880 observed rows, 24,591 filtered and
  one gap; its 16 prior-24-hour fetch errors were upstream 404s or one
  transport error, not a current fleet failure.
- CloudWatch reported all 16 `elixir-mcp-*` alarms `OK`. The RDS instance
  (`db.t4g.small`) had about 669 MiB freeable memory, 15 MiB swap and 10.6
  GiB free storage. OAuth discovery returned 200 and a bearerless MCP request
  returned 401. All three Discord preview LaunchAgents were active; bounded
  natural logs showed the POAP instance consuming contract events through
  8.1.0 without restart or replay.
- Jobs logs showed the latest nightly rollup complete in 85,032 ms with
  20,892 changes and no pending work. The September 24 efficiency row has
  249 lost battles across 34 gaps in 20,704 audited observations; that is the
  existing Keep the Record True watch, not a current Run corrective action.
- Cost Explorer's `Project=elixir-mcp` tag view for September 1–24 was
  $0.0153008495 direct attributed spend (mostly S3 and Lambda). This is not a
  full account-cost statement.

## Finding and source correction

The daily full acceptance pass covered 1,237 cases with one failure: its
derived catalogue included raw `live_fetch`, which necessarily uses the live
lane and correctly answered `live_pending`. The acceptance principal is
recorded-data-only, so `shapeCatalogue` now drops raw `live_fetch` and any
`live: true` row; the committed catalogue no longer carries it.

The one catalogue-only confirmation run did not invoke that live call. It
exposed an old daily-allocation assertion in
`recording#participation-by-week`. Jamie's weekly-deck decision supersedes
it: the 9.0.0 contract removes `war_decks_by_day`, `war_battles_by_day` and
`war_days_battled` from participation. Its bounded-full seed now witnesses
the retained weekly fields. `war_history` retains its separately observed
exact-week attendance facts.

That same confirmation run had three red cases: the documentation witness,
`badges_rarity` at 4,064 ms over its 4,000 ms ceiling, and
`battles_meta_decks` at 10,950 ms over 9,974 ms. The latter two had passed in
the earlier full run, and all current public, alarm and database evidence was
healthy. Per the objective, they were not retried or used to loosen a budget;
they remain the next Run Elixir MCP capacity watch.

## Verification and handoff

- The original live-lane correction passed `node --test
  acceptance/acceptance.test.mjs` (8 passed) and `npm run verify` (316
  passed). The 9.0.0 runtime correction passed `npm run verify` (315
  acceptance and automation checks) and deployed from `e2e7d2e` at 12:11Z.
  Its read-only live acceptance returned contract `9.0.0` for 48 members,
  retained `war_decks`, `war_points` and `war_scoring_decks`, and omitted all
  three retired daily fields. Public status was healthy: 200-second
  fetch/admission freshness, 955 battles in the last hour and zero DLQ
  messages.

The next scheduled Run Elixir MCP should use the bounded full participation
case as normal evidence, retain the live-lane exclusion, and investigate only
if the two capacity ceilings fail again against otherwise quiescent production.
