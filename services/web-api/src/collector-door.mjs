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

function hmac(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

/** Signed lease token: the collector cannot alter the job it echoes. */
export function encodeLease(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(secret, body)}`;
}

export function decodeLease(secret, token) {
  const [body, sig] = String(token ?? "").split(".", 2);
  if (!body || !sig) return null;
  const expected = hmac(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
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

/** Expire stale leases and charge them to the streak; then count live ones. */
async function settleLeases(db, gatewayId) {
  const { rowCount: expired } = await db.query(
    `delete from gateway_lease
     where gateway_id = $1 and issued_at < now() - make_interval(secs => $2)`,
    [gatewayId, LEASE_TTL_S],
  );
  if (expired > 0) {
    await db.query(
      `update gateway set missed_streak = missed_streak + $2
       where gateway_id = $1`,
      [gatewayId, expired],
    );
  }
  const { rows } = await db.query(
    `select count(*)::int as outstanding,
            (select missed_streak from gateway where gateway_id = $1) as streak
     from gateway_lease where gateway_id = $1`,
    [gatewayId],
  );
  return { outstanding: rows[0].outstanding, streak: rows[0].streak };
}

export function makeCollectorDoor({
  secret,
  sqs,
  notifyOwner = async () => {},
}) {
  // sqs: { receive(queue: 'live'|'bulk'|'results', waitSeconds) -> {body, receiptHandle} | null,
  //        send(queue, body), delete(queue, receiptHandle) }
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
      const { outstanding, streak } = await settleLeases(db, gw.gateway_id);
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
      // Live-eligible collectors drain live first (0s peek), then bulk.
      let queue = "bulk";
      let msg = null;
      if (gw.channel === "live") {
        msg = await sqs.receive("live", 0);
        if (msg) queue = "live";
      }
      if (!msg) msg = await sqs.receive("bulk", wait);
      if (!msg && gw.channel === "live") {
        // One more live peek after the bulk wait: a live job that
        // arrived mid-wait beats returning empty.
        msg = await sqs.receive("live", 0);
        if (msg) queue = "live";
      }
      if (!msg) return { status: 200, body: { empty: true } };

      let job;
      try {
        job = JSON.parse(msg.body);
      } catch {
        // Malformed queue content: drop it toward the DLQ path by
        // leaving it un-deleted; tell the collector to come back.
        return { status: 200, body: { empty: true } };
      }
      const crPath = crPathForJob(job);
      if (!crPath) return { status: 200, body: { empty: true } };
      const {
        rows: [leaseRow],
      } = await db.query(
        `insert into gateway_lease (gateway_id) values ($1) returning lease_id`,
        [gw.gateway_id],
      );
      await db.query(
        `update gateway set leases_issued = leases_issued + 1 where gateway_id = $1`,
        [gw.gateway_id],
      );
      const lease = encodeLease(secret, {
        g: gw.gateway_id,
        l: leaseRow.lease_id,
        q: queue,
        rh: msg.receiptHandle,
        job,
      });
      return {
        status: 200,
        body: { job, cr_path: crPath, lease },
      };
    },

    async submit(db, event, body) {
      const gw = await authGateway(db, event, [
        "probation",
        "active",
        "draining",
      ]);
      if (!gw) return { status: 401, body: { error: "unauthenticated" } };
      const lease = decodeLease(secret, body?.lease);
      if (!lease || lease.g !== gw.gateway_id) {
        return { status: 400, body: { error: "bad_lease" } };
      }
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
        job: lease.job,
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
      await sqs.send("results", JSON.stringify(envelope));
      await sqs.delete(lease.q, lease.rh).catch(() => {
        // Visibility may have expired; the request message redelivers
        // and ingest dedups the receipt — annoying, never harmful.
      });
      await db.query(
        `delete from gateway_lease where lease_id = $1 and gateway_id = $2`,
        [lease.l, gw.gateway_id],
      );
      await db.query(
        `update gateway set results_submitted = results_submitted + 1,
                missed_streak = 0,
                last_success_at = case when $2 = 'ok' then now() else last_success_at end
         where gateway_id = $1`,
        [gw.gateway_id, status],
      );
      return { status: 200, body: { ok: true } };
    },
  };
}
