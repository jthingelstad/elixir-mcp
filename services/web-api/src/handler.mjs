import { verifyRoutes } from "./routes/verify.mjs";
import { signInApi, apiProblem, v1Operation } from "./sign-in-api.mjs";
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

import { makeDatabase } from "@elixir-mcp/http/database";
import {
  AGE_ATTESTATION_MESSAGE,
  approvedAccount,
  openVerifiedAccount,
  createSession,
  resolveSession,
  sessionSeenFrom,
  viewerIp,
  originAllowed,
  forbiddenOrigin,
} from "@elixir-mcp/auth";
import { makeRegistry } from "@elixir-mcp/tools";

import { authRoutes } from "./routes/auth.mjs";
import { accountRoutes } from "./routes/account.mjs";
import { discordRoutes } from "./routes/discord.mjs";
import { timelineDiscordRoutes } from "./routes/timeline-discord.mjs";
import {
  highlightClanDiscord,
  postHighlightToClan,
  wakeAfterHighlight,
} from "@elixir-mcp/syndication";
import { emailRoutes } from "./routes/email.mjs";
import { clansRoutes } from "./routes/clans.mjs";
import { homeRoutes } from "./routes/home.mjs";
import { playerRoutes } from "./routes/player.mjs";
import { publicRoutes } from "./routes/public.mjs";
import { gatewaysRoutes } from "./routes/gateways.mjs";
import { exploreRoutes } from "./routes/explore.mjs";
import { feedbackRoutes } from "./routes/feedback.mjs";
import { adminRoutes } from "./routes/admin.mjs";
import { onboardAccount } from "@elixir-mcp/tools/onboard";
import { makeLive, requestFirstRead } from "@elixir-mcp/tools/live";
import { enqueueJob } from "@elixir-mcp/ledger";
import { resolveOwnedAgent } from "./agent-scope.mjs";
import { deadlineMs } from "./deadline.mjs";
import { principalsRoutes } from "./routes/principals.mjs";
import { battleRoutes } from "./routes/battle.mjs";
import { highlightRoutes } from "./routes/highlight.mjs";
import { cheersRoutes } from "./routes/cheers.mjs";
import { bellRoutes } from "./routes/bell.mjs";
import { peopleRoutes } from "./routes/people.mjs";
import { clanRoutes } from "./routes/clan.mjs";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import {
  CONTRACT_HEADER,
  json,
  sessionCookie,
  readCookie,
  bearer,
} from "./http.mjs";

/** A clan's saved policy, from Clan's ledger in Postgres: what a shared
 *  highlight's post to the clan's Discord is allowed by (#767). */
const clanPolicy = (db, clanTag) =>
  createPostgresLedger(db).currentPolicy(clanTag);

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
  // The Console's own place in the agent's timeline (0228), moved when
  // its owner views it there; never the agent's read pointer.
  "POST /api/me/timeline/seen",
  // The agent's timeline cross-posted to Discord (0213), set by its owner.
  "GET /api/me/timeline/discord",
  "PUT /api/me/timeline/discord",
  "POST /api/me/timeline/discord/rate",
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
  // What a follow would cost before the tap (#760), priced in the pool.
  "GET /api/me/follow-cost",
]);

const AGENT_PATH = /^\/api\/agent\/([a-z0-9]{8,16})(\/.*)?$/;

export { CLAN_UNSIGNED } from "./routes/clan.mjs";

/** The answer when no database connection could be had: the JSON API's
 *  documented problem (sign-in-with-elixir.md, 503 temporarily_unavailable), and
 *  the site API's own shape with words a person can act on. Both carry
 *  Retry-After and a request id to quote. */
const UNAVAILABLE_MESSAGE =
  "Elixir could not reach its database. Nothing was read or changed; try again in a few seconds.";
function unavailable(isApi, lambdaRequestId) {
  const requestId = lambdaRequestId ?? randomUUID();
  return isApi
    ? apiProblem(
        503,
        "temporarily_unavailable",
        requestId,
        UNAVAILABLE_MESSAGE,
        5,
      )
    : json(
        503,
        {
          error: "unavailable",
          message: UNAVAILABLE_MESSAGE,
          request_id: requestId,
        },
        { "retry-after": "5" },
      );
}

