/**
 * Tinylytics, loaded client-side — the same way apps/site, Elixir Drop and
 * Thingy all load it.
 *
 * This briefly went a different way. Issue #25 took the embed off the app
 * because third-party script on the session's origin can issue authenticated
 * same-origin requests with the user's authority, and the app then reported
 * views through our own API instead. That proxy is gone: it bought nothing.
 * The session cookie is Path=/ on elixir.poapkings.com and the embed still
 * loads on every static page of that same origin (/, /docs/*, /updates), so
 * the script the proxy was avoiding was already there. Keeping it off /app
 * alone made the app unmeasurable without making anything safer.
 *
 * What actually holds the line is the CSP (script-src 'self'
 * https://tinylytics.app), which is enforced on every behaviour.
 *
 * The one carve-out that IS real: /signin never loads it, because the magic
 * token rides that URL. localhost never tracks. The login_token scrub lives in
 * url-hygiene.js — first-party hygiene, and main.jsx runs it before this.
 */
const SITE_ID = "Yzx8dUUvUPn9AEJpTMeU";

export function loadTinylytics() {
  if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname))
    return;
  if (window.location.pathname.startsWith("/signin")) return;

  const script = document.createElement("script");
  script.defer = true;
  script.src = `https://tinylytics.app/embed/${SITE_ID}/min.js?hits&countries&events&beacon`;
  document.body.appendChild(script);

  bridgeRouteChanges();
}

/**
 * The embed records one hit at document load; pushState navigation is
 * invisible to it. Bridge route changes to the collector as virtual page hits
 * (Elixir Drop's technique, adapted from hash routing to pushState).
 *
 * An Explore record lives at /explore/player/2ABC — the id is a path segment,
 * which makes every player his own page and shreds the report into thousands
 * of one-hit rows. The page is /explore/player; WHICH record is an attribute
 * of that view, so it rides as ?id=. Nothing here is a secret — CR tags are
 * public game identifiers — this is about the path space meaning something.
 */
export function analyticsLocation(
  pathname = window.location.pathname,
  origin = window.location.origin,
) {
  if (pathname.startsWith("/signin")) return null;
  const segments = pathname.split("/").filter(Boolean);
  const page = segments.length ? `/${segments.slice(0, 2).join("/")}` : "/";
  const url = new URL(page, origin);
  const id = segments.slice(2).join("/");
  if (id) url.searchParams.set("id", decodeURIComponent(id));
  return { path: page, url: url.toString() };
}

function bridgeRouteChanges() {
  let last = analyticsLocation();
  const send = () => {
    const next = analyticsLocation();
    if (next === null || next.url === last?.url) return;
    const referrer = last ? last.url : document.referrer;
    last = next;
    try {
      if (typeof navigator.sendBeacon !== "function") return;
      const collector = new URL(`https://tinylytics.app/collector/${SITE_ID}`);
      collector.searchParams.set("url", next.url);
      collector.searchParams.set("path", next.path);
      collector.searchParams.set("referrer", referrer);
      navigator.sendBeacon(collector.toString());
    } catch {
      // Analytics is best-effort and must never interrupt navigation.
    }
  };
  const original = history.pushState.bind(history);
  history.pushState = (...args) => {
    original(...args);
    send();
  };
  window.addEventListener("popstate", send);
}
