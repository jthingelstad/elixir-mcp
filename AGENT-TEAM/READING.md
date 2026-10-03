# Objective reading map

Read `AGENTS.md`, `docs/ENGINEERING.md`, `WORKFLOW.md`, this map and your
objective. Read the ratified decisions in `docs/DECISIONS.md` (one line
each; `git log -p docs/DECISIONS.md` since the previous successful review
shows what changed) and follow the ones relevant to the objective. The
reasoning behind a line is in the dated entry in `docs/NOTES.md` (this
week's working notes) or `docs/notes/` (earlier weeks); read it when a
decision bears on the work. Record the reviewed revision.
Do not summarize the entire decision history or reread every product page on
every wake. If a contract/source version changed, read its changelog and the
current affected pages before judging evidence. A saved summary never overrides
current source.

Read `VISION.md` for the current development priorities and
`docs/reviews/2026-10-03-CLAN-MONDAY-READINESS.md` for the Monday checks.
The source of product behavior is `apps/site/src/docs/`, not this map. Read:

| Objective or finding | Required current documents |
|---|---|
| All MCP owners | `roles.md`, `connections.md`; changes in `packages/contracts/src/changelog.ts` since the reviewed version |
| Elixir Operator | `recording.md`, `operators.md`, `limits.md`; `docs/RELEASING-COLLECTOR.md` for collector changes; preview `../elixir-mcp-discord/AGENTS.md` for preview evidence |
| Elixir Data Auditor | `recording.md`, `clocks.md`, `methodology.md`, `responses.md`; affected tool declarations and standalone CR reference |
| Elixir Feedback Manager | `choosing-a-tool.md`, `timeline.md`, `protocol.md`; pages/declarations named by the observed feedback, including `agents.md` for the preview |
| Elixir Security Reviewer | `roles.md`, `agents.md`, `integrations.md`, `connections.md`, `privacy.md`, `limits.md`; changed auth declarations and refusal tests |
| JSON API (`/api/v1`) finding, or a change to a tool an operation mirrors | `integrations.md`, `packages/contracts/integration-api.openapi.json` |

Paths in the table are relative to `apps/site/src/docs/` unless explicitly
rooted with `docs/`, `packages/`, or `../`. Consult generated tool pages or the
registry for exact tool names; never maintain a second tool inventory here.

The contract summary an owner carries between runs is a version, source revision,
changed surfaces, evidence and next check in its compact current state. It is
not a copied product spec. Healthy runs retain their baseline checks and stop;
only measured gaps justify deeper investigation or mutation.

After ClanInternal activation, the same four owners also read the consolidated Clan sections in their objective files. Shared sources are `packages/clan-engine`, `packages/clan`, `packages/clan-state`, and `packages/clan-web`; maintenance uses the private clan_maintenance migrate operation in `.claude/skills/ops/ops.md`. Public behavior remains in `apps/site/src/docs/bring-your-clan.md`. Legacy Clan owners retire only after the handoff and state/routing read-back.
