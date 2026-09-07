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
export function scrubLoginToken() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("login_token")) return;
    url.searchParams.delete("login_token");
    window.history.replaceState(
      window.history.state,
      document.title,
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // Unparseable URL: leave it alone.
  }
}
