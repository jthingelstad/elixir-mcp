/**
 * Tinylytics loader (Jamie, 2026-09-05): global visitor tracking —
 * hits + countries, events + beacon armed for declarative hooks; no
 * kudos by request. Privacy posture matches Thingy's: the script stays
 * OFF /signin entirely (magic tokens ride that URL), login_token is
 * scrubbed from the address bar before the script loads anywhere else,
 * localhost never tracks, and the embed's own tinylytics_ignore
 * opt-out is honored by the script itself. Anonymous only — no
 * identifiers, no user text (jamie-email-tracking-policy).
 */
const SITE_ID = "Yzx8dUUvUPn9AEJpTMeU";

export function loadTinylytics() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("login_token");
    if (url.href !== window.location.href) {
      window.history.replaceState(
        window.history.state,
        document.title,
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  } catch {
    // Unparseable URL: leave it alone.
  }
  if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname))
    return;
  if (window.location.pathname.startsWith("/signin")) return;

  const script = document.createElement("script");
  script.defer = true;
  script.src = `https://tinylytics.app/embed/${SITE_ID}/min.js?hits&countries&events&beacon`;
  document.body.appendChild(script);

  bridgeRouteChanges();
}

/** The embed records one hit at document load; pushState navigation is
 *  invisible to it. Bridge route changes to the collector as virtual
 *  page hits (Elixir Drop's technique, adapted from hash routing to
 *  pushState). Paths are coarsened to their first two segments so
 *  record ids and player tags never become analytics dimensions —
 *  /explore/player/#TAG reports as /explore/player. */
export function analyticsPagePath(pathname = window.location.pathname) {
  if (pathname.startsWith("/signin")) return null;
  const segments = pathname.split("/").filter(Boolean).slice(0, 2);
  return segments.length ? `/${segments.join("/")}` : "/";
}

function bridgeRouteChanges() {
  let last = analyticsPagePath();
  const send = () => {
    const next = analyticsPagePath();
    if (next === null || next === last) return;
    const referrer = last
      ? new URL(last, window.location.origin).toString()
      : document.referrer;
    last = next;
    try {
      if (typeof navigator.sendBeacon !== "function") return;
      const collector = new URL(`https://tinylytics.app/collector/${SITE_ID}`);
      collector.searchParams.set(
        "url",
        new URL(next, window.location.origin).toString(),
      );
      collector.searchParams.set("path", next);
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
