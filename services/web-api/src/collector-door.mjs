/**
 * The zero-trust collector door (COLLECTOR-ZERO-TRUST.md, 2026-09-06).
 * Collectors are pure API clients: Bearer token we issue (sha256 stored),
 * server-assigned channel, server-computed CR path, server-stamped
 * identity on results. Work lives in the Postgres job ledger (0040);
 * collectors never touch AWS.
 *
 * Route semantics:
 *   GET  config  — launch-time contract + update authority
 *   POST lease   — channel-aware job lease (cap 2 outstanding, atomic
 *                  per gateway — issue #5)
 *   POST submit  — result envelope built HERE, ingested inline
 *
 * Quarantine: every lease that expires unsubmitted charges its gateway's
 * missed_streak inside ledger settlement itself, whichever actor settles
 * (issue #6); a submit resets it; crossing MISSED_STREAK_QUARANTINE flips
 * the gateway to draining and notifies the owner. Possible only because
 * leasing is server-mediated.
 */

import crypto from "node:crypto";
import { crPathForJob, crBattleTime } from "@elixir-mcp/contracts";
import { checkRateLimit } from "@elixir-mcp/auth";
import { leaseJob, completeJob } from "../../scheduler/src/ledger.mjs";

const TOKEN_PREFIX = "emcg_";
const LEASE_TTL_S = 90;
const MAX_OUTSTANDING = 2;
const MISSED_STREAK_QUARANTINE = 10;

/**
 * Per-token request budgets (issue #11), the thing
 * COLLECTOR-ZERO-TRUST.md promised and the door never applied. The
 * outstanding-lease cap bounds held WORK; it says nothing about
 * request volume, so config polls, empty lease polls and refused
 * submissions could all run unmetered against the shared web API and
 * database.
 *
 * The numbers come from what a collector actually does rather than
 * from a round number. Pacing floor is 1500ms and an idle check-in
 * comes every 15/N s, so the busiest honest collector runs roughly 2,000 leases
 * and 2,000 submits an hour; WORK is set at more than double that, so
 * no honest client can reach it even mid-backfill with a fleet several
 * times this size. Config is a launch-time contract a collector reads
 * on start and refreshes hourly - single digits per hour - so 120 is
 * about thirty times what it needs and still stops a config-poll flood,
 * which is the cheapest abuse of the three.
 *
 * Deliberately distinct from the outstanding-lease cap and from CR
 * fetch pacing: those bound concurrency and upstream politeness, this
 * bounds requests at our own door.
 */
const TOKEN_BUDGET = { work: 10_000, config: 120 };

/** Charge a gateway's hourly budget. Always AFTER authentication, so a
 *  caller can never pick the bucket it fills. */
async function withinBudget(db, gatewayId, kind) {
  return checkRateLimit(db, {
    bucket: `collector-${kind}#${gatewayId}`,
    max: TOKEN_BUDGET[kind],
  });
}

/** A refusal a collector can act on: which budget, and when to come
 *  back. Retry-After rides the HTTP response as well as the body. */
function budgetRefusal(kind) {
  const retryAfter = 3600 - Math.floor((Date.now() / 1000) % 3600);
  return {
    status: 429,
    headers: { "retry-after": String(retryAfter) },
    body: {
      error: "rate_limited",
      scope: kind,
      limit_per_hour: TOKEN_BUDGET[kind],
      retry_after_s: retryAfter,
      hint: "This collector's hourly request budget is spent. The window is fixed, not sliding: wait retry_after_s and it resets.",
    },
  };
}
const CONFIG = {
  contract_version: 2,
  // 2.0.30 (2026-09-12): the first client that checks in instead of
  // long-polling. Below it the door refuses lease and submit (426) when
  // COLLECTOR_MIN_ENFORCE=1; config is never refused. Unparseable
  // versions (a py-dev checkout) are allowed, by design.
  min_client_version: "2.0.30",
  pacing_ms: 1500,
  breaker: { threshold_403: 5, cooldown_s: 300 },
  // Judged by collectors on the gzip+base64 ENCODED size. 250,000 was
  // SQS's 256 KB message ceiling minus an envelope, and the transport
  // stopped being SQS at 0040 — this door is an HTTP API behind API
  // Gateway (10 MB) and a Lambda (6 MB per synchronous invocation). The
  // ceiling is the platform's; this sits under it with room for the
  // envelope. Base64 is 4/3 of gzip, so ~3.7 MB of gzip, on the order of
  // 40-80 MB of raw CR JSON: nothing the API returns is within two
  // orders of magnitude. Raw battlelogs above 250 KB compress 10-20x and
  // must never be discarded (collector issue #1) — now they never were
  // going to be.
  overflow_bytes: 5_000_000,
  // Check-ins, not polling (2026-09-11): the door answers at once and
  // says when to come back. 0 while work remains for the collector,
  // idle_s when the queue is empty - which is also the worst-case
  // pickup delay of a live: true fetch (review §9.1, §10.4). The idle
  // answer is PHASED per collector (phasedCheckIn), never the bare
  // constant: told "15 s" from the same empty queue, five collectors
  // arrived together after every scheduler tick.
  check_in: { idle_s: 15, capped_s: 5 },
  // A failed ingestion must not make the collector abandon a valid lease
  // immediately. Keep this bounded below the 90-second lease TTL: clients
  // retry only transport failures and 5xx responses with this same envelope.
  submit_retry: { max_attempts: 3, timeout_s: 20, backoff_ms: 500 },
  // The one CR read `collector doctor` makes to prove the operator's key
  // works from the operator's IP. Server-designated like every other
  // path, so the probe can change without a client release.
  doctor: { cr_path: "/locations?limit=1" },
};

