/**
 * The app loads NO third-party script (issue #25).
 *
 * Tinylytics used to be initialized here for every route except
 * /signin, which meant its code executed on /account, /admin and
 * /explore — inside the session's own origin. An HttpOnly cookie stops
 * script from READING the cookie, but not from issuing authenticated
 * same-origin requests and reading the responses, so that script ran
 * with the signed-in user's authority, including owner token and role
 * operations. Site analytics belongs to the static half (apps/site),
 * which has no session and no privileged API; product signals that
 * matter here are already emitted SERVER-side through the relay
 * (mcp.tool_call, explore.tool_call, site.signin, site.feedback).
 *
 * What did have to survive the removal is this: the magic link arrives
 * as ?login_token=..., and leaving it in the address bar leaks a live
 * credential into history, bookmarks, and any Referer the page sends.
 * That scrub was tangled up in the analytics loader; it is first-party
 * hygiene and belongs on its own.
 */
/**
 * CAPTURE, then scrub — in that order, which is the whole point.
 *
 * This used to scrub only, and it ran from main.jsx before React rendered. By
 * the time the sign-in view looked for ?login_token it had already been
 * deleted, so the magic link in every login email silently did nothing and
 * only the six-digit code ever worked.
 *
 * Both properties have to hold at once: the credential must leave the address
 * bar before it can reach history, a bookmark or a Referer header, AND it must
 * still be usable. So it moves to memory first. Memoised because main.jsx calls
 * this before render and the sign-in view calls it after — they must get the
 * same answer, and the URL is only readable the first time.
 */
let captured;
let taken = false;

export function takeLoginToken() {
  if (taken) return captured;
  taken = true;
  captured = null;
  try {
    const url = new URL(window.location.href);
    captured = url.searchParams.get("login_token");
    if (!captured) return null;
    url.searchParams.delete("login_token");
    window.history.replaceState(
      window.history.state,
      document.title,
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // Unparseable URL: leave it alone.
  }
  return captured;
}
