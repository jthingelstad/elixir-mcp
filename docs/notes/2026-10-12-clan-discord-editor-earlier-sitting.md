# 2026-10-12 — Elixir Clan's Discord editor: a run's move and sitting are one post; any earlier sitting counts

MCP and JSON API unchanged. No migration. Codex on #541 (both P2), shipped
in #542; follows `2026-10-12-clan-discord-editor-repeats.md`. Moved here
from that note (Codex on #543: one note per change).

- `toldToday` returned before reading the members' battle times when
  nothing had been posted about them today, so a battle-less move and a
  rung or sitting of the same sitting, new in one run, were two posts.
  The battle times are now read first. `clan-sync.test` pins it with a
  move and a rung in one run.
- The one-sitting cap counted only an earlier post that held a sitting
  story; a morning told only as its move let an evening sitting through.
  A post today of any sitting kind (move, league, best, sitting) now
  counts, as does any story already kept for the member in the run.
