/**
 * The /mcp Lambda shape (API Gateway behind the no-cookie CloudFront on
 * elixir.poapkings.com). Bearer only — cookies structurally never arrive.
 * 401s carry WWW-Authenticate with resource_metadata (RFC 9728) so
 * clients can discover the authorization server.
 */

import { randomUUID } from "node:crypto";

import pg from "pg";
import {
  validateAccessToken,
  validateServiceToken,
  describeRefusedCredential,
  recordCredentialRefusal,
  authLog,
  credentialRef,
  checkRateLimit,
  WINDOW_SECONDS as RATE_WINDOW_SECONDS,
  normalizeScope,
  resourceForPath,
  principalMatchesResource,
  originAllowed,
  forbiddenOrigin,
} from "@elixir-mcp/auth";
import { FULL_OAUTH_SCOPE, responseMeta } from "@elixir-mcp/contracts";
import { handleMcpMessage } from "./protocol.mjs";
import { makeRegistry } from "./tools.mjs";
import { makeInvoker, auditRow, onBehalfOfOf } from "./invoker.mjs";
import { makeQuota } from "./quota.mjs";
import { makeOauthRoutes, rawBody } from "./oauth-routes.mjs";
import { describeIdentity } from "./identity.mjs";
import { makeLive } from "./live.mjs";

import { HOURLY_RATE_LIMIT } from "./quota.mjs";
export { HOURLY_RATE_LIMIT };

