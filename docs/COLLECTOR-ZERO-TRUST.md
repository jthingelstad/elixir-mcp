# Collector zero-trust

Collectors have no AWS connectivity. They are pure API clients of Elixir
with a token we issue, a launch-time contract so collection changes need
no client update, and no IP collection at enrollment (Jamie's directive:
operators cannot be assumed safe). How to run a collector is public:
<https://elixir.poapkings.com/docs/operators>. Releasing one is
`docs/RELEASING-COLLECTOR.md`.

The collector is one Go implementation (`elixir-mcp-collector`); its
releases are signed and its updater verifies them and can roll back.

## Trust posture: open enrollment, admission is the trust

Enrollment is open (Jamie, 2026-10-12, #540): whoever raises a hand is
approved, and the admission checks are the trust a hobby record needs.
No shadow lane is built first, and there is no activation gate. A raise
creates the gateway on `probation`, the state the door leases to, with
its one-time token staged for the operator's reveal; its first admitted
submit moves it to `active`. The operator brings their own CR key,
allowlisted to their own IP with Supercell; Elixir never issues or
stores one.

What that trust rests on, all of it code that runs on every call:

1. **Shape validation and identity binding**: `admit()` in
   `packages/ingest/src/admission.mjs`. Every payload must match its
   endpoint's validator; a `player`, `clan` or `currentriverrace`
   payload must be about the tag the job asked for (`IDENTITY`); a
   battle log must carry the requested player on the team of every
   battle (`observer-missing`).
2. **Content-derived battle ids**: `canonicalBattleId` in
   `packages/ingest/src/battles.mjs` hashes the battle time, the sorted
   player tags and the battle class, so every observer's copy meets on
   one row and a fabricated battle has to agree with every clanmate's
   log of the same players.
3. **Server-stamped provenance**: the door stamps `gateway_id` (and
   `gateway_sha`) on the envelope from the token, never from the body;
   a collector cannot submit as another.
4. **Lease ownership**: a submit settles only a job whose `leased_by`
   is the caller's gateway (`bad_lease` otherwise).
5. **Per-token budget**: 10,000 work and 120 config requests per token
   per hour (`TOKEN_BUDGET`).
6. **Lease cap**: at most 2 unsubmitted leases per token
   (`MAX_OUTSTANDING`, `leaseUnderCap`).
7. **Missed-streak drain**: ten expired leases in a row and the door
   stops leasing, drains the gateway and tells the owner
   (`MISSED_STREAK_QUARANTINE`).
8. **Revoke**: the maintainer's, a row update the door checks on every
   call, with instant effect.

Monotonic MAX-merge counters bound the rest: a lie cannot walk recorded
numbers backwards.

"Quarantine", wherever the brief or a door message says it, means two
things and no more: the missed-streak drain (7) and the maintainer's
revoke (8). There is **no payload quarantine**: admission is binary,
an admitted payload from a probation collector projects straight into
canonical tables like any other, and nothing holds it back for a second
opinion. [engineering, 2026-10-12: drain plus revoke is enough; "no
shadow lane is built first".]

What admission cannot do: prove that a well-formed payload about the
right subject is TRUE. Content-derived ids and MAX-merge counters raise
the cost of a consistent lie; they do not make one impossible. That is
the risk open enrollment accepts.

**The minimum version is a switch, not a constant.** In code,
`versionRefusal` is off: it refuses `lease` and `submit` below
`min_client_version` only when the `COLLECTOR_MIN_ENFORCE` environment
variable is `1`, set from the `CollectorMinEnforce` stack parameter
(template default `"0"`). Production has it at `"1"` (read from the stack
on 2026-10-12), and deploys preserve it (`RELEASING-COLLECTOR.md`). So
the gate holds today because of that one parameter; a stack that loses
it serves a client of any version. Moving it, or the minimum, is Jamie's
call.

**Recovery is designed, not built.** Receipts carry their gateway forever
and the archive is replayable (the `{replay}` op), but there is **no
gateway-scoped purge-and-rebuild procedure and none has been run**.
Payload dedup and canonical projections make excising one observer more
involved than deleting its receipts, because a battle seen by an honest
clanmate's collector must survive the excision. Treat "lies are
removable" as an intention with a plausible mechanism under it, not a
capability on the shelf.

## The door

Three routes on `elixir.poapkings.com`, served by the collector door's
own Lambda (`services/collector`, routed by `CollectorRoute` in
`infra/template.yaml`, in the VPC with database access) over the
`@elixir-mcp/collector-door` package
(`packages/collector-door/src/door.mjs`). It has its own concurrency
ceiling, role and alarms, so a fleet burst cannot take the console's
capacity. Every route requires the CloudFront origin secret and a
per-collector Bearer token.

- **`GET /api/collector/config`**: the launch-time contract,
  `{contract_version, min_client_version, pacing_ms, breaker,
  overflow_bytes, check_in, submit_retry, doctor, gateway, observed_ip,
  update}`.
  Read at startup and hourly. `observed_ip` is the caller's address from
  CloudFront, the egress IP the operator allowlists on their CR key.
  `update` is the update authority (below).
- **`POST /api/collector/lease`**: a check-in, never a long-poll. It
  answers at once with `{job, cr_path, lease, filter?, next_check_in_s}`
  or `{empty: true, next_check_in_s}`, and the collector sleeps exactly
  that long. The idle answer is phased per collector (its own slot in the
  cycle, evenly spaced across the active fleet). Live jobs are a priority
  flag, served first to whichever collector checks in. **`cr_path` is
  computed by the server**: the client never learns the endpoint→path
  mapping, so new endpoints and collection changes ship with no client
  change. `lease` is an opaque, signed handle on a row in the Postgres
  job ledger (`packages/ledger`).
- **`POST /api/collector/submit`**: `{lease, status, body_gzip_b64 |
  error}`. The server builds the result envelope, **stamps `gateway_id`
  and `gateway_sha` from the token**, ingests it inline and settles the
  ledger job. Every authenticated call stamps `last_heartbeat_at`.

The client loop is config → `lease → fetch cr_path (paced) → submit`.
Pacing, breaker and overflow constants come from config, not compiled in.

Below `min_client_version` the door refuses `lease` and `submit` with 426
`client_too_old` only when the `CollectorMinEnforce` stack parameter is
on (`COLLECTOR_MIN_ENFORCE=1`; on in production, off by default); it never refuses
`config`, the channel a stale client updates through, and it fails open
on a version it cannot parse (`dev`).

### Tokens

Server-generated at the raise (`emcg_` prefix), stored as a sha256 hash
in the gateway row, shown once through a one-time claim-and-null
download staged for 72 hours. The operator can stage a fresh one for
their own collector (`POST /api/me/gateway-token`), which replaces the
old; the maintainer's `provision_token` does the same from Admin.
Lifecycle probation → active → draining → revoked, enforced at the door
on every call: a raise starts on probation, its first admitted submit
makes it active, and revocation is a row update with instant effect.
`pending` is only an older raise's state (config answers it; lease and
submit do not). Ingest keeps its gateway checks as defense in depth.

### Enrollment

Raise a hand with a **name only** (`POST /api/gateways`, signed in) and
a card. No static IP: the CR key's IP binding is between the operator
and Supercell. No IAM, no owner-side script, no approval step: the
raise generates the token and the one-time download is the
provisioning. The maintainer is emailed, sees every enrolled collector
in Admin → Collectors, and keeps drain and revoke.

### Fleet health

Database heartbeats are the fleet-health truth (Admin → Collectors,
`elixir_collectors`). Fleet death is alarmed by `LedgerOldestJobAlarm`
(`OldestQueuedAgeSeconds` in `ElixirMCP/Ledger`), an exhausted job by
`LedgerDeadJobsAlarm`, and the door itself by `CollectorErrorsAlarm` and
`CollectorLatencyAlarm`.

## What a hostile operator can still do, and can't

Still can: submit wrong or garbage data (admission, identity binding,
content-derived ids and revoke bound it), sit on leases (each expires and the job returns
to the ledger), hammer the door (budgeted per token, revocable
instantly). **Cannot:** touch any AWS API, impersonate another collector,
delete work unprocessed, write metrics, or learn anything beyond three
HTTPS endpoints. A live job reveals only a subject tag the recorder
already records, and its result is admitted like any other.

### The black-hole collector (takes work, never responds)

No job is lost: an unsubmitted lease expires after 90 s and the job
returns to the ledger; after five attempts it is `dead`. Against a
persistent black-holer:

- **Outstanding-lease cap**: at most 2 unsubmitted leases per token,
  atomic per gateway.
- **Per-token request budget**: 10,000 work requests (lease + submit) and
  120 config reads per token per hour, counted in `rate_limit` after
  authentication so nobody chooses the bucket they fill. Over budget is a
  429 with `retry_after_s` and `Retry-After`. The work ceiling is more
  than double what the busiest honest collector reaches at the 1500 ms
  pacing floor.
- **Missed-streak drain** (the door's 409 says `quarantined`): every
  lease that expires unsubmitted
  charges the gateway's `missed_streak` when the ledger settles it; a
  submit resets it. At ten in a row the door stops issuing leases, flips
  the gateway to draining and notifies the owner.

### The lying collector (submits plausible garbage)

1. **Built:** the admission checks above: shape validation; identity
   binding (the payload must be about the requested entity); monotonic
   MAX-merge counters (a lie cannot walk recorded numbers backwards);
   content-derived battle ids (a fabricated battle needs a story
   consistent across observers, and shared subjects are cross-checked by
   every clanmate's log); revoke.
2. **Not built, by decision: shadow verification.** Double-fetching a
   new collector's jobs on a trusted one before its results count was
   the old activation gate. Open enrollment replaced it (#540, which
   supersedes that half of #421).
3. **Not built: provenance purge.** Revoke the token, purge that
   gateway's receipts and payloads, replay the archive without them,
   keeping a trusted collector's observations of the same subjects. It
   needs a disposable database and archived fixtures before anyone relies
   on it; until then, revoke stops a liar and nothing removes what it
   already admitted.

## Updates: the server names, the release key signs

The config `update` block is the hub's `collector_release` ledger, one
`{version, sha256, url}` per platform, written only when the maintainer
names a release (`infra/scripts/name-collector-release.mjs`). The
collector repo signs each release's `SHA256SUMS` with its release key.
A collector installs a binary only when the signature verifies against
the key it carries, the signed `SHA256SUMS` covers the hash the hub
named, and the version is at or above its install floor; a new version
that cannot reach the hub rolls itself back. Naming refuses anything a
collector would refuse. Pushing malicious code to operators therefore
needs both the release key and the hub.

The collector reports what it runs in headers (`x-collector-version`,
`x-collector-binary-sha256`, `x-collector-release-key`). The door stamps
them, and `signatureState` (`packages/collector-door/src/signature.mjs`)
calls a collector `signed` when its hash equals a named hash for its
version. That is self-reported telemetry for the pages' badge, never
proof, and nothing gates on it.

## Deliberately not built

- **mTLS or request signing.** Bearer over TLS already authenticates and
  protects the transport; the token is the client identity. Submits are
  idempotent at ingest (receipt dedup).
- **Client attestation** ("prove the binary is unmodified"). Any proof
  produced on an untrusted machine is answered by that machine, and the
  target is wrong: a clean binary behind a lying proxy still poisons
  data. Behavior is checked on the output side.
- **Internal live fetches** (Jamie). They would put a CR key in the cloud
  (golden rule 2) and need VPC egress; rejected on the allowlist, egress
  cost and privacy.
- Token auto-rotation (owner-triggered regeneration only), multi-region
  doors, per-collector work partitioning.
