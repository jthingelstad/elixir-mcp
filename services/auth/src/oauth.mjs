/**
 * OAuth 2.1 authorization-server logic — DESIGN §6.2, librarian's
 * oauth-store pattern written fresh on Postgres (0005 tables).
 *
 * Public clients only, PKCE S256 mandatory, opaque prefixed tokens stored
 * as sha256 hex. Refresh rotation marks the old token rotated in a
 * conditional update BEFORE the successor exists anywhere — a raced
 * parallel redemption loses the condition and is treated as reuse, which
 * revokes the FAMILY (one revoked_at flip here; every validate checks it).
 * The family row carries the 90-day absolute lifetime: rotation can never
 * extend a grant forever (librarian audit A4), and re-consent re-runs the
 * access gate. The interactive /authorize state rides magic_login rows
 * with purpose='oauth' (one credential core, two shells) — no separate
 * pending table.
 */

import crypto from "node:crypto";
import {
  DEFAULT_OAUTH_SCOPE,
  OAUTH_SCOPES,
  FULL_OAUTH_SCOPE,
} from "@elixir-mcp/contracts";

export { OAUTH_SCOPES };
export const ACCESS_TOKEN_PREFIX = "eat_";
export const REFRESH_TOKEN_PREFIX = "ert_";
export const AUTH_CODE_PREFIX = "eac_";

export const CLIENT_TTL_SECONDS = 365 * 24 * 3600;
export const AUTH_CODE_TTL_SECONDS = 300;
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
export const FAMILY_ABSOLUTE_DAYS = 90;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43,128}$/;
const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;

const sha256hex = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");
const secret = (prefix) =>
  `${prefix}${crypto.randomBytes(32).toString("base64url")}`;

// --- validators (pure) -----------------------------------------------------

export function validClientId(value) {
  const raw = String(value ?? "").trim();
  return CLIENT_ID_RE.test(raw) ? raw : "";
}

export function sanitizeClientName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^\P{C}]/gu, "")
    .replace(/[<>&"']/g, "")
    .trim()
    .slice(0, 100);
}

/** Absolute https, or http on localhost/127.0.0.1 for local MCP clients.
 *  No fragments (RFC 6749 §3.1.2), no embedded credentials. */
export function validRedirectUri(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2048) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.hash || url.username || url.password) return "";
  if (url.protocol === "https:") return raw;
  // Loopback only, and BOTH loopbacks: RFC 8252 says a native client may use
  // either, and a client that picks ::1 is not a client we should refuse.
  // URL normalises the IPv6 literal to bracketed form.
  if (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return raw;
  return "";
}

export function validateRedirectUris(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5)
    return null;
  const uris = [];
  for (const entry of value) {
    const uri = validRedirectUri(entry);
    if (!uri) return null;
    if (!uris.includes(uri)) uris.push(uri);
  }
  return uris;
}

export function validState(value) {
  const raw = String(value ?? "");
  return raw.length <= 512 ? raw : "";
}

export function validCodeChallenge(value) {
  const raw = String(value ?? "").trim();
  return CODE_CHALLENGE_RE.test(raw) ? raw : "";
}

/** A client that names no scope is offered EVERY capability (1.0.0): the
 *  consent page lists them all ticked and the person unticks what they
 *  do not want. The old default - cr:read alone - meant feedback, the one
 *  behaviour every agent is told to perform unprompted, was refused on
 *  most connections (review 3.3). A client that names a scope set gets
 *  exactly that set, cr:read required. */
export function normalizeScope(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return FULL_OAUTH_SCOPE;
  const unique = [...new Set(raw.split(/\s+/))];
  if (
    !unique.includes(DEFAULT_OAUTH_SCOPE) ||
    unique.some((s) => !OAUTH_SCOPES.includes(s))
  )
    return "";
  return OAUTH_SCOPES.filter((scope) => unique.includes(scope)).join(" ");
}

/** Canonical absolute HTTPS resource URI (RFC 8707). Queries, fragments,
 *  and credentials cannot name this server's one protected resource. */
export function canonicalResource(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2048) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return "";
  return url.toString();
}

