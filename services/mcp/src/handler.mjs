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
  normalizeScope,
  resourceForPath,
  principalMatchesResource,
  originAllowed,
  forbiddenOrigin,
} from "@elixir-mcp/auth";
import { DEFAULT_OAUTH_SCOPE, responseMeta } from "@elixir-mcp/contracts";
import { handleMcpMessage } from "./protocol.mjs";
import { makeRegistry } from "./tools.mjs";
import { makeInvoker } from "./invoker.mjs";
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

  return async function handler(event) {
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
        "www-authenticate": `Bearer resource_metadata="${resourceMetadataForTarget}", scope="${DEFAULT_OAUTH_SCOPE}"`,
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
      if (message?.method === "tools/call" && message.id !== undefined) {
        const tool = String(message.params?.name ?? "");
        if (registry.has(tool)) {
          const requiredScope = registry.requiredScope(tool);
          if (!account.scopes.includes(requiredScope)) {
            const challengeScope = normalizeScope(
              `${account.scope} ${requiredScope}`,
            );
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
                    hint: `Reconnect this client and grant '${requiredScope}' on the consent page (the first connection grants only cr:read). Owner-issued service tokens carry every capability. Read tools, including elixir_events, need only cr:read.`,
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
        return {
          statusCode: 429,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "rate_limited" }),
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
        // What this connection is FOR. A person sees the full surface; an
        // agent's is shaped around a clan; an integration's around the corpus.
        kind: account.kind ?? "person",
        spendQuota: makeQuota({ db, account }),
        invokeTool: makeInvoker({
          db,
          account,
          registry,
          live,
          surface: account.serviceName ? `svc:${account.serviceName}` : "mcp",
          // Five agents on one account used to be five identical audit rows of
          // "something called war_current". These say which credential, from
          // where, calling itself what.
          viewerIp,
          viewerCountry,
          clientName: account.serviceName ?? account.clientName ?? null,
          oauthFamilyId: account.oauthFamilyId ?? null,
          track,
          notifyOwner,
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
  };
}
