# Collector Zero-Trust — kill the IAM users

**Design gate — awaiting Jamie's ratification (2026-09-06).** Jamie's
directive: operators cannot be assumed safe; collectors must have NO
AWS connectivity — pure API clients of Elixir MCP with a token we
issue, a launch-time contract so collection changes need no client
update, and no IP collection at enrollment.

## Assessment of the current model — the worry is justified

Today each collector holds a per-collector **IAM user** (a principal
inside the AWS account) plus the operator's own CR key. Verified
against the shipped code, three concrete problems:

1. **`cloudwatch:PutMetricData` on `Resource: "*"`**
   (provision-gateway.mjs). PutMetricData cannot be resource-scoped and
   the policy sets no namespace condition — any collector can write
   metrics into ANY namespace in the account: fake another collector's
   heartbeat, pollute billing/ops metrics, trip or silence
   metric-based alarms.
2. **Results are attributed by an unauthenticated field.** Ingest
   trusts `msg.gateway_id` from the message body; every collector holds
   send-rights on the same results queue. Any operator can submit
   results AS any other collector (only `revoked` is refused).
   Admission's new identity binding limits data damage, but
   attribution, credits, and lifecycle trust are all spoofable.
3. **Request-queue rights allow silent denial.** `ReceiveMessage` +
   `DeleteMessage` on the shared request queues means a hostile
   collector can drain jobs and delete them unprocessed — invisible
   except as falling yield.

Beyond the concrete holes: IAM users are long-lived credentials whose
misuse surface is "the AWS control plane said no," not "the request
never reached AWS"; every enrollment requires the owner to run a local
IAM-minting script (the whole provisioning dance exists only because
NAT-free VPC Lambdas cannot call IAM); and key revocation is an IAM
operation rather than a row update. **Verdict: the zero-trust direction
is right, and it also deletes our most complex operational flow.**

## The design: collectors as pure Elixir MCP API clients

### Doors

Three routes on the existing hostname, served by web-api (which already
sits in the VPC with SQS + DB access), Bearer-authenticated by a
per-collector token:

- **`GET /api/collector/config`** — the launch-time contract:
  `{contract_version, pacing_ms, breaker: {threshold_403, cooldown_s},
  overflow_bytes, poll: {live_wait_s, bulk_wait_s, idle_backoff_s},
  min_client_version}`. Fetched at startup and re-fetched
  opportunistically; `min_client_version` is the kill switch that can
  force a self-update.
- **`POST /api/collector/lease`** — long-polls live-then-bulk
  server-side (SQS wait bounded ~10s, inside CloudFront's origin
  timeout) and returns `{job, cr_path, lease}` or `{empty: true}`.
  **`cr_path` is computed by the server** — the client never learns
  endpoint→path mapping, so new CR endpoints and collection changes
  ship with zero client changes. `lease` is the opaque SQS receipt
  handle; the 60s visibility timeout means a leased-but-never-submitted
  job redelivers itself — an operator can no longer black-hole work.
- **`POST /api/collector/submit`** — `{lease, status, body_gzip_b64 |
  error}`. The server builds the result envelope, **stamps gateway_id
  and gateway_sha server-side from the token** (spoofing dies), sends
  to the results queue, deletes the request message. Every
  authenticated call also stamps `last_heartbeat_at` in the DB.

The client loop collapses to: config → `lease → fetch cr_path (paced)
→ submit`. No AWS SDK in either runtime — the Go binary drops
aws-sdk-go entirely, the Node worker drops @aws-sdk. Pacing, breaker,
and overflow constants come from config, not compiled-in.

### Tokens

Server-generated at approval, stored as a **hash** in the gateway row
(the service-token pattern), shown once via the existing one-time
claim-and-null download. Lifecycle unchanged (pending → probation →
active → drain → revoke) and enforced at the door on every call —
revocation is a row update with instant effect. Per-token rate limits
ride the existing rate_limit table. Ingest keeps its gateway checks as
defense in depth.

### Enrollment simplifies to almost nothing

Raise a hand with a **name only** (the card identity stays
server-assigned, as today). No static IP — the CR key's IP binding is
between the operator and Supercell and never our business. No IAM
minting, no owner-side script, no migrate-lambda staging op: approval
generates the token and the one-time download IS the provisioning.
`static_ip` becomes nullable and leaves the form and admin display.

### Heartbeat telemetry

