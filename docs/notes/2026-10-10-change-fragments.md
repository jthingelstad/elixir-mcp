# 2026-10-10 — one file per change: notes, What's new and the changelog

Of 634 commits to this repository from 2026-09-26 to 2026-10-10, 346
touched `docs/NOTES.md`, 170 `apps/site/src/_data/updates.js` and 46 the
contract version, so two pull requests in flight almost always conflicted
on them. Each change now adds files of its own instead (Jamie, 2026-10-10:
`plans/working-model-2026-10.md` in the clash-royale repository,
decisions 2, 3 and 6).

- **Notes:** this directory, one file per change (`README.md` here).
  `docs/NOTES.md` is frozen as the archive of the entries to 2026-10-10.
- **Open items** moved to GitHub issues: the Jamie queue as
  `needs-jamie` (#414 to #421), engineering as `engineering` (#422 to
  #428, and the existing #292 and #296), the parked ideas with their
  triggers as `parked` (#429 to #433).
- **What's new:** `apps/site/src/_data/updates/<YYYY-MM-DD>-<NN>-<slug>.md`,
  a `# Title` line and the body; NN orders one day's entries, the higher
  the newer. `updates.js` reads them. All 421 entries moved; the built
  site (all 1,255 files) and the docs corpus are byte-identical.
- **The contract changelog:** `packages/contracts/src/changes/<version>.ts`,
  one per version, each exporting its entry. The build lists them in the
  gitignored `src/generated/`, and `CONTRACT_VERSION` is the highest; no
  pull request types it. A test refuses a file whose name disagrees with
  its entry and a version that is not a patch, minor or major after the
  one before (true of all 259 versions since 0.6.0). `CHANGELOG` and
  `CONTRACT_VERSION` are identical to before, so `elixir_changelog` and
  `serverInfo.version` did not move.
- **`npm run contract:bump -- <patch|minor|major>`** writes the next
  version's file from the highest on `origin/main`. Run again after
  another pull request took that number, it renumbers this branch's file
  and the "MCP x.y.z" mentions in the notes and updates this branch added.

No contract change and nothing a user sees: MCP 11.7.2 and JSON API 3.1.0
unchanged.
