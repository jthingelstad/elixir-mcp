/**
 * OAuth 2.1 HTTP shell on the MCP door — DESIGN §6.2. The /authorize
 * pages reuse the SAME magic-code core as the web sign-in (one
 * credential-issuance core, two shells): pending state rides
 * magic_login purpose='oauth'. Two steps, not librarian's three — the
 * code page carries the consent language, so entering the code IS the
 * consent act. The access gate answers identically for unknown, pending,
 * and denied emails: "if your account is approved, a code is on its way"
 * (never an email oracle).
 *
 * CSP on these pages keeps form-action https: — 'self' alone silently
 * blocks the consent redirect in Chromium (librarian's shipped trap).
 */

import {
  emailHash,
  approvedAccount,
  startMagicLogin,
  verifyMagicCode,
  authLog,
  emailRef,
  checkRateLimit,
  registerClient,
  getClient,
  sanitizeClientName,
  validateRedirectUris,
  validRedirectUri,
  validState,
  validCodeChallenge,
  normalizeScope,
  canonicalResource,
  resourceForPath,
  verifyPkce,
  createAuthCode,
  redeemAuthCode,
  mintTokens,
  redeemRefreshToken,
  OAUTH_SCOPES,
} from "@elixir-mcp/auth";
import {
  DEFAULT_OAUTH_SCOPE,
  OAUTH_SCOPE_DETAILS,
} from "@elixir-mcp/contracts";

