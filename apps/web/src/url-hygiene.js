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
