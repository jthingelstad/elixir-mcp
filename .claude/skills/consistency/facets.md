# The alignment map

Which surfaces must agree with which. Paths are from the repo root unless
they start with `../` (a sibling checkout). When a decision lands, walk
its row: every surface named must realize it or be named in the report as
not affected, with the reason.

Seeded from the 2026-09-25 sweep. When a run finds a surface this map
missed, add it here in the same round.

## 1. The ledger and the reading path

The source of truth for what stands, and the files that point agents at it.

| Surface | Path | Must agree with |
|---|---|---|
| Decisions | `docs/DECISIONS.md` | itself (no line contradicts another), and everything below |
| Invariants | `docs/ENGINEERING.md` | DECISIONS, the tests that enforce each invariant |
| Working notes | `docs/NOTES.md`, `docs/notes/` | reasoning only; never cited as the ledger |
| Agent guide | `AGENTS.md` (CLAUDE.md is a symlink) | DECISIONS; points at DECISIONS, not NOTES |
| Objective runs | `AGENT-TEAM/READING.md`, `README.md`, `WORKFLOW.md`, the five objective files | DECISIONS; current plumbing in `infra/template.yaml` |
| Repo skills | `.claude/skills/gym/`, `.claude/skills/consistency/` | DECISIONS; the acceptance and deploy rules |
| User skill | `~/.claude/skills/mcp-tool-review/SKILL.md` | profiles, paths and tools as they are now |
| Domain guide | `../AGENTS.md`, `../AGENT-TEAM/` | the repo list, each repo's reading path, the lease order |

## 2. The contract

| Surface | Path | Must agree with |
|---|---|---|
| Versions | `packages/contracts/src/version.ts`, `changelog.ts` (`breaking` field, not prose) | the change's semver class (AGENTS.md rule 5) |
| Shared vocabulary | `packages/contracts/src/{modes,principals,roles,queue,tool-groups}.ts` | JS and SQL readers (one answer in both), docs tables |
| Tool registry | `services/mcp/src/tools.mjs`, `services/mcp/src/tools/**` | declarations, `output-schemas.mjs`, the brief |
| Output schemas | `services/mcp/src/output-schemas.mjs` | every field the tool serves; nothing it does not |
| The brief | `services/mcp/src/protocol.mjs` (`instructionsFor`) | the registry (segment tools, windows, conventions) |
| Entitlements and identity | `services/mcp/src/entitlements.mjs`, `identity.mjs` | DECISIONS on defaults, refusals, principals |
| Notes and docs pointers | the invoker and each tool's `notes()` / `docsRef()` | fields actually served (acceptance checks this live) |

## 3. Second derivations

Surfaces that compute a fact with their own SQL instead of calling the
tool. A decision applied to a tool does not reach these by itself; this
is where the war-days gap lived.

| Surface | Path | Must agree with |
|---|---|---|
| Timeline entries | `services/mcp/src/activity/entries.mjs`, `summary.mjs` | the tools for the same fact (war, battles, donations) |
| Participation SQL | `services/mcp/src/participation-sql.mjs` | `clans_participation`, `clans_standings`, war tools |
| Product mail | `services/jobs/src/email/build-*.mjs`, `packages/mail/src/render.mjs`, `packages/mail/fixtures/` | the tools the builder should call; wording in docs |
| Rollups | `services/jobs/src/meta-rollup.mjs` | live SQL for the same population and mode map |
| Console | `apps/web/src/views/**`, `apps/web/src/pages/**` | tool semantics, docs wording, privacy (analytics.js) |
| Web API routes | `services/web-api/src/routes/*.mjs`, `notify.mjs` | the tools, the docs, runtime strings that point at docs |
| Collector quota | `services/mcp/src/quota.mjs`, ingest points | mail, console and docs wording for credits |

## 4. The JSON API

