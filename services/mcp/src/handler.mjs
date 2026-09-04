/**
 * The /mcp Lambda shape (API Gateway behind the no-cookie CloudFront on
 * elixir.poapkings.com). Bearer only — cookies structurally never arrive.
 * 401s carry WWW-Authenticate with resource_metadata (RFC 9728) so
 * clients can discover the authorization server.
 */

import pg from "pg";
import {
  validateAccessToken,
  validateServiceToken,
  checkRateLimit,
} from "@elixir-mcp/auth";
import { handleMcpMessage } from "./protocol.mjs";
import { makeRegistry } from "./tools.mjs";
import { makeInvoker } from "./invoker.mjs";
import { makeQuota } from "./quota.mjs";
import { makeOauthRoutes, rawBody } from "./oauth-routes.mjs";
import { makeLive } from "./live.mjs";

export const HOURLY_RATE_LIMIT = 300;

export function makeHandler({
  databaseUrl,
  issuer = "https://elixir.poapkings.com",
  sendLoginEmail,
  enqueueLiveJob = null,
}) {
  const registry = makeRegistry();
  const live = enqueueLiveJob ? makeLive({ enqueue: enqueueLiveJob }) : null;
  const oauth = makeOauthRoutes({ issuer, sendLoginEmail });
  const unauthorized = () => ({
    statusCode: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
    },
    body: JSON.stringify({ error: "invalid_token" }),
  });

  return async function handler(event) {
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
    if (method === "GET" && path === "/.well-known/oauth-protected-resource") {
      return oauth.protectedResourceMetadata();
    }

    if (path.startsWith("/oauth/")) {
      const db = new pg.Client({ connectionString: databaseUrl });
      await db.connect();
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

    if (method !== "POST" || path !== "/mcp") {
      return { statusCode: 405, headers: { allow: "POST" }, body: "" };
    }
    const auth = String(
      event.headers?.authorization ?? event.headers?.Authorization ?? "",
    );
    if (!auth.toLowerCase().startsWith("bearer ")) return unauthorized();

    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      const presented = auth.slice(7).trim();
      // Two credentials open this door: OAuth access tokens (agents via
      // the browser flow) and Admin-issued service tokens (long-lived
      // API-token users like elixir-bot; audit surface svc:<name>).
      const account = presented.startsWith("svt_")
        ? await validateServiceToken(db, presented)
        : await validateAccessToken(db, presented);
      if (!account) return unauthorized();
      const withinRate = await checkRateLimit(db, {
        bucket: `mcp#${account.accountId}`,
        max: HOURLY_RATE_LIMIT,
      });
      if (!withinRate) {
        return {
          statusCode: 429,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "rate_limited" }),
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
      const result = await handleMcpMessage(message, {
        registry,
        spendQuota: makeQuota({ db, account }),
        invokeTool: makeInvoker({
          db,
          account,
          registry,
          live,
          surface: account.serviceName ? `svc:${account.serviceName}` : "mcp",
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
