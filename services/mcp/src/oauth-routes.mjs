/**
 * OAuth 2.1 HTTP shell on the MCP door. The /authorize
 * pages reuse the SAME magic-code core as the web sign-in (one
 * credential-issuance core, two shells): pending state rides
 * magic_login purpose='oauth'. Two steps, not librarian's three — the
 * code page carries the consent language, so entering the code IS the
 * consent act.
 *
 * Since 2026-10-12 this door opens accounts as the website's signup does
 * (Jamie: Drop "gets new users into Elixir"): the email step admits a new
 * address with publicLoginAccount, and only the proved code opens it with
 * openVerifiedAccount. A blocked address is sent nothing and is told so
 * only once it holds a code it could not have; the email step's page is
 * the same for every address (never an email oracle).
 *
 * The family's own provisioned clients (Elixir Drop, Elixir Clan) sign a
 * person in with no consent page (Jamie, 2026-10-12: "Consent to what? I
 * think no."): they get exactly what they asked for, never a box.
 *
 * Since 2026-09-12 the site session counts here too. /oauth/authorize is
 * the ONE door route CloudFront forwards the session cookie to (its own
 * behavior in infra/template.yaml; /mcp, /oauth/token and the rest stay
 * cookie-free): a person signed in to elixir.poapkings.com is shown the
 * consent page with no code to fetch, and a person who consents by code
 * is signed in to the site on the way out. Every consent used to cost a
 * trip to the inbox, whoever you were; connecting the family's own
 * products (Elixir Clan, Elixir Drop) made that a daily tax.
 *
 * CSP on these pages keeps form-action https: — 'self' alone silently
 * blocks the consent redirect in Chromium (librarian's shipped trap).
 */

import { createHash } from "node:crypto";
import {
  emailHash,
  approvedAccount,
  publicLoginAccount,
  openVerifiedAccount,
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
  validateAccessToken,
  isFirstPartyClient,
  redirectsToFamily,
  authenticateClient,
  revokeToken,
  signinMailAllowed,
  signinMailFromAllowed,
  signinAddress,
  viewerIp,
  OAUTH_SCOPES,
  resolveSession,
  createSession,
  readSessionCookie,
  sessionCookie,
  sessionSeenFrom,
  ABSOLUTE_CAP_DAYS,
  turnstileAtDoor,
  TURNSTILE_ORIGIN,
  TURNSTILE_REFUSED_MESSAGE,
  TURNSTILE_SITE_KEY,
} from "@elixir-mcp/auth";
import {
  OAUTH_SCOPE,
  OAUTH_SCOPE_DETAILS,
  STANDARD_OAUTH_SCOPES,
  DEFAULT_OAUTH_SCOPE,
} from "@elixir-mcp/contracts";

/** Registrations per caller per hour, and a global backstop per UTC day.
 *  The backstop fails closed, so it sits far above any real day (review
 *  §6.5). */
const DCR_PER_CALLER_HOUR = 20;
const DCR_GLOBAL_DAILY_CAP = 5000;

/** Names only the Elixir family's own apps may carry on a consent page:
 *  a client name is self-chosen, so one that opens with Elixir's or
 *  POAP KINGS' name is refused at registration. Folded (NFKC, case, and
 *  everything but letters and digits) so a space or a lookalike is not a
 *  way round. "Claude Code (elixir-mcp)" is a client naming its server,
 *  and stays allowed. */