export function makeHandler({
  databaseUrl,
  issuer = "https://elixir.poapkings.com",
  sendLoginEmail,
  enqueueLiveJob = null,
  track = null,
  originSecret = null,
  notifyOwner = null,
  /** { s3, bucket } from capture.mjs makeCaptureStore(); null = no capture. */
  capture = null,
  /** Where the per-call EMF line goes; null = no metrics. */
  emitMetrics = null,
}) {
  // Transport-level refusals - a rate limit, a database that will not
  // connect - are answered with the SAME envelope a tool refusal uses.
  // These used to render bare ({"message":"Internal Server Error"},
  // {"error":"rate_limited"}), which a caller could not tell apart from a
  // malformed argument and could not report: no code, no hint, and no
  // request_id to quote (playtest round, 2026-09-09).
  const envelope = (code, message, hint) => ({
    error: { code, message, ...(hint ? { hint } : {}) },
    meta: responseMeta({
      as_of: new Date().toISOString(),
      request_id: randomUUID(),
    }),
  });

  const unavailable = () => ({
    statusCode: 503,
    headers: { "content-type": "application/json", "retry-after": "5" },
    body: JSON.stringify(
      envelope(
        "live_unavailable",
        "The service could not reach its database. No data was read; this is not a problem with your request.",
        "Transient under load. Retry in a few seconds; quote meta.request_id if it persists.",
      ),
    ),
  });

  // One client per invocation against a db.t4g.micro makes the DATABASE the
  // thing that fails first under concurrency (infra/template.yaml). connect()
  // used to sit ABOVE the try/finally, so a refusal escaped the handler
  // entirely and Lambda rendered a bare 500. Null means never connected -
  // end() would then throw over the top of the real failure.
  const connectDb = async () => {
    const db = new pg.Client({ connectionString: databaseUrl });
    try {
      await db.connect();
      return db;
    } catch (err) {
      console.error("db_connect_failed", err?.message);
      return null;
    }
  };

  const registry = makeRegistry();
  const live = enqueueLiveJob ? makeLive({ enqueue: enqueueLiveJob }) : null;
  const oauth = makeOauthRoutes({ issuer, sendLoginEmail });
  // The personal resource's metadata document. Agent and integration doors
  // point at their own path-suffixed one, built per request below, so a client
  // 401'd at an agent URL discovers THAT resource rather than this one.
  const resourceMetadata = `${issuer}/.well-known/oauth-protected-resource`;

  // One line per HTTP request, the same shape as the site API's
  // (web-api handler.mjs). The EMF line and the call log cover tool
  // CALLS; until this line, initialize, tools/list, the OAuth routes and
  // every 401/403 refusal left nothing at all, so a run of 4xx on the
  // door was a count with no story. The door key never carries a
  // per-principal id (/a/<id> logs as /a/*).
  async function dispatch(event) {
    // Through CloudFront, or not at all: the viewer headers this door
    // records are only trustworthy when the distribution set them.
    if (!originAllowed(event, originSecret)) return forbiddenOrigin();
    const method =
      event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
    const path = event.rawPath ?? event.path ?? "/";

    // Metadata documents need no auth and no DB.
    if (
      method === "GET" &&
      path === "/.well-known/oauth-authorization-server"
    ) {
      return oauth.authorizationServerMetadata();
    }
    // RFC 9728 path-suffixed form: each protected resource publishes its own
    // metadata, so a client 401'd at an agent URL discovers THAT resource
    // rather than the canonical one and asks for a token with the wrong
    // audience.
    if (
      method === "GET" &&
      path.startsWith("/.well-known/oauth-protected-resource")
    ) {
      const suffix = path.slice("/.well-known/oauth-protected-resource".length);
      const target = resourceForPath(suffix || "/mcp", issuer);
      if (!target) {
        return {
          statusCode: 404,
          headers: { "content-type": "application/json" },
          body: '{"error":"not_found"}',
        };
      }
      return oauth.protectedResourceMetadata(target.resource);
    }

    if (path.startsWith("/oauth/")) {
      const db = await connectDb();
      if (!db) return unavailable();
      try {
        if (method === "POST" && path === "/oauth/register")
          return await oauth.register(db, event);
        if (method === "GET" && path === "/oauth/authorize")
          return await oauth.authorizeGet(db, event);
        if (method === "POST" && path === "/oauth/authorize")
          return await oauth.authorizePost(db, event);
        if (method === "POST" && path === "/oauth/token")
          return await oauth.token(db, event);
        if (method === "GET" && path === "/oauth/userinfo")
          return await oauth.userinfo(db, event);
        return {
          statusCode: 404,
          headers: { "content-type": "application/json" },
          body: '{"error":"not_found"}',
        };
      } finally {
        await db.end();
      }
    }

    const target = method === "POST" ? resourceForPath(path, issuer) : null;
    if (!target) {
      return { statusCode: 405, headers: { allow: "POST" }, body: "" };
    }
    // The challenge must name the resource actually being addressed.
    const resourceMetadataForTarget =
      target.kind === "person"
        ? resourceMetadata
        : `${issuer}/.well-known/oauth-protected-resource${path}`;
    // WHERE the caller is. requestContext.http.sourceIp is a CloudFront edge
    // node, not the client — the viewer's own address arrives in a header, and
    // only because the origin request policy forwards it. Both are optional:
    // a direct hit in local development has neither, and null beats a lie.
    const headerOf = (name) =>
      event.headers?.[name] ?? event.headers?.[name.toLowerCase()] ?? null;
    const viewerAddress = headerOf("cloudfront-viewer-address");
    const viewerIp = viewerAddress
      ? // "1.2.3.4:53422", and IPv6 is "2001:db8::1:53422" — the port is
        // always the last colon-separated part.
        viewerAddress.slice(0, viewerAddress.lastIndexOf(":")) || null
      : null;
    const viewerCountry = headerOf("cloudfront-viewer-country");

    const unauthorizedHere = () => ({
      statusCode: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${resourceMetadataForTarget}", scope="${FULL_OAUTH_SCOPE}"`,
      },
      body: JSON.stringify({ error: "invalid_token" }),
    });
    const auth = String(
      event.headers?.authorization ?? event.headers?.Authorization ?? "",
    );
    if (!auth.toLowerCase().startsWith("bearer ")) {
      authLog("mcp_unauthorized", {
        reason: "no_bearer",
        resource: target.resource,
      });
      return unauthorizedHere();
    }

    const db = await connectDb();
    if (!db) return unavailable();
    try {
      const presented = auth.slice(7).trim();
      // Two credentials open this door: OAuth access tokens (agents via
      // the browser flow) and Admin-issued service tokens (long-lived
      // API-token users like elixir-bot; audit surface svc:<name>).
      const account = presented.startsWith("svt_")
        ? await validateServiceToken(db, presented)
        : await validateAccessToken(db, presented, {
            resource: target.resource,
          });
      if (!account) {
        // THE HOLE THIS CLOSES: a refused credential was recorded nowhere.
        // mcp_call_audit is written by the invoker, i.e. after auth, so a
        // runtime presenting a rotated or revoked key produced no errors at
        // all -- it simply went quiet, and the console showed an agent that
        // looked idle. Observed 2026-09-09 when rotating a key took the
        // Discord bot offline for six minutes before anyone noticed.
        //
        // The credential itself never appears; a short digest is enough to
        // tell "one dead client retrying" from "many different bad keys".
        // Name it if we can. A credential the owner already knows about —
        // revoked, suspended, or presented at the wrong door — is the refusal
        // worth telling them about, and it is identifiable without granting
        // anything: the door has already said no.
        // Describing a refusal is visibility, never a precondition: if it
        // throws, the answer is still 401. A describe failure once turned
        // every refused OAuth token into a 500 at this door.
        let refused;
        try {
          refused = await describeRefusedCredential(db, presented);
        } catch (err) {
          authLog("mcp_refusal_describe_failed", { error: err?.message });
          refused = {
            kind: presented.startsWith("svt_")
              ? "service_token"
              : "access_token",
            reason: "undescribed",
          };
        }
        await recordCredentialRefusal(db, {
          presented,
          kind: refused.kind,
          tokenId: refused.tokenId,
          accountId: refused.accountId,
          reason: refused.reason,
          resource: target.resource,
          viewerIp,
          viewerCountry,
        });
        authLog("mcp_unauthorized", {
          reason: refused.reason,
          kind: refused.kind,
          resource: target.resource,
          credential: credentialRef(presented),
          country: viewerCountry,
          known_as: refused.label,
        });
        return unauthorizedHere();
      }

      // The URL declares what this connection is for; the credential proves
      // it. Without this check, distinct URLs would be decoration: a personal
      // token at an agent URL would answer from the wrong subject and nothing
      // would say so. 403 rather than 404 -- the resource exists, this
      // credential simply does not belong at it, and pretending otherwise
      // would make the door a probe for which agents exist.
      if (!principalMatchesResource(account, target)) {
        await recordCredentialRefusal(db, {
          presented,
          kind: presented.startsWith("svt_") ? "service_token" : "access_token",
          accountId: account.accountId,
          reason: "wrong_resource",
          resource: target.resource,
          viewerIp,
          viewerCountry,
        });
        authLog("mcp_wrong_resource", {
          reason: "principal_mismatch",
          resource: target.resource,
          kind: account.kind ?? "person",
          country: viewerCountry,
        });
        return {
          statusCode: 403,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            error: "wrong_resource",
            message: `This credential is not for ${target.resource}.`,
            hint:
              target.kind === "person"
                ? "An agent or integration key belongs at its own URL, not the personal one."
                : "Use the key issued for this agent, or connect at the personal /mcp resource.",
          }),
        };
      }
      let message;
      try {
        message = JSON.parse(rawBody(event));
      } catch {
        return {
          statusCode: 400,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "invalid_json" }),
        };
      }
      const surface = account.serviceName
        ? `svc:${account.serviceName}`
        : "mcp";
      const clientName = account.serviceName ?? account.clientName ?? null;
      // A JSON-RPC-layer refusal never reaches the invoker, so until 0063
      // a quota wall or a hidden-tool refusal was invisible in the log
      // (review 5.2). One row per refusal: the tool asked for, the code,
      // bounded arguments, and a minted request_id - error_code stays
      // null because no tool ran. Awaited, because the connection closes
      // when this handler returns.
      const auditRefusal = (rpcCode, toolName, args = {}) =>
        auditRow(db, {
          accountId: account.accountId,
          tokenId: account.tokenId ?? null,
          requestId: randomUUID(),
          surface,
          tool: String(toolName ?? ""),
          args: args && typeof args === "object" ? args : {},
          startedAt: Date.now(),
          viewerIp,
          viewerCountry,
          clientName,
          oauthFamilyId: account.oauthFamilyId ?? null,
          principalKind: account.kind ?? "person",
          onBehalfOf: onBehalfOfOf(args),
          rpcErrorCode: rpcCode,
        });
      if (message?.method === "tools/call" && message.id !== undefined) {
        const tool = String(message.params?.name ?? "");
        if (registry.has(tool)) {
          const requiredScope = registry.requiredScope(tool);
          if (!account.scopes.includes(requiredScope)) {
            const challengeScope = normalizeScope(
              `${account.scope} ${requiredScope}`,
            );
            await auditRefusal(-32003, tool, message.params?.arguments);
            return {
              statusCode: 403,
              headers: {
                "content-type": "application/json",
                "www-authenticate": `Bearer error="insufficient_scope", scope="${challengeScope}", resource_metadata="${resourceMetadata}"`,
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: message.id ?? null,
                error: {
                  code: -32003,
                  message: `The access token lacks the capability required by this tool: ${requiredScope}.`,
                  data: {
                    required_scope: requiredScope,
                    granted_scope: account.scope,
                    // A refusal that does not say how to fix it is a wall
                    // (feedback #16): the first connection is read-only by
                    // design, and the step-up is a reconnect, not a setting.
                    hint: `Reconnect this client and keep '${requiredScope}' ticked on the consent page (every capability is offered, ticked, unless the client asked for less), or edit the connection's capabilities under Account -> Connections, which takes effect on the next call. Owner-issued service tokens carry every capability. Read tools, including elixir_events, need only cr:read.`,
                  },
                },
              }),
            };
          }
        }
      }
      // Same principle as the daily quota: the bucket belongs to whoever is
      // paying. An integration may carry its own ceiling, since its traffic
      // is a function of its userbase rather than its owner's habits.
      const withinRate = await checkRateLimit(db, {
        bucket: `mcp#${account.budget?.accountId ?? account.accountId}`,
        max: account.hourlyRateLimit ?? HOURLY_RATE_LIMIT,
      });
      if (!withinRate) {
        // Windows are fixed and hour-aligned, so the wait is the remainder
        // of this one - a real number, never a guessed backoff.
        const retryAfter = Math.max(
          1,
          RATE_WINDOW_SECONDS -
            Math.floor((Date.now() / 1000) % RATE_WINDOW_SECONDS),
        );
        return {
          statusCode: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(retryAfter),
          },
          body: JSON.stringify(
            envelope(
              "quota_exceeded",
              `Rate limit reached (${account.hourlyRateLimit ?? HOURLY_RATE_LIMIT} requests per hour for this connection).`,
              `The window is hourly and resets in ${retryAfter}s. Recorded-data reads are unlimited within it - see /docs (Roles) or ask via elixir_feedback.`,
            ),
          ),
        };
      }
      // Identity is read ONCE, on initialize, and never on a tool call: it is
      // what the connection is, not what the request is, and paying for it per
      // call would trade one wasted round trip for a permanent one.
      const identity =
        message?.method === "initialize"
          ? await describeIdentity(db, account)
          : null;

      const result = await handleMcpMessage(message, {
        registry,
        identity,
        // resources/read for the card catalog; everything else in the
        // resource corpus is built in.
        db,
        // What this connection is FOR. A person sees the full surface; an
        // agent's is shaped around a clan; an integration's around the corpus.
        kind: account.kind ?? "person",
        spendQuota: makeQuota({ db, account }),
        // protocol.mjs calls this at its own refusal sites (unknown tool,
        // hidden tool, daily quota): auditRefusal(rpcCode, toolName, args).
        auditRefusal,
        invokeTool: makeInvoker({
          db,
          account,
          registry,
          live,
          surface,
          // Five agents on one account used to be five identical audit rows of
          // "something called war_current". These say which credential, from
          // where, calling itself what.
          viewerIp,
          viewerCountry,
          clientName,
          oauthFamilyId: account.oauthFamilyId ?? null,
          track,
          notifyOwner,
          capture,
          emitMetrics,
        }),
      });
      return {
        statusCode: result.statusCode,
        headers: { "content-type": "application/json" },
        body: result.payload === null ? "" : JSON.stringify(result.payload),
      };
    } finally {
      await db.end();
    }
  }

  return async function handler(event, context) {
    const started = Date.now();
    const method =
      event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
    const path = event.rawPath ?? event.path ?? "/";
    const rpc = rpcSummary(event);
    let status = 500;
    try {
      const res = await dispatch(event);
      status = res?.statusCode ?? 200;
      return res;
    } finally {
      const requestId = context?.awsRequestId ?? null;
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          http: `${method} ${doorKey(path)}`,
          ...rpc,
          status,
          ms: Date.now() - started,
          ...(requestId ? { request_id: requestId } : {}),
        }),
      );
    }
  };
}

function doorKey(path) {
  return path.replace(/\/([ai])\/[^/]+/g, "/$1/*");
}

// The JSON-RPC method and, for tools/call, the tool name - read
// leniently, because this runs for every request including the ones
// dispatch will refuse as invalid JSON.
function rpcSummary(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const message = JSON.parse(raw);
    if (!message || typeof message.method !== "string") return {};
    const out = { rpc: message.method };
    if (message.method === "tools/call" && message.params?.name)
      out.tool = String(message.params.name);
    return out;
  } catch {
    return {};
  }
}
