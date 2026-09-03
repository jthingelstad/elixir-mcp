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
  checkRateLimit,
  registerClient,
  getClient,
  sanitizeClientName,
  validateRedirectUris,
  validRedirectUri,
  validState,
  validCodeChallenge,
  normalizeScope,
  verifyPkce,
  createAuthCode,
  redeemAuthCode,
  mintTokens,
  redeemRefreshToken,
  OAUTH_SCOPES,
} from "@elixir-mcp/auth";

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
  ]
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k] ?? "")}">`)
    .join("");
}

async function validatedAuthRequest(db, q) {
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
  if (!scope) return { error: "unsupported scope" };
  return {
    client,
    redirectUri,
    codeChallenge,
    scope,
    state: validState(q.state),
  };
}

export function makeOauthRoutes({ issuer, sendLoginEmail }) {
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
      const v = await validatedAuthRequest(db, q);
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
      const v = await validatedAuthRequest(db, form);
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
          const { code } = await startMagicLogin(db, {
            emailHash: hash,
            purpose: "oauth",
            context: {
              client_id: v.client.clientId,
              redirect_uri: v.redirectUri,
              scope: v.scope,
              state: v.state,
              code_challenge: v.codeChallenge,
            },
          });
          await sendLoginEmail({
            email: form.email,
            code,
            purpose: "oauth",
            clientName: v.client.clientName,
          });
        }
        // Identical page whether or not anything was sent — never an oracle.
        return html(
          200,
          page(
            "Enter your code",
            `<h1>Check your email</h1>
             <p>If your account is approved, a 6-digit code is on its way to ${esc(form.email)}.</p>
             <p><strong>Entering it authorizes ${esc(v.client.clientName)} to read your recorded Clash Royale data.</strong></p>
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
        const burned = await verifyMagicCode(db, {
          emailHash: hash,
          code: form.code,
        });
        const ctx = burned?.purpose === "oauth" ? burned.context : null;
        const account = burned ? await approvedAccount(db, hash) : null;
        if (
          !ctx ||
          !account ||
          ctx.client_id !== v.client.clientId ||
          ctx.redirect_uri !== v.redirectUri ||
          ctx.code_challenge !== v.codeChallenge
        ) {
          return html(
            400,
            page(
              "Elixir MCP",
              `<h1>That didn&rsquo;t work</h1><p>The code was wrong, expired, or didn&rsquo;t match this request. Start over from your MCP client.</p>`,
            ),
          );
        }
        const code = await createAuthCode(db, {
          clientId: v.client.clientId,
          accountId: account.account_id,
          redirectUri: v.redirectUri,
          scope: ctx.scope,
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
      const clientId = String(form.client_id ?? "");
      const client = await getClient(db, clientId);
      if (!client) return json(400, { error: "invalid_client" });

      if (form.grant_type === "authorization_code") {
        const redeemed = await redeemAuthCode(db, form.code);
        if (!redeemed || redeemed.clientId !== clientId)
          return json(400, { error: "invalid_grant" });
        if (redeemed.redirectUri !== String(form.redirect_uri ?? ""))
          return json(400, { error: "invalid_grant" });
        if (!verifyPkce(form.code_verifier, redeemed.codeChallenge))
          return json(400, { error: "invalid_grant" });
        const tokens = await mintTokens(db, {
          clientId,
          accountId: redeemed.accountId,
          scope: redeemed.scope,
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
        });
        if (result.status !== "ok")
          return json(400, { error: "invalid_grant" });
        return json(200, {
          access_token: result.tokens.accessToken,
          refresh_token: result.tokens.refreshToken,
          token_type: "Bearer",
          expires_in: result.tokens.expiresIn,
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

    protectedResourceMetadata() {
      return json(
        200,
        {
          resource: `${issuer}/mcp`,
          authorization_servers: [issuer],
          scopes_supported: OAUTH_SCOPES,
          bearer_methods_supported: ["header"],
        },
        { "cache-control": "public, max-age=300" },
      );
    },
  };
}
