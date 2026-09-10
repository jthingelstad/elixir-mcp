import { integrationsRoutes } from "./routes/integrations.mjs";
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
  originAllowed,
  forbiddenOrigin,
} from "@elixir-mcp/auth";
import { makeRegistry } from "../../mcp/src/tools.mjs";

import { collectorRoutes } from "./routes/collector.mjs";
import { authRoutes } from "./routes/auth.mjs";
import { accountRoutes } from "./routes/account.mjs";
import { collectionsRoutes } from "./routes/collections.mjs";
import { publicRoutes } from "./routes/public.mjs";
import { gatewaysRoutes } from "./routes/gateways.mjs";
import { exploreRoutes } from "./routes/explore.mjs";
import { feedbackRoutes } from "./routes/feedback.mjs";
import { adminRoutes } from "./routes/admin.mjs";
import { onboardAccount } from "./onboard.mjs";
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
    const fromBearer = bearer(event);
    const token = fromBearer || readCookie(event);
    if (!token) return null;
    if (
      !fromBearer &&
      requireContractHeader &&
      !event.headers?.[CONTRACT_HEADER]
    )
      return null;
    return resolveSession(db, { secret, token });
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

  async function mintSessionResponse(db, hash) {
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
      { authenticated: true },
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
  };

  return async function handler(event) {
    // Through CloudFront, or not at all (see auth origin.mjs).
    if (!originAllowed(event, originSecret)) return forbiddenOrigin();
    const method =
      event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
    const path = event.rawPath ?? event.path ?? "/";
    const isIntegration = path.startsWith("/api/v1/");
    const route = isIntegration
      ? integrationApi
      : (routes[`${method} ${path}`] ??
        wildcardRoute(routes, method, path, event));
    if (!route) return json(404, { error: "not_found" });
    let body = {};
    if (event.body) {
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
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      return await route(db, event, body);
    } finally {
      await db.end();
    }
  };
}
