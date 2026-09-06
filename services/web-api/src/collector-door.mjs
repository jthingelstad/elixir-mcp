/**
 * The zero-trust collector door (COLLECTOR-ZERO-TRUST.md, 2026-09-06).
 * Collectors are pure API clients: Bearer token we issue (sha256 stored),
 * server-assigned channel, server-computed CR path, server-stamped
 * identity on results. The SQS request/results queues stay the internal
 * transport; collectors never touch AWS.
 *
 * Route semantics:
 *   GET  config  — launch-time contract + update authority
 *   POST lease   — channel-aware job lease (cap 2 outstanding)
 *   POST submit  — result envelope built HERE; request message deleted
 *
 * Quarantine: a lease that expires unsubmitted bumps missed_streak; a
 * submit resets it; crossing MISSED_STREAK_QUARANTINE flips the gateway
 * to draining and notifies the owner. Possible only because leasing is
 * server-mediated — the SQS-direct model could never see this.
 */

import crypto from "node:crypto";
import { crPathForJob } from "@elixir-mcp/contracts";
import {
  leaseJob,
  completeJob,
  settleLeases as settleLedger,
} from "../../scheduler/src/ledger.mjs";

const TOKEN_PREFIX = "emcg_";
const LEASE_TTL_S = 90; // SQS visibility is 60s; expired rows are noise
const MAX_OUTSTANDING = 2;
const MISSED_STREAK_QUARANTINE = 10;
const MAX_BODY_GZ_B64 = 400_000; // ~300KB gzipped; SQS cap is 256KB raw msg
const CONFIG = {
  contract_version: 2,
  min_client_version: "2.0.0",
  pacing_ms: 1500,
  breaker: { threshold_403: 5, cooldown_s: 300 },
  overflow_bytes: 250_000,
  poll: { live_wait_s: 8, bulk_wait_s: 2, idle_backoff_s: 20 },
};

function sha256hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
     returning gateway_id, name, channel, status, missed_streak`,
    [sha256hex(token), statuses],
  );
  return rows[0] ?? null;
}

/** Settle the ledger, charge THIS gateway's newly expired leases to
 *  its streak, and report its outstanding count. */
async function settleForGateway(db, gatewayId) {
  const { rowCount: expiredMine } = await db.query(
    `update gateway g set missed_streak = g.missed_streak + exp.n
     from (select count(*)::int as n from job
           where leased_by = $1 and status = 'leased'
             and leased_at < now() - make_interval(secs => $2)) exp
     where g.gateway_id = $1 and exp.n > 0`,
    [gatewayId, LEASE_TTL_S],
  );
  void expiredMine;
  await settleLedger(db);
  const { rows } = await db.query(
    `select
       (select count(*)::int from job
        where leased_by = $1 and status = 'leased') as outstanding,
       (select missed_streak from gateway where gateway_id = $1) as streak`,
    [gatewayId],
  );
  return { outstanding: rows[0].outstanding, streak: rows[0].streak };
}

export function makeCollectorDoor({
  ingest, // async (db, resultEnvelope) -> pipeline outcome (0040 inline)
  notifyOwner = async () => {},
}) {
  return {
    async config(db, event) {
      const gw = await authGateway(db, event, [
        "probation",
        "active",
        "draining",
      ]);
      if (!gw) return { status: 401, body: { error: "unauthenticated" } };
      const { rows: rel } = await db.query(
        `select platform, version, sha256, url from collector_release`,
      );
      return {
        status: 200,
        body: {
          ...CONFIG,
          gateway: { name: gw.name, channel: gw.channel, status: gw.status },
          update: Object.fromEntries(
            rel.map((r) => [
              r.platform,
              { version: r.version, sha256: r.sha256, url: r.url },
            ]),
          ),
        },
      };
    },

    async lease(db, event, body) {
      const gw = await authGateway(db, event, ["probation", "active"]);
      if (!gw) return { status: 401, body: { error: "unauthenticated" } };
      const { outstanding, streak } = await settleForGateway(db, gw.gateway_id);
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
      if (outstanding >= MAX_OUTSTANDING) {
        return {
          status: 429,
          body: {
            error: "lease_cap",
            hint: `At most ${MAX_OUTSTANDING} unsubmitted leases; submit or wait ${LEASE_TTL_S}s.`,
          },
        };
      }
      const wait = Math.min(
        Math.max(Number(body?.wait_s ?? 0), 0),
        gw.channel === "live"
          ? CONFIG.poll.live_wait_s
          : CONFIG.poll.bulk_wait_s,
      );
      const lanes = gw.channel === "live" ? ["live", "bulk"] : ["bulk"];
      // Ledger lease with a short re-check loop standing in for the
      // old SQS long poll: 500ms cadence up to the wait budget - it
      // cannot miss the way SQS short polls did (0040).
      const deadline = Date.now() + wait * 1000;
      let job = await leaseJob(db, { gatewayId: gw.gateway_id, lanes });
      while (!job && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        job = await leaseJob(db, { gatewayId: gw.gateway_id, lanes });
      }
      if (!job) return { status: 200, body: { empty: true } };
      const crPath = crPathForJob(job);
      if (!crPath) {
        // Unmappable endpoint: close it out rather than bouncing forever.
        await completeJob(db, { jobId: job.job_id, gatewayId: gw.gateway_id });
        return { status: 200, body: { empty: true } };
      }
      await db.query(
        `update gateway set leases_issued = leases_issued + 1 where gateway_id = $1`,
        [gw.gateway_id],
      );
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
        gateway_id: gw.gateway_id, // SERVER-stamped: spoofing dies here
        ...(version ? { gateway_sha: version } : {}),
        fetched_at,
        status,
        ...(body?.http_status ? { http_status: Number(body.http_status) } : {}),
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
      await db.query(
        `update gateway set results_submitted = results_submitted + 1,
                missed_streak = 0,
                last_success_at = case when $2 = 'ok' then now() else last_success_at end
         where gateway_id = $1`,
        [gw.gateway_id, status],
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
