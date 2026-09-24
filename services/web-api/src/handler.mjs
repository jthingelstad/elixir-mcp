import { integrationsRoutes } from "./routes/integrations.mjs";
import { verifyRoutes } from "./routes/verify.mjs";
import { battleActivityRoutes } from "./routes/battle-activity.mjs";
import { integrationApi, integrationProblem } from "./integration-api.mjs";
import { randomUUID } from "node:crypto";
/**
 * Site API — docs/ENGINEERING.md One credential core, this is the web shell.
 *
 * Auth resolution: Bearer wins (dev/tools), else the __Host- cookie —
 * and cookie-authed state changes require the X-Elixir-Client header
 * (CSRF: SameSite=Lax + custom-header contract, librarian's pattern; the
 * CloudFront distribution for the site is the only origin that forwards
 * it). The access-gate answers identically for unknown/pending/denied
 * emails everywhere — never an oracle.
 */

import pg from "pg";
import {
  approvedAccount,
  createSession,
  resolveSession,
  sessionSeenFrom,
  originAllowed,
  forbiddenOrigin,
} from "@elixir-mcp/auth";
import { makeRegistry } from "../../mcp/src/tools.mjs";

import { collectorRoutes } from "./routes/collector.mjs";
import { authRoutes } from "./routes/auth.mjs";
import { accountRoutes } from "./routes/account.mjs";
import { emailRoutes } from "./routes/email.mjs";
import { collectionsRoutes } from "./routes/collections.mjs";
import { publicRoutes } from "./routes/public.mjs";
import { gatewaysRoutes } from "./routes/gateways.mjs";
import { exploreRoutes } from "./routes/explore.mjs";
import { feedbackRoutes } from "./routes/feedback.mjs";
import { adminRoutes } from "./routes/admin.mjs";
import { onboardAccount } from "./onboard.mjs";
import { resolveOwnedAgent } from "./agent-scope.mjs";
import { principalsRoutes } from "./routes/principals.mjs";
import {
  CONTRACT_HEADER,
  json,
  sessionCookie,
  readCookie,
  bearer,
} from "./http.mjs";

/**
 * Routes are keyed by exact "METHOD /path". A record route with the id in
 * the path (`GET /api/me/activity/calls/<request_id>`) registers as
 * `GET /api/me/activity/calls/*` and receives the last segment, decoded,
 * as `event.pathParam`. One segment only: anything deeper is a 404.
 */
function wildcardRoute(routes, method, path, event) {
  const cut = path.lastIndexOf("/");
  if (cut <= 0 || cut === path.length - 1) return null;
  const route = routes[`${method} ${path.slice(0, cut)}/*`];
  if (!route) return null;
  try {
    event.pathParam = decodeURIComponent(path.slice(cut + 1));
  } catch {
    return null;
  }
  return route;
}

/**
 * An agent's console (docs/reviews/2026-09-23-CONSOLE-ACCOUNT-SWITCHER.md):
 * `/api/agent/<public_id>/<tail>` runs the `/api/me/<tail>` route AS that
 * agent, for the person who owns it. The scope lives in the path, never in
 * a header or the session, so the access log and the audit say whose page
 * was read, and nothing ambient can make a write land on the wrong account.
 *
 * Only the routes listed here take the scope. Everything else under the
 * prefix is a 404, and so is an agent that is not yours: the answer never
 * confirms that another owner's agent exists.
 */
export const AGENT_SCOPED_ROUTES = new Set([
  "GET /api/me",
  "GET /api/me/timeline",
  "GET /api/me/requests",
  "GET /api/me/activity/calls/*",
  "GET /api/me/activity",
  "GET /api/me/feedback",
  "GET /api/me/usage",
  "GET /api/me/connections",
  "POST /api/me/connections/revoke",
  "POST /api/me/connections/scope",
  "POST /api/me/connections/refusals/dismiss",
]);

const AGENT_PATH = /^\/api\/agent\/([a-z0-9]{8,16})(\/.*)?$/;

/** The route for a path and the key it is registered under. */
function findRoute(routes, method, path, event) {
  const exact = `${method} ${path}`;
  if (routes[exact]) return { route: routes[exact], key: exact };
  const route = wildcardRoute(routes, method, path, event);
  return route
    ? { route, key: `${method} ${path.slice(0, path.lastIndexOf("/"))}/*` }
    : null;
}

