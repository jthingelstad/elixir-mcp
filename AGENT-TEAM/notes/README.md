# Run notes

The team's working memory: a run's findings, watches and proposals worth
keeping beyond the run. A healthy no-op run needs no file here. Ratified
decisions land in `docs/DECISIONS.md` (one line) with their reasoning in
`docs/NOTES.md`; this directory is not the ledger.

## Naming

- **Dated run logs:** `<date>-<objective>.md`, the date the run began and the
  objective as its runbook is named (`2026-09-25-run-elixir-mcp.md`,
  `2026-09-23-keep-the-boards.md`). A second run of the same objective on
  the same day adds a suffix (`2026-09-14-close-the-loop-evening.md`); a
  one-off topic from a run is `<date>-<topic>.md`.
- **Weekly roll-ups:** `<year>-W<week>.md` (ISO week), holding that
  week's dated logs verbatim, oldest first, each under a heading that
  names the file it was.

## Retention

A dated log stays as its own file for two ISO weeks. After that it is
rolled into its week's `<year>-W<week>.md` and the original is deleted
(`git rm`); git keeps the history, and a citation of the old file name
resolves to the heading of the same name in the weekly file. Close the
Loop's Friday deep pass does the roll under its `loop` lease. The first
roll-up, `2026-W37.md`, was made on 2026-09-25.
