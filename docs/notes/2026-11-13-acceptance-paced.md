# 2026-11-13 — Acceptance is paced and waits for database headroom

On 2026-11-12/13 about ten deploys each ran the acceptance suite against
production. The database's `EBSByteBalance%` fell from 89% at 21:22 UTC
to 0 at 04:55 UTC (15:22 to 22:55 US Central), and at 05:06 to 05:09 UTC
it dropped connections: MCP and the collector door answered 5xx, ingest
hit statement timeouts and a deploy failed at its migrate step. The same
had happened at 19:00 UTC the day before, ahead of a restart. A
whole-suite run cost 10 to 15 points of byte balance (29 at worst), a
one-family run 4 to 7, and the bucket refills only about 4 to 6 points
an hour at idle.

What changed (no contract, API or migration change):

- **The runner is paced.** `acceptance/run.mjs` rests twice each door
  call's time, 250 ms to 10 s, before its next call (`PACE`,
  `pacedDoor`). Still one call at a time. The whole suite takes about 45
  minutes instead of about 15, one family 15 to 25, at about a third of
  the read rate. A cached read never rests, and nothing rests after the
  last call. `--no-pace` is for a local server only; tests and bite
  replays run unpaced. The run prints its calling and resting seconds.
- **The deploy reads the database's headroom first.** With acceptance
  asked, `deploy.mjs` reads `EBSByteBalance%`, `EBSIOBalance%` and
  `CPUCreditBalance` from CloudWatch (`infra/scripts/lib/db-headroom.mjs`,
  the new `@aws-sdk/client-cloudwatch` dev dependency) in the account
  phase, before anything is built, and again before the run. Under 50%
  (whole suite) or 25% (a family) on the lower of the two EBS balances it
  refuses, saying how long to wait and whether one family fits. At the
  first read nothing ships (exit 2); at the second the deploy is live,
  the record says acceptance was refused, and it exits 1.
  `--skip-headroom-check` runs anyway, for an outage. A balance it cannot
  read is a logged skip. CPU credits are printed, never a refusal: RDS
  runs T4g unlimited, and the 2026-11-12 restart left them at 0 for ten
  hours without throttling anything.
- **At most one acceptance run per deploy train**, in
  `docs/OPERATIONS.md`, the `ship` skill and `docs/DECISIONS.md`
  ([engineering]).

Why these floors: 50% leaves room for the worst whole-suite run seen (29
points) with the traffic behind it; the database started timing
statements once the balance was under about 15%.

Running only the cases a change touches stays the existing
`--acceptance=<family>` (a tool-name prefix). Mapping changed files to
families automatically was not cheap: the tools share most of their code,
so nearly any change would map to every family.

Not proven live: the pace's effect on the balance (no acceptance run was
made against production while it recovered) and the refusal inside a real
deploy. The tests pin the pace on a fake clock and the refusal path of
the acceptance phase; a local stub door showed the rests between
requests; the preflight read the live balances read-only and refused
both a whole-suite and a family run at 1%.