/**
 * The one place a request path becomes a protected-resource identity.
 *
 * Three shapes, and only three. This pattern is the code half of the CHECK
 * constraint in migration 0054 — they must agree, so a test compares them
 * against the same adversarial matrix. The host is a hard-coded literal on
 * both sides: nothing a caller sends can steer the audience off this origin.
 *
 * Returns { resource, kind, publicId } or null. `kind` is what the URL CLAIMS;
 * proving it is the credential's job, and the mismatch between the two is the
 * whole reason distinct URLs are worth having.
 */
const RESOURCE_PATH_RE = /^\/(?:mcp|([ai])\/([a-z0-9]{8,16})\/mcp)$/;

export function resourceForPath(path, issuer) {
  const match = RESOURCE_PATH_RE.exec(String(path ?? ""));
  if (!match) return null;
  const resource = canonicalResource(new URL(path, issuer).toString());
  if (!resource) return null;
  if (!match[1]) return { resource, kind: "person", publicId: null };
  return {
    resource,
    kind: match[1] === "a" ? "agent" : "integration",
    publicId: match[2],
  };
}

/**
 * Does the credential presented actually belong at the door it was presented
 * at? A person's token at an agent URL, or one agent's token at another
 * agent's URL, is the failure this whole scheme exists to convert from a
 * silently wrong answer into a refusal.
 */
export function principalMatchesResource(account, target) {
  if (!account || !target) return false;
  const kind = account.kind ?? "person";
  if (kind !== target.kind) return false;
  if (target.kind === "person") return true;
  return Boolean(account.publicId) && account.publicId === target.publicId;
}

export function verifyPkce(codeVerifier, codeChallenge) {
  const verifier = String(codeVerifier ?? "").trim();
  const challenge = String(codeChallenge ?? "");
  if (!CODE_VERIFIER_RE.test(verifier) || !BASE64URL_RE.test(challenge))
    return false;
  const derived = Buffer.from(
    crypto.createHash("sha256").update(verifier).digest("base64url"),
  );
  const actual = Buffer.from(challenge);
  return (
    derived.length === actual.length && crypto.timingSafeEqual(derived, actual)
  );
}

function validOpaque(raw, prefix) {
  const value = String(raw ?? "").trim();
  return value.startsWith(prefix) &&
    BASE64URL_RE.test(value.slice(prefix.length)) &&
    value.length <= 128
    ? value
    : "";
}

// --- clients ---------------------------------------------------------------

export async function registerClient(db, { clientName, redirectUris }) {
  const clientId = crypto.randomBytes(18).toString("base64url");
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ($1, $2, $3, now() + make_interval(secs => $4))`,
    [clientId, clientName, JSON.stringify(redirectUris), CLIENT_TTL_SECONDS],
  );
  return { clientId, clientName, redirectUris };
}

export async function getClient(db, clientId) {
  const id = validClientId(clientId);
  if (!id) return null;
  const { rows } = await db.query(
    `update oauth_client
     set last_used_at = now(), expires_at = now() + make_interval(secs => $2)
     where client_id = $1 and expires_at > now()
     returning client_id, client_name, redirect_uris`,
    [id, CLIENT_TTL_SECONDS],
  );
  const row = rows[0];
  return row
    ? {
        clientId: row.client_id,
        clientName: row.client_name,
        redirectUris: row.redirect_uris,
      }
    : null;
}

// --- authorization codes ---------------------------------------------------

export async function createAuthCode(
  db,
  { clientId, accountId, redirectUri, scope, resource, codeChallenge },
) {
  const grantedScope = normalizeScope(scope);
  const audience = canonicalResource(resource);
  if (!grantedScope || !audience) throw new Error("invalid OAuth grant");
  const code = secret(AUTH_CODE_PREFIX);
  await db.query(
    `insert into oauth_code (code_hash, client_id, account_id, code_challenge, redirect_uri, scope, resource, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
    [
      sha256hex(code),
      clientId,
      accountId,
      codeChallenge,
      redirectUri,
      grantedScope,
      audience,
      AUTH_CODE_TTL_SECONDS,
    ],
  );
  return code;
}

