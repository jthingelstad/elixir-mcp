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
- **A migration never rewrites a large table.** The migrate Lambda has
  300 s and a migration is one transaction; `ALTER TABLE` takes an ACCESS
  EXCLUSIVE lock that the transaction holds to its end. 0099 as first
  written (add column + 468k-row UPDATE + two index builds) outlived the
  Lambda, and its orphaned backend kept the lock until every connection
  was queued behind it - the door was down ~35 minutes (docs/NOTES.md,
  2026-09-15). The shape is: the migration adds the nullable column
  (instant, no default that rewrites); a keyset-batched migrate op fills
  it in short transactions (`{type_backfill}`, `{deck_backfill}` were
  this); index builds follow in their own migration once filled. If a
  migration needs more than a few seconds of lock, it is an op.
- **The fingerprint test** asserts that a from-scratch create and the full
  migration ladder produce the same schema — the drift between "what a new
  install gets" and "what production accumulated" has bitten this family
  before. Re-pin it from a **fresh scratch database**, never the dev one.
- **Canonical tables are lossless by policy.** Projections are rebuildable
  from the S3 payload archive (every distinct payload, forever); battles,
  snapshots and receipts are the system of record and must never need a
  rebuild.
- **Tools never read `api_payload`.** Its JSON column is a cache for a reader
  waiting on that exact payload - `live_fetch`, on the live lane, within
  seconds - and only live-lane payloads carry it (a lane rule, never an
  endpoint exemption). Every product-facing datum has a projection: the
  card catalog is `card`, a player's collection is `player_card` (0076).
