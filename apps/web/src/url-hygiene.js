/**
 * CAPTURE, then scrub — in that order, which is the whole point.
 *
 * This used to scrub only, and it ran from main.jsx before React rendered. By
 * the time the sign-in view looked for the login_token it had already been
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
    // The link rides the FRAGMENT (#129): a fragment never leaves the
    // browser, where a query string reaches the CDN's access logs. The
    // query form was read for one link lifetime while mail moved over;
    // it is no longer redeemed, only scrubbed, so a stale one never
    // lingers in history either. Only the part that carried it changes.
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    captured = fragment.get("login_token");
    const inQuery = url.searchParams.has("login_token");
    if (!captured && !inQuery) return null;
    if (inQuery) url.searchParams.delete("login_token");
    if (captured) {
      fragment.delete("login_token");
      url.hash = fragment.toString();
    }
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

/** The token, ONCE: the first caller gets it and it is gone. The sign-in
 *  view redeems through this, so however many times that view mounts or
 *  re-renders while the session settles - and it did, four redeems in
 *  600 ms live on 2026-09-13, three of them 400s on a spent token - the
 *  credential is presented exactly one time. takeLoginToken() above is
 *  for the boot-time scrub and stays memoised. */
let consumed = false;
export function consumeLoginToken() {
  const token = takeLoginToken();
  if (consumed) return null;
  consumed = true;
  return token;
}
