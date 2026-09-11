# Engineering invariants

**What this is:** the rules that constrain how Elixir MCP is built, which are
not product documentation and never should have been mixed with it.

**Where the product is documented:** <https://elixir.poapkings.com/docs>. That
is the source of truth for what the service *does* — what a user, an agent and
an integration are, the tools, the roles and quotas, what is recorded. If you
are about to explain product behaviour in this repo, you are about to create a
second copy that will drift. Write it there instead.

**Where decisions are recorded:** `docs/NOTES.md`, newest last. Ratified
decisions live there and are not re-litigated.

**Why this file exists:** `docs/DESIGN.md` claimed to be the spec of record for
five days after it stopped being true. It described a claims model that had been
replaced, a tool count that had moved twice, and knew nothing of the three
principals — while `AGENTS.md` pointed every session at it as authoritative.
It is archived at `docs/archive/DESIGN-v2-2026-09-03.md`; the *reasoning* in it
is still worth reading, and the reasoning is all it should ever have carried.

---

## The rate budget is a ToS position, not an optimisation

**One conservative global budget, regardless of how many gateways exist.** The
fleet is redundancy — a gateway dying, an IP getting soft-blocked — and never
quota multiplication. Budget state is a Postgres row settled each scheduler
tick, not process memory, because a Lambda that ticks every minute has nowhere
to keep it.

Only the gateway calls the Clash Royale API at runtime. The key lives solely on
allowlisted operator machines: never in CI, never in a Lambda, never in a
browser.

**403 is also what rate-limit overage looks like.** This is the CR API's most
surprising documented behaviour and it is encoded, not assumed. Consecutive
403s open a per-gateway breaker and drain it.

## The database only moves forward

- Ordered SQL in `db/migrations/NNNN_name.sql`, applied by the **migrate Lambda
  only**, at deploy. Never at handler start. Never by hand. Concurrent Lambdas
  racing migrations is a self-inflicted outage.
- **Expand and contract.** Additive first: nullable columns, new tables, indexes
  `CONCURRENTLY`. Drops and renames land only once no deployed code reads the
  old shape. A migration that breaks running code cannot ship with it.
- **The fingerprint test** asserts that a from-scratch create and the full
  migration ladder produce the same schema — the drift between "what a new
  install gets" and "what production accumulated" has bitten this family
  before. Re-pin it from a **fresh scratch database**, never the dev one.
- **Canonical tables are lossless by policy.** Projections are rebuildable only
  within the ~60-day raw-payload window; battles, snapshots and receipts are the
  system of record and must never need a rebuild.

## One client is one connection, so one query at a time

Every handler opens a `pg.Client` — a single connection — and pg serializes
whatever you send it. `Promise.all([db.query(a), db.query(b)])` therefore
buys **no** parallelism: the second query waits for the first either way.
Measured 2026-09-09 against three `pg_sleep(0.3)` calls on one client:
913 ms concurrent-looking, 907 ms sequential. What it does buy is a
`DeprecationWarning` per overlap, and pg 9 will make it an error.

**So: await database queries one at a time.** A test walks the service
source and fails on a `Promise.all` that wraps `db.query`. If a handler
ever genuinely needs concurrent database work, it needs a second
connection (a pool), which is a capacity decision about a db.t4g.micro —
not something to reach for inside a request.

Non-database work still parallelises fine: `queueStats` fans out SQS calls
across separate clients, and that is untouched.

## The tool contract has clients that never update

- `packages/contracts` is the single source of truth for tool schemas, the error
  enum, `deck_hash`, and the `meta` envelope. Semver over the contract, not the
  code: additive is a minor, breaking is a major with a deprecation window.
- **Clients cache `tools/list` forever.** `serverInfo.version` is
  `<contract>+tools.<fingerprint>` precisely so a cache can be busted; a
  stateless server can never push `listChanged`. Every bump gets a
  `CHANGELOG` entry in the same commit — `elixir_changelog(since)` is how an
  agent discovers what moved.
- **Never hand-mirror the tool list** into another repo or a doc. It rots. The
  published `/tools.json` and the docs page are generated from the live
  registry at build time for exactly this reason.

## Tool conventions