- **Cards played are rows, not JSON (0091, column gone in 0097).** The
  record a tool reads is `deck` (one row per `deck_hash`, the contract's
  identity), `deck_card` (its cards by form) and
  `battle_participant_card` (what each participant played, with levels);
  the byte-true capture is the payload archive in S3. Ingest writes all
  three in the battle's transaction; `{deck_census}` proves nothing is
  missing. Tests that seed a battle by hand write the rows through
  `services/mcp/test/deck-rows.mjs` (`hashFor` + `seedPlayedDeck`).
  A card seen in a battle before the daily catalog poll gets a stub
  `card` row (`catalog_seen_at` null) and queues a live catalog fetch -
  ingest never waits on catalog integrity (Jamie, 2026-09-15). New
  card-shaped questions go through these tables. The card rows are
  reached by primary-key prefix `(battle_id, player_tag)` from a
  participant, and corpus-wide "which battles used card X" walks
  `deck_card (card_id) -> deck_hash -> battle_participant (deck_hash,
  battle_time)`; do not add a battle_id-carrying secondary index on the
  card rows again (0096: three of them were 1.68 GB against 88 MB of
  shared buffers, and the plans never used them).
  On 2026-09-11 the catalog had a by-name carve-out in the sweep and the
  collection had none, and `players_collection` answered `cards: []` for
  most players most of the day.

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
  (`entitledClan()`); segment tools take `segment` and name a population
  (`SEGMENT_SCHEMA`, `resolveSegment()`, `segmentFilter()`): `"mine"`,
  `"corpus"` or an object naming one subject. The corpus is one population
  among the others, never a default (Jamie, 2026-09-18): `segment` is
  required since 4.0.0 (`resolveSegment()` refuses its absence with the
  argument's own description as the hint) and a corpus read carries
  `population` (`populationBlock`). The first sentence of the description
  says which, in the fixed phrase. Nothing to default to is `no_subject`, never a guess.
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
- **The mark rides the lease, so duplicates never cross the wire.** A
  bulk-lane battlelog lease carries `filter.battles_after` (the mark, in the
  API's own `battleTime` spelling — collectors compare strings, never parse
  dates); the collector submits the API's array minus everything at or
  before it, plus `observed`/`filtered` counts in the envelope. The hub's own
  mark filter still runs underneath (a collector that ignores the filter is
  correct, only wasteful). Never on the live lane: `live_fetch` hands the
  agent the whole log. The archived S3 object is that filtered array — API
  shape, new battles only, since 2026-09-11.
- Gateways gzip every response body; a post-compression overflow is rejected
  loudly, because it means the CR response shape changed and that wants a human.
- **Collectors check in; the door never waits.** `/lease` answers at once
  with a job or `empty` and `next_check_in_s` (0 while work remains; when
  idle, the seconds to the caller's own slot in the 15 s cycle - slots are
  evenly spaced by rank among collectors heard from in the last 5 minutes,
  computed against the wall clock, so a fleet of N idles one check-in
  every 15/N s and never arrives together after a scheduler tick;
  `phasedCheckIn` in the door); every collector serves the live lane first.
  There is no live channel and no long-poll: the old 500 ms re-check loop
  was ~350k transactions a day and most of the web-api Lambda bill. Ledger
  settlement runs on the scheduler tick, not per call.
- **`live: true` is asynchronous.** Fresh if a receipt inside the API's own
  `max-age` is in hand (whichever lane fetched it - the API would serve the
  same cached copy), else one priority job is minted (charged once, at the
  mint; a second ask while it is open is the same ask) and the record
  answers now with `live_status.pending`. Nothing polls Postgres inside an
  MCP call (`services/mcp/src/live.mjs`).
- **The shape of every admitted payload is known, and a change is a work
  item** (time-series review 2.7; Jamie, 2026-09-17). Every endpoint's
  projector carries a field manifest (`services/ingest/src/payload-keys.mjs`):
  for each field the API sends, at the top level and inside each array's
  elements, either the table and column it lands in, or `derived: <from>`,
  or `dropped: <reason>`. A test walks every fixture payload and fails on a
  field the manifest does not name, and on a manifest entry with no
  disposition. Ingest itself does nothing more: the check is out of band.
  The nightly shape census (`{shape_census}` in the jobs Lambda, 05:05Z,
  after the payload sweep) reads a sample of the day's archived objects per
  endpoint (twenty, the newest first), and reports two things per
  endpoint: fields present in the sample and absent from the manifest (the
  API added something), and manifest fields absent from every sampled
  payload for seven days (the API retired something, as `expLevel` was;
  `payload_shape_seen`, 0132, is its memory). Each finding is filed once
  into `feedback` under the owner account with `category: data_quality`,
  `surface: recorder` and a context of `{endpoint, path, first_seen,
  sample_type, seen_in}`, deduplicated on `(endpoint, path)` while an item
  is open; Close the Loop reads the queue on its schedule and turns the
  item into the change (the manifest entry and projection, the contract
  bump, the docs, the `cr-agent-api-docs` entry). The same run emits
  `ElixirMCP/Record PayloadShapeFindings` so the count is on the
  dashboard; nothing mails anyone. Collectors stay dumb: they gzip bytes
  and never parse, so shape is the hub's to know.
- **A receipt says what the fetch was worth** (0077): `new_facts` is the
  projection's own count of rows inserted or changed, `ingest_ms` the
  transaction's wall time, `api_bytes` what the collector read before any
  filter. Points reward `new_facts > 0` only. Every projector returns
  `facts`; a new one must.

## Mail is transactional until a kind says otherwise

Every email kind in `packages/contracts` (`EMAIL_KIND_CLASS`) is classified
**transactional** or **bulk**, and the classification is the whole mail
policy (settled 2026-09-17 with the move to SES):

- A **transactional** message is one a person asked for (a sign-in code) or
  the direct consequence of their own or the operator's action. It carries
  **no `List-Unsubscribe`**: nobody can opt out of a code they just
  requested, Gmail's and Yahoo's bulk-sender rules exempt transactional mail,
  and the header on it would be a false signal. The body says "if you did
  not request this, ignore it" instead. Every kind today is transactional.
- A **bulk** message goes to many people on a schedule (a digest). It MUST
  carry `unsubscribe.url` (https). The relay adds `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) from it;
  the validator refuses the message without it, and refuses a transactional
  kind that carries one.

Adding a kind without classifying it fails to typecheck, so the decision
is made where the kind is born and cannot be forgotten. The unsubscribe
endpoint is `/api/email/unsubscribe` (2026-09-18, with the six product
kinds; docs/EMAIL.md). SES's own open and click tracking are never
enabled (the configuration set's event list has neither): no link is
rewritten through Amazon. What mail carries instead (Jamie, 2026-09-18)
is the site's Tinylytics, from `packages/mail`: a pixel whose path names
the mail (`/mail/<kind>/<period>`, `/mail/login`, `/mail/welcome`; the
owner's own notifications carry none) and `utm_` tags on links into the
site. Counts per mail, never per reader.

**Product identifiers versus measurement (ratified 2026-09-19; NOTES
that day, "Analytics and privacy, settled").** Two categories, and the
confusion between them produced wrong choices three times (issue #25's
analytics proxy, the first pass of the mail footer, the analytics
bridge's comments). *Product records* are per account and shown to the
account: call audit, email sends, account events, feedback,
connections. Their identifiers - request ids, send ids, tags - may
appear anywhere the product needs them, including in links inside
mail; they point at records the holder can open and are not tracking
identifiers, so nothing about them needs hiding from a URL.
*Measurement* is Tinylytics: per page, per mail issue, per campaign,
never per account, never per recipient. The analytics bridge
(`apps/web/src/analytics.js`) reports a record page as its kind
(`/account/activity/e`) for REPORT HYGIENE - one row per page - not as
a privacy device. The one URL that skips analytics entirely is one
carrying a credential (`/signin`). Do not add per-recipient open or
click tracking, engagement scoring, or automation on read state; do not
tie sponsorship (`/support`) to anything on an account.

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

`npm run verify` is the same pre-push and CI gate: formatting, lint, Knip, the
TypeScript check over the console and the kit packages, and all workspace
tests. The root test command first builds the shared contracts,
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
in web-api behind a no-cookie CloudFront behavior. (The only door route that
sees the session cookie is `/oauth/authorize`, the consent page, on its own
behavior since 0083; it resolves the site session with the same secret.) `service_token.audience`
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