/** Single-use conditional redemption: races lose. */
export async function redeemAuthCode(db, code) {
  const raw = validOpaque(code, AUTH_CODE_PREFIX);
  if (!raw) return null;
  const { rows } = await db.query(
    `update oauth_code set used_at = now()
     where code_hash = $1 and used_at is null and expires_at > now()
     returning client_id, account_id, code_challenge, redirect_uri, scope, resource`,
    [sha256hex(raw)],
  );
  const row = rows[0];
  return row
    ? {
        clientId: row.client_id,
        accountId: row.account_id,
        codeChallenge: row.code_challenge,
        redirectUri: row.redirect_uri,
        scope: row.scope,
        resource: row.resource,
      }
    : null;
}

// --- tokens ----------------------------------------------------------------

async function insertToken(db, { kind, familyId, token, ttlSeconds }) {
  await db.query(
    `insert into oauth_token (token_hash, kind, family_id, expires_at)
     values ($1, $2, $3, now() + make_interval(secs => $4))`,
    [sha256hex(token), kind, familyId, ttlSeconds],
  );
}

export async function mintTokens(db, { clientId, accountId, scope, resource }) {
  const grantedScope = normalizeScope(scope);
  const audience = canonicalResource(resource);
  if (!grantedScope || !audience) throw new Error("invalid OAuth grant");
  const { rows } = await db.query(
    `insert into oauth_family (client_id, account_id, scope, resource, absolute_expires_at)
     values ($1, $2, $3, $4, now() + make_interval(days => $5))
     returning family_id`,
    [clientId, accountId, grantedScope, audience, FAMILY_ABSOLUTE_DAYS],
  );
  const family = rows[0].family_id;
  // Activity log (0010): a new family = a newly authorized client.
  await db
    .query(
      `insert into account_event (account_id, kind, detail)
       values ($1, 'agent_connected', $2)`,
      [accountId, JSON.stringify({ client_id: clientId })],
    )
    .catch(() => {});
  const accessToken = secret(ACCESS_TOKEN_PREFIX);
  const refreshToken = secret(REFRESH_TOKEN_PREFIX);
  await insertToken(db, {
    kind: "access",
    familyId: family,
    token: accessToken,
    ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  });
  await insertToken(db, {
    kind: "refresh",
    familyId: family,
    token: refreshToken,
    ttlSeconds: REFRESH_TOKEN_TTL_SECONDS,
  });
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scope: grantedScope,
    resource: audience,
    familyId: family,
  };
}

async function revokeFamily(db, familyId) {
  await db.query(
    `update oauth_family set revoked_at = now() where family_id = $1 and revoked_at is null`,
    [familyId],
  );
}

export async function redeemRefreshToken(
  db,
  { refreshToken, clientId, resource },
) {
  const raw = validOpaque(refreshToken, REFRESH_TOKEN_PREFIX);
  if (!raw) return { status: "invalid" };
  const { rows } = await db.query(
    `select t.token_hash, t.expires_at, t.rotated_to, t.revoked_at,
            f.family_id, f.client_id, f.account_id, f.scope, f.resource,
            f.absolute_expires_at, f.revoked_at as family_revoked_at
     from oauth_token t join oauth_family f on f.family_id = t.family_id
     where t.token_hash = $1 and t.kind = 'refresh'`,
    [sha256hex(raw)],
  );
  const row = rows[0];
  if (!row || row.revoked_at || row.family_revoked_at)
    return { status: "invalid" };
  if (row.client_id !== clientId) return { status: "invalid" };
  if (row.resource !== canonicalResource(resource))
    return { status: "invalid_target" };
  if (row.expires_at.getTime() < Date.now()) return { status: "invalid" };
  if (row.rotated_to) {
    // Replay of an already-rotated token (RFC 9700 §4.14.2): kill the family.
    await revokeFamily(db, row.family_id);
    return { status: "reuse_revoked" };
  }
  if (row.absolute_expires_at.getTime() < Date.now()) {
    // Absolute family lifetime: force a fresh authorization (re-runs the gate).
    await revokeFamily(db, row.family_id);
    return { status: "invalid" };
  }

  const newRefresh = secret(REFRESH_TOKEN_PREFIX);
  // Mark rotated BEFORE the successor exists; a raced redemption loses
  // this conditional write and lands in the replay branch above.
  const { rowCount } = await db.query(
    `update oauth_token set rotated_to = $2
     where token_hash = $1 and rotated_to is null`,
    [row.token_hash, sha256hex(newRefresh)],
  );
  if (rowCount === 0) {
    await revokeFamily(db, row.family_id);
    return { status: "reuse_revoked" };
  }
  const accessToken = secret(ACCESS_TOKEN_PREFIX);
  await insertToken(db, {
    kind: "access",
    familyId: row.family_id,
    token: accessToken,
    ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  });
  await insertToken(db, {
    kind: "refresh",
    familyId: row.family_id,
    token: newRefresh,
    ttlSeconds: REFRESH_TOKEN_TTL_SECONDS,
  });
  return {
    status: "ok",
    tokens: {
      accessToken,
      refreshToken: newRefresh,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      scope: row.scope,
      resource: row.resource,
      familyId: row.family_id,
    },
    accountId: row.account_id,
    clientId: row.client_id,
  };
}

