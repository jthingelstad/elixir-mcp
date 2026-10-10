# 2026-10-10 — how production is operated moves to docs/OPERATIONS.md; AGENT-TEAM leaves

The agent team for the whole Clash Royale domain now lives in the private
clash-royale repository, eight roles in one place (Jamie, 2026-10-10:
`plans/working-model-2026-10.md` there, decisions 4, 7 and 8). What a role
needs to know about how this system works stays here, with the code, and
changes in the same pull request as the code.

- **`docs/OPERATIONS.md`** holds the facts and the never-do rules the
  roles read, without the roles: Pipeline health, Dead letters and dead
  jobs, Collector fleet, Feedback, Record truth, Security sweep, Incident
  authority, Clan maintenance and Restore rehearsal. The domain's
  runbooks cite those sections by name, so
  `docs/operations.test.mjs` pins the headings and their order. Every
  write in it goes through `npm run op`.
- **`AGENT-TEAM/` is removed:** the four role files, the reading list,
  schedule, workflow, automations, evals, the notes and summaries
  directories, the objective lease and the preflight scripts. The
  production lock (#434) replaced the lease. `worktree-setup.sh` moved
  to `scripts/` and prepares only this repository's worktree; siblings
  are the domain's `session-start`. `.codex/environments/environment.toml`
  runs it from there.
- **The process prose** follows the session model: one worktree, one
  branch, one pull request, a draft at the first push, auto-merge on a
  green `validate`, then a deploy from a detached `origin/main` that takes
  the lock and comments on the pull requests it shipped. No post-deploy
  notes pull request. AGENTS.md, `infra/AGENTS.md`, ENGINEERING,
  DECISIONS and the skills (ship, consistency, gym, migration,
  tool-change, reference-audit, ops) say so. The ops skill and catalogue
  run ops through `npm run op` and name `docs/OPERATIONS.md` sections as
  their authority; a raw invoke is for reads only.
- **The restore rehearsal** section records the procedure, but DECISIONS
  still declines restore readiness work, a rehearsal included (Jamie,
  2026-09-27). Whether one runs is Jamie's call.

No contract change and nothing a user sees: MCP 11.7.2 and JSON API 3.1.0
unchanged.
