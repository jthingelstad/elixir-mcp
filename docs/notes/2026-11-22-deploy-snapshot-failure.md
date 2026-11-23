# 2026-11-22 — A failed statistics snapshot no longer strands a deploy

The deploy's `public-stats` phase runs after the stack has switched. A
failed snapshot threw a plain `Error`; `deploy()` handles only
`DeployExit`, so the process died there with a stack trace. The Lambdas
were live, and the site publish, the invalidation, smoke, the visibility
check and the deploy record never ran.

The snapshot only freshens the totals the site build bakes, and
`/api/public/stats` computes a missing or stale snapshot itself. So the
phase now warns, the deploy finishes, the record carries
`public_stats: "failed"`, and the deploy exits 1 with a line naming it,
as a failed acceptance run does. A failed invoke is treated the same as
a function error.

The same class, for every other phase: once production has changed (the
stack phase has finished, or the site phase is about to upload), a phase
that crashes ends the deploy with exit 1 and one line naming the phase
and what is live, and says to run the deploy again. The second run finds
the bundles already live, takes the site lane, does what is left and
writes the record. Before production has changed a crash is still a
crash. Smoke's own exit is unchanged.

`services/mcp/test/infra-controls.test.mjs` holds both: the phases that
still run after a failed snapshot, and the line a later crash prints.
`infra/AGENTS.md` and the `ship` skill said "a failed snapshot stops the
deploy"; both now say what happens.

No migration, contract or JSON API change.
