/**
 * The path a request's log line may carry (2026-11-22).
 *
 * A path can hold a credential: a Timeline feed link's token
 * (`/api/rss/<token>`) is the whole sign-in for a feed reader, a share
 * link's id is a capability. The log line is kept for years and read by
 * reports, so neither belongs in it. A door that matched a route names
 * the route's shape itself (`context.route`, `server.mjs`); this is what
 * a line carries when no route did: a scanner's path, or a credential path asked for with a
 * method or a suffix its route does not answer.
 */

/** A long run of token characters holding a digit or a capital: a random
 *  id, token or uuid, never a word of a route (`oauth-authorization-server`
 *  has neither). */
const OPAQUE = /^(?=.*[0-9A-Z])[A-Za-z0-9_-]{20,}$/;

/** The segment after one of these is a credential or a capability
 *  whatever it looks like, so a short or mistyped one is masked too. */
const SECRET_AFTER = new Set(["rss", "share", "shared-items"]);

/** `path` with every segment that is, or may be, a credential replaced
 *  by `*`. */
export function logPath(path) {
  // The agent doors (/a/<public id>/mcp, /api/agent/<id>) are gone
  // (2026-11-23), but an old client still knocking at one names an
  // account's public id in its path, so those segments stay masked.
  const segments = String(path ?? "")
    .replace(/^\/a\/[^/]+/, "/a/*")
    .replace(/^\/api\/agent\/[^/]+/, "/api/agent/*")
    .split("/");
  return segments
    .map((segment, i) =>
      i > 0 &&
      segment !== "" &&
      (SECRET_AFTER.has(segments[i - 1]) || OPAQUE.test(segment))
        ? "*"
        : segment,
    )
    .join("/");
}
