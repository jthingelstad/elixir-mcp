# 2026-11-13 — A failed acceptance run is recorded

The #935 review (Codex) found that a failing acceptance run threw
`DeployExit` straight out of the acceptance phase. That skipped the
`clean-tree` and `record` phases, so a failed run was missing from the
deploy history, along with the database cost the deploy had just
measured. Those are the runs most likely to have drained the database.

Now a failing run sets the result to `FAILED (<suite>)`, prints the same
`ACCEPTANCE FAILED` line, and lets the remaining phases run. The deploy
record and the pull request comments carry the failure and
`acceptance_headroom`. The deploy still exits 1 at the end, as it does
for a refused run. Nothing else about a failure changes: the code is
live either way, so the response is still to fix forward or roll back.
No contract, API or migration change.