const DCR_GLOBAL_DAILY_CAP = 200;

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{background:#10131c;color:#e8e4d8;font:16px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:22rem;padding:2rem;background:#171c2a;border:1px solid #2c3450;border-radius:12px}
h1{font-size:1.2rem;color:#f5c944;margin:0 0 .75rem}
input{width:100%;box-sizing:border-box;padding:.6rem;margin:.5rem 0;background:#10131c;color:#e8e4d8;border:1px solid #2c3450;border-radius:8px;font-size:1rem}
button{width:100%;padding:.65rem;margin-top:.5rem;background:#f5c944;color:#10131c;border:0;border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer}
p{font-size:.9rem;color:#a9a493}small{display:block;margin-top:1rem;font-size:.72rem;color:#6d6a5e}
ul{padding-left:1.25rem;color:#a9a493}li{margin:.45rem 0}li strong{color:#e8e4d8}
</style></head><body><main>${body}
<small>This material is unofficial and is not endorsed by Supercell. For more information see Supercell&rsquo;s Fan Content Policy: www.supercell.com/fan-content-policy.</small>
</main></body></html>`;
}

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  // form-action must keep https: — 'self' alone blocks the consent redirect.
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action https: http://localhost:* http://127.0.0.1:*; base-uri 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
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
const html = (statusCode, body) => ({
  statusCode,
  headers: HTML_HEADERS,
  body,
});

/** API Gateway v2 delivers form posts base64-encoded (isBase64Encoded);
 *  JSON usually arrives as text. Decode before parsing, always. */
export function rawBody(event) {
  const body = event.body ?? "";
  return event.isBase64Encoded
    ? Buffer.from(body, "base64").toString("utf8")
    : body;
}

function parseForm(event) {
  return Object.fromEntries(new URLSearchParams(rawBody(event)));
}

function hiddenAuthFields(q) {
  return [
    "client_id",
    "redirect_uri",
    "state",
    "code_challenge",
    "code_challenge_method",
    "scope",
    "resource",
  ]
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k] ?? "")}">`)
    .join("");
}

/**
 * What went wrong, in a sentence that names the next action.
 *
 * The old page said "wrong, expired, or didn't match this request" for seven
 * different causes, three of which are fixed by doing the same thing again and
 * four of which are not. Somebody holding a correct, current code was told to
 * start over, did, and hit it again.
 */
function codeFailure(reason) {
  const messages = {
    wrong_flow: [
      "That code is for signing in to the website",
      "It is not the code Claude asked for. Use the code from the most recent Elixir MCP email sent for this connection, or press back and send a new one.",
    ],
    superseded: [
      "A newer code was sent",
      "That code was replaced by a later one for this connection. Check your most recent email.",
    ],
    already_used: [
      "That code has been used",
      "Each code works once. Start over from your MCP client to get a new one.",
    ],
    expired: [
      "That code has expired",
      "Codes are good for 15 minutes. Start over from your MCP client to get a new one.",
    ],
    attempts_exhausted: [
      "Too many attempts on that code",
      "Start over from your MCP client; the next code starts fresh.",
    ],
    no_live_code: [
      "There is no code waiting",
      "It may have expired, or already been used. Start over from your MCP client.",
    ],
    malformed: [
      "That is not a six-digit code",
      "Check the digits and try again.",
    ],
    code_mismatch: [
      "That code did not match",
      "Check the most recent email for this connection. Codes are good for 15 minutes and work once.",
    ],
    account_not_approved: [
      "That account cannot sign in",
      "It is not approved yet. Request access from the site and try again once it is.",
    ],
  };
  const [title, body] = messages[reason] ?? [
    "That didn't work",
    // The request-side mismatches land here: the code was fine, the request
    // around it was not the one that asked for it.
    "This is not the request that asked for that code — the client, the redirect, the connection or the challenge changed. Start over from your MCP client, in one pass, without reloading this page.",
  ];
  return `<h1>${esc(title)}</h1><p>${esc(body)}</p>`;
}

function consentCapabilities(scope) {
  const granted = new Set(scope.split(" "));
  return `<ul>${OAUTH_SCOPE_DETAILS.filter(({ scope: value }) =>
    granted.has(value),
  )
    .map(
      ({ title, description }) =>
        `<li><strong>${esc(title)}</strong> — ${esc(description)}</li>`,
    )
    .join("")}</ul>`;
}

/**
 * Which principal a requested audience names, and whether the signed-in person
 * may speak for it.
 *
 * Consenting to act AS an agent is a different act from signing in as yourself,
 * and the ONLY person who may do it is the agent's owner. The check is an
 * ownership comparison against the authenticated account — not a role, not a
 * capability — because owning the agent is the entire basis of the authority.
 */
async function principalForTarget(db, target) {
  if (target.kind === "person") return { ok: true, principal: null };
  const { rows } = await db.query(
    `select a.account_id, a.kind, a.public_id, a.owned_by_account_id,
            (select ac.clan_tag from account_clan ac
              where ac.account_id = a.account_id and ac.is_primary limit 1) as clan_tag,
            (select t.name from service_token t
              where t.account_id = a.account_id and t.revoked_at is null
              order by t.token_id limit 1) as name
     from account a
     where a.public_id = $1 and a.kind = $2 and a.status = 'approved'
       and not exists (select 1 from integration i where i.account_id = a.account_id)`,
    [target.publicId, target.kind],
  );
  // Deliberately the same refusal whether the principal is missing or simply
  // not yours: otherwise the consent screen becomes a way to discover which
  // agents exist.
  return rows[0] ? { ok: true, principal: rows[0] } : { ok: false };
}

async function validatedAuthRequest(db, q, targetFor) {
  const client = await getClient(db, q.client_id);
  if (!client) return { error: "unknown client_id" };
  const redirectUri = validRedirectUri(q.redirect_uri);
  if (!redirectUri || !client.redirectUris.includes(redirectUri))
    return { error: "redirect_uri not registered" };
  if ((q.code_challenge_method ?? "S256") !== "S256")
    return { error: "code_challenge_method must be S256" };
  const codeChallenge = validCodeChallenge(q.code_challenge);
  if (!codeChallenge) return { error: "invalid code_challenge" };
  const scope = normalizeScope(q.scope);
  if (!scope) return { error: "invalid_scope" };
  const target = targetFor(q.resource);
  if (!target) return { error: "invalid_target" };
  return {
    client,
    redirectUri,
    codeChallenge,
    scope,
    resource: target.resource,
    target,
    state: validState(q.state),
  };
}

export function makeOauthRoutes({ issuer, sendLoginEmail }) {
  /** The three legal audiences: the personal door and one per principal. */
  const targetFor = (value) => {
    const canonical = canonicalResource(value);
    if (!canonical) return null;
    if (!canonical.startsWith(issuer)) return null;
    return resourceForPath(canonical.slice(issuer.length), issuer);
  };
  return {
    async register(db, event) {
      const ip = event.requestContext?.http?.sourceIp ?? "unknown";
      const perIp = await checkRateLimit(db, { bucket: `dcr#${ip}`, max: 20 });
      let globalOk = false;
      try {
        const { rows } = await db.query(
          `insert into rate_limit (bucket, window_start, count) values ('dcr#global', current_date, 1)
           on conflict (bucket, window_start) do update set count = rate_limit.count + 1 returning count`,
        );
        globalOk = rows[0].count <= DCR_GLOBAL_DAILY_CAP; // fail closed
      } catch {
        globalOk = false;
      }
      if (!perIp || !globalOk)
        return json(429, { error: "temporarily_unavailable" });
      let body;
      try {
        body = JSON.parse(rawBody(event));
      } catch {
        return json(400, { error: "invalid_client_metadata" });
      }
      const redirectUris = validateRedirectUris(body.redirect_uris);
      if (!redirectUris) return json(400, { error: "invalid_redirect_uri" });
      const client = await registerClient(db, {
        clientName: sanitizeClientName(body.client_name) || "MCP client",
        redirectUris,
      });
      return json(201, {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    },

    async authorizeGet(db, event) {
      const q = event.queryStringParameters ?? {};
      const v = await validatedAuthRequest(db, q, targetFor);
      if (v.error)
        return html(
          400,
          page(
            "Elixir MCP",
            `<h1>Can&rsquo;t authorize</h1><p>${esc(v.error)}</p>`,
          ),
        );
      return html(
        200,
        page(
          "Connect to Elixir MCP",
          `<h1>Connect ${esc(v.client.clientName)}</h1>
           <p>Enter the email on your approved Elixir MCP account and we&rsquo;ll send a sign-in code.</p>
           <form method="post" action="/oauth/authorize">
             <input type="hidden" name="step" value="email">${hiddenAuthFields(q)}
             <input type="email" name="email" placeholder="you@example.com" required autofocus>
             <button>Send code</button>
           </form>`,
        ),
      );
    },

    async authorizePost(db, event) {
      const form = parseForm(event);
      const v = await validatedAuthRequest(db, form, targetFor);
      if (v.error)
        return html(
          400,
          page(
            "Elixir MCP",
            `<h1>Can&rsquo;t authorize</h1><p>${esc(v.error)}</p>`,
          ),
        );
      const hash = emailHash(form.email);
      const ip = event.requestContext?.http?.sourceIp ?? "unknown";

      if (form.step === "email") {
        const allowed = await checkRateLimit(db, {
          bucket: `oauthmail#${ip}`,
          max: 10,
        });
        const account = allowed ? await approvedAccount(db, hash) : null;
        if (account) {
          authLog("oauth_code_issued", {
            email: emailRef(hash),
            client: v.client.clientName,
            resource: v.resource,
            kind: v.target.kind,
          });
          const { code } = await startMagicLogin(db, {
            emailHash: hash,
            purpose: "oauth",
            context: {
              client_id: v.client.clientId,
              redirect_uri: v.redirectUri,
              scope: v.scope,
              resource: v.resource,
              state: v.state,
              code_challenge: v.codeChallenge,
            },
          });
          await sendLoginEmail({
            email: form.email,
            code,
            purpose: "oauth",
            clientName: v.client.clientName,
            newsletter: account.newsletter_opt_in === true,
          });
        }
        // Identical page whether or not anything was sent — never an oracle.
        return html(
          200,
          page(
            "Enter your code",
            `<h1>Check your email</h1>
             <p>If your account is approved, a 6-digit code is on its way to ${esc(form.email)}.</p>
             ${
               v.target.kind === "person"
                 ? `<p><strong>Entering it authorizes ${esc(v.client.clientName)} to:</strong></p>${consentCapabilities(v.scope)}`
                 : `<p><strong>This connects ${esc(v.client.clientName)} as one of your ${esc(v.target.kind === "agent" ? "agents" : "integrations")}, not as you.</strong></p>
                    <p>It will act with that principal&rsquo;s own identity and see its data, not your players or your feed. You can only do this for a principal you own.</p>
                    ${consentCapabilities(v.scope)}`
             }
             <form method="post" action="/oauth/authorize">
               <input type="hidden" name="step" value="code">${hiddenAuthFields(form)}
               <input type="hidden" name="email" value="${esc(form.email)}">
               <input inputmode="numeric" autocomplete="one-time-code" name="code" placeholder="123456" required autofocus>
               <button>Authorize</button>
             </form>`,
          ),
        );
      }

      if (form.step === "code") {
        const verified = await verifyMagicCode(db, {
          emailHash: hash,
          code: form.code,
          // Ours, not the website's. These two flows share a table and used to
          // consume each other's codes and each other's attempts.
          purpose: "oauth",
        });
        const ctx = verified.ok ? verified.row.context : null;
        const account = verified.ok ? await approvedAccount(db, hash) : null;

        // WHICH of these failed decides what the person should do next, and
        // saying "one of seven things" left them retrying a code that could
        // never work. Each branch below is a different next step.
        const mismatch =
          ctx && account
            ? ctx.client_id !== v.client.clientId
              ? "client"
              : ctx.redirect_uri !== v.redirectUri
                ? "redirect_uri"
                : ctx.resource !== v.resource
                  ? "resource"
                  : ctx.code_challenge !== v.codeChallenge
                    ? "code_challenge"
                    : null
            : null;

        if (!verified.ok || !ctx || !account || mismatch) {
          const reason = !verified.ok
            ? verified.reason
            : !account
              ? "account_not_approved"
              : `request_${mismatch}`;
          authLog("oauth_code_rejected", {
            email: emailRef(hash),
            reason,
            attempts: verified.attempts,
            client: v.client.clientName,
            resource: v.resource,
          });
          return html(400, page("Elixir MCP", codeFailure(reason)));
        }
        authLog("oauth_code_accepted", {
          email: emailRef(hash),
          client: v.client.clientName,
          resource: v.resource,
          kind: v.target.kind,
        });
        // The person proved who they are. If the audience names a principal,
        // the grant belongs to THAT account -- so every token minted from this
        // code carries the agent's identity, budget and tool surface, and the
        // person's own data is not reachable through it at all.
        const owned = await principalForTarget(db, v.target);
        if (
          !owned.ok ||
          (owned.principal &&
            owned.principal.owned_by_account_id !== account.account_id)
        ) {
          authLog("oauth_principal_refused", {
            email: emailRef(hash),
            resource: v.resource,
            kind: v.target.kind,
          });
          return html(
            403,
            page(
              "Elixir MCP",
              `<h1>Not yours to connect</h1><p>That agent or integration is not one you own.</p>`,
            ),
          );
        }

        const code = await createAuthCode(db, {
          clientId: v.client.clientId,
          accountId: owned.principal?.account_id ?? account.account_id,
          redirectUri: v.redirectUri,
          scope: ctx.scope,
          resource: ctx.resource,
          codeChallenge: v.codeChallenge,
        });
        const url = new URL(v.redirectUri);
        url.searchParams.set("code", code);
        if (v.state) url.searchParams.set("state", v.state);
        url.searchParams.set("iss", issuer); // RFC 9207
        return {
          statusCode: 303,
          headers: { location: url.toString(), "cache-control": "no-store" },
          body: "",
        };
      }
      return html(400, page("Elixir MCP", "<h1>Bad request</h1>"));
    },

    async token(db, event) {
      const form = parseForm(event);
      // Any legal audience; WHICH one is already pinned by the code being
      // redeemed, which was bound to a resource when it was issued.
      const requested = targetFor(form.resource);
      if (!requested) return json(400, { error: "invalid_target" });
      const requestedResource = requested.resource;
      const clientId = String(form.client_id ?? "");
      const client = await getClient(db, clientId);
      if (!client) return json(400, { error: "invalid_client" });

      if (form.grant_type === "authorization_code") {
        const redeemed = await redeemAuthCode(db, form.code);
        if (!redeemed || redeemed.clientId !== clientId) {
          authLog("oauth_token_rejected", {
            reason: redeemed ? "client_mismatch" : "code_unknown_or_used",
            client: clientId,
            resource: requestedResource,
          });
          return json(400, { error: "invalid_grant" });
        }
        // Each of these is a different client bug and they all used to look
        // identical from the outside, and leave nothing behind on the inside.
        const grantFault =
          redeemed.redirectUri !== String(form.redirect_uri ?? "")
            ? "redirect_uri_mismatch"
            : redeemed.resource !== requestedResource
              ? "resource_mismatch"
              : !verifyPkce(form.code_verifier, redeemed.codeChallenge)
                ? "pkce_failed"
                : null;
        if (grantFault) {
          authLog("oauth_token_rejected", {
            reason: grantFault,
            client: clientId,
            resource: requestedResource,
          });
          return json(400, {
            error:
              grantFault === "resource_mismatch"
                ? "invalid_target"
                : "invalid_grant",
          });
        }
        const tokens = await mintTokens(db, {
          clientId,
          accountId: redeemed.accountId,
          scope: redeemed.scope,
          resource: redeemed.resource,
        });
        authLog("oauth_token_issued", {
          client: clientId,
          resource: redeemed.resource,
          grant: "authorization_code",
        });
        return json(200, {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_type: "Bearer",
          expires_in: tokens.expiresIn,
          scope: redeemed.scope,
        });
      }
      if (form.grant_type === "refresh_token") {
        const result = await redeemRefreshToken(db, {
          refreshToken: form.refresh_token,
          clientId,
          resource: requestedResource,
        });
        if (result.status === "invalid_target")
          return json(400, { error: "invalid_target" });
        if (result.status !== "ok")
          return json(400, { error: "invalid_grant" });
        return json(200, {
          access_token: result.tokens.accessToken,
          refresh_token: result.tokens.refreshToken,
          token_type: "Bearer",
          expires_in: result.tokens.expiresIn,
          scope: result.tokens.scope,
        });
      }
      return json(400, { error: "unsupported_grant_type" });
    },

    authorizationServerMetadata() {
      return json(
        200,
        {
          issuer,
          authorization_endpoint: `${issuer}/oauth/authorize`,
          token_endpoint: `${issuer}/oauth/token`,
          registration_endpoint: `${issuer}/oauth/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: OAUTH_SCOPES,
        },
        { "cache-control": "public, max-age=300" },
      );
    },

    // One document per protected resource (RFC 9728). The default is the
    // personal one, so every existing caller sees exactly what it saw before.
    protectedResourceMetadata(resource = `${issuer}/mcp`) {
      return json(
        200,
        {
          resource,
          authorization_servers: [issuer],
          // The initial challenge is deliberately read-only. General MCP
          // clients can step up from a per-tool insufficient_scope response.
          scopes_supported: [DEFAULT_OAUTH_SCOPE],
          bearer_methods_supported: ["header"],
        },
        { "cache-control": "public, max-age=300" },
      );
    },
  };
}
