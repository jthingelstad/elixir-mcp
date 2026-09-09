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

## Ingest invariants

- Ingest is the admission boundary: validate identity fields and must-have keys
  before anything mutates durable state. Optional CR fields stay optional, so
  additive API evolution never stops the recorder.
- **Freshness advances only on admission, never on HTTP 200.** A rejected
  payload must not burn its subject's polling window.
- Idempotent by construction, so at-least-once delivery and queue retries are
  free.
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
