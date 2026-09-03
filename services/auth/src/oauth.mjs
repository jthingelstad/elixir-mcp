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

export const OAUTH_SCOPES = ["cr:read"];
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
  if (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
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

export function normalizeScope(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return OAUTH_SCOPES.join(" ");
  const unique = [...new Set(raw.split(/\s+/))];
  return unique.some((s) => !OAUTH_SCOPES.includes(s)) ? "" : unique.join(" ");
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
  { clientId, accountId, redirectUri, scope, codeChallenge },
) {
  const code = secret(AUTH_CODE_PREFIX);
  await db.query(
    `insert into oauth_code (code_hash, client_id, account_id, code_challenge, redirect_uri, scope, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))`,
    [
      sha256hex(code),
      clientId,
      accountId,
      codeChallenge,
      redirectUri,
      scope,
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
     returning client_id, account_id, code_challenge, redirect_uri, scope`,
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

export async function mintTokens(
  db,
  { clientId, accountId, scope, familyId = null },
) {
  let family = familyId;
  if (!family) {
    const { rows } = await db.query(
      `insert into oauth_family (client_id, account_id, absolute_expires_at)
       values ($1, $2, now() + make_interval(days => $3))
       returning family_id`,
      [clientId, accountId, FAMILY_ABSOLUTE_DAYS],
    );
    family = rows[0].family_id;
    // Activity log (0010): a new family = a newly authorized client.
    await db
      .query(
        `insert into account_event (account_id, kind, detail)
         values ($1, 'agent_connected', $2)`,
        [accountId, JSON.stringify({ client_id: clientId })],
      )
      .catch(() => {});
  }
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
    scope,
    familyId: family,
  };
}

async function revokeFamily(db, familyId) {
  await db.query(
    `update oauth_family set revoked_at = now() where family_id = $1 and revoked_at is null`,
    [familyId],
  );
}

export async function redeemRefreshToken(db, { refreshToken, clientId }) {
  const raw = validOpaque(refreshToken, REFRESH_TOKEN_PREFIX);
  if (!raw) return { status: "invalid" };
  const { rows } = await db.query(
    `select t.token_hash, t.expires_at, t.rotated_to, t.revoked_at,
            f.family_id, f.client_id, f.account_id, f.absolute_expires_at, f.revoked_at as family_revoked_at
     from oauth_token t join oauth_family f on f.family_id = t.family_id
     where t.token_hash = $1 and t.kind = 'refresh'`,
    [sha256hex(raw)],
  );
  const row = rows[0];
  if (!row || row.revoked_at || row.family_revoked_at)
    return { status: "invalid" };
  if (row.client_id !== clientId) return { status: "invalid" };
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
export async function validateAccessToken(db, token) {
  const raw = validOpaque(token, ACCESS_TOKEN_PREFIX);
  if (!raw) return null;
  const { rows } = await db.query(
    `select f.client_id, a.account_id, a.email_hash, a.is_owner, a.timezone, a.mcp_daily_quota
     from oauth_token t
     join oauth_family f on f.family_id = t.family_id
     join account a on a.account_id = f.account_id
     where t.token_hash = $1 and t.kind = 'access'
       and t.expires_at > now() and t.revoked_at is null
       and f.revoked_at is null and f.absolute_expires_at > now()
       and a.status = 'approved'`,
    [sha256hex(raw)],
  );
  const row = rows[0];
  return row
    ? {
        accountId: row.account_id,
        emailHash: row.email_hash,
        isOwner: row.is_owner,
        timezone: row.timezone,
        mcpDailyQuota: row.mcp_daily_quota,
        clientId: row.client_id,
      }
    : null;
}
