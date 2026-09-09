// account_id arrives from the client; a malformed one is a 404, not a
// Postgres uuid syntax error surfacing as a 500.
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COOKIE_NAME = "__Host-elixir_session";
export const CONTRACT_HEADER = "x-elixir-client";

export const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...headers,
  },
  body: JSON.stringify(body),
});

export function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function readCookie(event) {
  const cookies =
    event.cookies ?? String(event.headers?.cookie ?? "").split("; ");
  for (const c of cookies) {
    if (c.startsWith(`${COOKIE_NAME}=`)) return c.slice(COOKIE_NAME.length + 1);
  }
  return "";
}

export function bearer(event) {
  const auth = String(event.headers?.authorization ?? "");
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

// bigint ids (token_id, feedback_id) arrive from the client too; a
// non-numeric one is a 400, not a Postgres "invalid input syntax" 500.
export const ID_RE = /^[0-9]{1,18}$/;
