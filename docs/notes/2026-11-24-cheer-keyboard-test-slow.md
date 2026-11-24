# The keyboard cheer test gets a slow test's time

2026-11-24. `apps/web/e2e/cheer-tap.spec.ts` "another kind from the
keyboard" runs two accessibility scans and three keyboard walks. On a
loaded machine it passed 30 seconds and timed out, with every assertion
holding. It is now `test.slow()`, as the repo's other heavy journeys are.
It passed 20 of 20 runs.