/**
 * A family registered as `METHOD /prefix/**` answers every path under the
 * prefix, at any depth, and dispatches it itself: Clan's
 * `/api/clan/clans/<tag>/...` (routes/clan.mjs). The nearest prefix wins.
 */
function familyRoute(routes, method, path) {
  for (let cut = path.lastIndexOf("/"); cut > 0;) {
    const key = `${method} ${path.slice(0, cut)}/**`;
    if (routes[key]) return { route: routes[key], key };
    cut = path.lastIndexOf("/", cut - 1);
  }
  return null;
}

/** The route for a path and the key it is registered under. */
function findRoute(routes, method, path, event) {
  const exact = `${method} ${path}`;
  if (routes[exact]) return { route: routes[exact], key: exact };
  const route = wildcardRoute(routes, method, path, event);
  return route
    ? { route, key: `${method} ${path.slice(0, path.lastIndexOf("/"))}/*` }
    : familyRoute(routes, method, path);
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
  secret,
  sendLoginEmail,
  notifyOwner = async () => {},
  sendWelcomeEmail = async () => {},
  deadLetters = async () => null,
  originSecret = null,
  /** { s3, bucket } for reading captured tool calls (capture.mjs
   *  makeCaptureStore); null = the call record carries the row only. */
  capture = null,
  /** Unsubscribe links' own key (packages/mail unsubscribe.mjs); null =
   *  links are signed and checked with the session secret. */
  unsubscribeSecret = null,
  /** () => the built app shell (routes/battle.mjs makeSiteShell), which a
   *  battle's page is served in; null = /battle/* answers 503. */
  siteShell = null,
  /** () => the site's email page (apps/site/src/email-page.njk), the
   *  shell a mail's turn-off link is answered in; null = a plain page. */
  emailShell = null,
  /** (read) => a battle's share picture as PNG bytes (share-image.mjs
   *  makeShareImage); null = /battle/<id>.png answers 503. */
  shareImage = null,
  /** (method) => the site's 404 page (routes/site-miss.mjs), for an
   *  address the site bucket missed; null = the JSON not_found. */
  siteMiss = null,
  /** { outbox, readStatus, readHistory } for the timeline's Discord cross-post
   *  (routes/timeline-discord.mjs); null = no hello line, no status. */
  discord = null,
  /** { clientId, bridge } for linking and signing in with Discord
   *  (routes/discord.mjs, #531): the app's public id and the outbox
   *  round trip to the relay, which alone reaches Discord; null = the
   *  Console offers neither. */
  discordLogin = null,
  /** Clan's request adapter (clan.mjs createClanRequest), behind its
   *  routes (routes/clan.mjs). Clan is part of Elixir and its routes always
   *  exist; a test that never reaches them may leave this out. */
  clan = null,
  /** The live lane for first reads (tools live.mjs makeLive); null = the
   *  ledger's, charged to nobody, as Tracking's add uses. */
  live = null,
  /** (accountId, now) => a wake for the account's stored Home week
   *  (tools activity/home-feed.mjs homeWeekWake); null = a stale week is
   *  served until it is past serving, then the read builds it. */
  homeWake = null,
}) {
  database ??= makeDatabase({
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_MAX ?? 4),
  });
  const liveRead = live ?? makeLive({ enqueue: enqueueJob });
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
      verifiedPlayerTag = null,
      verifiedAgeAt = null,
    } = {},
  ) {
    const opened = verifiedEmail
      ? await openVerifiedAccount(db, {
          emailHash: hash,
          email: verifiedEmail,
          newsletterOptIn: verifiedNewsletter,
          timezone: verifiedZone,
          playerTag: verifiedPlayerTag,
          ageAttestedAt: verifiedAgeAt,
        })
      : null;
    // A proof for an address with no account, from a form that did not
    // ask the 13-or-older question (plain sign-in): no account opens and
    // no session is minted (0240, #763). Holding the proof already shows
    // control of the address, so saying so is not an oracle; the page
    // asks the question and sends a new email.
    if (opened?.refused === "age_attestation_required")
      return json(403, {
        error: "age_attestation_required",
        message: AGE_ATTESTATION_MESSAGE,
      });
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
        ...(opened.newsletter_opt_in === true
          ? { ipAddress: viewerIp(event) }
          : {}),
      }).catch(() => console.error("signup_welcome_queue_failed"));
    }
    // The second chance at approval-time tracking: at the decision we may
    // not have fetched the requested player yet, so their clan was not
    // knowable. It no-ops once account.onboarded_at is set (0065).
    const onboarded = await onboardAccount(db, account.account_id);
    // A player the signup form named is claimed above, after proof; its
    // first read is asked for as a Tracking add asks (requestFirstRead,
    // the pool's daily first reads), so "Tag not found" or the capture
    // shows in seconds rather than at the scheduler's next pass.
    // The battle log with it (2026-11-09): this is a person's first look.
    if (onboarded?.player === true && onboarded.tag)
      await requestFirstRead(db, liveRead, onboarded.tag, account.account_id, {
        battles: true,
      });
    // Only a first use says where a new person lands: their player's
    // record, or Tracking to add one. That is the verification that
    // created the account, or the first sign-in to one made for them
    // ({account_enroll}, an approval): onboarding claims its player or,
    // with no tag, stamps it, once.
    const firstUse =
      opened?.created ||
      onboarded?.player === true ||
      onboarded?.skipped === "no_requested_tag" ||
      // A signup tag another account has verified (#556): Tracking, which
      // says why.
      Boolean(onboarded?.refused);
    const landing = firstUse
      ? {
          new_account: {
            player_tag: onboarded?.player === true ? onboarded.tag : null,
          },
        }
      : {};
    return json(
      200,
      { authenticated: true, ...landing, ...extra },
      { "set-cookie": sessionCookie(minted.token, 90 * 24 * 3600) },
    );
  }

  const routes = {
    ...authRoutes({
      resolveAccount,
      mintSessionResponse,
      sendLoginEmail,
    }),
    ...accountRoutes({
      resolveAccount,
      logEvent,
      notifyOwner,
      capture,
      discordLogin: Boolean(discordLogin),
    }),
    ...discordRoutes({
      resolveAccount,
      mintSessionResponse,
      logEvent,
      discordLogin,
    }),
    ...timelineDiscordRoutes({ resolveAccount, discord, notifyOwner }),
    ...clansRoutes({ resolveAccount, logEvent }),
    ...publicRoutes({ deadLetters }),
    ...gatewaysRoutes({ resolveAccount, logEvent, notifyOwner }),
    ...exploreRoutes({ resolveAccount, exploreRegistry }),
    ...homeRoutes({
      resolveAccount,
      exploreRegistry,
      clan,
      // A stored week past fresh asks the timeline-sync lane for a new one.
      wake: homeWake,
    }),
    ...playerRoutes({ resolveAccount, live: liveRead }),
    ...feedbackRoutes({ resolveAccount, notifyOwner }),
    ...adminRoutes({
      resolveAccount,
      logEvent,
      capture,
    }),
    ...principalsRoutes({ resolveAccount, logEvent }),
    ...verifyRoutes({ resolveAccount, logEvent }),
    ...battleRoutes({ siteShell, shareImage }),
    ...cheersRoutes({ resolveAccount }),
    // The bell's stored week rides the same wake (bell_week, 0247).
    ...bellRoutes({ resolveAccount, wake: homeWake }),
    ...peopleRoutes({ resolveAccount }),
    ...highlightRoutes({
      resolveAccount,
      siteShell,
      shareImage,
      // A post, or words that change, wakes the Discord syndication of
      // the timelines its player reaches, as an admission does.
      wake: discord?.outbox
        ? (d, highlight) =>
            wakeAfterHighlight(d, highlight, { outbox: discord.outbox })
        : null,
      // A shared highlight in its player's clan's Discord, by its owner's
      // act, through the clan's activity channel and the relay (#767).
      clanDiscord: discord?.outbox
        ? {
            state: (d, accountId, id) =>
              highlightClanDiscord(d, accountId, id, { policyFor: clanPolicy }),
            post: (d, accountId, id) =>
              postHighlightToClan(d, accountId, id, {
                outbox: discord.outbox,
                policyFor: clanPolicy,
              }),
          }
        : null,
    }),
    // Clan, a part of Elixir: its routes under /api/clan (routes/clan.mjs).
    ...clanRoutes({ clan, resolvePerson }),
    ...emailRoutes({
      resolveAccount,
      secret: unsubscribeKeys,
      // The archive bucket store the call record reads from; sent mail
      // lives in the same bucket under mail/sent/.
      archive: capture,
      emailShell,
    }),
  };

  async function handler(event, context) {
    // Through CloudFront, or not at all (see auth origin.mjs).
    if (!originAllowed(event, originSecret)) return forbiddenOrigin();
    const method = event.method ?? "GET";
    const path = event.path ?? "/";
    const isApi = path.startsWith("/api/v1/");
    const agentPath = isApi ? null : AGENT_PATH.exec(path);
    const found = isApi
      ? {
          route: (db, event, body) => signInApi(db, event, body),
          key: `${method} /api/v1/*`,
          // The line names the operation the key cannot (review 2026-10-21).
          operation: v1Operation(method, path),
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
        body = JSON.parse(event.body);
      } catch {
        // A path no /api/v1 operation answers is the route's 404 to the
        // docs whatever its body, so it is not refused here as JSON
        // (Codex on #621); the route reads no body for it.
        if (!(isApi && !found.operation))
          return isApi
            ? apiProblem(400, "invalid_json", randomUUID())
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
    const requestId = context?.requestId ?? null;
    let status = 500;
    let connectMs = 0;
    let timedOut = false;
    // What a route adds to the line (Clan's reads, table operations and
    // lock, routes/clan.mjs): never a body, a key or a token.
    let trace = null;
    // A route that reads nothing (Clan's health check) takes no lease: it
    // stays an answer when the pool is full or the instance is away.
    const db = route.withoutDatabase ? null : database.lease();
    const soft = deadlineMs(context, event);
    // A route that runs a tool races the invoker's deadline inside this
    // one (deadline.mjs), so the tool answers query_timeout with its
    // request id before this handler has to answer 504.
    if (soft !== null) event.softDeadlineAt = Date.now() + soft;
    try {
      const res = await withDeadline(
        soft,
        async () => {
          if (db) {
            try {
              await db.connect();
            } catch (error) {
              // A full pool or a database that will not connect: nothing
              // was read or written, so the caller is told to come back,
              // in its door's shape (MCP's is live_unavailable).
              console.error({ event: "db_connect_failed", name: error.name });
              return unavailable(isApi, requestId);
            }
            connectMs = Date.now() - started;
          }
          if (agentPath) {
            const person = await resolvePerson(db, event);
            if (!person) return json(401, { error: "unauthenticated" });
            const agent = await resolveOwnedAgent(db, person, agentPath[1]);
            if (!agent) return json(404, { error: "not_found" });
            event.scopedAccount = agent;
          }
          return route(db, event, body, context);
        },
        () => {
          timedOut = true;
          return isApi
            ? apiProblem(504, "timeout", requestId ?? randomUUID())
            : json(504, { error: "timeout" });
        },
      );
      status = res?.statusCode ?? 200;
      if (!res?.trace) return res;
      ({ trace } = res);
      const answer = { ...res };
      delete answer.trace;
      return answer;
    } finally {
      // A timed-out route may still hold a query. The pool destroys a
      // busy or failed lease; PostgreSQL notices a closed socket only
      // when it next talks to the client, or at the database's
      // client_connection_check_interval (0186). What bounds the query is
      // its statement_timeout: the invoker's for a tool, and the
      // connection's PGOPTIONS ceiling (infra/template.yaml) for the rest.
      await db?.end().catch(() => {});
      // A route's story folds into this one line. Its own route key (a
      // family's exact route, `GET /api/clan/clans/*/week`) names it; its
      // timings and counts ride beside; a slow or failing one is a warn.
      const story = { ...trace };
      for (const own of ["at", "level", "status", "ms", "http"])
        delete story[own];
      (trace?.level === "warn" ? console.warn : console.info)({
        at: new Date().toISOString(),
        http: trace?.http ?? routeKey,
        ...(found.operation ? { operation: found.operation } : {}),
        status,
        ms: Date.now() - started,
        connect_ms: connectMs,
        ...(requestId ? { request_id: requestId } : {}),
        ...(timedOut ? { timed_out: true } : {}),
        ...story,
      });
    }
  }
  // Every route key the map registers, for the public-boundary test
  // (#526): it walks them with no credential, so a new route that
  // answers unsigned is listed there on purpose or fails.
  handler.routeKeys = Object.freeze(Object.keys(routes));
  handler.close = database.close;
  return handler;
}