/**
 * Bearer -> account context for the MCP door. Enforces token liveness,
 * family revocation/absolute lifetime, AND the access gate — a token for
 * a no-longer-approved account validates to nothing, on every request.
 */
/**
 * Whose daily budget a call spends, and which role sets its ceiling.
 *
 * An AGENT spends its OWNER's budget — that is the deal that lets every clan
 * leader have one without a tier gate. Its own role still caps what it may
 * COLLECT (slots, comprehensive vs activity), which is the axis that keeps a
 * demo honest; calls are the axis that costs the service money, and those come
 * out of the parent's allowance.
 *
 * An INTEGRATION pays for itself. Its traffic scales with its own userbase and
 * has nothing to do with its owner's personal usage, which is exactly why it
 * sits behind a partner gate and carries a per-key quota.
 */
function budgetFor(row) {
  if (row.kind === "agent" && row.owned_by_account_id) {
    return {
      accountId: row.owned_by_account_id,
      role: row.owner_role ?? row.role,
      override: row.owner_mcp_daily_quota ?? null,
      liveOverride: row.owner_live_daily_quota ?? null,
    };
  }
  if (row.kind === "integration") {
    return {
      accountId: row.account_id,
      role: row.role,
      override: row.token_daily_quota ?? row.mcp_daily_quota ?? null,
      liveOverride: row.live_daily_quota ?? null,
    };
  }
  return {
    accountId: row.account_id,
    role: row.role,
    override: row.mcp_daily_quota ?? null,
    liveOverride: row.live_daily_quota ?? null,
  };
}

export async function validateAccessToken(db, token, { resource } = {}) {
  const raw = validOpaque(token, ACCESS_TOKEN_PREFIX);
  const audience = canonicalResource(resource);
  if (!raw || !audience) return null;
  const { rows } = await db.query(
    `select f.client_id, f.scope, f.resource, f.family_id, c.client_name,
            a.account_id, a.email_hash, a.is_owner, a.timezone, a.mcp_daily_quota,
            a.role, a.live_daily_quota, a.kind, a.owned_by_account_id, a.public_id,
            o.role as owner_role, o.mcp_daily_quota as owner_mcp_daily_quota,
            o.live_daily_quota as owner_live_daily_quota
     from oauth_token t
     join oauth_family f on f.family_id = t.family_id
     join oauth_client c on c.client_id = f.client_id
     join account a on a.account_id = f.account_id
     left join account o on o.account_id = a.owned_by_account_id
     where t.token_hash = $1 and t.kind = 'access'
       and t.expires_at > now() and t.revoked_at is null
       and f.revoked_at is null and f.absolute_expires_at > now()
       and f.resource = $2
       and not exists (select 1 from integration i where i.account_id = a.account_id)
       and a.status = 'approved'`,
    [sha256hex(raw), audience],
  );
  const row = rows[0];
  return row
    ? {
        accountId: row.account_id,
        emailHash: row.email_hash,
        // One entitlements system: the console is a role power.
        isOwner: row.role === "owner",
        isAdmin: row.role === "owner" || row.role === "admin",
        timezone: row.timezone,
        mcpDailyQuota: row.mcp_daily_quota,
        role: row.role,
        liveDailyQuota: row.live_daily_quota,
        clientId: row.client_id,
        // Carried so a call can be attributed to the CONNECTION a person can
        // revoke, and labelled with what that client calls itself.
        clientName: row.client_name,
        oauthFamilyId: row.family_id,
        scope: row.scope,
        scopes: row.scope.split(" "),
        resource: row.resource,
        kind: row.kind,
        ownedByAccountId: row.owned_by_account_id,
        publicId: row.public_id,
        budget: budgetFor(row),
        credentialType: "oauth",
      }
    : null;
}

