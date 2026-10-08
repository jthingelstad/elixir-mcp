# Run notes

The team's working memory: a run's findings, watches and proposals worth
keeping beyond the run. A healthy no-op run needs no file here. Ratified
decisions land in `docs/DECISIONS.md` (one line) with a dated entry in
`docs/NOTES.md`; this directory is not the ledger.

## Naming

- `<date>-<objective>.md`: the date the run began and the objective as its
  runbook is named (`2026-10-09-elixir-operator.md`). A second run of the
  same objective on the same day adds a suffix
  (`2026-10-09-elixir-feedback-manager-evening.md`); a one-off topic from a
  run is `<date>-<topic>.md`.
- A run writes its log in its own worktree and lands it with the run's
  pull request, like any other change.

## Retention

A run log stays for two ISO weeks, then is deleted (`git rm`); git keeps
it. Anything still open moves to "Open and queued" in `docs/NOTES.md`
first. The Elixir Feedback Manager's Friday deep pass does the pruning, as
a pull request (no lease: it touches nothing in production).
