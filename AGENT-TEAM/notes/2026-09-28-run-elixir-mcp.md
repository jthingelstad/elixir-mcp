# Run Elixir MCP — active-war acceptance predicate corrected

## Evidence

- Preflight was observation-available and mutation-eligible; lease
  `5bcab878-e563-4e8d-921f-a4688b5c0645` protected the correction.
- Public status at 09:48Z was healthy: 967 battles/hour, 37-second
  fetch/admission freshness, five fresh signed active collectors, no dead jobs,
  and no outbox dead letters. The trailing 24-hour capture audit had 6 gaps in
  19,249 polls.
- Migrate `{stats:true}` found 740 trailing-hour battle-log polls with 0 gaps;
  its 24-hour errors were expected upstream 404s plus one transport receipt.
  Nightly efficiency, activity, meta rollup and archetype stamping completed.
- Alarms were quiet. RDS had about 671 MiB freeable memory, 16 MiB swap, and
  99.5% EBS byte balance.

## Finding and correction

The one daily read-only acceptance pass failed two war-history identities on
the active regular week. That row is correctly `in_progress` with
`finished_early: null`; it can still hold live fame at or above the finish line
and a known finish war day. The acceptance predicates had treated that unknown
state as a closed-week contradiction.

`acceptance/checks/identities.mjs` now limits the line-reached implication to
closed rows and asserts an absent finish day only for `finished_early ===
false`. `acceptance/acceptance.test.mjs` has a regression fixture covering the
active, finished, and closed-without-finish states. The focused test and
`npm run verify` passed. This changes the local acceptance harness only; no
deployment or repeat of the live suite is required.

## Discord preview watch

All three Docker instances were up for 33 hours, but the POAP KINGS editor
routine retried every five minutes after its Claude workspace API limit was
reached. The error named a 2026-10-01T00:00Z reset. No container was restarted,
no routine was run early, and no cursor was replayed. The preview needs a
failure-specific cooldown in its own repository so that an external workspace
limit does not keep spending attempts while recovery time is known.
