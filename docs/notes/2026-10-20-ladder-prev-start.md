# 2026-10-20 — Ladder: the first-hour sentence needs last season's start

Two Codex findings on #608, fixed together. No contract change: MCP
11.13.1 and JSON API 3.2.0. No reads added.

- **The first-hour sentence needs both starts.** `recordedSeasons`
  permits a season with no start (`startsAt: null`), and without last
  season's start `samePointWindow` can never cut a same point. The
  first-hour sentence promised one "from its first whole hour" all the
  same. It now needs last season's start as well as this season's;
  without it the foot keeps the plain "All of <last> ran N days." A
  journey pins it: 40 minutes into Season 136 with Season 135 listed
  without a start (the fixture's new `pastStart: false`).
- **The public docs say it.** `apps/site/src/docs/ladder.md` ▸ This
  season vs last now says that in a season's first hour there is no
  same point yet, and the page says so. No What's new entry: the
  2026-10-20-07 entry announced the panel the same day, and this
  sentence documents an edge of it.
