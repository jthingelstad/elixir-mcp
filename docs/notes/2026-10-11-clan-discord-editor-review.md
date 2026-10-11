# 2026-10-11 — The editor's stories: three review fixes

Codex review findings on #503. All three are fixed. MCP and JSON API unchanged, no migration.

- **A second promotion in a day** now counts the day before the promotion being told, not the day before the run. A story told late is no longer called a second promotion because of today's moves, and two moves made together keep the detail.
- **The clanmates already in an arena** are counted whole. Only the names are capped, so more than ten clanmates there is told as their real number, never as "10".
- **`renderStory` keeps no clock of its own.** Without `nowMs` it says no "when", rather than reading the time; every caller passes the run's time.