The per-gateway CloudWatch namespaces (`ElixirMCP/Gateway/<name>`) go
away with the permission that fed them. DB heartbeats (already shown on
the public Status page) become the single fleet-health truth; fleet
death is already alarmed via bulk-queue age. One less credential use,
one less unpinnable permission, no custom-metric spend.

### What a hostile operator can still do — and can't

Still can: fetch wrong/garbage data (admission + identity binding +
lifecycle quarantine bound it), sit on leases (visibility timeout
redelivers), hammer the API (rate-limited per token, revocable
instantly). **Can no longer:** touch any AWS API, impersonate another
collector, delete work unprocessed, forge metrics, or learn anything
about the tenant beyond three HTTPS endpoints.

### Channels: bulk for operators, live for us (Jamie, 2026-09-06)

Instead of one lease door with QoS, the fleet splits into two
**server-assigned channels**, carried in the config payload so it is
not even a client fork — same binary, different config:

- **`bulk`** — the default and the ONLY channel open to outside
  operators. Bulk jobs are scheduler-chosen, latency-irrelevant work:
  the client polls lazily (drain-until-empty, then idle backoff from
  config — no held connections at all). An operator collector never
  sees which subjects users are asking about in real time, and can
  never serve a payload straight into a user's live answer.
- **`live`** — grantable only by the owner, run only on our own
  machines. These long-poll for the 1–3s live-lane SLA.

This is better than QoS on three axes. **Security:** live jobs reveal
user intent (who is being asked about, right now) and their results
flow directly into answers — exactly the surface to keep out of
untrusted hands; bulk operators only ever learn what the recorder
already decided to poll. **Scale:** standing long-polls now scale with
OUR machines (one or two), not the open fleet — the concurrency
concern below evaporates for the part that grows. **Semantics:** the
two SQS queues already exist; the door simply serves each token its
channel. If our live collectors are down, `live_fetch` degrades to its
structured `live_unavailable` while operator bulk recording continues
untouched.

### Considered and REJECTED (Jamie, 2026-09-06): internal live fetches

Could Elixir MCP make live fetches itself? Technically yes, and it
would delete the live channel entirely — but it changes two deliberate
postures, so it is a separate decision:

1. **A CR key would live in the cloud.** Golden rule 2 today: the CR
   key exists only on operator machines, never in Lambda. Internal
   live means a Supercell key in Secrets Manager, resolved into a
   fetcher Lambda. IP-bound and revocable, but a rule change.
2. **The VPC would need egress.** NAT-free is a security posture. A
   managed NAT gateway is ~$32/mo (material against the $40 cost
   alarm); the hobby-honest alternative is a t4g.nano NAT instance
   with an Elastic IP (~$4/mo) — which is a small pet to keep.
   Supercell allowlists the EIP.

What it buys: the live lane stops depending on any home machine's
uptime, and the collector story collapses to "operators do bulk,
full stop." What it doesn't buy: our machines still run bulk
collectors anyway, so the machine dependency leaves only the live
path — a path that already degrades to a structured
`live_unavailable` rather than failing.

**Decision (Jamie):** rejected — the IP-allowlist/egress cost plus the
privacy angle settle it. Live stays on private collectors WE run; the
channels split above is the ratified shape.

### Costs and trade-offs, stated honestly

- Long-poll concurrency is confined to the owner-run live channel
  (one or two machines) — the open fleet holds no connections. Bulk
  jobs gain up to one idle-backoff interval of latency, irrelevant
  against cadences measured in minutes.
- One extra HTTPS hop per job (~50–150ms) against a 1.5s pace — negligible.
- web-api's role gains receive/delete on request queues + send on
  results (an internal role, not an operator credential).
- The bearer token is still a secret in the operator's .env — but
  single-purpose, instantly revocable, and worthless against AWS.

## Certificates, signing, and the two bad collectors (Jamie's stress-test, 2026-09-06)

### mTLS / request signing: NO

Bearer-over-TLS already gives us authenticated, confidential transport;
mTLS would add a client-certificate lifecycle (issue, renew, revoke)
for a hobby fleet with no gain — the token IS the client identity, and
the server's identity comes from public TLS. Request signing (HMAC over
bodies) defends against replay and tampering that TLS already prevents;
submits are additionally idempotent at ingest (receipt dedup). Neither
earns its operational weight here.

### Client code attestation ("prove the binary is unmodified"): NO

