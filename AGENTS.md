# AGENTS.md

Elixir is the missing social layer of Clash Royale: a timeline of the
players you follow, built on a recorder of players and their clans (the
official API is current-state only), served on one origin,
`elixir.poapkings.com`:

| Path | What | Code |
| --- | --- | --- |
| `/`, `/docs`, `/updates` | the site and the public docs | `apps/site` (Eleventy) |
| `/home` | Home: one feed beside your week and clan, with Find (`/home/find`) and You; a player's page (`/home/player/<tag>`, its Record tab the game record); where signing in lands | `apps/web/src/home` |
| `/signin` | signing in | `apps/web` |
| `/settings` | Settings: your account and agents, with its left rail; Admin (`/settings/admin/*`) for staff | `apps/web` |
| `/console`, `/data/service` | only redirect: the Console folded on 2026-11-12 (Jamie) and `apps/web/src/lib/moved.js` maps every old address; `/data/service` goes to `/data`, the public status page | `apps/web` |
| `/home/you/stats` | Stats (Ladder until 2026-11-12; `/ladder` redirects): your season, read back, You's last tab | `apps/web/src/ladder` |
| `/clan`, `/api/clan` | Clan, a part of Elixir: running a clan on its policy | `packages/clan*` |
| `/battle/<id>` | a battle's public page | `services/web-api` |
| `/mcp`, `/a/<id>/mcp`, `/oauth/*`, `/.well-known/*` | the MCP and OAuth doors | `services/mcp`, `packages/tools` |
| `/api/v1` | the JSON API | `services/web-api`, `packages/tools` |

Node 24 native HTTP Web Functions and asynchronous Event Functions, RDS
PostgreSQL, S3 and CloudFront in one CloudFormation stack. `CLAUDE.md` is a symlink to this file; do not fork them.
`../AGENTS.md` covers the sibling repos; `~/Projects/AGENTS.md` covers AWS
and secret safety everywhere.

## Scope

Elixir is the missing social layer of Clash Royale (`VISION.md`, the
root): a timeline of the players you follow, built on the personal and
clan recorder, with MCP and a person's own agent kept core. Never built:
elite or pro tracking and a deck builder. Not part of Elixir: global
leaderboards, corpus recording, game-wide meta statistics,
recommendations in Elixir's own outputs, recording Collections or player
ratings. Do not build them, even over a smaller population. Agents may coach from Elixir's facts;
that is theirs, not Elixir's. The Ultimate Champions and Card of the
Week mail are retired. A retired name still in code or docs is cleanup,
not a feature to preserve.

## What to read

- **Product behaviour:** the public docs, `apps/site/src/docs/` (served at
  `/docs`, and to agents by `elixir_docs`). They are the only description
  of what the service does; do not write a second one here.
- **`docs/product/`:** one brief per surface, rewritten to the social
  layer and ratified by Jamie on 2026-11-13: what it is for, who it
  serves, its principles, what it never does, what is open. Intent, not
  behaviour. Where a brief and `VISION.md` disagree, VISION wins, and a
  dated banner at a brief's top names what a later ruling overtook. Read
  the brief for its principles, list the product questions a change
  raises in its design note, and take the brief's and VISION's direction
  mid-build (tagged `[engineering]`, listed in the pull request) rather
  than asking one question at a time.
- **`docs/DECISIONS.md`:** what stands, one line each, each tagged with
  who decided it. A **[Jamie]** line is not re-litigated, and a surface
  that disagrees with it is the defect; an **[engineering]** line is a
  default you may propose changing with evidence. A line says no more
  than its decision: cite it, never restate it wider.
- **`docs/ENGINEERING.md`:** the build invariants (rate budget, migrations,
  contract versioning, ingest, packages, deploy).
- **`docs/notes/`:** one note per change, written in its pull request
  (`docs/notes/README.md`); `docs/NOTES.md` is the frozen archive to
  2026-10-10. A new decision gets its note and its DECISIONS line in the
  same change. Open items and asks for Jamie are GitHub issues
  (`needs-jamie`, `engineering`, `parked`).
- **`docs/OPERATIONS.md`:** how production is operated: the health reads,
  dead jobs and letters, the collector fleet, feedback, record truth, the
  security sweep and the incident ops' bounds.
- **`README.md`:** the workspace map.
- **Area guides**, read the one for the code you are in:

