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
}