// The soft deadline sits under the Lambda timeout by a margin that
// covers writing the line and ending the client. Outside Lambda (tests,
// no context) there is no deadline unless the caller supplies one.
const DEADLINE_MARGIN_MS = 1500;
function deadlineMs(context) {
  if (typeof context?.getRemainingTimeInMillis !== "function") return null;
  return Math.max(context.getRemainingTimeInMillis() - DEADLINE_MARGIN_MS, 1);
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
  secret,
  sendLoginEmail,
  notifyOwner = async () => {},
  sendWelcomeEmail = async () => {},
  queueStats = async () => null,
  track = null,
  collectorDoor = null,
  originSecret = null,
  /** { s3, bucket } for reading captured tool calls (capture.mjs
   *  makeCaptureStore); null = the call record carries the row only. */
  capture = null,
}) {
  // Tinylytics ping (best-effort by contract; never blocks a response).
  const ping = async (eventName, value) => {
    if (!track) return;
    try {
      await track(eventName, value);
    } catch {
      // Analytics must never break serving (house rule).
    }
  };
  async function resolveAccount(
    db,
    event,
    { requireContractHeader = false } = {},
  ) {
    // An agent-scoped request was resolved before the route ran (the
    // owner's session, then the agent it owns); the contract header rule
    // still applies to it exactly as to the owner's own requests.
    if (event.scopedAccount) {
      if (
        requireContractHeader &&
        !bearer(event) &&
        !event.headers?.[CONTRACT_HEADER]
      )
        return null;
      return event.scopedAccount;
    }
    return resolvePerson(db, event, { requireContractHeader });
  }
  async function resolvePerson(
    db,
    event,
    { requireContractHeader = false } = {},
  ) {
    const fromBearer = bearer(event);
    const token = fromBearer || readCookie(event);
    if (!token) return null;
    if (
      !fromBearer &&
      requireContractHeader &&
      !event.headers?.[CONTRACT_HEADER]
    )
      return null;
    return resolveSession(db, {
      secret,
      token,
      // Where this request came from, for the Profile page's device
      // list. Bearer callers are not devices; the columns stay as the
      // browser left them.
      seen: fromBearer ? null : sessionSeenFrom(event),
    });
  }

  let exploreRegistryCache = null;
  function exploreRegistry() {
    exploreRegistryCache ??= makeRegistry();
    return exploreRegistryCache;
  }

  // The activity log must never break the action it records.
  async function logEvent(db, accountId, kind, detail = null) {
    await db
      .query(
        `insert into account_event (account_id, kind, detail) values ($1, $2, $3)`,
        [accountId, kind, detail ? JSON.stringify(detail) : null],
      )
      .catch(() => {});
  }

  async function mintSessionResponse(
    db,
    hash,
    { event = null, extra = {} } = {},
  ) {
    const account = await approvedAccount(db, hash);
    if (!account) {
      // A VALID code for an account that is not approved yet is not the
      // same failure as a bad code, and telling the two apart is safe:
      // holding the code already proves control of the address. Saying
      // "expired or already used" to somebody whose request is simply
      // waiting sent them round the loop again, and the loop could not
      // ever work.
      const { rows } = await db.query(
        `select status from account where email_hash = $1`,
        [hash],
      );
      if (rows[0] && rows[0].status !== "approved")
        return json(403, { error: "not_approved", status: rows[0].status });
      return json(400, { error: "invalid_or_expired" });
    }
    const minted = await createSession(db, {
      secret,
      accountId: account.account_id,
      emailHash: hash,
      seen: event ? sessionSeenFrom(event) : null,
    });
    await logEvent(db, account.account_id, "signed_in");
    // The signup funnel's last step, and the only one that means the product
    // was actually reached: request → approval → somebody actually arriving.
    // Counted once per account, by asking whether this is their first session
    // BEFORE the one just minted is the only one there is.
    try {
      const { rows } = await db.query(
        `select count(*)::int as n from session where account_id = $1`,
        [account.account_id],
      );
      if (rows[0]?.n === 1) await ping("signup.activated");
    } catch {
      // Never let a funnel count cost somebody their sign-in.
    }
    // The second chance at approval-time tracking: at the decision we may
    // not have fetched the requested player yet, so their clan was not
    // knowable. It no-ops once account.onboarded_at is set (0065).
    await onboardAccount(db, account.account_id);
    return json(
      200,
      { authenticated: true, ...extra },
      { "set-cookie": sessionCookie(minted.token, 90 * 24 * 3600) },
    );
  }

  const routes = {
    ...collectorRoutes({ collectorDoor }),
    ...authRoutes({
      resolveAccount,
      ping,
      mintSessionResponse,
      sendLoginEmail,
      notifyOwner,
    }),
    ...accountRoutes({ resolveAccount, logEvent, notifyOwner, capture }),
    ...collectionsRoutes({ resolveAccount, logEvent }),
    ...publicRoutes({ queueStats }),
    ...gatewaysRoutes({ resolveAccount, logEvent, notifyOwner }),
    ...exploreRoutes({ resolveAccount, exploreRegistry, track }),
    ...feedbackRoutes({ resolveAccount, ping, notifyOwner }),
    ...adminRoutes({
      resolveAccount,
      ping,
      logEvent,
      notifyOwner,
      sendWelcomeEmail,
      capture,
    }),
    ...principalsRoutes({ resolveAccount, logEvent }),
    ...integrationsRoutes({ resolveAccount, logEvent }),
    ...verifyRoutes({ resolveAccount, logEvent }),
    ...battleActivityRoutes({ resolveAccount }),
    ...emailRoutes({
      resolveAccount,
      secret,
      // The archive bucket store the call record reads from; sent mail
      // lives in the same bucket under mail/sent/.
      archive: capture,
    }),
  };

  return async function handler(event, context) {
    // Through CloudFront, or not at all (see auth origin.mjs).
    if (!originAllowed(event, originSecret)) return forbiddenOrigin();
    const method =
      event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
    const path = event.rawPath ?? event.path ?? "/";
    const isIntegration = path.startsWith("/api/v1/");
    const agentPath = isIntegration ? null : AGENT_PATH.exec(path);
    const found = isIntegration
      ? { route: integrationApi, key: `${method} /api/v1/*` }
      : findRoute(
          routes,
          method,
          agentPath ? `/api/me${agentPath[2] ?? ""}` : path,
          event,
        );
    if (!found) return json(404, { error: "not_found" });
    if (agentPath && !AGENT_SCOPED_ROUTES.has(found.key))
      return json(404, { error: "not_found" });
    const { route } = found;
    let body = {};
    // The one-click unsubscribe POST (RFC 8058) carries
    // "List-Unsubscribe=One-Click" as a form body, not JSON; the route
    // reads only the query string.
    const formOnly = path === "/api/email/unsubscribe";
    if (event.body && !formOnly) {
      try {
        // API Gateway v2 may deliver bodies base64-encoded.
        body = JSON.parse(
          event.isBase64Encoded
            ? Buffer.from(event.body, "base64").toString("utf8")
            : event.body,
        );
      } catch {
        return isIntegration
          ? integrationProblem(400, "invalid_json", randomUUID())
          : json(400, { error: "invalid_json" });
      }
    }
    // One timing line per request, so a slow page can be attributed to
    // a route rather than read off the Lambda's undifferentiated
    // REPORT (2026-09-11: the console rail lagged the page and nobody
    // could say which call). The ROUTE KEY, never the raw path: a
    // wildcard suffix is a request id or a name. The line carries the
    // Lambda request id so it joins the REPORT line, and the SOFT
    // DEADLINE below is what guarantees it is written at all: a route
    // that hangs on the database used to run into the 20 s Lambda kill,
    // which leaves a REPORT and no route (the 09-11 RDS recoveries:
    // 113 such lines, none attributable). Now the handler answers 504
    // itself a little before the kill, so the line says which route,
    // and the client gets JSON rather than a gateway error page.
    const started = Date.now();
    // An agent's public id is a name too: the scoped key logs the prefix
    // with a star and the route it ran (`GET /api/agent/*/timeline`).
    const routeKey = agentPath
      ? found.key.replace(" /api/me", " /api/agent/*")
      : found.key;
    const requestId = context?.awsRequestId ?? null;
    let status = 500;
    let connectMs = 0;
    let timedOut = false;
    const db = new pg.Client({ connectionString: databaseUrl });
    try {
      const res = await withDeadline(
        deadlineMs(context),
        async () => {
          await db.connect();
          connectMs = Date.now() - started;
          if (agentPath) {
            const person = await resolvePerson(db, event);
            if (!person) return json(401, { error: "unauthenticated" });
            const agent = await resolveOwnedAgent(db, person, agentPath[1]);
            if (!agent) return json(404, { error: "not_found" });
            event.scopedAccount = agent;
          }
          return route(db, event, body);
        },
        () => {
          timedOut = true;
          return isIntegration
            ? integrationProblem(504, "timeout", requestId ?? randomUUID())
            : json(504, { error: "timeout" });
        },
      );
      status = res?.statusCode ?? 200;
      return res;
    } finally {
      // A timed-out route may still hold a query; ending the client
      // cancels the socket, and the query with it.
      await db.end().catch(() => {});
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          http: routeKey,
          status,
          ms: Date.now() - started,
          connect_ms: connectMs,
          ...(requestId ? { request_id: requestId } : {}),
          ...(timedOut ? { timed_out: true } : {}),
        }),
      );
    }
  };
}
