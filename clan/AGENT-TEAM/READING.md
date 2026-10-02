# Objective reading map

Read `AGENTS.md`, `docs/VISION.md` (what the product is for and its
principles), `WORKFLOW.md`, this map and your objective. Read the
decisions in `docs/NOTES.md` (newest last) since the previous successful
run; on first use, read the headings and the decisions relevant to the
objective. Record the reviewed revision in automation memory. A saved
summary never overrides current source.

The source of product behaviour is the code and `AGENTS.md`; the source of
Elixir's behaviour is <https://elixir.poapkings.com/docs> (`protocol`,
`connections`, `agents`, `verify`) and its `elixir_changelog` tool.

| Objective or finding | Required current documents |
|---|---|
| Clan Operator | `AGENTS.md` §AWS and deploying; `infra/template.yaml`; `infra/scripts/{deploy,smoke,parameters}.mjs`; `.github/workflows/clan-deploy.yml` at the root; Elixir's `elixir_changelog` |
| Clan Policy Auditor | `AGENTS.md` §The engine's contract, §Policy, §Awards, §Roles in Manage; `../packages/clan-engine/src/*.mjs` and `test/`; `../packages/clan/src/manage/{service,awards}.mjs`; each clan's saved policy (the ledger, read-only); `docs/NOTES.md` from 2026-09-25, "Elixir Clan is for any clan" |
| Clan Feedback Manager | `AGENTS.md` §Feedback; `../packages/clan/src/feedback.mjs`; `scripts/feedback.mjs`; `../packages/clan-web/src/views/{Feedback,Maintain}.jsx`; `docs/NOTES.md` "waiting on Jamie" items |
| Clan Security Reviewer | `AGENTS.md` §The five rules, §The seams to Elixir, §Sessions, §What is stored; `../packages/clan/src/{cookies,oauth,gate,handler}.mjs`; `infra/template.yaml` (CloudFront behaviors, headers policy, IAM); `.gitignore`; `git ls-files` |
| A verdict or action disputed by a member | Clan Policy Auditor's row, plus the disputed member's line in the latest verdict snapshot (ledger) and the policy version that judged it |
| A season closed without grants | `../packages/clan-engine/src/awards.mjs` (`seasonsFrom`, the closed/complete rule), `../packages/clan/src/manage/awards.mjs`, the ledger's `awards_snapshot#<clan>` |
| Elixir contract moved | Elixir's changelog entry, `AGENTS.md` §Elixir tools this app depends on, `../packages/clan/src/{gate,elixir-api}.mjs`, the engine's `facts.mjs` if `clans_participation` changed |
