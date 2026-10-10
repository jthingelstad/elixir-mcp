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
  openVerifiedAccount,
  createSession,
  resolveSession,
  sessionSeenFrom,
  originAllowed,
  forbiddenOrigin,
} from "@elixir-mcp/auth";
import { makeRegistry } from "@elixir-mcp/tools";

import { authRoutes } from "./routes/auth.mjs";
import { accountRoutes } from "./routes/account.mjs";
import { timelineDiscordRoutes } from "./routes/timeline-discord.mjs";
import { wakeAfterFact } from "@elixir-mcp/syndication";
import { emailRoutes } from "./routes/email.mjs";
import { clansRoutes } from "./routes/clans.mjs";
import { publicRoutes } from "./routes/public.mjs";
import { gatewaysRoutes } from "./routes/gateways.mjs";
import { exploreRoutes } from "./routes/explore.mjs";
import { feedbackRoutes } from "./routes/feedback.mjs";
import { adminRoutes } from "./routes/admin.mjs";
import { onboardAccount } from "@elixir-mcp/tools/onboard";
import { resolveOwnedAgent } from "./agent-scope.mjs";
import { deadlineMs } from "./deadline.mjs";
import { principalsRoutes } from "./routes/principals.mjs";
import { battleRoutes } from "./routes/battle.mjs";
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
 * An agent's console:
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
  // The agent's timeline cross-posted to Discord (0213), set by its owner.
  "GET /api/me/timeline/discord",
  "PUT /api/me/timeline/discord",
  "GET /api/me/requests",
  "GET /api/me/activity/calls/*",
  "GET /api/me/activity",
  "GET /api/me/feedback",
  "GET /api/me/feedback/*",
  "GET /api/me/usage",
  "GET /api/me/connections",
  "POST /api/me/connections/revoke",
  "POST /api/me/connections/scope",
  "POST /api/me/connections/refusals/dismiss",
  // Configuring the agent (phase 2): what it tracks, and the clan it acts
  // for, in the person's pooled slots (@elixir-mcp/claims).
  "GET /api/me/clans",
  "POST /api/me/clans",
  "POST /api/me/players",
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
  deadLetters = async () => null,
  originSecret = null,
  /** { s3, bucket } for reading captured tool calls (capture.mjs
   *  makeCaptureStore); null = the call record carries the row only. */
  capture = null,
  /** { enqueue, archive } for a family app's mail on the JSON API
   *  (2.4.0): the outbox and the sent-mail archive; null = refused. */
  mail = null,
  /** Unsubscribe links' own key (packages/mail unsubscribe.mjs); null =
   *  links are signed and checked with the session secret. */
  unsubscribeSecret = null,
  /** () => the built app shell (routes/battle.mjs makeSiteShell), which a
   *  battle's page is served in; null = /battle/* answers 503. */
  siteShell = null,
  /** (read) => a battle's share picture as PNG bytes (share-image.mjs
   *  makeShareImage); null = /battle/<id>.png answers 503. */
  shareImage = null,
  /** (method) => the site's 404 page (routes/site-miss.mjs), for an
   *  address the site bucket missed; null = the JSON not_found. */
  siteMiss = null,
  /** { outbox, readStatus } for the timeline's Discord cross-post
   *  (routes/timeline-discord.mjs); null = no hello line, no status. */
  discord = null,
  /** Internal Clan request handler. Null until the reviewed state cutover;
   * the old origin continues to serve Clan during preparation. */
  clan = null,
}) {
  // What unsubscribe links are signed and checked with: their own key
  // when there is one, and the session secrets for links sent before it.
  const unsubscribeKeys =
    secret || unsubscribeSecret
      ? { unsubscribe: unsubscribeSecret, session: secret }
      : null;
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
    {
      event = null,
      extra = {},
      verifiedEmail = null,
      verifiedNewsletter = true,
      verifiedZone = null,
    } = {},
  ) {
    const opened = verifiedEmail
      ? await openVerifiedAccount(db, {
          emailHash: hash,
          email: verifiedEmail,
          newsletterOptIn: verifiedNewsletter,
          timezone: verifiedZone,
        })
      : null;
    const account = await approvedAccount(db, hash);
    if (account && account.kind !== "person")
      return json(403, { error: "not_approved" });
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
    if (opened) {
      // After proof only. The existing welcome/outbox and enrollment flag
      // preserve mail policy; a courtesy-mail outage must not undo sign-in.
      await sendWelcomeEmail({
        email: verifiedEmail,
        newsletter: opened.newsletter_opt_in === true,
      }).catch(() => console.error("signup_welcome_queue_failed"));
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
    ...authRoutes({
      resolveAccount,
      mintSessionResponse,
      sendLoginEmail,
      notifyOwner,
    }),
    ...accountRoutes({
      resolveAccount,
      logEvent,
      notifyOwner,
      capture,
      clanInternal: Boolean(clan),
    }),
    ...timelineDiscordRoutes({ resolveAccount, discord }),
    ...clansRoutes({ resolveAccount, logEvent }),
    ...publicRoutes({ deadLetters }),
    ...gatewaysRoutes({ resolveAccount, logEvent, notifyOwner }),
    ...exploreRoutes({ resolveAccount, exploreRegistry }),
    ...feedbackRoutes({ resolveAccount, notifyOwner }),
    ...adminRoutes({
      resolveAccount,
      logEvent,
      notifyOwner,
      sendWelcomeEmail,
      capture,
    }),
    ...principalsRoutes({ resolveAccount, logEvent }),
    ...integrationsRoutes({ resolveAccount, logEvent }),
    ...verifyRoutes({ resolveAccount, logEvent }),
    ...battleActivityRoutes({ resolveAccount }),
    ...battleRoutes({ siteShell, shareImage }),
    ...emailRoutes({
      resolveAccount,
      secret: unsubscribeKeys,
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
    const isClan = clan && path.startsWith("/api/clan/");
    const agentPath = isIntegration ? null : AGENT_PATH.exec(path);
    const found = isIntegration
      ? {
          route: (db, event, body) =>
            integrationApi(db, event, body, {
              mail: mail ? { ...mail, secret: unsubscribeKeys } : null,
              wake: discord?.outbox
                ? (d, fact) =>
                    wakeAfterFact(d, fact, { outbox: discord.outbox })
                : null,
            }),
          key: `${method} /api/v1/*`,
        }
      : isClan
        ? {
            key: `${method} /api/clan/*`,
            route: async (db, event, body) => {
              if (method === "GET" && path === "/api/clan/health")
                return json(200, { ok: true });
              if (path === "/api/clan/auth/callback")
                return json(410, { error: "retired_oauth_callback" });
              const person = await resolvePerson(db, event, {
                requireContractHeader: !["GET", "HEAD"].includes(method),
              });
              if (!person) {
                if (method === "GET" && path === "/api/clan/auth/login")
                  return {
                    statusCode: 303,
                    headers: {
                      location: "/console/signin?return_to=%2Fclan",
                      "cache-control": "no-store",
                    },
                    body: "",
                  };
                return json(401, { signed_in: false });
              }
              return clan({
                db,
                account: person,
                event: {
                  ...event,
                  body: event.body ? JSON.stringify(body) : undefined,
                  isBase64Encoded: false,
                },
                signout: async () => {
                  const res = await routes["POST /api/session/signout"](
                    db,
                    event,
                  );
                  return {
                    ...res,
                    statusCode: 303,
                    headers: {
                      ...res.headers,
                      location: "/clan",
                      "cache-control": "no-store",
                    },
                    body: "",
                  };
                },
              });
            },
          }
        : findRoute(
            routes,
            method,
            agentPath ? `/api/me${agentPath[2] ?? ""}` : path,
            event,
          );
    // The site bucket missed and the edge failed over here: the site's
    // own 404 page, never for a path under /api/, whose callers read JSON.
    if (
      !found &&
      siteMiss &&
      (method === "GET" || method === "HEAD") &&
      !path.startsWith("/api/")
    )
      return siteMiss(method);
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
    const soft = deadlineMs(context, event);
    // A route that runs a tool races the invoker's deadline inside this
    // one (deadline.mjs), so the tool answers query_timeout with its
    // request id before this handler has to answer 504.
    if (soft !== null) event.softDeadlineAt = Date.now() + soft;
    try {
      const res = await withDeadline(
        soft,
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
      // A timed-out route may still hold a query. Ending the client
      // closes the socket, but PostgreSQL notices a closed socket only
      // when it next talks to the client, or at the database's
      // client_connection_check_interval (0186). What bounds the query is
      // its statement_timeout: the invoker's for a tool, and the
      // connection's PGOPTIONS ceiling (infra/template.yaml) for the rest.
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