| Surface | Path | Must agree with |
|---|---|---|
| Wiring | `services/web-api/src/integration-api.mjs` | the MCP tool each person route mirrors, its required scope |
| Contract | `packages/contracts/integration-api.openapi.json` | the mirrored tools' output; ordinary semver |
| Pin | `services/web-api/test/integration-api.pin.json` | moves only with `info.version` |
| Docs | `apps/site/src/docs/integrations.md` (Versions list) | the OpenAPI version and its changes |

## 5. Recording, schema and operations

| Surface | Path | Must agree with |
|---|---|---|
| Ingest | `services/ingest/src/*.mjs` | DECISIONS on what is recorded and how (no per-day war guesses) |
| Scheduler | `services/scheduler/src/*.mjs` | the rate budget, the session clock |
| Migrations | `db/migrations/NNNN_*.sql` | the migration rules (`services/migrate/test/migration-rules.test.mjs`) |
| Migrate ops | `services/migrate/src/ops-*.mjs` | retired designs removed; each op named by a runbook, skill or CI |
| Infrastructure | `infra/template.yaml`, `infra/scripts/*.mjs` | runbooks, DECISIONS on alarms, metrics and cost |
| Deploy | `infra/scripts/deploy.mjs` | DECISIONS on acceptance, the clean-tree rule |
| Payload audit | `infra/scripts/payload-field-audit.mjs` | RELEASING-COLLECTOR.md step 3 |

## 6. Public docs (agents read these through `elixir_docs`)

| Surface | Path | Must agree with |
|---|---|---|
| Docs pages | `apps/site/src/docs/*.md` | the registry, output schemas and DECISIONS |
| Examples | `apps/site/src/_data/examples.js` | valid tool names and required arguments |
| What's new | `apps/site/src/_data/updates.js` | the changelog, in plain words |
| Privacy promises | `privacy.md`, `connections.md`, `email.md`, `terms.md` | what the code sends, keeps and deletes |
| Front page | `README.md` | the services and packages that exist |

## 7. Acceptance

| Surface | Path | Must agree with |
|---|---|---|
| Gym cases | `acceptance/gym.json` | current decisions (`amended` with a reason; prune refuted cases whose subject left the contract; every finding keeps a control) |
| Known failures | `acceptance/known.json` | a current reason and an expiry |
| Catalogue | `acceptance/catalogue*.json`, `catalogue-allow.json` | seeds that fit the result cap; allowed tokens carry reasons |
| Contract checks | `acceptance/checks/*.mjs` | current field names |

## 8. Connected repos

| Repo | Where it touches the hub | Must agree with |
|---|---|---|
| `../clan.poapkings.com` | `services/api/src/elixir-api.mjs`, AGENTS.md, `docs/NOTES.md` | `/api/v1` operations and versions |
| `../drop.poapkings.com` | `services/api/src/elixir-oauth.ts` (sign-in, `/api/v1`), `elixir-mcp.ts` and `elixir-collection.ts` (integration key), `seasons.ts` (policy clock), SPEC.md, AGENTS.md | `/api/v1`, the OAuth door, the clock |
| `../elixir-bot` | `elixir_mcp.py`, `capabilities/mcp_stats.py`, AGENTS.md | MCP fields it reads; no contract pin |
| `../elixir-mcp-discord` | `src/events.js`, `src/prompt.js`, `src/feedback.js`, AGENTS.md | `elixir_timeline` paging and order, tool names |
| `../cr-agent-api-docs` | the endpoint and field pages | the hub's observed semantics (general findings only); `.claude/skills/reference-audit/` checks it against the payload archive |
| `../poapkings.com` | `src/elixir-mcp.njk`, member pages | REPORT ONLY (Jamie, 2026-09-25) |
| `../elixir-family` | `MAP.md` (historical, frozen 2026-09-13), `plans/` | nothing current; Clan's guide still points at MAP.md |

## 9. Memory

`~/.claude/projects/-Users-otto-Projects/memory/`: memories name files,
flags and decisions. A memory that contradicts DECISIONS.md is updated
or deleted in the round that finds it.
