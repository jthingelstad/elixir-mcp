/**
 * OAuth 2.1 HTTP shell on the MCP door. The /authorize
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
  findRecentlyUsedCode,
  authLog,
  emailRef,
  requestRef,
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

/**
 * The door's own page shell.
 *
 * These hex values are literals rather than the design tokens, and have
 * to be: this page is served by the MCP door under a CSP of
 * `default-src 'none'; style-src 'unsafe-inline'`, so it can load no
 * stylesheet at all — not even our own. They are the same values as
 * packages/design/styles.css and must be changed together.
 *
 * It was still carrying a palette (#10131c ink on #171c2a) that matched
 * nothing else in the product, which on the one screen where somebody
 * hands over access is the wrong thing to look unfamiliar.
 */
function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{background:radial-gradient(60rem 30rem at 50% -12rem,#191140,#0c0920) #0c0920;color:#faf8ff;font:15px/1.5 Inter,system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;-webkit-font-smoothing:antialiased}
main{max-width:27rem;box-sizing:border-box;padding:26px;margin:24px;background:#150f36;border:1px solid #3a3175;border-radius:16px;box-shadow:0 24px 70px rgba(4,2,12,.5)}
h1{font-size:1.4rem;line-height:1.15;font-weight:600;color:#faf8ff;margin:0 0 .5rem}
input{width:100%;box-sizing:border-box;padding:12px 13px;margin:.5rem 0 .875rem;background:#120d2e;color:#faf8ff;border:1px solid #4c4193;border-radius:10px;font-size:15px}
input[type=checkbox]{width:16px;height:16px;margin:2px 9px 0 0;accent-color:#8b5cf6}
button{width:100%;padding:13px;margin-top:.5rem;background:linear-gradient(180deg,#ffe99a,#f5c84c);color:#2a1500;border:0;border-radius:11px;font-size:15px;font-weight:700;cursor:pointer}
p{font-size:13.5px;line-height:1.6;color:#bdb4e2;text-wrap:pretty}
a{color:#b49dfb}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;color:#b49dfb}
small{display:block;margin-top:1.25rem;padding-top:14px;border-top:1px solid #2d2560;font-size:11.5px;line-height:1.5;color:#a29ad0}
ul{list-style:none;padding:0;margin:.5rem 0;color:#bdb4e2}
li{margin:0;padding:10px 0;border-bottom:1px solid #241d4e;font-size:13.5px}
li strong{color:#faf8ff;font-weight:600}
label{display:flex;align-items:flex-start;cursor:pointer}
</style></head><body><main>${body}
<small>This material is unofficial and is not endorsed by Supercell. For more information see Supercell&rsquo;s Fan Content Policy: www.supercell.com/fan-content-policy.</small>
</main></body></html>`;
}

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  // form-action must keep https: — 'self' alone blocks the consent redirect.
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action https: http://localhost:* http://127.0.0.1:* http://[::1]:*; base-uri 'none'; frame-ancestors 'none'",
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

/** Every value of a repeated field. parseForm keeps only the last. */
function formValues(event, key) {
  return new URLSearchParams(rawBody(event)).getAll(key);
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

/**
 * What this connection will be able to do, and what else it MAY be allowed
 * to do.
 *
 * The requested capabilities are fixed: a client that asked for them needs
 * them. The rest are offered as checkboxes, because this page is the only
 * place a human can widen a grant. Scope arrives in the client's ?scope=
 * parameter, and the protected-resource challenge advertises cr:read only,
 * so a client that never asks for feedback:write could never obtain it -
 * while the insufficient_scope refusal told people to grant exactly that
 * "on the consent page", where no such control existed (2026-09-09).
 *
 * RFC 6749 section 3.3 permits issuing a scope different from the one
 * requested provided the token response says so, which it does: the
 * granted scope is stored on the auth code and echoed back at redemption.
 */
function consentCapabilities(scope) {
  const granted = new Set(scope.split(" "));
  const line = ({ title, description }) =>
    `<strong>${esc(title)}</strong> — ${esc(description)}`;
  const asked = OAUTH_SCOPE_DETAILS.filter((d) => granted.has(d.scope));
  const rest = OAUTH_SCOPE_DETAILS.filter((d) => !granted.has(d.scope));
  return (
    `<ul>${asked.map((d) => `<li>${line(d)}</li>`).join("")}</ul>` +
    (rest.length === 0
      ? ""
      : `<p><strong>You can also allow, if you want to:</strong></p>
         <ul>${rest
           .map(
             (d) =>
               `<li><label><input type="checkbox" name="grant" value="${esc(d.scope)}"> ${line(d)}</label></li>`,
           )
           .join("")}</ul>
         <p>Only what you tick is added. ${esc(String(asked.length))} capabilit${asked.length === 1 ? "y was" : "ies were"} asked for by the client; these were not.</p>`)
  );
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
            request: requestRef(v.codeChallenge),
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

        // IDEMPOTENT, because this form gets posted twice.
        //
        // iOS fills a one-time code and submits; a tap submits again ~1.4s
        // later. The first POST authorized correctly and 303'd back to the
        // client — and the second, finding the code spent, painted "there is
        // no code waiting" over the redirect that would have finished the
        // connection. From the outside it looked like the code was refused;
        // from the logs it was accepted and then contradicted.
        //
        // So a duplicate repeats the first answer rather than denying it.
        // Nothing is trusted from the replay itself: every binding below is
        // re-checked against this request, the window is two minutes, and the
        // auth code minted is single-use like any other, so whichever
        // navigation wins, exactly one code is redeemable.
        let ctx = verified.ok ? verified.row.context : null;
        let replayed = false;
        if (
          !verified.ok &&
          (verified.reason === "no_live_code" ||
            verified.reason === "already_used")
        ) {
          const prior = await findRecentlyUsedCode(db, {
            emailHash: hash,
            code: form.code,
            purpose: "oauth",
          });
          if (prior) {
            ctx = prior.context;
            replayed = true;
          }
        }
        const account = ctx ? await approvedAccount(db, hash) : null;

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

        // Same code again, or a different one? "no_live_code" alone cannot say,
        // and the answer decides whether a duplicate submit or a second
        // authorize request is at fault.
        const presentedCodeRef = !verified.ok
          ? replayed
            ? "same_as_burned"
            : (await findRecentlyUsedCode(db, {
                  emailHash: hash,
                  code: form.code,
                  withinSeconds: 900,
                }))
              ? "older_burned_code"
              : "unrecognized"
          : null;

        if ((!verified.ok && !replayed) || !ctx || !account || mismatch) {
          const reason = !ctx
            ? verified.reason
            : !account
              ? "account_not_approved"
              : mismatch
                ? `request_${mismatch}`
                : verified.reason;
          authLog("oauth_code_rejected", {
            email: emailRef(hash),
            request: requestRef(v.codeChallenge),
            // Did they hand us the same code again (a duplicate submit) or a
            // different one (a second flow)? On the no-live-code path the
            // classifier never ran, so the log could not tell those apart.
            presented: presentedCodeRef,
            reason,
            attempts: verified.attempts,
            client: v.client.clientName,
            resource: v.resource,
          });
          return html(400, page("Elixir MCP", codeFailure(reason)));
        }
        authLog(replayed ? "oauth_code_replayed" : "oauth_code_accepted", {
          email: emailRef(hash),
          request: requestRef(v.codeChallenge),
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

        // The human is the only party who can widen a grant, and only to
        // capabilities this server defines. The base is the scope BOUND at
        // the email step, never this form's, so a re-posted ?scope= cannot
        // move the grant behind the checkboxes.
        const added = formValues(event, "grant").filter(
          (value) => OAUTH_SCOPES.includes(value) && !ctx.scope.includes(value),
        );
        const grantedScope = normalizeScope([ctx.scope, ...added].join(" "));
        if (added.length > 0)
          authLog("oauth_scope_widened", {
            email: emailRef(hash),
            request: requestRef(v.codeChallenge),
            client: v.client.clientName,
            requested: ctx.scope,
            added: added.join(" "),
          });
        const code = await createAuthCode(db, {
          clientId: v.client.clientId,
          accountId: owned.principal?.account_id ?? account.account_id,
          redirectUri: v.redirectUri,
          scope: grantedScope,
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