const FAMILY_NAME_RE = /^(?:elixir|poapkings)/;
function impersonatesFamily(clientName) {
  const folded = String(clientName ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  return FAMILY_NAME_RE.test(folded);
}

/** Where a client's codes go, for the consent pages: the host, or the
 *  loopback a local client listens on. */
function redirectHost(uri) {
  try {
    return new URL(uri).host;
  } catch {
    return "";
  }
}

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

/**
 * Turnstile on the email step (2026-10-14, auth turnstile.mjs). The page
 * works without script; this one inline script, allowed by its hash and
 * nothing else, loads Cloudflare's only once the address field is
 * focused or typed in (it has autofocus, so in practice on arrival here,
 * and never on any other door page). The widget shows itself only when
 * Cloudflare wants a click, and puts its token in the form as
 * `cf-turnstile-response`. Sending waits for the token a few seconds (as
 * long as a shown challenge needs); a script that cannot load, or an
 * error, sends without one and the relay records it as missing.
 */
const TURNSTILE_SCRIPT = `(function(){
var f=document.getElementById("signin-email-form");
var e=f&&f.elements.email;
var slot=document.getElementById("turnstile-slot");
if(!f||!e||!slot)return;
var state="idle",token="",shown=false,held=false;
function load(){
if(state!=="idle")return;
state="loading";
window.elixirTurnstileLoaded=function(){
if(!window.turnstile){state="failed";return;}
try{window.turnstile.render(slot,{sitekey:"${TURNSTILE_SITE_KEY}",action:"oauth-signin",appearance:"interaction-only","refresh-expired":"auto",
callback:function(t){token=t;shown=false;state="ready";},
"expired-callback":function(){token="";},
"before-interactive-callback":function(){shown=true;},
"error-callback":function(){token="";state="failed";}});}catch(x){state="failed";}
};
var s=document.createElement("script");
s.src="${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit&onload=elixirTurnstileLoaded";
s.async=true;
s.onerror=function(){state="failed";};
document.head.appendChild(s);
}
e.addEventListener("focus",load);
e.addEventListener("input",load);
if(document.activeElement===e)load();
f.addEventListener("submit",function(ev){
if(held){ev.preventDefault();return;}
if(token||state==="idle"||state==="failed")return;
ev.preventDefault();
held=true;
var started=Date.now();
(function wait(){
if(token||state==="failed"||Date.now()-started>=(shown?120000:5000))return f.submit();
setTimeout(wait,250);
})();
});
})();`;
const TURNSTILE_SCRIPT_HASH = createHash("sha256")
  .update(TURNSTILE_SCRIPT)
  .digest("base64");

/** The email step's headers: the door's CSP, plus that one script and
 *  Cloudflare's script and challenge frame. */
const EMAIL_STEP_HEADERS = {
  ...HTML_HEADERS,
  "content-security-policy": `${HTML_HEADERS["content-security-policy"]}; script-src 'sha256-${TURNSTILE_SCRIPT_HASH}' ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}`,
};
const emailStepHtml = (statusCode, body) => ({
  statusCode,
  headers: EMAIL_STEP_HEADERS,
  body,
});

/** Native HTTP preserves the raw form text, including repeated fields. */
export function rawBody(event) {
  return event.body ?? "";
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
      "It is not the code this sign-in asked for. Use the code from the most recent Elixir email sent for this connection, or press back and send a new one.",
    ],
    superseded: [
      "A newer code was sent",
      "That code was replaced by a later one for this connection. Check your most recent email.",
    ],
    already_used: [
      "That code has been used",
      "Each code works once. Start over from the app that sent you here to get a new one.",
    ],
    expired: [
      "That code has expired",
      "Codes are good for 15 minutes. Start over from the app that sent you here to get a new one.",
    ],
    attempts_exhausted: [
      "Too many attempts on that code",
      "Start over from the app that sent you here; the next code starts fresh.",
    ],
    no_live_code: [
      "There is no code waiting",
      "It may have expired, or already been used. Start over from the app that sent you here.",
    ],
    malformed: [
      "That is not a six-digit code",
      "Check the digits and try again.",
    ],
    code_mismatch: [
      "That code did not match",
      "Check the most recent email for this connection. Codes are good for 15 minutes and work once.",
    ],
    // Only an address the gate refuses reaches this: a new one is opened
    // by the code it just proved. Holding the code proves the address, so
    // saying so is not an oracle.
    account_not_approved: [
      "This account cannot sign in",
      "Contact Elixir at admin@poapkings.com if you think this is a mistake. A new code does not remove an account restriction.",
    ],
  };
  const [title, body] = messages[reason] ?? [
    "That didn't work",
    // The request-side mismatches land here: the code was fine, the request
    // around it was not the one that asked for it.
    "This is not the request that asked for that code — the client, the redirect, the connection or the challenge changed. Start over from the app that sent you here, in one pass, without reloading this page.",
  ];
  return `<h1>${esc(title)}</h1><p>${esc(body)}</p>`;
}

/** What a connection cannot do without each capability, for the page
 *  and the confirmation (Jamie 2026-09-24: say what an unticked box
 *  will stop). */
const WITHOUT = {
  "recordings:write": "track or stop tracking players and clans for you",
  "account:write":
    "remember who is talking to it or set your private nicknames",
  "feedback:write": "send feedback to the Elixir maintainer for you",
};

/** The capabilities offered ticked before anyone touches the page
 *  (Jamie 2026-09-24): on a person's own connection none, every write is
 *  theirs to choose; on an agent or integration every write but tracking,
 *  which spends the owner's tracking slots and is ticked on purpose. */
function defaultTicked(kind) {
  return kind === "person" || kind === "api"
    ? []
    : STANDARD_OAUTH_SCOPES.filter(
        (s) => s !== OAUTH_SCOPE.READ && s !== OAUTH_SCOPE.RECORDINGS_WRITE,
      );
}

/** The standard capabilities a request did not ask for: the checkboxes. */
function optionalScopes(scope) {
  const granted = new Set(scope.split(" "));
  return STANDARD_OAUTH_SCOPES.filter((s) => !granted.has(s));
}

/** The capabilities a request names, as a list with no boxes. */
function askedCapabilities(scope) {
  const asked = new Set(scope.split(" "));
  return `<ul>${OAUTH_SCOPE_DETAILS.filter((d) => asked.has(d.scope))
    .map(
      (d) =>
        `<li><strong>${esc(d.title)}</strong> — ${esc(d.description)}</li>`,
    )
    .join("")}</ul>`;
}