The 1.0.0 contract (review `docs/REVIEW-2026-09-10-DOCS-TOOLS-SEAM.md`, 2.3)
made these uniform; the registry tests enforce the mechanical ones. The
product meaning of each lives on the site (`protocol.md`, "Argument
conventions"; `choosing-a-tool.md`); this list is what a new tool must do.

- **Names.** `<domain>_<noun>` for reads; `<domain>_<verb>_<noun>` only for
  writes. `*_tag` is one tag, `*_tags` an array, `collection` a slug.
- **Defaults by family.** Player-shaped tools default `player_tag` to the
  caller (`subject()`); clan tools default `clan_tag` to the recorded clan
  (`entitledClan()`); segment tools take a nested `segment` and default to
  the corpus (`SEGMENT_SCHEMA`, `segmentFilter()`). The first sentence of the
  description says which, in the fixed phrase. Nothing to default to is
  `no_subject`, never a guess.
- **Windows.** `from`/`to` (`WINDOW_ARGS`) on every windowed tool, `days` /
  `weeks` as sugar, resolved once by `resolveWindow()`; date-only bounds in
  `zoneFor()`'s zone, which the per-call `timezone` argument overrides.
- **One `applied` block** per response (`appliedBlock()`): `window` with its
  `source`, plus `limit`, `sort`, `mode`, `segment`, `verbosity` as used.
  Never `filters_applied`, `window_*`, `limit_applied`.
- **Size.** `verbosity: full | compact` (`VERBOSITY(compactDesc)`) is the only
  size control. No `summary`, `include_*` or `detail` flags.
- **Prose.** `notes: string[]` of one-sentence caveats (`notes()`),
  `methodology{}` where a formula applies, and `docs: docsRef(page, section)`.
  Formulas live on the docs page the pointer names, not in a note. No
  top-level key matching `/_note$/` outside `meta.completeness_note`.
- **Errors.** The closed set in `packages/contracts/src/errors.ts`; every
  `ToolFailure` hint names one executable next step (a tool and its
  arguments). `no_subject` for nothing to answer about; `result_too_large`
  for a cap breach, raised by the protocol layer and by `live_fetch` for a
  battle log.
- **Annotations** (`packages/contracts/src/tool-groups.ts`): `readOnly` true
  unless account state visible to others changes (the events cursor is a
  bookmark); `destructive` true if any action removes or replaces;
  `openWorld` true if any path, including a `live: true` flag, reaches the
  CR API.
- **Declarations.** Description at most 600 characters; shared schemas by
  reference (`TAG_SCHEMA`, `ON_BEHALF_OF_SCHEMA`, `WINDOW_ARGS`,
  `MODE_SCHEMA`, `SEGMENT_SCHEMA`, `TIMEZONE_SCHEMA`), never re-typed;
  `limit` carries a `maximum`; the most-called tools declare an
  `outputSchema` (`services/mcp/src/output-schemas.mjs`) that the registry
  validates responses against.
- **Every docs pointer resolves.** `services/mcp/test/docs-pointers.test.mjs`
  scans the tool modules for `docsRef(...)` and `*_DOCS` literals and fails
  when the page or H2 section is not in the built corpus. Add the section to
  the page before adding the pointer; never bend a pointer to a heading
  that says something else.
- **Every tool is in a group** that exists in `GROUP_ORDER`, and the tool
  reference (`apps/site/src/docs/tools/<group>.njk`) has one page per group.

## Ingest invariants

- Ingest is the admission boundary: validate identity fields and must-have keys
  before anything mutates durable state. Optional CR fields stay optional, so
  additive API evolution never stops the recorder.
- **Freshness advances only on admission, never on HTTP 200.** A rejected
  payload must not burn its subject's polling window.
- Idempotent by construction, so at-least-once delivery and queue retries are
  free. **Idempotent is not the same as free of writes:** an upsert whose
  `ON CONFLICT DO UPDATE` has no `WHERE` writes a new tuple version for every
  conflicting row even when nothing changes, and a battlelog is 25 battles
  resubmitted on every poll — that was ~8 writes per real insert until
  2026-09-11. Guard every enrich upsert with `where (current) is distinct
  from (resolved)`, and derive follow-on work (rollups) from what was
  actually written, not from the payload.
- **A live battlelog poll touches only what is new.** `battlelog_high_water`
  holds the newest `battle_time` each observer's own log has delivered; ingest
  drops everything at or before it before any table is probed (the log is
  chronological and contiguous). The same row is the capture audit — a full
  log whose oldest battle is newer than the mark has rolled past battles we
  never saw — and the coverage question. Replayed history (a fetch older
  than 24h) neither consults nor moves the mark; keep it that way or an
  import silently discards everything older than the present.
- Gateways gzip every response body; a post-compression overflow is rejected
  loudly, because it means the CR response shape changed and that wants a human.

## Where the patterns live

- **CR API truth:** `cr-agent-api-docs` — a standalone repo, deliberately NOT
  vendored here. Two projects carried copies; both drifted, in both directions.
  Read it in place, and **write to it** when the live API surprises us.
- **Recorder patterns:** `elixir-bot` (Python, patterns only — never code).
- **Infra style:** `drop.poapkings.com/infra/`, including the parameter-wipe
  guard, which must not be lost in translation.

## Deploying

`node infra/scripts/deploy.mjs` with `AWS_PROFILE=jamie` **in the environment** —
the CLI profile flag alone does not satisfy the SDK's provider chain. Order is
build → upload → migrate → stack → web. It is smoke-gated, and deploys are
cumulative: never deploy past a commit whose infrastructure change is blocked.

## Verification follows the boundaries

`npm run verify` is the same pre-push and CI gate: formatting, lint, Knip and
all workspace tests. The root test command first builds the shared contracts,
so a fresh checkout cannot depend on a previous local build. Knip entries name
actual executable roots per workspace;
remove obsolete entries instead of suppressing configuration hints. Successful
account journeys use the real web API, JSON transport and per-run scratch
Postgres databases. Crash-containment tests serve a different purpose and do
not substitute for those journeys.

Metadata rules live in `packages/contracts/src/meta.ts`. Producers validate
there and at the registry boundary; a new metadata field needs its type and
runtime rule together. The response guide's example is generated from this
contract and validated again from built HTML. Keep cross-tool numerical
agreement and protocol serialization tests alongside endpoint-specific tests.


## Platform Integration API

The public [integration guide](../apps/site/src/docs/integrations.md) and
`packages/contracts/integration-api.openapi.json` define `/api/v1`. The API runs
in web-api behind a no-cookie CloudFront behavior. `service_token.audience`
separates REST and MCP credentials, and `integration` holds permissions and
capacity independently of the sponsoring person. Admin management lives in
`services/web-api/src/routes/integrations.mjs`; personal principal routes cannot
manage these identities. Legacy MCP credentials are unchanged by migration 0058.

The data seam is `services/ingest/src/{game-clock,recorded-profile}.mjs`, shared
with MCP. Async requests bind integration, idempotency key and ledger job;
completion requires admitted receipt plus projected data. The existing scheduler
still owns global pacing. Operational cleanup expires refresh records and keeps
90 days of integration usage. REST operations use the existing call audit with
`surface=rest`, token/account/request identity and HTTP status.

Collection grants use the actual collection owner without impersonating them.
`setCollectionMembers` owns the membership lock, capacity check, attribution and
recording reconciliation transaction. Only requested tags are reconciled on
add retries; manual members and other recording reasons survive. Schema changes
are expand-first. Deploy MCP, provision a REST credential and collection grant,
then switch Drop's backend credential and code together. Read-only API checks
and ordinary traffic verify the cutover before revoking the old MCP key.


For a controlled migration, the IAM-only migrate Lambda accepts
`{integration:{action:"list"}}` and the same admin configuration body under
`integration`. Creation/rotation require a locally generated `token_hash`;
plaintext is never sent to Lambda. `retire_legacy` requires the new integration
id and the old digest, only matches a same-named MCP key on its human sponsor,
and requires a successful audited REST call. It cannot revoke another agent's
credential. Stage Drop's `ElixirIntegrationKey` parameter with the previous code
artifact; CI then deploys the REST client while preserving the staged key.
