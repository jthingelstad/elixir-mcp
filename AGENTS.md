# AGENTS.md

Elixir records Clash Royale history for players and their clans (the
official API is current-state only) and serves it on one origin,
`elixir.poapkings.com`:

| Path | What | Code |
| --- | --- | --- |
| `/`, `/docs`, `/updates` | the site and the public docs | `apps/site` (Eleventy) |
| `/console` | the Console: your record, account, agents, admin | `apps/web` |
| `/ladder` | Ladder: your season, read back | `apps/web/src/ladder` |
| `/clan`, `/api/clan` | Elixir Clan: running a clan on its policy | `packages/clan*` |
| `/battle/<id>` | a battle's public page | `services/web-api` |
| `/mcp`, `/a/<id>/mcp`, `/oauth/*`, `/.well-known/*` | the MCP and OAuth doors | `services/mcp`, `packages/tools` |
| `/api/v1` | the JSON API | `services/web-api`, `packages/tools` |

Node 24 Lambdas, RDS PostgreSQL, S3 and CloudFront in one CloudFormation
stack. `CLAUDE.md` is a symlink to this file; do not fork them.
`../AGENTS.md` covers the sibling repos; `~/Projects/AGENTS.md` covers AWS
and secret safety everywhere.

## Scope

Elixir is the personal and clan recorder; MCP is an extension of it
(`VISION.md`). There are no global leaderboards, elite or corpus
recording, game-wide meta statistics, gameplay recommendations, editorial
emails, recording Collections or branded player scores. Do not build
them, even over a smaller population. A retired name still in code or
docs is cleanup, not a feature to preserve.

## What to read

- **Product behaviour:** the public docs, `apps/site/src/docs/` (served at
  `/docs`, and to agents by `elixir_docs`). They are the only description
  of what the service does; do not write a second one here.
- **`docs/DECISIONS.md`:** what stands, one line each. Do not re-litigate a
  line; a surface that disagrees with it is the defect.
- **`docs/ENGINEERING.md`:** the build invariants (rate budget, migrations,
  contract versioning, ingest, packages, deploy).
- **`docs/NOTES.md`:** open items, Jamie's queue, dated working notes. A new
  decision gets its NOTES entry and its DECISIONS line in the same change.
- **`README.md`:** the workspace map.
- **Area guides**, read the one for the code you are in:

| Area | Guide |
| --- | --- |
| Console and the shared web shell | `apps/web/AGENTS.md` |
| Ladder | `apps/web/src/ladder/AGENTS.md` |
| Elixir Clan | `packages/clan/AGENTS.md` (engine, state and views: their own short guides) |
| MCP tools and the JSON API operations | `packages/tools/AGENTS.md` |
| The site and public docs | `apps/site/AGENTS.md` |
| Infrastructure and deploy | `infra/AGENTS.md` |
| Mail | `docs/EMAIL.md` |
| Collector releases | `docs/RELEASING-COLLECTOR.md`, `docs/COLLECTOR-ZERO-TRUST.md` |
| Secrets | `docs/SECRETS.md` |

- **Skills** (`.claude/skills/`), the procedures for recurring work; read
  the one that fits first: `ship` (a change to production), `tool-change`
  (adding or changing an MCP tool), `migration` (a schema change or
  backfill), `ops` (live diagnostics and every migrate op), `consistency`
  (a decision reaching every surface), `gym` (adversarial tool testing),
  `reference-audit` (the payload archive against cr-agent-api-docs).

## Golden rules

Skills and tests cite these by number; keep the numbering.

1. **This repo is PUBLIC; secrets never enter it or agent context.** Local
   `.env` files only (mode 0600; canonical CR variable `CR_API_TOKEN`),
   never read or printed; name them. Check tracking with `git ls-files`,
   never `.gitignore` alone. `asm-exec` resolves nothing on this host:
   queue a secret edit for Jamie (`docs/SECRETS.md`).
2. **Only collectors call the Clash Royale API at runtime.** CR tokens live
   on allowlisted operator machines, never in CI, a Lambda or a browser
   (`npm run cr` and acceptance `ground` are local maintainer checks).
3. **One global rate budget.** More collectors add redundancy, never
   quota: Supercell ToS posture, not an optimization.
4. **CR tags are the only IDs for game entities.** One shared normalizer,
   no surrogate keys; accounts touch game data only through a claim.
