/**
 * What the static half needs to know before it paints: that this browser
 * has a session, and what to call the person. The session cookie is
 * HttpOnly and static pages are served without an origin call, so the app
 * leaves this note for them (`apps/site/src/assets/session-hint.js` reads
 * it). A hint, never authority: every signed-in read still asks the server,
 * and a stale hint costs a click that lands on the sign-in page.
 *
 * It holds a name only when that name is a player's. The person's email
 * address is never written to browser storage.
 */
export const SESSION_HINT_KEY = "elixir.session";
/** The session's sliding window (packages/auth session.mjs): a hint no app
 *  visit has refreshed for this long describes a session that has ended. */
const HINT_DAYS = 30;

export function sessionHint(me, now = Date.now()) {
  const claims = me.claims ?? [];
  const primary = claims.find((c) => c.is_primary);
  const name = primary?.nickname ?? primary?.name ?? null;
  return { until: now + HINT_DAYS * 86_400_000, name };
}

/** Signing out leaves for a static page at once, before any session read
 *  could clear this, so the sign-out itself does. */
export function forgetSession() {
  try {
    window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage off: there is nothing to forget.
  }
}

/** Called with what the session said; an unknown session changes nothing. */
export function rememberSession(me) {
  if (me === null || me === undefined) return;
  if (!me.authenticated) return forgetSession();
  try {
    window.localStorage.setItem(
      SESSION_HINT_KEY,
      JSON.stringify(sessionHint(me)),
    );
  } catch {
    // Storage off: the static half keeps its signed-out face.
  }
}
