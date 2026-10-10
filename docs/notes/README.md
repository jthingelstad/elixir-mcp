# Change notes

One file per change, written in the change's own pull request, so two
pull requests never edit one file. They replace `docs/NOTES.md`, which is
the frozen archive of the notes up to 2026-10-10.

- **Name:** `YYYY-MM-DD-<slug>.md`, the date the change is written, a
  slug in lowercase words and hyphens (`2026-10-10-change-fragments.md`).
  Two notes may share a date; never rename another note.
- **First line:** `# YYYY-MM-DD — <title>`, the same date.
- **Body:** what changed, why, and the versions it ships in (MCP, JSON
  API, a migration's number), as the NOTES entries did. A ratified
  decision also gets its line in `docs/DECISIONS.md` in the same pull
  request.
- **Not here:** open items, asks for Jamie and parked ideas. Each is a
  GitHub issue in this repository, labelled `needs-jamie`, `engineering`
  or `parked` (a parked issue names its trigger); close it in the pull
  request that settles it.

A note is history once merged: a later change writes a note of its own
rather than editing an old one. If its pull request renumbers the
contract version (`npm run contract:bump`), the "MCP x.y.z" mentions in
the notes that pull request added follow.
