# Objective reading map

Read `AGENTS.md`, `docs/ENGINEERING.md`, `WORKFLOW.md`, this map and your
objective. Read the changed ratified decisions in `docs/NOTES.md` (newest last)
since the previous successful review; on first use inspect recent headings and
follow the decisions relevant to the objective. Record the reviewed revision.
Do not summarize the entire decision history or reread every product page on
every wake. If a contract/source version changed, read its changelog and the
current affected pages before judging evidence. A saved summary never overrides
current source.

The source of product behavior is `apps/site/src/docs/`, not this map. Read:

| Objective or finding | Required current documents |
|---|---|
| All MCP owners | `roles.md`, `connections.md`; changes in `packages/contracts/src/changelog.ts` since the reviewed version |
| Run Elixir MCP | `recording.md`, `operators.md`, `limits.md`; `docs/RELEASING-COLLECTOR.md` for collector changes; preview `../elixir-mcp-discord/AGENTS.md` for preview evidence |
| Keep the Record True | `recording.md`, `clocks.md`, `methodology.md`, `responses.md`; affected tool declarations and standalone CR reference |
| Close the Loop | `choosing-a-tool.md`, `events.md`, `protocol.md`; pages/declarations named by the observed feedback, including `agents.md` for the preview |
| Guard the Door | `roles.md`, `agents.md`, `integrations.md`, `connections.md`, `privacy.md`, `limits.md`; changed auth declarations and refusal tests |
| REST integration finding | `integrations.md`, `packages/contracts/integration-api.openapi.json` |

Paths in the table are relative to `apps/site/src/docs/` unless explicitly
rooted with `docs/`, `packages/`, or `../`. Consult generated tool pages or the
registry for exact tool names; never maintain a second tool inventory here.

The contract summary an owner carries between runs is a version, source revision,
changed surfaces, evidence and next check in its compact current state. It is
not a copied product spec. Healthy runs retain their baseline checks and stop;
only measured gaps justify deeper investigation or mutation.
