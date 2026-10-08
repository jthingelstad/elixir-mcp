# Engineering invariants

The rules that constrain how Elixir is built. What the service *does* is on
the site (`apps/site/src/docs/`, <https://elixir.poapkings.com/docs>);
writing product behaviour here makes a second copy that drifts. What stands
as a decision is `docs/DECISIONS.md`. This file is build invariants only.

---

## The rate budget is a ToS position, not an optimisation

**One conservative global budget, regardless of how many collectors exist.**
The fleet is redundancy (a collector dying, an IP soft-blocked), never quota
multiplication, and collectors never pool. Budget state is a Postgres row
settled each scheduler tick, not process memory, because a Lambda that
ticks every few minutes (`SchedulerTickMinutes`, 5 by default) has nowhere
to keep it.

**Every minted fetch is charged, once.** The tick charges the bucket for
the rows it actually inserted (a subject already queued is not charged
twice) and plans against `min(tokens, capacity - queued bulk)` of the bulk
share, so work queued through a fleet outage cannot stack past what the
bucket allows. Every new live row (the live lane, a JSON API profile
refresh, a card first seen in a deck) takes one token atomically
(`takeLiveToken` in `packages/ledger/src/ledger.mjs`); with none left it
queues nothing, charges nothing (not even the account's live quota) and
answers at the next tick. `budget_charge` records the charges by hour and
lane, and the public status reports them as `charged_24h`. The status
headline is fetches in 24 hours against the bulk share of a day,
rate x 86,400 x (1 - live_reserve).

Only collectors call the Clash Royale API at runtime. The key lives solely
on allowlisted operator machines: never in CI, a Lambda or a browser.

**403 is also what rate-limit overage looks like.** This is the CR API's
most surprising documented behaviour and it is encoded, not assumed.
Consecutive 403s open a per-collector breaker and drain it.

## What gets recorded

- **Recording follows tracking.** `packages/claims` decides who is recorded
  and why: a person's players and the players and clans they follow, in
  one pooled set of slots per person and their agents. Nothing is recorded
  for its own sake.
- **A clan nobody tracks keeps only its tracked players.** A roster poll of
  such a clan writes membership, role and roster rows only for the tracked
  players on it, plus the clan's name, and no clan day row
  (`rosterRecords` in `packages/ingest/src/roster.mjs`). A retained battle
  keeps every participant, so a later-tracked opponent's history is whole.
- **Retired endpoints are refused at every boundary.** Board and other
  retired recording endpoints are listed in
  `packages/contracts/src/recording-policy.ts` (`RETIRED_RECORDING_ENDPOINTS`)
  and refused by the plan, the lease, the collector door and ingest.
- **Admission holds a shared advisory lock.** A bulk submission with a
  server-stamped job id holds the ledger's shared session advisory lock
  through error receipts, archive writes and projection, released in
  `finally` (`packages/ingest/src/pipeline.mjs`). Anything that changes
  recording authority takes the matching exclusive lock, and a waiting
  submission rechecks authority after acquiring it. Historical replay
  without a job id keeps its own authority.

## The database only moves forward

- Ordered SQL in `db/migrations/NNNN_name.sql`, applied by the **migrate
  Lambda only**, at deploy. Never at handler start. Never by hand.
  Concurrent Lambdas racing migrations is a self-inflicted outage.
- **Expand and contract.** Additive first: nullable columns, new tables, an
  index in its own migration once its column is filled (a plain `create
  index`: every migration runs in a transaction, which refuses
  `CONCURRENTLY`). Drops and renames land only once no deployed code reads
  the old shape.
- **A migration never rewrites a large table.** The migrate Lambda has
  300 s, a migration is one transaction, and `ALTER TABLE` holds an ACCESS
  EXCLUSIVE lock to its end; an orphaned backend keeps that lock until
  every connection queues behind it. The shape: the migration adds the
  nullable column (no default that rewrites); a keyset-batched migrate op
  fills it in short transactions; index builds follow in their own
  migration. More than a few seconds of lock is an op.
  `services/migrate/test/migration-rules.test.mjs` enforces it: `NOT VALID`,
  `VALIDATE` and `SET NOT NULL` never share a file; no column type changes
  in place, no primary-key re-key, no stored generated column added to an
  existing table; a migration that locks a table it did not create sets
  `lock_timeout` first. `migration-lock.test.mjs` pins every shipped file's
  sha256 (`db/migrations.sha256`), so an edit fails verify, not the deploy.
- **A backfill that does not vacuum is not finished.** A hot backfill
  leaves the visibility map empty (`relallvisible = 0`) and every
  index-only scan falls back to the heap, so a big rewrite ends with the
  `{vacuum}` op on the tables it touched. Never run a backfill and a deploy
  together: migrate has reserved concurrency 1, so the deploy's migration
  step gets a 429 and the deploy stops.
- **Live diagnostics only through migrate ops.** No psql path reaches the
  private database; the ops (`{explain_*}`, `{vacuum}`, the census ops) are
  the read path, and an EXPLAIN runs the exact SQL the tool serves. Only
  `{}` migrates; an unknown op key is refused. The catalogue is the `ops`
  skill.
- **The fingerprint test** applies the whole ladder to a fresh scratch
  database and compares its schema with the committed
  `db/schema.fingerprint`. Re-pin it from a fresh scratch database, never a
  dev one.

## The canonical record and the archive

- **Canonical tables are lossless for what Elixir retains.** Battles,
  snapshots and receipts are the system of record and never need a
  rebuild; projections rebuild from the S3 payload archive. History leaves
  only through a reviewed, Jamie-approved manifest run as bounded migrate
  ops, which also deletes the selected archive object versions (a delete
  marker is not deletion).
- **The archive is write-once and content-addressed:** `payloads/` objects
  are written with `If-None-Match: *` (`packages/ingest/src/handler.mjs`)
  in a versioned bucket with `DeletionPolicy: Retain`.
- **Tools never read `api_payload`.** Its JSON column is a cache for a
  reader waiting on that exact payload (`live_fetch`, on the live lane,
  within seconds), and only live-lane payloads carry it. Every
  product-facing datum has a projection: the card catalog is `card`, a
  player's collection is `player_card`.
- **Cards played are rows, not JSON.** A tool reads `deck` (one row per
  `deck_hash`, the contract's identity), `deck_card` (its cards by form)
  and `battle_participant_card` (what each participant played, with
  levels); ingest writes all three in the battle's transaction, and
  `{deck_census}` proves nothing is missing. Tests that seed a battle write
  the rows through `packages/tools/test/deck-rows.mjs`. A card seen before
  the daily catalog poll gets a stub `card` row (`catalog_seen_at` null)
  and queues a live catalog fetch; ingest never waits on catalog
  integrity. The card rows are reached by primary-key prefix
  `(battle_id, player_tag)`; a card-to-battles walk goes
  `deck_card (card_id) -> deck_hash -> battle_participant (deck_hash,
  battle_time)`. Never add a battle_id-carrying secondary index on the card
  rows: they were gigabytes against the shared buffers and no plan used
  them.

## One client is one connection, so one query at a time

Every handler opens a `pg.Client`, a single connection, and pg serializes
whatever you send it. `Promise.all([db.query(a), db.query(b)])` buys no
parallelism, only a `DeprecationWarning` per overlap (an error in pg 9).
**Await database queries one at a time.**
`services/mcp/test/pg-usage.test.mjs` fails on a `Promise.all` that wraps
`db.query`. Concurrent database work needs a second connection, which is a
capacity decision about a `db.t4g.micro`, not something to reach for
inside a request. Non-database work (S3 calls) still parallelises.

## Read budgets

- Each Lambda's `statement_timeout` is set through `PGOPTIONS` in
  `infra/template.yaml`, a ceiling just under that function's Lambda kill.
- A read-only tool waits at most 5 s for a lock and answers
  `query_timeout` with a request id when its deadline passes, on every door
  (MCP, Explore, `/api/v1`) (`packages/tools/src/invoker.mjs`). Writes never
  race a deadline.
- An MCP result over `MCP_RESULT_MAX_CHARS`
  (`packages/tools/src/result-text.mjs`) is `result_too_large`, with its
  price, never a silent clip.

## The tool contract has clients that never update

- `packages/contracts` is the single source of truth for tool schemas, the
  error enum, `deck_hash` and the `meta` envelope. For **MCP**, semver
  describes the **domain contract**: a new capability is a minor, a
  correction a patch (including removing a field that withdrew an
  unreliable claim), and a major is reserved for a domain-model shift that
  changes what an agent's task means. Agents reason from the current
  declaration, schema and notes; an absent field means no claim.
- **The JSON API is versioned separately, on ordinary semver.** Its callers
  are programs (Drop, a clan's website, other integrations), so a removed
  or renamed response field is a major of
  `integration-api.openapi.json`'s `info.version`, even when the same
  change is an MCP patch; its operations serve the tool's structured
  result, so check them on every MCP field removal
  (`services/web-api/test/integration-pin.test.mjs` pins the shapes). The
  path stays `/api/v1`: it is also the OAuth audience. Its versions are on
  `apps/site/src/docs/json-api.md`.
- **Clients cache `tools/list` forever.** `serverInfo.version` is
  `<contract>+tools.<fingerprint>` so a cache can be busted; a stateless
  server can never push `listChanged`. Every bump gets an entry in
  `packages/contracts/src/changelog.ts` in the same commit;
  `elixir_changelog(since)` and `/updates` serve it.
- **Never hand-mirror the tool list** into another repo or a doc. The
  published `/tools.json` and the docs reference are generated from the
  registry at build time.

## Tool conventions

The registry tests (`services/mcp/test/tool-conventions.test.mjs`,
`packages/tools/test/tool-schema-lint.test.mjs`) enforce the mechanical
ones. The product meaning of each is on the site (`protocol.md`, "Argument
conventions"; `choosing-a-tool.md`); this list is what a new tool must do.

- **Names.** `<domain>_<noun>` for reads; `<domain>_<verb>_<noun>` only for
  writes. `*_tag` is one tag, `*_tags` an array.
- **Defaults by family.** Player-shaped tools default `player_tag` to the
  caller (`subject()`); clan tools default `clan_tag` to the recorded clan
  (`entitledClan()`); segment tools (`battles_trends`, `cards_card`,
  `badges_*`) take a required `segment` naming a population
  (`SEGMENT_SCHEMA`, `resolveSegment()`, `segmentFilter()`): `"mine"` or an
  object naming exactly one player or clan. Missing, ambiguous, collection
  and corpus selectors refuse before database work. The first sentence of
  the description says which, in the fixed phrase. Nothing to default to
  is `no_subject`, never a guess.
- **Windows.** `from`/`to` (`WINDOW_ARGS`) on every windowed tool, `days` /
  `weeks` as sugar, and `season` (`SEASON_ARG_SCHEMA`), resolved once by
  `resolveSeasonWindow()` in `tools/shared.mjs`; date-only bounds in
  `zoneFor()`'s zone, which the per-call `timezone` argument overrides.
  The session zone is UTC, pinned on the database itself, so a bare
  `::date` or `current_date` over a timestamptz is a UTC day on every
  connection. A caller's zone is applied in SQL (`at time zone`), never by
  setting the session.
- **One `applied` block** per response (`appliedBlock()`): `window` with its
  `source`, plus `limit`, `sort`, `mode`, `segment`, `verbosity` as used.
  Never `filters_applied`, `window_*`, `limit_applied`.
- **Size.** `verbosity: full | compact` (`VERBOSITY(compactDesc)`) is the
  only size control. No `summary`, `include_*` or `detail` flags.
- **Prose.** `notes: string[]` of one-sentence caveats (`notes()`),
  `methodology{}` where a formula applies, and `docs: docsRef(page,
  section)`. Formulas live on the docs page the pointer names, not in a
  note. No top-level key matching `/_note$/` outside
  `meta.completeness_note`.
- **Errors.** The closed set in `packages/contracts/src/errors.ts`; every
  `ToolFailure` hint names one executable next step (a tool and its
  arguments). `no_subject` for nothing to answer about; `result_too_large`
  for a cap breach, raised by the protocol layer and by `live_fetch` for a
  battle log.
- **Annotations** (`packages/contracts/src/tool-groups.ts`): `readOnly`
  true unless account state visible to others changes (the events cursor
  is a bookmark); `destructive` true if any action removes or replaces;
  `openWorld` true if any path, including a `live: true` flag, reaches the
  CR API.
- **Declarations.** Description at most 600 characters; shared schemas by
  reference (`TAG_SCHEMA`, `ON_BEHALF_OF_SCHEMA`, `WINDOW_ARGS`,
  `MODE_SCHEMA`, `SEGMENT_SCHEMA`, `TIMEZONE_SCHEMA`), never re-typed;
  `limit` carries a `maximum`; every tool declares an `outputSchema`
  (`packages/tools/src/output-schemas.mjs`) that the registry validates
  responses against.
- **Every docs pointer resolves.** `packages/tools/test/docs-pointers.test.mjs`
  scans the tool modules for `docsRef(...)` and `*_DOCS` literals and fails
  when the page or H2 section is not in the built corpus. Add the section
  before the pointer; never bend a pointer to a heading that says
  something else.
- **Every tool is in a group** that exists in `GROUP_ORDER`, and the tool
  reference (`apps/site/src/docs/tools/<group>.njk`) has one page per group.

## Ingest invariants

- Ingest is the admission boundary: validate identity fields and must-have
  keys before anything mutates durable state. Optional CR fields stay
  optional, so additive API evolution never stops the recorder.
- **Freshness advances only on admission, never on HTTP 200.** A rejected
  payload must not burn its subject's polling window.
- Idempotent by construction, so at-least-once delivery and retries are
  free. **Idempotent is not the same as free of writes:** an upsert whose
  `ON CONFLICT DO UPDATE` has no `WHERE` writes a new tuple version for
  every conflicting row even when nothing changes, and a battlelog is 25
  battles resubmitted on every poll. Guard every enrich upsert with
  `where (current) is distinct from (resolved)`, and derive follow-on work
  (rollups) from what was actually written, not from the payload.
- **A live battlelog poll touches only what is new.** `battlelog_high_water`
  holds the newest `battle_time` each observer's own log has delivered;
  ingest drops everything at or before it before any table is probed. The
  same row is the capture audit (a full log whose oldest battle is newer
  than the mark has rolled past battles we never saw) and the coverage
  question. Replayed history (a fetch older than 24h) neither consults nor
  moves the mark; keep it that way or an import silently discards
  everything older than the present.
- **The mark rides the lease, so duplicates never cross the wire.** A
  bulk-lane battlelog lease carries `filter.battles_after` (the mark, in
  the API's own `battleTime` spelling: collectors compare strings, never
  parse dates); the collector submits the API's array minus everything at
  or before it, plus `observed`/`filtered` counts. The hub's own mark
  filter still runs underneath. Never on the live lane: `live_fetch` hands
  the agent the whole log. The archived S3 object is that filtered array.
- Collectors gzip every response body; a post-compression overflow is
  rejected loudly, because it means the CR response shape changed.
- **Collectors check in; the door never waits.** `/lease` answers at once
  with a job or `empty` and `next_check_in_s` (0 while work remains; when
  idle, the seconds to the caller's own slot in the 15 s cycle, slots
  evenly spaced by rank among collectors heard from in the last 5 minutes,
  so a fleet of N idles one check-in every 15/N s; `phasedCheckIn` in the
  door). Every collector serves the live lane first. There is no live
  channel and no long-poll. Ledger settlement runs on the scheduler tick,
  not per call.
- **`live: true` is asynchronous.** Fresh if a receipt inside the API's own
  `max-age` is in hand (whichever lane fetched it), else one priority job
  is minted (charged once, at the mint; a second ask while it is open is
  the same ask) and the record answers now with `live_status.pending`.
  Nothing polls Postgres inside an MCP call (`packages/tools/src/live.mjs`).
- **The shape of every admitted payload is known, and a change is a work
  item.** Every endpoint's projector carries a field manifest
  (`packages/ingest/src/payload-keys.mjs`): for each field the API sends,
  at the top level and inside each array's elements, the table and column
  it lands in, or `derived: <from>`, or `dropped: <reason>`. A test walks
  every fixture payload and fails on a field the manifest does not name,
  and on an entry with no disposition. The nightly shape census
  (`{shape_census}` in the jobs Lambda, 05:05Z) samples the day's archived
  objects per endpoint and reports fields absent from the manifest (the API
  added something) and manifest fields absent for seven days (the API
  retired something; `payload_shape_seen` is its memory). Each finding is
  filed once into `feedback` under the owner account (`category:
  data_quality`, `surface: recorder`), deduplicated on `(endpoint, path)`
  while open, for the Elixir Feedback Manager to turn into the change (the
  manifest entry and projection, the contract bump, the docs, the
  `cr-agent-api-docs` entry). Collectors stay dumb: they gzip bytes and
  never parse.
- **A receipt says what the fetch was worth:** `new_facts` is the
  projection's own count of rows inserted or changed, `ingest_ms` the
  transaction's wall time, `api_bytes` what the collector read before any
  filter. Points reward `new_facts > 0` only. Every projector returns
  `facts`; a new one must.

## Grammar in code, vocabulary in data

A deck's archetype (`archetype` on every deck object) is a pure function in
`packages/contracts/src/archetypes.ts`: the priority order of win
conditions, the bait-package and bridge-partner tests, the cycle bound, how
a label is composed. It runs over a vocabulary that is DATA: which cards are
win conditions (and at which tier), bait units, bridge partners, and cards
that name a deck without being its win condition. The vocabulary lives in
`cr-agent-api-docs` (`data/card-roles.json`, `data/deck-aliases.json`), one
public URL per entry, validated by that repo's build and kept by the
domain's Clash Royale Analyst. It is imported into `card_role` /
`deck_alias` / `card_role_version` at every deploy
(`infra/scripts/import-card-roles.mjs`, from the sibling checkout: the
Lambdas have no internet), and its commit time rides every archetype as
`roles_version` beside the grammar's own version. Never write a card's role
into code, and never edit the vocabulary here.

The archetype is stamped on `deck` as a cache of that function with its
version; the nightly re-stamps every row behind the current grammar and
vocabulary, so history is relabelled on purpose when the vocabulary
improves, and readers classify at read time for any row the nightly has
not reached. No matchup table, expected advantage or quality claim rides a
label.

## Mail

Every email kind in `packages/contracts` (`EMAIL_KIND_CLASS`) is classified
**transactional** or **bulk**, and the classification is the whole mail
policy. Adding a kind without classifying it fails to typecheck.

- A **transactional** message is one a person asked for (a sign-in code) or
  the direct consequence of their own or the operator's action. It carries
  **no `List-Unsubscribe`**; the body says "if you did not request this,
  ignore it" instead.
- A **bulk** message goes to many people on a schedule. It MUST carry
  `unsubscribe.url` (https); the relay adds `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) from it,
  and the validator refuses a bulk message without it and a transactional
  one with it. The six active product kinds are bulk; the two retired
  editorial kinds remain only so sent history and old unsubscribe links
  resolve (`docs/EMAIL.md`).

SES's own open and click tracking are never enabled: no link is rewritten
through Amazon. Mail carries the site's Tinylytics instead, from
`packages/mail`: a pixel whose path names the mail (`/mail/<kind>/<period>`,
`/mail/login`, `/mail/welcome`; the owner's own notifications carry none)
and `utm_` tags on links into the site. Counts per mail, never per reader.

**Product identifiers versus measurement.** *Product records* are per
account and shown to the account: call audit, email sends, account events,
feedback, connections. Their identifiers (request ids, send ids, tags) may
appear anywhere the product needs them, including links inside mail; they
point at records the holder can open and are not tracking identifiers.
*Measurement* is Tinylytics: per page, per mail issue, per campaign, never
per account or recipient. The analytics bridge (`apps/web/src/analytics.js`)
reports a record page as its kind for report hygiene. The one URL that
skips analytics entirely carries a credential (`/console/signin`). No
per-recipient open or click tracking, engagement scoring, or automation on
read state; sponsorship (`/support`) ties to nothing on an account.

## Network posture

VPC Lambdas (web-api, collector, mcp, scheduler, migrate, jobs) run in a
NAT-free VPC and never call another Lambda. Work that needs the internet
(mail through SES, a clan's model call) is handed to the non-VPC email
relay by writing one object to the outbox bucket (`email/`, `clan-model/`)
through the S3 gateway endpoint; S3 notifies SQS, which holds retries and
the dead-letter queue. Metrics ride the EMF log line; a custom metric exists
only to back an alarm.

## Services share through packages, never each other

A service is a Lambda's door: its entry, its handler, its routes, and
nothing another Lambda needs. What more than one Lambda runs is a package,
imported by name.

| Package | Owns |
| --- | --- |
| `contracts` | versions, changelog, errors, groups, principals, modes, archetypes, the collector contract, the OpenAPI document |
| `tools` | the tool registry and everything around a call (invoker, quota, identity, live fetch, capture); MCP and web-api are its doors |
| `record` | the record's data functions and clocks, the SQL a tool and a job both read, attested facts |
| `claims` | who is recorded and why: claims, tracking reasons, pooled slot quotas |
| `ingest` | the admission boundary, payload to rows; run inline by the collector door |
| `ledger` | the job ledger and its plan; the scheduler runs it, the door and the JSON API enqueue through it |
| `collector-door` | collectors' `config`, `lease`, `submit` and the release-signature state |
| `auth` | sessions, OAuth, tokens, integration accounts, the `clans_context` reader |
| `mail`, `outbox` | rendering, the send ledger and archive, delivery; the S3 outbox |
| `clan-engine`, `clan`, `clan-state`, `clan-web` | Elixir Clan (`packages/clan/AGENTS.md`) |
| `docs` | the public docs as a corpus the MCP door serves |
| `design`, `ui`, `client` | the web kit (`apps/web/AGENTS.md`) |

| Service (Lambda) | Serves |
| --- | --- |
| `web-api` | the site's API, `/api/v1`, `/api/clan`, Explore, `/battle/*`, OAuth consent |
| `mcp` | the MCP and OAuth doors |
| `collector` | the collector door |
| `scheduler` | the ledger tick |
| `jobs` | the nightly and hourly jobs, mail builds, Clan's morning run |
| `email-relay` | the outbox: mail over SES, Clan model calls |
| `migrate` | migrations at deploy and every op |

A package is bundled into each Lambda by esbuild, so adding one needs no
infrastructure; its `package.json` names what it exports and depends on, and
knip holds both honest. `packages/record/test/boundary.test.mjs` holds the
line over `src`: no package imports a service; no service's `src` leaves its
own directory by a relative path; no service imports another by name. Tests
are exempt. Two doors over one fact read one function, and a parity test
says so (`services/web-api/test/record-parity.test.mjs`).

## The JSON API

`/api/v1` is defined by `packages/contracts/integration-api.openapi.json`
and the public guides (`apps/site/src/docs/json-api.md`,
`integrations.md`). It runs in web-api behind a no-cookie CloudFront
behavior (the only door route that sees the session cookie is
`/oauth/authorize`, the consent page, on its own behavior).

- Two callers: an integration's `svt_` key, and a person's OAuth grant
  with audience `/api/v1`. `service_token.audience` keeps REST and MCP
  credentials apart. Each operation declares the callers it admits
  (`x-principals`).
- An integration holds its permissions (`clans:read`, `mail:send`,
  `facts:write`, granted only by name) and capacity apart from its sponsor.
  Admin management is `services/web-api/src/routes/integrations.mjs`;
  personal routes cannot manage these identities.
- First-party clients (a provisioned `family_oauth_client`, every redirect
  URI on a family origin) are not metered.
- Async refreshes bind integration, idempotency key and ledger job;
  completion requires an admitted receipt and projected data. The
  scheduler still owns pacing. Calls are audited with `surface=rest`.

## Clan inside Elixir

`packages/clan/AGENTS.md` is the guide. The invariants:

- Private Clan state (`clan_state`, `packages/clan-state`) is never imported
  by MCP, the tools or any public game package. The one exception is
  `clans_context`, through `@elixir-mcp/auth/clan-context`, pinned by
  `services/web-api/test/clan-boundary.test.mjs`.
- The Postgres adapter receives the request's connected client; the caller
  owns transactions and the serialization of multi-item changes.
- The internal Clan path receives only the resolved Elixir person and the
  connected client; a request-local opaque credential keeps the closed
  reader inside the process, and no OAuth grant or integration key is
  fabricated.
- Award absence evidence reads `@elixir-mcp/record/war-membership`:
  canonical membership intervals and admitted roster observations bracket
  the whole week, with recording active before it. Finish presence or a
  current rejoin alone cannot prove absence.
- Model calls go through the outbox `clan-model/` lane with separate
  request, claim and reply prefixes (only the request prefix notifies the
  queue), sealed with their own HKDF domain; the immutable claim is written
  before the provider is contacted, so an interrupted claim is never spent
  again. No key, prompt or answer is logged. The sealed model key keeps its
  original derivation and AAD.
- A model request is one forced tool call with nothing model-specific:
  no temperature, top_p, top_k, thinking, effort or assistant prefill
  (the Claude 5 models, Haiku 5.5 included, answer a 400 to each). The
  answer is the `tool_use` block by type. A `refusal` or `max_tokens`
  stop is an error (`model_refused`, `model_cut_off`) even with a tool
  call in it, never a draft: the engine fills missing words with its
  plain template. `MODEL_PREFERENCE` only names a default when a key is
  added; a clan's saved model is never moved.
- Repair is the IAM-only `{clan_maintenance}` migrate op: bounded reads,
  digest-checked feedback responses, and an audited system withdrawal of
  one pending removal under incident authority. Sealed key items have no
  maintenance read path.

## Deploying

The whole loop is the `ship` skill; `infra/AGENTS.md` has the stack. The
invariants:

- `node infra/scripts/deploy.mjs` with `AWS_PROFILE=cloud-engineer` **in
  the environment** (the CLI profile flag alone does not satisfy the SDK's
  provider chain). It refuses uncommitted changes to tracked files, an
  unknown flag, and a HEAD that is not `origin/main` with a green
  `validate` check (`infra/scripts/lib/ci-gate.mjs`).
- Deploys are cumulative: never deploy past a commit whose infrastructure
  or access change is blocked. IAM ships with the stack through a deploy;
  an IAM change outside a deploy needs Jamie's action-specific approval.
- A bundle is named by its content, so the same source must build the same
  bytes: nothing a Lambda carries reads the clock at build time (the docs
  corpus takes `SOURCE_DATE_EPOCH` from its sources' last commit).
- The vocabulary import refuses an uncommitted reference checkout; a
  release that must not change reference content uses
  `--verify-reference-seed`, which compares the live tables with the seed
  read-only before migrations and stops on a mismatch.

## Verification follows the boundaries

`npm run verify` is the pre-push gate and CI's `validate` check (which also
builds the site and runs the Playwright journeys): formatting, lint, knip,
the TypeScript check over the console and the kit, and all workspace tests.
The root test command first builds the shared contracts. Knip entries name
actual executable roots per workspace; remove obsolete entries instead of
suppressing hints. Account journeys use the real web API and per-run scratch
Postgres databases.

**The acceptance suite** (`acceptance/`, layers in `acceptance/README.md`)
reads the deployed door as a read-only agent principal with its own token
and budget, and asserts invariants, never values that change daily. It runs
after the smoke gate when a deploy asks (`--acceptance`,
`--acceptance=<family>`) and any time with `npm run acceptance`; it never
writes and never passes `live: true`. A Gym finding's criterion goes under
its feedback id in `acceptance/checks/gym.mjs`.

Metadata rules live in `packages/contracts/src/meta.ts`; producers validate
there and at the registry boundary, and a new metadata field needs its type
and runtime rule together.

## Where the patterns live

- **CR API truth:** `cr-agent-api-docs`, standalone, never vendored. Read
  it in place, and write to it when the live API surprises us.
- **Infra style:** `drop.poapkings.com/infra/`, including the
  parameter-wipe guard.
