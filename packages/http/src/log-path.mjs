/**
 * The path a request's log line may carry (2026-11-22).
 *
 * A path can hold a credential: a Timeline feed link's token
 * (`/api/rss/<token>`) is the whole sign-in for a feed reader, a share
 * link's id is a capability, an agent's public id is a name. The log
 * line is kept for years and read by reports, so none of them belongs in
 * it. A door that matched a route names the route's shape itself
 * (`context.route`, `server.mjs`); this is what a line carries when no
 * route did: a scanner's path, or a credential path asked for with a
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