const SERVICE_TOKEN_PREFIX = "svt_";

/**
 * Issue a long-lived service token bound to an account. The raw token is
 * returned ONCE; only its sha256 is stored.
 *
 * `scope` omitted means every scope — the shape every token minted before 0053
 * holds, kept so those keep working. New keys should say what they need:
 * Elixir Drop reads a war clock and has no business being able to edit
 * collections or change account settings.
 */
/**
 * A service token value and its digest, without storing either.
 *
 * The token FORMAT belongs here; where the row gets written does not. The ops
 * lane mints on an operator's machine and sends only the hash, so keeping the
 * two halves separable is what lets that path and the console path share one
 * insert instead of growing a parallel implementation.
 */
export function mintServiceTokenValue() {
  const raw = secret(SERVICE_TOKEN_PREFIX);
  return { raw, hash: sha256hex(raw) };
}

export async function issueServiceToken(
  db,
  { accountId, name, scope = null, dailyQuota = null, hourlyRateLimit = null },
) {
  const raw = secret(SERVICE_TOKEN_PREFIX);
  await db.query(
    `insert into service_token (account_id, name, token_hash, scope, daily_quota, hourly_rate_limit)
     values ($1, $2, $3, $4, $5, $6)`,
    [accountId, name, sha256hex(raw), scope, dailyQuota, hourlyRateLimit],
  );
  return raw;
}

/** Validate a service token; returns the account shape the MCP handler
 *  expects, plus serviceName for per-token audit surfaces. */
export async function validateServiceToken(
  db,
  token,
  { audience = "mcp" } = {},
) {
  const raw = validOpaque(token, SERVICE_TOKEN_PREFIX);
  if (!raw) return null;
  const { rows } = await db.query(
    `select t.token_id, t.name, t.scope as token_scope,
            t.daily_quota as token_daily_quota,
            t.hourly_rate_limit as token_rate_limit,
            a.account_id, a.email_hash, a.is_owner, a.timezone, a.mcp_daily_quota,
            a.role, a.live_daily_quota, a.kind, a.owned_by_account_id, a.public_id,
            o.role as owner_role, o.mcp_daily_quota as owner_mcp_daily_quota,
            o.live_daily_quota as owner_live_daily_quota
     from service_token t
     join account a on a.account_id = t.account_id
     left join account o on o.account_id = a.owned_by_account_id
     where t.token_hash = $1 and t.revoked_at is null and a.status = 'approved'
       and t.audience = $2
       and ($2 <> 'mcp' or not exists (select 1 from integration i where i.account_id = a.account_id))`,
    [sha256hex(raw), audience],
  );
  const row = rows[0];
  if (!row) return null;
  await db
    .query(
      `update service_token set last_used_at = now() where token_id = $1`,
      [row.token_id],
    )
    .catch(() => {});
  return {
    accountId: row.account_id,
    emailHash: row.email_hash,
    isOwner: row.role === "owner",
    isAdmin: row.role === "owner" || row.role === "admin",
    timezone: row.timezone,
    mcpDailyQuota: row.mcp_daily_quota,
    role: row.role,
    liveDailyQuota: row.live_daily_quota,
    serviceName: row.name,
    // The token is the principal that made the call; the account is merely
    // who it belongs to. Selected here since 0020 and dropped on the floor
    // until 0052 gave the audit somewhere to put it.
    tokenId: row.token_id,
    // A key carries only the authority it was issued with. NULL means every
    // scope, which is what every token minted before 0053 holds — narrowing
    // them retroactively would revoke authority nobody agreed to give up.
    // New keys are written narrow: Drop needs cr:read to read a war clock, not
    // the ability to edit collections and change account settings.
    scope: row.token_scope ?? OAUTH_SCOPES.join(" "),
    scopes: row.token_scope ? row.token_scope.split(" ") : [...OAUTH_SCOPES],
    kind: row.kind,
    ownedByAccountId: row.owned_by_account_id,
    publicId: row.public_id,
    hourlyRateLimit: row.token_rate_limit ?? null,
    budget: budgetFor(row),
    credentialType: "service",
  };
}

