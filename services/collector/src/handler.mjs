/**
 * The collector door's Lambda (COLLECTOR-ZERO-TRUST.md). Three routes,
 * each a call into @elixir-mcp/collector-door, which authenticates the
 * collector's Bearer token itself.
 *
 * It was three routes in the web-api, and 99% of that Lambda's requests
 * (235k of 237k over the three days before 2026-09-29): a fleet burst
 * took the console's concurrency, and its lines were most of the
 * console's log. On its own function it has its own ceiling, role and
 * alarms; CloudFront sends /api/collector/* to its native Web Function
 * endpoint. The shape is the web-api's: through CloudFront or not at
 * all, one exclusive PostgreSQL pool lease per request, a soft deadline
 * under the HTTP timeout, and one handler timing line with the same fields,
 * so a Logs Insights query reads either log.
 */

import { makeDatabase } from "@elixir-mcp/http/database";
import { originAllowed, forbiddenOrigin } from "@elixir-mcp/auth";

/** What the handler keeps back from the HTTP timeout to write its log
 *  line and release its pool lease; past it the door answers 504 itself. */
const DEADLINE_MARGIN_MS = 1500;

const ROUTES = {
  "GET /api/collector/config": (door, db, event) => door.config(db, event),
  "POST /api/collector/lease": (door, db, event, body) =>
    door.lease(db, event, body),
  "POST /api/collector/submit": (door, db, event, body) =>
    door.submit(db, event, body),
};

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...headers,
  },
  body: JSON.stringify(body),
});

function deadlineMs(context) {
  if (typeof context?.remainingMs !== "function") return null;
  return Math.max(context.remainingMs() - DEADLINE_MARGIN_MS, 1);
}

async function withDeadline(ms, run, onTimeout) {
  if (ms === null) return run();
  let timer;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([run(), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

export function makeHandler({
  databaseUrl,
  database = null,
  originSecret = null,
  door,
}) {
  database ??= makeDatabase({
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_MAX ?? 4),
  });
  async function handler(event, context) {
    if (!originAllowed(event, originSecret)) return forbiddenOrigin();
    const method = event.method ?? "GET";
    const key = `${method} ${event.path ?? "/"}`;
    const route = ROUTES[key];
    if (!route) return json(404, { error: "not_found" });
    let body = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return json(400, { error: "invalid_json" });
      }
    }
    const started = Date.now();
    const requestId = context?.requestId ?? null;
    let status = 500;
    let connectMs = 0;
    let timedOut = false;
    const db = database.lease();
    try {
      const res = await withDeadline(
        deadlineMs(context),
        async () => {
          await db.connect();
          connectMs = Date.now() - started;
          const r = await route(door, db, event, body);
          return json(r.status, r.body, r.headers ?? {});
        },
        () => {
          timedOut = true;
          return json(504, { error: "timeout" });
        },
      );
      status = res.statusCode;
      return res;
    } finally {
      // What bounds a query the deadline abandoned is the connection's
      // statement_timeout (PGOPTIONS, infra/template.yaml).
      await db.end().catch(() => {});
      console.info({
        at: new Date().toISOString(),
        http: key,
        status,
        ms: Date.now() - started,
        connect_ms: connectMs,
        ...(requestId ? { request_id: requestId } : {}),
        ...(timedOut ? { timed_out: true } : {}),
      });
    }
  }
  handler.close = database.close;
  return handler;
}
