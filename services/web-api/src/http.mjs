// account_id arrives from the client; a malformed one is a 404, not a
// Postgres uuid syntax error surfacing as a 500.
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import { sessionCookie, readSessionCookie } from "@elixir-mcp/auth";

export const CONTRACT_HEADER = "x-elixir-client";
// The cookie's name and attributes live with the auth package now, because
// the MCP door sets the same cookie at consent (0083); these names stay
// for the routes that always used them.
export { sessionCookie };
export const readCookie = readSessionCookie;

export const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...headers,
  },
  body: JSON.stringify(body),
});

export function bearer(event) {
  const auth = String(event.headers?.authorization ?? "");
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

// bigint ids (token_id, feedback_id) arrive from the client too; a
// non-numeric one is a 400, not a Postgres "invalid input syntax" 500.
export const ID_RE = /^[0-9]{1,18}$/;