/** A collector heard from this recently holds a slot in the idle cycle.
 *  Matches the collectors' own watchdog: five minutes with no door
 *  contact and a collector exits, so one silent that long is not in the
 *  fleet either. */
const FLEET_WINDOW = "5 minutes";

/**
 * Seconds until this collector's next idle slot on the wall clock.
 *
 * Every active collector owns a fixed phase in the idle cycle, evenly
 * spaced by its rank in the fleet (N collectors, idle_s seconds: one
 * check-in every idle_s / N). The answer is the distance from now to
 * that phase - a property of the fleet and the clock, not of when the
 * caller last called - so collectors that arrive together are spread
 * within one cycle and stay spread, a collector that drained a burst of
 * work falls straight back into its own slot, and the fleet changing
 * size re-spaces everyone by the next cycle. Integer seconds because the
 * Go client parses next_check_in_s into an int; never 0 (that means
 * "come straight back"), so a caller sitting on its own slot is told
 * a full cycle.
 */
export function phasedCheckIn({ rank, fleet, idleS, nowMs }) {
  const slot = Math.floor((rank * idleS) / Math.max(fleet, 1));
  const nowS = Math.floor(nowMs / 1000);
  const wait = (((slot - nowS) % idleS) + idleS) % idleS;
  return wait === 0 ? idleS : wait;
}

async function idleCheckIn(db, gatewayId, nowMs) {
  // The caller is always in this list: authGateway just stamped its
  // heartbeat. uuid order is arbitrary but stable, which is all a rank
  // needs.
  const { rows } = await db.query(
    `select gateway_id from gateway
      where status in ('probation', 'active')
        and last_heartbeat_at > now() - $1::interval
      order by gateway_id`,
    [FLEET_WINDOW],
  );
  const rank = Math.max(
    rows.findIndex((r) => r.gateway_id === gatewayId),
    0,
  );
  return phasedCheckIn({
    rank,
    fleet: rows.length,
    idleS: CONFIG.check_in.idle_s,
    nowMs,
  });
}

// The transport bound on the COMPRESSED body (base64 chars). ONE number,
// the same one the door serves to collectors, because on 2026-09-11 there
// were two: CONFIG.overflow_bytes was raised to 5 MB and this stayed at
// 400,000, so every season-final board (~400 KB encoded) was refused with
// bad_body, the collector's lease sat unsubmitted for its 90 seconds, and
// the fleet ran at a third of its pace until the door and the collectors
// agreed again. Ingest separately bounds the DECOMPRESSED size (issue #4).
const MAX_BODY_GZ_B64 = CONFIG.overflow_bytes;

function sha256hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Pull a numeric version out of whatever a client calls itself.
 *
 *  Clients report a build string, not a bare semver: the Go binary says
 *  "v2.0.19" and the Python twin says "py-v2.0.19". Both mean the same
 *  generation. A local build says "dev" or "py-dev" and yields null.
 */