| Area | Guide |
| --- | --- |
| Home, Settings, Admin and the shared web shell | `apps/web/AGENTS.md` |
| Ladder | `apps/web/src/ladder/AGENTS.md` |
| Clan | `packages/clan/AGENTS.md` (engine, state and views: their own short guides) |
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
  `reference-audit` (the payload archive against cr-agent-api-docs),
  `discord-review` (judging the Discord posts Elixir cannot see).

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
   minor, a correction a patch, a major is Jamie's call; every bump is a
   file in `src/changes/` written by `npm run contract:bump`. `/api/v1`
   keeps ordinary semver; its `x-tool` operations mirror MCP tools and
   change with them.
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
- Clan is a set of features inside Elixir, never a separate product or
  an integration (Jamie, 2026-11-12). Private Clan state (leader notes,
  holds, decisions) reaches only those the clan's policy allows and never
  MCP or public tools. The one exception, `clans_my_view` (a person's own view), reads through
  `@elixir-mcp/auth/clan-context` (pinned by
  `services/web-api/test/clan-boundary.test.mjs`); `clans_context`
  retired in 12.0.0. The clan directory (`clans_directory` and Clan's own
  web API) reads only the policy's public part through the same seam
  (`readClanDirectory`), pinned there too.
- Canonical game facts enter only through collectors.
- Services share through packages, never each other
  (`packages/record/test/boundary.test.mjs`).

## Voice

Every word a player reads (the site, the docs' player pages, the app, mail,
the timeline's lines, Discord posts) sounds like Clash Royale, written for
a player on their phone ("Player-facing words sound like the game",
DECISIONS):

- **Short and friendly.** Short sentences and short paragraphs; "you" and
  contractions; lists over long paragraphs. Say "tap", not "click".
- **The game's words, capitalized as the game does:** player tag,
  clanmates, battle, deck, Arena, league, trophies, River Race, Clan Wars,
  Leader, Co-Leader, Elder. "Follow", never "track".
- **True first.** Promise only what the code does; a playful line is
  still a claim. No em dashes, no buzzwords, no version history in
  product pages.
- **Players are often kids.** Keep it warm and plain, and never name a
  real player in examples except King Thing #20JJJ2CCRU and POAP KINGS
  #J2RGCRVG.
- **The front-door sentence is fixed:** "Elixir is the missing social
  layer of Clash Royale: follow your friends and your clan, see how they
  play, and cheer them on."

Developer and agent pages (protocol, tools, the JSON API, operators) stay
plain and precise rather than playful. Legal lines (the unofficiality
notice, privacy, terms) change only with Jamie's word.

## Real tags

No real player's tag in code, tests, fixtures, docs or pull requests,
except King Thing #20JJJ2CCRU and POAP KINGS #J2RGCRVG: many players are
minors. Invent one over the alphabet `0289PYLQGRJCUV`, starting `#0`, and
add it to `docs/invented-tags.json`. `docs/no-real-tags.test.mjs` fails
when a file gains a tag that is none of these (the captured ones already
here are counted in `docs/no-real-tags.baseline.json` and may only fall;
`node infra/scripts/no-real-tags.mjs --update` lowers it).

## Working style

- **A session is one worktree, one branch, one pull request.** The main
  checkout stays on a clean `main`. Make a worktree at a fresh
  `origin/main` and run `scripts/worktree-setup.sh` in it. On Jamie's
  machine the domain's `scripts/session-start` does both and
  `session-finish` cleans up (`../AGENTS.md`, `../WORKFLOW.md`);
  there is no lease. Open a draft pull request at the first
  push (`gh pr create --draft --fill`): the open list is how sessions see
  each other.
- **`main` takes only pull requests:** `gh pr ready`, then
  `gh pr merge --auto --rebase --delete-branch`; merged on a green
  `validate` check, no bypass, Jamie's account included.
- **`npm run verify`** before every push: prettier, oxlint, knip and
  typecheck (`verify:static`), every workspace test (`npm test`, which is
  `infra/scripts/test.mjs`: one build, then the workspaces side by side),
  and the Lambda bundles (`build.mjs`). `npm run format` fixes style.
  When `git diff --name-only origin/main...HEAD | sh
  infra/scripts/e2e-needed.sh` prints `true`, run `npm run e2e` (the
  Playwright journeys) as well; CI will. Node is 24 (`.node-version`),
  and the test runner says so loudly on any other. After touching
  `.github/workflows/`, `sh infra/scripts/test-workflows.sh`.
- **Docs ship with the change, as files of their own:** user-visible
  behaviour updates `apps/site/src/docs/` and adds a What's new entry in
  `apps/site/src/_data/updates/` in the same commit; a change note goes in
  `docs/notes/`; a contract move is `npm run contract:bump`. Two pull
  requests never edit one shared file for these. `/docs/tools` is
  generated from the registry, never hand-edited.
- **Commits are small and message-first;** stage named paths, never
  `git add -A`; assert HEAD moved.
- **Deploying is part of done.** From a detached, freshly fetched
  `origin/main`: `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs`
  (`--acceptance=<family>` when that family's tools changed), then read
  the change back live. The deploy takes the production lock and comments
  on each pull request it shipped. Ops-lambda writes go through
  `npm run op`, which takes the same lock. A held lock is a wait; never
  clear another holder's. `--break-glass` only when GitHub itself is
  down. `/ship` has the rest.
- **Ask Jamie up front** for product calls (who sees what, what is
  promised), an MCP or `/api/v1` major, IAM edits outside a deploy and
  deleting production rows. Steps only Jamie can do (Supercell keys, DNS,
  secret values) are one exact ask in a `needs-jamie` issue.

## AWS

- Profile `cloud-engineer`, `us-east-1`; hobby-account sizing; no em
  dashes in resource names or descriptions.
- One stack, `infra/template.yaml`; every parameter is classed in
  `infra/scripts/parameters.mjs`. An unclassed one resets to its default.
- Alarms publish to SNS `elixir-mcp-alarms` for the sysadmin
  `projects-ops-alerts` queue; no email. Two since 2026-11-03
  (ledger dead jobs, scheduler missing); database free storage and the
  dead-letter queues are otto-ops' hourly `check-cloud-metrics` Dagu
  job's. The custom metrics the removed alarms read stay for Grafana. The stack owns no
  dashboard: Elixir's are in Grafana on Otto (`otto-ops`), and add none.
- The distribution carries projects-sysadmin's shared `edge` AWS WAF web
  ACL (`!ImportValue edge-waf-WebAclArn`, count mode); the stack owns none.
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