/**
 * What this connection will be able to do, and what else it MAY be allowed
 * to do.
 *
 * The requested capabilities are fixed: a client that asked for them needs
 * them. The rest are checkboxes, because this page is the only place a
 * human can widen a grant: ticked or not by the connection's kind
 * (defaultTicked), or as the person left them when they come back from
 * the confirmation. Each box says what the connection cannot do without
 * it.
 *
 * RFC 6749 section 3.3 permits issuing a scope different from the one
 * requested provided the token response says so, which it does: the
 * granted scope is stored on the auth code and echoed back at redemption.
 */
function consentCapabilities(scope, { kind, ticked = null } = {}) {
  const granted = new Set(scope.split(" "));
  const on = new Set(ticked ?? defaultTicked(kind));
  const line = ({ title, description }) =>
    `<strong>${esc(title)}</strong> — ${esc(description)}`;
  // A non-standard capability (account:email) is never offered unasked:
  // it appears only in the list above, when the client named it.
  const rest = OAUTH_SCOPE_DETAILS.filter(
    (d) => d.standard && !granted.has(d.scope),
  );
  return (
    askedCapabilities(scope) +
    (rest.length === 0
      ? ""
      : `<p><strong>You choose whether it may also:</strong></p>
         <ul>${rest
           .map(
             (d) =>
               `<li><label><input type="checkbox" name="grant" value="${esc(d.scope)}"${on.has(d.scope) ? " checked" : ""}> ${line(d)}</label>${WITHOUT[d.scope] ? `<br><small>Unticked, it will not be able to ${esc(WITHOUT[d.scope])}.</small>` : ""}</li>`,
           )
           .join("")}</ul>
         <p>You can change these later on the Connections page of your console.</p>`)
  );
}

/** A box that started ticked and was unticked: what the confirmation
 *  names before the grant is made. */
