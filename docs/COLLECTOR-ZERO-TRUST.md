# Collector zero-trust

Collectors have no AWS connectivity. They are pure API clients of Elixir
with a token we issue, a launch-time contract so collection changes need
no client update, and no IP collection at enrollment (Jamie's directive:
operators cannot be assumed safe). How to run a collector is public:
<https://elixir.poapkings.com/docs/operators>. Releasing one is
`docs/RELEASING-COLLECTOR.md`.

The collector is one Go implementation (`elixir-mcp-collector`); its
releases are signed and its updater verifies them and can roll back.

## Trust posture: read this before enrolling anyone

The name of this document describes where the collector plane is going,
not all of where it is:

- Probation is **a status, not a control**. A probation gateway fetches
  config, leases real jobs, and its admitted submissions project
  straight into canonical history like any other collector's.
- Admission proves **shape and identity**: that a payload is well-formed
  and is about the entity we asked for. It cannot prove that a plausible
  payload is TRUE. Content-derived battle ids and MAX-merge counters raise
  the cost of a consistent lie; they do not make one impossible.
- Missed-streak quarantine detects a collector that fails to return work.
  It does not detect one that returns fiction.

Therefore **collector enrollment is trusted-volunteer, not zero-trust.**
An enrolled operator is a person trusted with write access to the
permanent record, and enrollment carries exactly that weight. Enrollment
is not self-serve: raising a hand does nothing until the maintainer
approves it, and approval issues only a one-time bearer token. The
operator brings their own CR key, allowlisted to their own IP with
Supercell; Elixir never issues or stores one.

**The activation gate.** Before a gateway run by someone other than the
maintainer is moved to `active`, either the shadow lane below must ship,
or the decision to trust that specific operator must be made
deliberately and written down. "Begin probation" means "these results
count".

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
`client_too_old` when the `CollectorMinEnforce` stack parameter is on; it
never refuses `config`, the channel a stale client updates through, and
it fails open on a version it cannot parse (`dev`).

### Tokens

Server-generated at approval (`emcg_` prefix), stored as a sha256 hash
in the gateway row, shown once through a one-time claim-and-null
download. Lifecycle pending → probation → active → draining → revoked,
enforced at the door on every call: revocation is a row update with
instant effect. Ingest keeps its gateway checks as defense in depth.

### Enrollment

Raise a hand with a **name only**; the card identity is server-assigned.
No static IP: the CR key's IP binding is between the operator and
Supercell. No IAM, no owner-side script: approval generates the token
and the one-time download is the provisioning.

### Fleet health

Database heartbeats are the fleet-health truth (Admin → Collectors,
`elixir_collectors`). Fleet death is alarmed by `LedgerOldestJobAlarm`
(`OldestQueuedAgeSeconds` in `ElixirMCP/Ledger`), an exhausted job by
`LedgerDeadJobsAlarm`, and the door itself by `CollectorErrorsAlarm` and
`CollectorLatencyAlarm`.

## What a hostile operator can still do, and can't

Still can: submit wrong or garbage data (admission, identity binding and
the lifecycle bound it), sit on leases (each expires and the job returns
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
- **Missed-streak quarantine**: every lease that expires unsubmitted
  charges the gateway's `missed_streak` when the ledger settles it; a
  submit resets it. At ten in a row the door stops issuing leases, flips
  the gateway to draining and notifies the owner.

### The lying collector (submits plausible garbage)

1. **Built:** admission shape validation; identity binding (the payload
   must be about the requested entity); monotonic MAX-merge counters (a
   lie cannot walk recorded numbers backwards); content-derived battle
   ids (a fabricated battle needs a story consistent across observers,
   and shared subjects are cross-checked by every clanmate's log).
2. **Not built: shadow verification.** A probation collector's jobs
   sampled and double-fetched by a trusted collector, comparing stable
   fields (name, trophies within tolerance, badge counts, roster
   membership); activation earned by agreement, with a low sampling rate
   after. This is the activation gate above.
3. **Not built: provenance quarantine.** Revoke the token, purge that
   gateway's receipts and payloads, replay the archive without them,
   keeping a trusted collector's observations of the same subjects. It
   needs a disposable database and archived fixtures before anyone relies
   on it.

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