5. **Contracts are versioned in `packages/contracts`** (version,
   changelog, errors, groups, principals, collector contract,
   `integration-api.openapi.json`); tool declarations and output schemas
   sit with their handlers in `packages/tools`. MCP: an addition is a
   minor, a correction a patch, a major is Jamie's call; every bump gets a
   `changelog.ts` entry. `/api/v1` keeps ordinary semver; its `x-tool`
   operations mirror MCP tools and change with them.
6. **Schema changes are ordered migrations in `db/migrations`**, applied
   only by the migrate Lambda during a deploy, never at handler start or
   by hand. Expand and contract; applied files are immutable
   (`db/migrations.sha256`); canonical tables are lossless.
7. **Never copy-paste code between repos.** Write fresh with the pattern
   open.
8. **`../cr-agent-api-docs` is Clash Royale API truth**, standalone and
   public; never vendor it. Patch it by PR when the live API surprises us:
   facts that hold for any caller (endpoint shapes, field semantics,
   nullability, reset timing), never clan material, tags or raw payloads.
   `npm run cr` checks a claim first; the `reference-audit` skill diffs
   the payload archive against it.
9. **Tests run on scratch databases** made per run (brew `postgresql@17`
   running, no Docker; `PG_ADMIN_URL` overrides the admin URL). Live data:
   reads and refusal paths only, never a verifying write.
10. **The unofficiality disclaimer** is on every user-visible surface,
    including tool response metadata and this repo's README.

## Boundaries

- Store UTC everywhere; a time zone is display only. Report times to
  Jamie in US Central.
- An MCP token never authenticates at `/api/v1`, nor the reverse.
- Private Clan state never reaches MCP or public tools. The one exception,
  `clans_context`, reads through `@elixir-mcp/auth/clan-context` (pinned by
  `services/web-api/test/clan-boundary.test.mjs`).
- Canonical game facts enter only through collectors.
- Services share through packages, never each other
  (`packages/record/test/boundary.test.mjs`).

## Working style

- **Own checkout:** if another session is in the main checkout, work in a
  worktree from `origin/main` and run `AGENT-TEAM/scripts/worktree-setup.sh`
  there.
- **`main` takes only pull requests:** branch, `gh pr create --fill`,
  `gh pr merge --auto --rebase --delete-branch`; merged on a green
  `validate` check, no bypass, Jamie's account included.
- **`npm run verify`** before every push (prettier, oxlint, knip,
  typecheck, every workspace test); `npm run format` fixes style;
  `npm run e2e` runs the Playwright journeys CI runs. After touching
  `.github/workflows/`, `sh infra/scripts/test-workflows.sh`.
- **Docs ship with the change:** user-visible behaviour updates
  `apps/site/src/docs/` and `apps/site/src/_data/updates.js` in the same
  commit; `/docs/tools` is generated from the registry, never hand-edited.
- **Commits are small and message-first;** stage named paths, never
  `git add -A`; assert HEAD moved.
- **Deploying is part of done.** From green `origin/main`: claim the lease
  (`node AGENT-TEAM/scripts/objective-lease.mjs claim session`), then
  `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs`
  (`--acceptance=<family>` when that family's tools changed), read the
  change back live, release the lease. A held lease is a wait.
  `--break-glass` only when GitHub itself is down. `/ship` has the rest.
- **Ask Jamie up front** for product calls (who sees what, what is
  promised), an MCP or `/api/v1` major, IAM edits outside a deploy and
  deleting production rows. Steps only Jamie can do (Supercell keys, DNS,
  secret values) go into `docs/NOTES.md` as one exact ask.

## AWS

- Profile `cloud-engineer`, `us-east-1`; hobby-account sizing; no em
  dashes in resource names or descriptions.
- One stack, `infra/template.yaml`; every parameter is classed in
  `infra/scripts/parameters.mjs`. An unclassed one resets to its default.
- Alarms publish to SNS `elixir-mcp-alarms` for the sysadmin
  `projects-ops-alerts` queue; no email. No dashboard: a custom metric
  exists only behind an alarm.
- `deploy.mjs` tags the stack (`awsApplication`, `Application=Elixir`,
  `Project=elixir-mcp`, `Environment`, `ManagedBy`, `Repository`);
  CloudFormation propagates them.

## Collectors

The collector is `../elixir-mcp-collector` (Go). Its merges publish signed
candidates; one reaches the fleet only when named from this repo
(`docs/RELEASING-COLLECTOR.md`), and rollback is naming the previous
release. The collector contract (`config`, `lease`, `submit`) stays
canonical in `packages/contracts`, and changes land server-side first.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