function uncheckedDefaults(v, ticked) {
  const offered = new Set(optionalScopes(v.scope));
  return defaultTicked(v.target.kind).filter(
    (s) => offered.has(s) && !ticked.includes(s),
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
  // A JSON API grant (/api/v1) is the signed-in person's, as /mcp is.
  if (target.kind === "person" || target.kind === "api")
    return { ok: true, principal: null };
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
  // A client that names no scope asks for read only (Jamie 2026-09-24):
  // every other capability is the person's to tick on the consent page,
  // where it was once granted outright with no box to untick.
  const explicitScope = String(q.scope ?? "").trim() !== "";
  const scope = explicitScope ? normalizeScope(q.scope) : DEFAULT_OAUTH_SCOPE;
  if (!scope) return { error: "invalid_scope" };
  // The account's address goes only to the Elixir family's own apps
  // (every redirect on a family origin); no other client may even ask
  // (Jamie 2026-09-25; DECISIONS, "The account's address goes only to
  // the Elixir family's own apps"). Recording
  // attested facts is the same: a family app's only (JSON API 2.2.0).
  const familyOnly = [OAUTH_SCOPE.ACCOUNT_EMAIL, OAUTH_SCOPE.CLANS_ATTEST].find(
    (s) => scope.split(" ").includes(s),
  );
  if (
    familyOnly &&
    !isFirstPartyClient({
      redirectUris: client.redirectUris,
      provisioned: Boolean(client.family),
    })
  )
    return {
      error: `invalid_scope: ${familyOnly} is offered only to the Elixir family's own apps`,
    };
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

export function makeOauthRoutes({
  issuer,
  sendLoginEmail,
  /** The welcome mail, after a code opened a new account. A courtesy:
   *  its failure never undoes the sign-in. */
  sendWelcomeEmail = async () => {},
  /** The site session secret. Unset = consent knows nothing of sessions. */
  sessionSecret = null,
}) {
  /** The three legal audiences: the personal door and one per principal. */
  const targetFor = (value) => {
    const canonical = canonicalResource(value);
    if (!canonical) return null;
    if (!canonical.startsWith(issuer)) return null;
    return resourceForPath(canonical.slice(issuer.length), issuer);
  };

  /**
   * The person the browser is signed in as, or null. The row's own gate
   * applies (approved, unrevoked, unexpired), and the address on file
   * comes along so the page can say who, and so a client asking for
   * account:email can be refused this shortcut when there is none to
   * give (the code path records one).
   */
  async function signedIn(db, event) {
    if (!sessionSecret) return null;
    const token = readSessionCookie(event);
    if (!token) return null;
    const session = await resolveSession(db, {
      secret: sessionSecret,
      token,
      seen: sessionSeenFrom(event),
    });
    if (!session) return null;
    const { rows } = await db.query(
      `select account_id, email, newsletter_opt_in from account where account_id = $1`,
      [session.accountId],
    );
    return rows[0]
      ? {
          ...rows[0],
          email_hash: session.emailHash,
          sessionId: session.sessionId,
        }
      : null;
  }

  /**
   * A sign-in with no consent page (Jamie, 2026-10-12, of Drop: "Consent
   * to what? I think no."): one of the family's own provisioned clients,
   * signing the person in as themselves, for their own door or the JSON
   * API. It is granted exactly the scope it asked for, which
   * validatedAuthRequest has already held to what a family client may
   * ask; there are no boxes, so nothing widens it. Acting as an agent or
   * an integration is a different act and keeps its page, whoever asks.
   * Every other client keeps its consent page.
   */
  const signsInOnly = (v) =>
    (v.target.kind === "person" || v.target.kind === "api") &&
    isFirstPartyClient({
      redirectUris: v.client.redirectUris,
      provisioned: Boolean(v.client.family),
    });

  /** "Send me Elixir product news", as the website's signup form has it:
   *  checked, and applied only to an account this sign-in opens
   *  (DECISIONS, "Newsletter consent is explicit"). */
  const productNewsBox = `<label><input type="checkbox" name="product_news" value="1" checked> Send me Elixir product news</label>
       <p><small>For a new account only. Existing newsletter choices stay the same.</small></p>`;

  /** The email step's page, shared by the GET and by a session that lapsed. */
  const emailStepPage = (q, v, lead = "") =>
    page(
      signsInOnly(v) ? "Sign in with Elixir" : "Connect to Elixir",
      `<h1>${signsInOnly(v) ? "Sign in to" : "Connect"} ${esc(v.client.clientName)}</h1>
       ${lead}
       ${clientBlock(v)}
       <p>Enter your email to sign in to Elixir, or to create your free Elixir account if you don&rsquo;t have one. We&rsquo;ll send a 6-digit code.</p>
       <form method="post" action="/oauth/authorize" id="signin-email-form">
         <input type="hidden" name="step" value="email">${hiddenAuthFields(q)}
         <input type="email" name="email" placeholder="you@example.com" required autofocus>
         ${productNewsBox}
         <div id="turnstile-slot"></div>
         <button>Send code</button>
       </form>
       <script>${TURNSTILE_SCRIPT}</script>`,
    );

  /**
   * Who is asking, in words the client did not choose. The
   * name is the client's own; where the code is sent is not, and a family
   * app is one Elixir provisioned. Shown above every consent.
   */
  const clientBlock = (v) =>
    signsInOnly(v)
      ? `<p>${esc(v.client.clientName)} is one of Elixir&rsquo;s own apps and uses your Elixir account. Signing in sends you back to <strong>${esc(redirectHost(v.redirectUri))}</strong>.</p>`
      : v.client.family
        ? `<p>${esc(v.client.clientName)} is one of Elixir&rsquo;s own apps. Approving sends you back to <strong>${esc(redirectHost(v.redirectUri))}</strong>.</p>`
        : `<p>${esc(v.client.clientName)} named itself; Elixir has not checked it. Approving sends a code to <strong>${esc(redirectHost(v.redirectUri))}</strong>. Continue only if you started this connection and you trust that address.</p>`;

  /** What the client will be able to do, worded for the target's kind.
   *  A family sign-in lists what the app gets, with no boxes: it asked
   *  for it and there is nothing to choose. */
  const capabilitiesBlock = (v, verb, ticked = null) => {
    if (signsInOnly(v))
      return `${clientBlock(v)}<p><strong>${esc(v.client.clientName)} will be able to:</strong></p>${askedCapabilities(v.scope)}`;
    const caps = consentCapabilities(v.scope, {
      kind: v.target.kind,
      ticked,
    });
    return v.target.kind === "person" || v.target.kind === "api"
      ? `${clientBlock(v)}<p><strong>${verb} authorizes ${esc(v.client.clientName)} to:</strong></p>${caps}`
      : `${clientBlock(v)}<p><strong>This connects ${esc(v.client.clientName)} as one of your ${esc(v.target.kind === "agent" ? "agents" : "integrations")}, not as you.</strong></p>
         <p>It will act with that principal&rsquo;s own identity and see its data, not your players or your feed. You can only do this for a principal you own.</p>
         ${caps}`;
  };

  /** The signed-in consent page (a GET, or back from the confirmation). */
  const sessionConsentPage = (v, q, me, ticked = null) => {
    const { step, confirm, grant, ...rest } = q;
    void step;
    void confirm;
    void grant;
    const switchUrl = `/oauth/authorize?${new URLSearchParams({ ...rest, switch: "1" })}`;
    return page(
      "Connect to Elixir",
      `<h1>Connect ${esc(v.client.clientName)}</h1>
       <p>You are signed in to Elixir${me.email ? ` as <strong>${esc(me.email)}</strong>` : ""}.</p>
       <form method="post" action="/oauth/authorize">
         ${capabilitiesBlock(v, "Authorizing", ticked)}
         <input type="hidden" name="step" value="session">${hiddenAuthFields(q)}
         <button>Authorize</button>
       </form>
       <p><a href="${esc(switchUrl)}">Not you? Sign in with a code instead.</a></p>`,
    );
  };

  /** The code-entry page (after the email step, or back from the
   *  confirmation with the code still in hand). The same page for every
   *  address, whether or not a code was sent (never an oracle). */
  const codeEntryPage = (v, form, ticked = null, lead = "") =>
    page(
      "Enter your code",
      `<h1>Check your email</h1>
       ${lead || `<p>A 6-digit code is on its way to ${esc(form.email)}. Entering it signs you in to Elixir, and creates your Elixir account if you are new.</p>`}
       <form method="post" action="/oauth/authorize">
         ${capabilitiesBlock(v, "Entering it", ticked)}
         <input type="hidden" name="step" value="code">${hiddenAuthFields(form)}
         <input type="hidden" name="email" value="${esc(form.email)}">
         <input inputmode="numeric" autocomplete="one-time-code" name="code" placeholder="123456" value="${esc(form.code ?? "")}" required autofocus>
         <button>${signsInOnly(v) ? "Sign in" : "Authorize"}</button>
       </form>`,
    );

  /**
   * Before the grant: a box that started ticked and was unticked is named,
   * with what the connection will not be able to do, and the person
   * confirms or goes back (Jamie 2026-09-24). It runs BEFORE a code is
   * verified, so going back spends nothing.
   */
  const confirmPage = (v, form, ticked, missing) =>
    page(
      "Confirm what it can do",
      `<h1>Before you connect ${esc(v.client.clientName)}</h1>
       <p>You unticked ${missing.length === 1 ? "a capability" : "capabilities"} it would normally have. Without ${missing.length === 1 ? "it" : "them"}, this connection will not be able to:</p>
       <ul>${missing.map((s) => `<li>${esc(WITHOUT[s] ?? s)}</li>`).join("")}</ul>
       <p>When it tries, Elixir will refuse and name the capability; you can grant it later on the Connections page of your console.</p>
       <form method="post" action="/oauth/authorize">
         <input type="hidden" name="step" value="${esc(form.step)}">${hiddenAuthFields(form)}
         ${form.email !== undefined ? `<input type="hidden" name="email" value="${esc(form.email)}">` : ""}
         ${form.code !== undefined ? `<input type="hidden" name="code" value="${esc(form.code)}">` : ""}
         ${ticked.map((s) => `<input type="hidden" name="grant" value="${esc(s)}">`).join("")}
         <button name="confirm" value="1">Connect without ${missing.length === 1 ? "it" : "them"}</button>
         <button name="confirm" value="back">Go back and change</button>
       </form>`,
    );

  /** The confirmation gate for a consent POST: null to proceed. */
  const confirmGate = (event, v, form, backPage) => {
    // A family sign-in has no boxes, so nothing to confirm.
    if (signsInOnly(v)) return null;
    const ticked = formValues(event, "grant").filter((s) =>
      STANDARD_OAUTH_SCOPES.includes(s),
    );
    const missing = uncheckedDefaults(v, ticked);
    if (missing.length === 0 || form.confirm === "1") return null;
    return html(
      200,
      form.confirm === "back"
        ? backPage(ticked)
        : confirmPage(v, form, ticked, missing),
    );
  };

  /**
   * The consent act itself, once the person is known: the principal
   * check, the widening checkboxes, the auth code, the redirect. The
   * same whether the person proved themselves with a code just now or
   * was already signed in; only the log line names which. A family
   * sign-in had no boxes, so whatever the form posts widens nothing.
   */
  async function completeConsent(
    db,
    event,
    { v, account, hash, boundScope, how },
  ) {
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
          "Elixir",
          `<h1>Not yours to connect</h1><p>That agent or integration is not one you own.</p>`,
        ),
      );
    }

    // The human is the only party who can widen a grant, and only to
    // capabilities this server defines. The base is the scope BOUND at
    // the email step (or shown on the signed-in page), never a re-posted
    // ?scope=, so nothing can move the grant behind the checkboxes.
    // ...and only to a STANDARD capability: account:email is never
    // widened into, whatever the form posts.
    const added = (signsInOnly(v) ? [] : formValues(event, "grant")).filter(
      (value) =>
        STANDARD_OAUTH_SCOPES.includes(value) && !boundScope.includes(value),
    );
    const grantedScope = normalizeScope([boundScope, ...added].join(" "));
    if (added.length > 0)
      authLog("oauth_scope_widened", {
        email: emailRef(hash),
        request: requestRef(v.codeChallenge),
        client: v.client.clientName,
        requested: boundScope,
        added: added.join(" "),
      });
    const code = await createAuthCode(db, {
      clientId: v.client.clientId,
      accountId: owned.principal?.account_id ?? account.account_id,
      redirectUri: v.redirectUri,
      scope: grantedScope,
      resource: v.resource,
      codeChallenge: v.codeChallenge,
    });
    const url = new URL(v.redirectUri);
    url.searchParams.set("code", code);
    if (v.state) url.searchParams.set("state", v.state);
    url.searchParams.set("iss", issuer); // RFC 9207
    const headers = { location: url.toString(), "cache-control": "no-store" };
    // Consent by code IS a sign-in, so the site gets its session here
    // too: the next consent, and the console, will not ask again.
    if (how === "code" && sessionSecret) {
      const minted = await createSession(db, {
        secret: sessionSecret,
        accountId: account.account_id,
        emailHash: hash,
        seen: sessionSeenFrom(event),
      });
      headers["set-cookie"] = sessionCookie(
        minted.token,
        ABSOLUTE_CAP_DAYS * 24 * 3600,
      );
    }
    return { statusCode: 303, headers, body: "" };
  }

  return {
    async register(db, event) {
      const ip = viewerIp(event) ?? "unknown";
      const perIp = await checkRateLimit(db, {
        bucket: `dcr#${ip}`,
        max: DCR_PER_CALLER_HOUR,
      });
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
      // The family's own clients are provisioned by Elixir, never
      // registered.
      if (redirectsToFamily(redirectUris))
        return json(400, {
          error: "invalid_redirect_uri",
          error_description:
            "Redirect URIs on an Elixir family origin belong to Elixir's own apps.",
        });
      const clientName = sanitizeClientName(body.client_name) || "MCP client";
      if (impersonatesFamily(clientName))
        return json(400, {
          error: "invalid_client_metadata",
          error_description:
            "A client name may not begin with Elixir's or POAP KINGS' name.",
        });
      const client = await registerClient(db, { clientName, redirectUris });
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
            "Elixir",
            `<h1>Can&rsquo;t authorize</h1><p>${esc(v.error)}</p>`,
          ),
        );
      // Signed in to the site already? Then this is a consent page, not
      // a sign-in page. ?switch=1 is the way out for a shared browser.
      // A client that wants the address (account:email) from an account
      // that has none on file still goes the code way: that is where
      // the address gets recorded.
      const me = q.switch ? null : await signedIn(db, event);
      if (me && !(v.scope.includes(OAUTH_SCOPE.ACCOUNT_EMAIL) && !me.email)) {
        // A family app signs a signed-in person straight back in: no page.
        if (signsInOnly(v)) {
          authLog("oauth_family_signin", {
            email: emailRef(me.email_hash),
            request: requestRef(v.codeChallenge),
            client: v.client.clientName,
            resource: v.resource,
            kind: v.target.kind,
          });
          return completeConsent(db, event, {
            v,
            account: me,
            hash: me.email_hash,
            boundScope: v.scope,
            how: "family",
          });
        }
        authLog("oauth_consent_from_session", {
          email: emailRef(me.email_hash),
          request: requestRef(v.codeChallenge),
          client: v.client.clientName,
          resource: v.resource,
          kind: v.target.kind,
        });
        return html(200, sessionConsentPage(v, q, me));
      }
      return emailStepHtml(200, emailStepPage(q, v));
    },

    async authorizePost(db, event) {
      const form = parseForm(event);
      const v = await validatedAuthRequest(db, form, targetFor);
      if (v.error)
        return html(
          400,
          page(
            "Elixir",
            `<h1>Can&rsquo;t authorize</h1><p>${esc(v.error)}</p>`,
          ),
        );
      const ip = viewerIp(event) ?? "unknown";

      if (form.step === "session") {
        // SameSite=Lax means a cross-site POST arrives without the cookie,
        // so a session here is a same-site consent from our own page.
        const me = await signedIn(db, event);
        if (!me)
          return emailStepHtml(
            200,
            emailStepPage(
              form,
              v,
              "<p>Your Elixir sign-in has ended; sign in with a code to continue.</p>",
            ),
          );
        const gated = confirmGate(event, v, form, (ticked) =>
          sessionConsentPage(v, form, me, ticked),
        );
        if (gated) return gated;
        authLog("oauth_session_accepted", {
          email: emailRef(me.email_hash),
          request: requestRef(v.codeChallenge),
          client: v.client.clientName,
          resource: v.resource,
          kind: v.target.kind,
        });
        return completeConsent(db, event, {
          v,
          account: me,
          hash: me.email_hash,
          boundScope: v.scope,
          how: "session",
        });
      }

      if (form.step === "email") {
        const email = signinAddress(form.email);
        if (!email)
          return emailStepHtml(
            400,
            emailStepPage(
              form,
              v,
              "<p>That is not an email address. Check it and try again.</p>",
            ),
          );
        const hash = emailHash(email);
        // Turnstile (2026-10-14): the token rides the login message to the
        // relay, which asks Cloudflare. Only a missing token under enforce
        // is refused here, before either ceiling counts it.
        const turnstile = turnstileAtDoor(form, "oauth");
        if (turnstile.refuse) {
          authLog("turnstile_refused", {
            email: emailRef(hash),
            door: "oauth",
            turnstile: turnstile.seen,
          });
          return emailStepHtml(
            403,
            emailStepPage(form, v, `<p>${esc(TURNSTILE_REFUSED_MESSAGE)}</p>`),
          );
        }
        // The website's signup guards, shared with it: one ceiling per
        // caller and one per address, whichever door asked, because both
        // doors now open accounts.
        const okIp = await signinMailFromAllowed(db, ip);
        const okEmail = await signinMailAllowed(db, hash);
        if (!okIp || !okEmail) {
          // Said plainly, as the website says it: the counters run for any
          // address, so this is not an oracle.
          authLog("signin_mail_limited", {
            email: emailRef(hash),
            by: okIp ? "address" : "ip",
            door: "oauth",
            turnstile: turnstile.seen,
          });
          return html(
            200,
            codeEntryPage(
              v,
              { ...form, email, code: "" },
              null,
              "<p>That is the limit on sign-in emails for now. The most recent code still works for fifteen minutes; after an hour you can ask for another.</p>",
            ),
          );
        }
        // A new address is admitted as the website's signup admits it; a
        // blocked one gets nothing. Nothing is created here: the account
        // opens only when the code is proved (the code step).
        const account = await publicLoginAccount(db, hash);
        if (account) {
          authLog("oauth_code_issued", {
            email: emailRef(hash),
            turnstile: turnstile.seen,
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
              // Frozen with the request, applied only if the code opens a
              // new account (openVerifiedAccount): the address as typed,
              // and the product-news box, unticked unless it was posted.
              signup_email: email.toLowerCase(),
              signup_news: form.product_news === "1",
            },
          });
          await sendLoginEmail({
            email,
            code,
            ipAddress: viewerIp(event),
            purpose: "oauth",
            clientName: v.client.clientName,
            turnstile: turnstile.carry,
            // Existing accounts keep their saved choice; a new account's
            // box is applied after proof, on the welcome send.
            newsletter:
              account.status === "approved" &&
              account.newsletter_opt_in === true,
          });
        }
        // Identical page whether or not anything was sent — never an oracle.
        return html(200, codeEntryPage(v, { ...form, email, code: "" }));
      }

      const hash = emailHash(form.email);

      if (form.step === "code") {
        const gated = confirmGate(event, v, form, (ticked) =>
          codeEntryPage(
            v,
            form,
            ticked,
            "<p>Enter the code from your email.</p>",
          ),
        );
        if (gated) return gated;
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
        // WHICH of these failed decides what the person should do next, and
        // saying "one of seven things" left them retrying a code that could
        // never work. Each branch below is a different next step.
        const mismatch = ctx
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

        // The code is proved (now, or by the first of a duplicate submit)
        // and bound to this request: a new address opens its account here,
        // exactly as the website's signup does, from the address and the
        // news choice frozen with the request. Idempotent, and it never
        // reopens a denied or blocked account; `opened` is null for an
        // account that was already open, so the welcome goes once.
        const opened =
          ctx && !mismatch && (verified.ok || replayed)
            ? await openVerifiedAccount(db, {
                emailHash: hash,
                email: ctx.signup_email,
                newsletterOptIn: ctx.signup_news === true,
              })
            : null;
        const found = ctx && !mismatch ? await approvedAccount(db, hash) : null;
        const account = found && found.kind === "person" ? found : null;

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
            : mismatch
              ? `request_${mismatch}`
              : !account
                ? "account_not_approved"
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
          return html(400, page("Elixir", codeFailure(reason)));
        }
        authLog(replayed ? "oauth_code_replayed" : "oauth_code_accepted", {
          email: emailRef(hash),
          request: requestRef(v.codeChallenge),
          client: v.client.clientName,
          resource: v.resource,
          kind: v.target.kind,
          ...(opened?.created ? { opened: true } : {}),
        });
        if (opened) {
          // After proof only, as the website sends it; a courtesy-mail
          // outage must not undo the sign-in. No onboarding here: this
          // door asks for no player tag, and the first Console sign-in
          // (onboardAccount) lands a tagless account on Tracking.
          await sendWelcomeEmail({
            email: ctx.signup_email,
            newsletter: opened.newsletter_opt_in === true,
            ...(opened.newsletter_opt_in === true
              ? { ipAddress: viewerIp(event) }
              : {}),
          }).catch(() => console.error("signup_welcome_queue_failed"));
        }
        // Consent is a sign-in: record the address on the way past, as the
        // site's sign-in does, so /oauth/userinfo can answer for an account
        // that predates Elixir keeping it. The hash still decided which
        // account this is.
        await db.query(
          `update account set email = $2
           where account_id = $1 and email is distinct from $2`,
          [account.account_id, String(form.email).trim().toLowerCase()],
        );
        return completeConsent(db, event, {
          v,
          account,
          hash,
          boundScope: ctx.scope,
          how: "code",
        });
      }
      return html(400, page("Elixir", "<h1>Bad request</h1>"));
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
      // A family client authenticates (client_secret_post, 0185); every
      // other client is public. RFC 6749 §5.2: a failed client
      // authentication is 401 invalid_client.
      if (!(await authenticateClient(db, client, form.client_secret))) {
        authLog("oauth_token_rejected", {
          reason: "client_authentication",
          client: clientId,
          resource: requestedResource,
        });
        return json(401, { error: "invalid_client" });
      }

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
        if (!tokens) return json(400, { error: "invalid_grant" });
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

    /**
     * RFC 7009 revocation: a client ends its own grant, as
     * signing out of a family app should. Form-encoded token and client_id
     * (plus client_secret for a family client). 200 whether or not the
     * token was live, known or the client's: the answer says nothing.
     */
    async revoke(db, event) {
      const form = parseForm(event);
      const client = await getClient(db, String(form.client_id ?? ""));
      if (!client) return json(401, { error: "invalid_client" });
      if (!(await authenticateClient(db, client, form.client_secret)))
        return json(401, { error: "invalid_client" });
      if (!form.token) return json(400, { error: "invalid_request" });
      const revoked = await revokeToken(db, {
        token: form.token,
        clientId: client.clientId,
      });
      if (revoked) authLog("oauth_token_revoked", { client: client.clientId });
      return json(200, {});
    },

    /**
     * Who the token's person is, for a client that holds account:email.
     * The one place the account's address leaves Elixir, and only to a
     * client the person granted that capability on the consent page (it
     * is never offered unasked). `sub` is the account id, stable for the
     * account's life; `email_verified` is always true because a person
     * proved the address with a code before any grant existed.
     */
    async userinfo(db, event) {
      const auth = String(
        event.headers?.authorization ?? event.headers?.Authorization ?? "",
      );
      const challenge = (error, extra = "") => ({
        statusCode: error === "insufficient_scope" ? 403 : 401,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "www-authenticate": `Bearer error="${error}"${extra}`,
        },
        body: JSON.stringify({ error }),
      });
      if (!auth.toLowerCase().startsWith("bearer "))
        return challenge("invalid_token");
      // Userinfo is the issuer's, not a door's: a person's grant for either
      // personal audience answers here (a family app that signs in for the
      // JSON API, Drop since 2026-09-25, needs the stable sub as an MCP
      // client did). An agent's audience (/mcp/agent/<id>) never does.
      const token = auth.slice(7).trim();
      const account =
        (await validateAccessToken(db, token, {
          resource: `${issuer}/mcp`,
        })) ??
        (await validateAccessToken(db, token, {
          resource: `${issuer}/api/v1`,
        }));
      if (!account) return challenge("invalid_token");
      // Family apps only, checked again at the door the address leaves by:
      // a grant made before the rule (2026-09-25) carries no exception.
      if (
        !account.scopes.includes(OAUTH_SCOPE.ACCOUNT_EMAIL) ||
        !account.firstParty
      )
        return challenge(
          "insufficient_scope",
          `, scope="${OAUTH_SCOPE.ACCOUNT_EMAIL}"`,
        );
      const { rows } = await db.query(
        `select email from account where account_id = $1`,
        [account.accountId],
      );
      const email = rows[0]?.email ?? null;
      if (!email) {
        // An account that predates Elixir keeping the address, whose
        // holder has not signed in since. The next consent fills it.
        return json(404, {
          error: "email_unavailable",
          message:
            "This account has no recorded email address yet. Signing in to Elixir once records it.",
        });
      }
      return json(
        200,
        { sub: account.accountId, email, email_verified: true, kind: "person" },
        { "cache-control": "no-store" },
      );
    },

    authorizationServerMetadata() {
      return json(
        200,
        {
          issuer,
          authorization_endpoint: `${issuer}/oauth/authorize`,
          token_endpoint: `${issuer}/oauth/token`,
          registration_endpoint: `${issuer}/oauth/register`,
          userinfo_endpoint: `${issuer}/oauth/userinfo`,
          revocation_endpoint: `${issuer}/oauth/revoke`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          // "none" for every registered client; the family's provisioned
          // clients authenticate with client_secret_post.
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
          revocation_endpoint_auth_methods_supported: [
            "none",
            "client_secret_post",
          ],
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
          // Every capability is advertised (1.0.0): a client that asks for
          // what the resource supports asks for all of them, and the consent
          // page is where a person narrows the grant.
          scopes_supported: OAUTH_SCOPES,
          bearer_methods_supported: ["header"],
        },
        { "cache-control": "public, max-age=300" },
      );
    },
  };
}