export function parseClientVersion(raw) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(raw ?? ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Is `raw` at least `min`? Unknown versions are ALLOWED.
 *
 *  Fail-open is deliberate. This gate exists to retire clients that
 *  cannot speak the current contract, not to authenticate anyone - the
 *  bearer token does that. Refusing a version we failed to parse would
 *  turn a formatting slip into a fleet-wide outage, which is exactly
 *  the failure this is supposed to prevent.
 */
export function clientMeetsMinimum(raw, min) {
  const got = parseClientVersion(raw);
  const want = parseClientVersion(min);
  if (!got || !want) return true;
  for (let i = 0; i < 3; i += 1) {
    if (got[i] !== want[i]) return got[i] > want[i];
  }
  return true;
}

/** Refuse work to a client below the minimum - but never refuse CONFIG,
 *  which is the channel it self-updates through. Locking a stale client
 *  out of the only route that could fix it is how a version gate turns
 *  into a brick.
 *
 *  Off unless COLLECTOR_MIN_ENFORCE is set, so the minimum can be moved
 *  and observed before it bites.
 */
function versionRefusal(event) {
  if (process.env.COLLECTOR_MIN_ENFORCE !== "1") return null;
  const raw = String(event.headers?.["x-collector-version"] ?? "").slice(0, 64);
  if (clientMeetsMinimum(raw, CONFIG.min_client_version)) return null;
  return {
    status: 426,
    body: {
      error: "client_too_old",
      min_client_version: CONFIG.min_client_version,
      your_version: raw,
      hint: "This collector is below the minimum client version. Released binaries update themselves from /api/collector/config within the hour; the Python twin must be re-downloaded from the latest release.",
    },
  };
}

async function authGateway(db, event, statuses) {
  const header =
    event.headers?.authorization ?? event.headers?.Authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const { rows } = await db.query(
    `update gateway set last_heartbeat_at = now()
     where token_hash = $1 and status = any($2)
     returning gateway_id, name, card_name, channel, status, missed_streak`,
    [sha256hex(token), statuses],
  );
  return rows[0] ?? null;
}

/** The filter a lease may carry (contracts LeaseFilter): the observer's
 *  battlelog high-water mark (0073), spelled the way the API spells
 *  battleTime, for bulk-lane battlelog jobs only. */
async function leaseFilter(db, job) {
  if (job.endpoint !== "player_battlelog" || job.lane !== "bulk") return null;
  const { rows } = await db.query(
    `select battle_time from battlelog_high_water where observer_tag = $1`,
    [job.entity_key],
  );
  if (!rows[0]) return null;
  return { battles_after: crBattleTime(rows[0].battle_time.toISOString()) };
}

/** A token the door knows but will never honour again. Told apart from
 *  a typo only here, on config, so a revoked operator's box can say so. */
async function isRevokedToken(db, event) {
  const header =
    event.headers?.authorization ?? event.headers?.Authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  if (!token.startsWith(TOKEN_PREFIX)) return false;
  const { rows } = await db.query(
    `select 1 from gateway where token_hash = $1 and status = 'revoked'`,
    [sha256hex(token)],
  );
  return rows.length > 0;
}

/** This gateway's current streak. Settlement (which charges every
 *  expired lease to its gateway) runs on the scheduler tick, every five
 *  minutes; it used to run here on every lease call as well - three
 *  updates over `job` per check-in, for a counter nothing reads faster
 *  than the tick (2026-09-11). */
async function inspectStreak(db, gatewayId) {
  const { rows } = await db.query(
    `select missed_streak as streak from gateway where gateway_id = $1`,
    [gatewayId],
  );
  return { streak: rows[0].streak };
}

/** Atomic per-gateway capacity check + grant (issue #5). A transaction-
 *  scoped advisory lock keyed on the gateway serializes concurrent
 *  lease calls from one token, so the outstanding count and the grant
 *  observe the same state. Held only across this check-and-grant. */
async function leaseUnderCap(db, gatewayId, lanes) {
  await db.query("begin");
  try {
    await db.query(`select pg_advisory_xact_lock(hashtext($1)::bigint)`, [
      gatewayId,
    ]);
    const { rows } = await db.query(
      `select count(*)::int as outstanding from job
       where leased_by = $1 and status = 'leased'`,
      [gatewayId],
    );
    if (rows[0].outstanding >= MAX_OUTSTANDING) {
      await db.query("rollback");
      return { capped: true };
    }
    const job = await leaseJob(db, { gatewayId, lanes });
    await db.query("commit");
    return { job };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

export function makeCollectorDoor({
  ingest, // async (db, resultEnvelope) -> pipeline outcome (0040 inline)
  notifyOwner = async () => {},
  now = () => Date.now(), // the idle cycle's clock; injected by tests
}) {
  return {
    async config(db, event) {
      // Config answers a PENDING token too - the most common new-operator
      // state is "installed, not yet promoted", and from inside the box it
      // was indistinguishable from a typo (both 401). Lease and submit
      // still refuse it; config is what `collector doctor` reads.
      const gw = await authGateway(db, event, [
        "pending",
        "probation",
        "active",
        "draining",
      ]);
      if (!gw) {
        if (await isRevokedToken(db, event))
          return {
            status: 403,
            body: {
              error: "revoked",
              hint: "This collector token was revoked by the maintainer; it will never work again. Raise your hand for a new one.",
            },
          };
        return { status: 401, body: { error: "unauthenticated" } };
      }
      if (!(await withinBudget(db, gw.gateway_id, "config")))
        return budgetRefusal("config");
      const { rows: rel } = await db.query(
        `select platform, version, sha256, url from collector_release`,
      );
      return {
        status: 200,
        body: {
          ...CONFIG,
          gateway: {
            name: gw.name,
            card: gw.card_name,
            channel: gw.channel,
            status: gw.status,
          },
          // The caller's address as the door saw it: the egress IP the
          // operator must allowlist on their CR key, read without the
          // collector talking to anything but this door.
          observed_ip: event.requestContext?.http?.sourceIp ?? null,
          update: Object.fromEntries(
            rel.map((r) => [
              r.platform,
              { version: r.version, sha256: r.sha256, url: r.url },
            ]),
          ),
        },
      };
    },

    // The body is unread since 2026-09-12: wait_s was the only field.
    async lease(db, event, _body) {
      const gw = await authGateway(db, event, ["probation", "active"]);
      if (!gw) return { status: 401, body: { error: "unauthenticated" } };
      if (!(await withinBudget(db, gw.gateway_id, "work")))
        return budgetRefusal("work");
      const tooOld = versionRefusal(event);
      if (tooOld) return tooOld;
      const { streak } = await inspectStreak(db, gw.gateway_id);
      if (streak >= MISSED_STREAK_QUARANTINE) {
        // Black-hole quarantine: stop serving, drain, tell the owner.
        await db.query(
          `update gateway set status = 'draining' where gateway_id = $1 and status <> 'draining'`,
          [gw.gateway_id],
        );
        await notifyOwner({
          kind: "gateway_quarantined",
          playerTag: gw.name,
        });
        return {
          status: 409,
          body: {
            error: "quarantined",
            hint: "Too many leases expired unsubmitted; the owner has been notified.",
          },
        };
      }
      // Every collector serves both lanes (2026-09-11): live is a
      // priority flag on a job, not a kind of collector. leaseJob orders
      // live first, so whichever collector checks in next takes it.
      const lanes = ["live", "bulk"];
      // A check-in answers at once. The pre-2026-09-11 wait_s long-poll
      // was honoured for a day of compatibility and removed 2026-09-12
      // once the fleet reported 2.0.30 clients; a client that still
      // sends wait_s is ignored and, below the minimum, refused.
      const grant = await leaseUnderCap(db, gw.gateway_id, lanes);
      if (grant.capped) {
        return {
          status: 429,
          body: {
            error: "lease_cap",
            hint: `At most ${MAX_OUTSTANDING} unsubmitted leases; submit or wait ${LEASE_TTL_S}s.`,
            next_check_in_s: CONFIG.check_in.capped_s,
          },
        };
      }
      const job = grant.job;
      if (!job)
        return {
          status: 200,
          body: {
            empty: true,
            next_check_in_s: await idleCheckIn(db, gw.gateway_id, now()),
          },
        };
      const crPath = crPathForJob(job);
      if (!crPath) {
        // Unmappable endpoint: close it out rather than bouncing forever.
        await completeJob(db, { jobId: job.job_id, gatewayId: gw.gateway_id });
        return { status: 200, body: { empty: true, next_check_in_s: 0 } };
      }
      await db.query(
        `update gateway set leases_issued = leases_issued + 1 where gateway_id = $1`,
        [gw.gateway_id],
      );
      // Collector-side filtering (Jamie, 2026-09-11): a bulk battlelog
      // lease carries the observer's high-water mark so the collector
      // drops the battles the hub already holds before submitting - the
      // duplicates never cross the wire. Never on the live lane: the
      // agent waiting on that read gets the whole log.
      const filter = await leaseFilter(db, job);
      return {
        status: 200,
        body: {
          job: {
            endpoint: job.endpoint,
            entity_key: job.entity_key,
            lane: job.lane,
          },
          cr_path: crPath,
          lease: String(job.job_id),
          ...(filter ? { filter } : {}),
          // There may be more: come straight back after submitting.
          next_check_in_s: 0,
        },
      };
    },

    async submit(db, event, body) {
      const gw = await authGateway(db, event, [
        "probation",
        "active",
        "draining",
      ]);
      if (!gw) return { status: 401, body: { error: "unauthenticated" } };
      if (!(await withinBudget(db, gw.gateway_id, "work")))
        return budgetRefusal("work");
      // Submit is gated too, but AFTER auth: a client that leased work
      // before the minimum moved still gets to hand back what it holds
      // only if it is current. Anything it cannot submit expires and is
      // re-queued by the ledger, so no job is lost either way.
      const tooOldSubmit = versionRefusal(event);
      if (tooOldSubmit) return tooOldSubmit;
      const jobId = Number(body?.lease);
      if (!Number.isInteger(jobId) || jobId <= 0) {
        return { status: 400, body: { error: "bad_lease" } };
      }
      // The lease is a DB fact: only the leasing gateway holds it, and
      // the job identity comes from the row - nothing client-supplied
      // to sign or verify (0040 replaced the HMAC lease token).
      const { rows: leased } = await db.query(
        `select job_id, endpoint, entity_key, lane from job
         where job_id = $1 and leased_by = $2 and status = 'leased'`,
        [jobId, gw.gateway_id],
      );
      if (!leased[0]) return { status: 400, body: { error: "bad_lease" } };
      const job = leased[0];

      const status = body?.status === "ok" ? "ok" : "error";
      if (
        status === "ok" &&
        (typeof body.body_gzip_b64 !== "string" ||
          body.body_gzip_b64.length > MAX_BODY_GZ_B64)
      ) {
        return { status: 400, body: { error: "bad_body" } };
      }
      const fetchedAtMs = Date.parse(body?.fetched_at ?? "");
      const fetched_at =
        Number.isFinite(fetchedAtMs) &&
        Math.abs(Date.now() - fetchedAtMs) < 300_000
          ? new Date(fetchedAtMs).toISOString()
          : new Date().toISOString();
      const version = String(
        event.headers?.["x-collector-version"] ?? "",
      ).slice(0, 64);
      const envelope = {
        v: 1,
        job: {
          endpoint: job.endpoint,
          entity_key: job.entity_key,
          lane: job.lane,
        },
        // SERVER-stamped provenance: spoofing dies here, and the job id
        // binds a live wait to ITS result (issue #3).
        job_id: Number(job.job_id),
        gateway_id: gw.gateway_id,
        ...(version ? { gateway_sha: version } : {}),
        fetched_at,
        status,
        ...(body?.http_status ? { http_status: Number(body.http_status) } : {}),
        // The collector's own count of what it saw and dropped under the
        // lease's filter; validated by the contract, read by ingest.
        ...(Number.isInteger(body?.observed)
          ? { observed: body.observed }
          : {}),
        ...(Number.isInteger(body?.filtered)
          ? { filtered: body.filtered }
          : {}),
        ...(Number.isInteger(body?.api_bytes) && body.api_bytes >= 0
          ? { api_bytes: body.api_bytes }
          : {}),
        ...(status === "ok"
          ? { body_gzip_b64: body.body_gzip_b64 }
          : {
              error: {
                kind: ["transport", "http", "overflow", "breaker"].includes(
                  body?.error?.kind,
                )
                  ? body.error.kind
                  : "transport",
                ...(body?.error?.message
                  ? { message: String(body.error.message).slice(0, 500) }
                  : {}),
              },
            }),
      };
      // INLINE INGEST (0040): the admission-and-projection transaction
      // runs here, and the door answers only after commit. Rejections
      // are recorded receipts (job done, structured feedback to the
      // collector); an exception leaves the lease held so expiry
      // requeues a bounded refetch.
      let outcome;
      try {
        outcome = await ingest(db, envelope);
      } catch (err) {
        console.error(
          "submit_ingest_error",
          job.endpoint,
          job.entity_key,
          err?.message,
        );
        return { status: 500, body: { error: "ingest_failed" } };
      }
      await completeJob(db, { jobId, gatewayId: gw.gateway_id });
      // Contact, not success: last_success_at is owned by ingest and
      // advances only on ADMISSION (issue #7) — a client-declared "ok"
      // whose payload was rejected must not look like a good fetch.
      await db.query(
        `update gateway set results_submitted = results_submitted + 1,
                missed_streak = 0
         where gateway_id = $1`,
        [gw.gateway_id],
      );
      return {
        status: 200,
        body: {
          ok: true,
          outcome: outcome?.outcome ?? "processed",
          ...(outcome?.errors ? { admission_errors: outcome.errors } : {}),
        },
      };
    },
  };
}