Any integrity proof produced ON an untrusted machine is answered BY
that machine — a modified client reports the clean binary's hash.
Unforgeable attestation needs a hardware root of trust (TPM/enclave),
which is enterprise machinery this fleet will never justify. It is
also the wrong target: a byte-perfect binary behind a lying proxy
still poisons data, and a modified binary that submits truth is
harmless. Integrity of BEHAVIOR is what matters, and the
output-side defenses below are how it is checked. Hashing earns its
keep only in the download direction (the server names the SHA-256 the
client must install), and `gateway_sha` stays in heartbeats as an
honest what-are-you-running signal — telemetry, never proof.

### Self-update signing: YES — and the server is the root of trust

The one real signing gap is the update path: today the collector
verifies a SHA-256 that ships in the SAME GitHub release as the binary
— whoever can forge the release can forge the hash. GO-PORT deferred
key-based signing because a key in GH secrets dies in the same
compromise. The zero-trust door solves this more cleanly than a key
ceremony: **the config endpoint becomes the update authority.**
`/api/collector/config` gains `update: {version, sha256, url}`; the
client only installs a binary whose hash the SERVER named. Pushing
malicious code to operators then requires compromising Elixir MCP
itself, not just a GitHub release — and it costs operators nothing and
us no signing ritual. (Sigstore/cosign can layer on later if the fleet
ever includes strangers at scale.)

### The black-hole collector (takes work, never responds)

The visibility timeout already guarantees no job is LOST — an
unsubmitted lease redelivers in 60s. What it doesn't stop is a
persistent black-holer grabbing jobs repeatedly: five failed
deliveries dead-letters a job, so a determined black-holer could walk
the queue into the DLQ. Because leasing is now server-mediated, we can
do what the SQS-direct model never could:

- **Outstanding-lease cap**: at most 2 unsubmitted leases per token —
  a black-holer holds 2 jobs, ever, not the queue.
- **Yield accounting**: the door counts leases issued vs results
  submitted per token. A collector whose submit ratio collapses (or
  goes N consecutive leases without a submit) is **auto-quarantined**:
  the server simply stops issuing it leases, flips it to drain, and
  notifies the owner (existing owner_notify path + feed event). Honest
  collectors are unaffected; the failure is visible in minutes instead
  of as mysteriously falling yield.

### The lying collector (submits plausible garbage)

Defense in depth, layered by cost:

1. **Already shipped**: admission shape validation; identity binding
   (the payload must be ABOUT the requested entity); monotonic
   MAX-merge counters (a lie cannot walk recorded numbers backwards);
   content-derived battle ids (fabricated battles need a
   cross-observer-consistent story, and shared subjects get
   cross-checked by every clanmate's log).
2. **Probation becomes real**: today probation is just a status. Under
   v2 it means **shadow verification** — a probation collector's jobs
   are sampled and double-fetched by a trusted (our) collector, and
   semantically stable fields (name, trophies within tolerance, badge
   counts, roster membership) are compared. Activation is EARNED by
   agreement with trusted observers, not by time served. Post-
   activation, a low sampling rate continues forever.
3. **Provenance quarantine is the backstop**: every payload's receipt
   carries its gateway forever, and projections are rebuildable from
   the S3 archive. If a liar is discovered late, the incident path is:
   revoke the token, purge that gateway's receipts/payloads, replay
   the archive without them. Lies are removable, not permanent.

## Migration (end state ratified by Jamie, 2026-09-06)

End state: **Node is retired entirely** — it was the bootstrap
implementation and v2 removes its last reason to exist (the server
computes cr_path and pins the wire shape; no shared-JS contract
argument remains). The Mac runs TWO v2 collectors on the existing CR
keys — **one Python, one Go** — deliberate runtime diversity, so a bad
release of either client can never silence the whole home fleet. The
cabin runs the same Go binary.

1. **Server first**: routes + token issuance + `static_ip` optional +
   channels; SQS path keeps working (both doors live).
2. **Collector v2 clients**: the Go client speaks HTTPS only; a small
   Python twin (~150 lines) joins it. The cabin (magic-pines) has
   never started — it begins life on the zero-trust Go client and
   **never receives AWS credentials at all**.
3. **Mac cutover**: the two Node collectors are REPLACED by one Python
   and one Go v2 client on the existing keys. Node runs the old SQS
   path until this moment and is never ported to v2.
4. **Teardown**: delete the per-collector IAM users, the minting
   script, and the collector repo's Node source; remove the
   SQS/metrics grants from OPERATORS.md; admin UI drops the IP column.

## Deliberately out (v1)

mTLS or signed requests (bearer over TLS matches the threat model at
this scale); token auto-rotation (owner-triggered regeneration only);
multi-region doors; per-collector work partitioning.
