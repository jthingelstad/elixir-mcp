# 2026-11-09 — the domain agent team is retired; its references move

The Clash Royale domain's agent team (`../AGENT-TEAM/`) was retired on
2026-11-09 at Jamie's word ("Agent team is going to go away"). Its seven
roles had been paused since the 2026-10-10 hold. What runs on a schedule is
in otto-ops, as Dagu jobs and the two daily Claude sessions.

This repository only pointed at it, so only pointers change:

- `AGENTS.md`: the session procedure is `../WORKFLOW.md`.
- The `discord-review` skill keeps its private notes in `../notes/`.
- The `reference-audit` skill no longer says a team runs it weekly: nobody
  does on a schedule.
- The `consistency` skill's facets name `../WORKFLOW.md` and otto-ops in
  place of the team's runbooks.

Nothing shipped changes: no MCP, JSON API or migration version moves.
