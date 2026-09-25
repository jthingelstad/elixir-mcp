# AGENTS.md

Elixir MCP: records Clash Royale history (the official API is current-state
only) and serves it to players' own agents through an authenticated remote MCP
server. One hostname, `elixir.poapkings.com`: the site at /, the MCP/OAuth
door path-split at /mcp, /oauth/*, /.well-known/* behind a no-cookie
CloudFront behavior (consolidated from two hostnames 2026-09-03).

**The site is two builds in one bucket** (split 2026-09-07). `apps/site`
is an Eleventy build that emits real documents for everything that is
CONTENT - home, `/docs/*`, `/updates` (which holds the changelog since
2026-09-10) - plus the
machine-readable surfaces (`llms.txt`, `llms-full.txt`, `tools.json`,
`sitemap.xml`, `feed.xml`). `apps/web` is the React application for
everything behind a session or drawn live at read time, served from
`/app.html`. A CloudFront function routes each path to its owner; that
list lives in three places (the function in `infra/template.yaml`,
`STATIC_LINKS` in `apps/web/src/App.jsx`, and the pages `apps/site`
builds) and a test pins them together. Build both with
`node infra/scripts/build-site.mjs`, which validates the merged tree
before a deploy can upload it.

**The web foundation (2026-09-13, plan in
`../elixir-family/plans/console-clan-foundation.md`).** `apps/web` is
React 19 on TanStack Router (the route tree in `App.jsx`, one lazy chunk
per section under `src/pages/`) and TanStack Query (`src/lib/queries.js`
is the one place for keys and hooks; the reader's own things are keyed
under `["me", ...]`, so invalidating the session refetches all of them).
Three workspace packages are the family's, consumed by the console
through the workspace and by the verticals as source through a pinned
git dependency: `packages/design` - tokens (`src/tokens.css`, with a
Tailwind `@theme inline reference` map so utilities exist for them) and
component rules (`src/components.css`), compiled ONCE by Tailwind v4 over
both halves' and the kit's sources into `dist/styles.css`, which both
halves serve; `packages/ui` - Chrome, Rail, LogTable, Fresh, Markdown,
Icon, ErrorBoundary, Disclaimer and the one clock vocabulary, TypeScript,
written on utilities; `packages/client` - the `{ ok, status, data }`
envelope, `createClient()`, `answered()`/`unwrap()` and the query client
with its one retry rule. Anything a vertical needs that the kit lacks is
a kit addition here, never a local copy there. An inline-style ratchet
test pins the console's count and only goes down; Radix arrives with the
first real dialog, not before.

`CLAUDE.md` is a symlink to this file. Do not fork them.

**The product is documented publicly**, at
<https://elixir.poapkings.com/docs> (source in `apps/site/src/docs/`). That is
the source of truth for what the service does — users vs agents vs
integrations, tools, roles and quotas, what is recorded. **Do not describe
product behaviour in this repo**; a second copy drifts, which is exactly how
`docs/DESIGN.md` came to claim authority while describing a model that had
been replaced. It is archived at `docs/archive/`.

**Start with `docs/ENGINEERING.md`** — the invariants that constrain how this
is built (rate budget, migrations, contract versioning, ingest, prior-art map).
What still stands is `docs/DECISIONS.md`, one line per ratified decision
and declined idea; don't re-litigate them. `docs/NOTES.md` holds the
current week's working notes (earlier weeks in `docs/notes/`); record new
decisions there as they happen and add the line to `DECISIONS.md`.

## Golden rules

1. **This repo is PUBLIC and secrets never enter it — or agent context.**
   Local `.env` only (canonical var: `CR_API_TOKEN`; Drop's differing
   `CR_API_KEY` name is not ours), written by bootstrap scripts, mode 0600.
   Never read secret values into context; handle by file/name reference.
   Verify tracking with `git ls-files`, never trust `.gitignore` alone.
2. **Only the gateway calls the CR API at runtime.** The token lives solely on
   allowlisted-IP operator machines — never in CI, Lambda, or the browser.
3. **One global rate budget.** The gateway fleet is redundancy, never quota
   multiplication. This is ToS posture, not an optimization (docs/ENGINEERING.md: rate budget).
4. **CR tags are the only IDs for game entities.** One shared normalizer, no
   surrogate keys; accounts touch game data only through `claim`.
5. **`packages/contracts` is the single source of truth** for tool schemas,
   the error enum, `deck_hash`, and the meta envelope. Versioning rules:
   `docs/ENGINEERING.md`, “The tool contract has clients that never update,”
   and `docs/DECISIONS.md`: the MCP rule is MCP-only (majors track domain
   shifts; removing an unreliable field is a patch), while the `/api/v1`
   JSON API keeps ordinary semver, so a change to a tool whose result a
   JSON API operation mirrors is checked against that operation.
6. **Schema changes are ordered migrations in `db/migrations`**, applied only
   by the migrate Lambda at deploy — never at handler start, never by hand.
   Expand-and-contract; canonical tables are lossless by policy.
7. **Never copy-paste code between repos.** Write fresh with the pattern open.
8. **`~/Projects/clash-royale/cr-agent-api-docs` is CR API truth** — a standalone repo
   (github `jthingelstad/cr-agent-api-docs`), deliberately NOT vendored here.
   Two projects carried copies; both drifted, in both directions, and real
   observations sat stranded in them for months. One checkout, edited in
   place, is the fix.

   **Write to it.** It exists to accumulate observed API behavior, and Elixir
   MCP is its best contributor: we record many clans, so we see API and game
   behavior a single-clan tool cannot. When the live API surprises us, patch
   that repo as part of the fix and push.

   Push findings that hold for ANY caller — endpoint shapes, field semantics,
   nullability, timing and reset behavior. Never push clan-specific material
   (POAP KINGS rosters, our fame, our members) or notes about downstream
   consumers of the docs; it documents the game and its API, not our use of
   them.

   `infra/scripts/cr-api.mjs` (`npm run cr`) calls any CR endpoint directly,
   which is how you check a claim before writing it down. The reference
   audit skill (`.claude/skills/reference-audit/`) diffs the whole S3
   payload archive against the reference and proposes the patches, by
   population and date, never by tag.

9. **Tests:** scratch databases generated per run (brew `postgresql@17`, no
   Docker); against live data, reads and refusal-paths only — never verify
   with writes.
10. **The unofficiality disclaimer** appears on every user-visible surface,
    including tool response metadata and this repo's README.

## AWS

- Always `--profile cloud-engineer`, region `us-east-1`. Hobby-account rules from
  `~/Projects/AGENTS.md` apply: smallest understandable solution, no em
  dashes in resource names.
- One CloudFormation stack in `infra/`. Port Drop's `parameters.mjs`
  discipline (SECRET/REQUIRED/PRESERVED with `UsePreviousValue`) — omitted
  parameters silently reset to template defaults.
- Alarms route to SNS `elixir-mcp-alarms` → the sysadmin `projects-ops-alerts`
  queue. No email subscriptions.
- No CloudWatch dashboard, and a custom metric exists only to back an
  alarm (2026-09-24): no one reads CloudWatch by hand, and agents read
  Postgres, the migrate ops and the public status endpoint. Anything else
  worth recording rides the EMF line as a plain property (Logs Insights
  reads it) or lives in the database.
- `deploy.mjs` tags the stack `awsApplication` (the myApplications
  application "Elixir"), `Application=Elixir`, `Project=elixir-mcp`,
  `Environment`, `ManagedBy` and `Repository`, the account standard in
  `projects-sysadmin` docs/AWS-TAGS.md; CloudFormation propagates them to
  every taggable resource.
- Store UTC everywhere; timezone is a display concern.

## AGENT-TEAM

Standing maintenance is objective-owned: five owners defined in
`AGENT-TEAM/` (Run Elixir MCP, Keep the Record True, Close the Loop,
Guard the Door, Keep the Boards) run on the `automations.toml` schedules.
Read order for any objective run: this file and `docs/DECISIONS.md` ->
`AGENT-TEAM/WORKFLOW.md` -> `AGENT-TEAM/README.md` -> the objective file.
The repo skills (`.claude/skills/`) are the procedures for recurring work;
read the one that fits before starting:

- `ship`: a finished change to production (bookkeeping, verify, commits,
  deploy with the right acceptance scope, acceptance triage, read-back).
- `tool-change`: adding or changing an MCP tool, from the DECISIONS check
  to the JSON API mirror and the docs.
- `migration`: a schema change, expand-and-contract, and a backfill as an op.
- `ops`: live diagnostics and the catalogue of every migrate op (a test
  keeps the catalogue equal to the code).
- `gym`: the adversarial tester of the MCP tool families; it replaced the
  daily Claude Cloud routine, which is retired.
- `consistency`: a decision reaching every surface that depends on it
  (`/consistency <decision>` the day a DECISIONS line lands or changes,
  `/consistency sweep` before a milestone).
- `reference-audit`: the S3 payload archive against cr-agent-api-docs. EVERY mutating actor on
this checkout - objective run or interactive session - claims the
checkout lease first (`AGENT-TEAM/scripts/objective-lease.mjs`).

## Working style

- Work lands on `main`; CI (validate workflow) must stay green.
- **Docs ship with the change**: anything altering architecture or
  user-facing behavior updates the site docs (`apps/site/src/docs/`) and
  the What's-new list (`apps/site/src/_data/updates.js`) in the same
  commit. The tool reference (`/docs/tools`) is GENERATED from the MCP
  registry - never hand-edit it; fix the tool's declaration instead.
- `npm run verify` (prettier check + oxlint + knip + typecheck + all workspace tests) is the
  pre-push gate; `npm run format` fixes style. `npm run knip` can also run
  the dead-export/dependency check alone during refactoring. CI uses the same gate.
- Commits are small and message-first; assert HEAD moved after committing
  (don't pipe commit output through `tail`).
- Deploy with `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs`.
  Acceptance is opt-in per deploy and `deploy.mjs` prints a WARNING when
  it is skipped: pass `--acceptance=<family>` whenever a tool in that
  family changes, and the whole suite (`--acceptance`) only for shared
  code or a release.
- Manual steps only Jamie can do (Supercell keys, DNS, secret values,
  first-run bootstrap) get queued in `docs/NOTES.md`, not silently blocked on.
- Collector (gateway) code lives in its OWN repo:
  `~/Projects/clash-royale/elixir-mcp-collector` (github jthingelstad/elixir-mcp-collector,
  split 2026-09-04). Pushing to that repo's main does NOT deploy it: a
  green push publishes a CANDIDATE (prerelease) that nobody runs, and it
  reaches the fleet only when this repo names it, which also promotes it
  to Latest. Named versions land on collectors within the hour. Follow
  `docs/RELEASING-COLLECTOR.md` — candidate, soak, name, verify, roll
  back — it carries the platform-key trap that fails silently. The
  collector contract (`config`, `lease`, `submit`) stays canonical here in
  `packages/contracts` — contract changes land server-side first
  (operators read <https://elixir.poapkings.com/docs/operators>). There is
  no collector version pin, not even for a canary: rollback is naming the
  previous release.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*


### Platform integrations

`/api/v1` is Elixir's versioned JSON API, a public product beside MCP (Jamie,
2026-09-23). It admits two kinds of caller. Admin-managed platform integrations
use their `svt_` integration key. People use an OAuth grant whose audience is
`/api/v1`, which the family's own apps use (Elixir Clan reads Elixir through it,
not through MCP). Each operation declares the callers it admits
(`x-principals`). First-party clients (every redirect URI on a family origin)
are not metered. Read
[`apps/site/src/docs/integrations.md`](apps/site/src/docs/integrations.md) and
`packages/contracts/integration-api.openapi.json` before changing this contract.
Preserve REST/MCP credential audience separation (an MCP token never
authenticates at `/api/v1`, and a `/api/v1` token never at MCP), integration-owned quotas,
principal-bound asynchronous refreshes and narrow collection-add grants. Drop's
automatic membership is deliberate; supplied tags are unverified, enrollment is
not capture, and canonical game facts still enter only through collectors.