/**
 * Name a credential that was REFUSED, so its owner can be told.
 *
 * The interesting refusal is not a stranger guessing: it is a key its owner
 * already knows about, still being presented by something they forgot to
 * update. That case is identifiable — the hash is in the table, the row simply
 * says revoked, or its account is suspended, or it belongs at another door —
 * and identifying it is what turns "an agent went quiet" into "your revoked
 * key `poap-kings` was presented 288 times today from one address".
 *
 * Returns { kind, tokenId, accountId, label, reason } with everything but kind
 * possibly null. Recognising a credential grants nothing: this runs only after
 * the door has already refused it.
 */
export async function describeRefusedCredential(db, presented) {
  const value = String(presented ?? "");
  if (!value) return { kind: "unknown", reason: "empty" };
  const digest = sha256hex(value);

  if (value.startsWith("svt_")) {
    const { rows } = await db.query(
      `select t.token_id, t.name, t.revoked_at, a.account_id, a.status, a.kind
       from service_token t join account a on a.account_id = t.account_id
       where t.token_hash = $1`,
      [digest],
    );
    const row = rows[0];
    if (!row) return { kind: "service_token", reason: "unknown_key" };
    return {
      kind: "service_token",
      tokenId: row.token_id,
      accountId: row.account_id,
      label: row.name,
      reason: row.revoked_at
        ? "revoked_key"
        : row.status !== "approved"
          ? "principal_suspended"
          : "wrong_door",
    };
  }

  // oauth_token carries neither account nor client: both hang off the
  // family (0005). Selecting them from the token threw, and the throw
  // turned every refused eat_ token into a 500 (fixed 2026-09-09).
  const { rows } = await db.query(
    `select f.account_id, t.expires_at, t.revoked_at,
            f.revoked_at as family_revoked_at, c.client_name
     from oauth_token t
     join oauth_family f on f.family_id = t.family_id
     left join oauth_client c on c.client_id = f.client_id
     where t.token_hash = $1 and t.kind = 'access'`,
    [digest],
  );
  const row = rows[0];
  if (!row) return { kind: "access_token", reason: "unknown_key" };
  return {
    kind: "access_token",
    accountId: row.account_id,
    label: row.client_name ?? null,
    reason:
      row.revoked_at || row.family_revoked_at
        ? "revoked_key"
        : row.expires_at && row.expires_at < new Date()
          ? "expired"
          : "wrong_door",
  };
}

/**
 * Record it, coalesced per credential per source per day. Never throws: a
 * refusal that could not be written down must still be a refusal.
 */
export async function recordCredentialRefusal(
  db,
  {
    presented,
    kind,
    tokenId,
    accountId,
    reason,
    resource,
    viewerIp,
    viewerCountry,
  },
) {
  try {
    await db.query(
      `insert into credential_refusal
         (credential_hash, token_id, account_id, kind, reason, resource, viewer_ip, viewer_country)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (day, credential_hash, viewer_ip, resource) do update
         set attempts = credential_refusal.attempts + 1,
             last_seen = now(),
             reason = excluded.reason,
             token_id = coalesce(excluded.token_id, credential_refusal.token_id),
             account_id = coalesce(excluded.account_id, credential_refusal.account_id)`,
      [
        sha256hex(String(presented ?? "")),
        tokenId ?? null,
        accountId ?? null,
        kind ?? "unknown",
        reason ?? "refused",
        resource ?? null,
        viewerIp ?? null,
        viewerCountry ?? null,
      ],
    );
  } catch {
    /* visibility is never worth failing a refusal over */
  }
}
