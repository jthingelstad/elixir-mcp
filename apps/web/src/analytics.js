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
 *
 * That carve-out used to take the ROUTE BRIDGE down with it, and the bridge is
 * how this SPA reports anything after its first document. A magic link lands on
 * /signin and the app pushStates to /account/overview without a reload, so a
 * session that entered the console the ordinary way reported NOT ONE page —
 * every screen the 2026-09-09 console redesign added was invisible for exactly
 * the people who use it most. The two jobs are now separate: the embed records
 * the document load and is the part /signin skips; the bridge records
 * navigation and is installed always.
 */
const SITE_ID = "Yzx8dUUvUPn9AEJpTMeU";

/**
 * A record of one call or one sent email: /account/activity/c/<request_id>,
 * /account/activity/e/<send_id>, /admin/emails/<send_id>. Report hygiene,
 * the same reason Explore ids ride as ?id= rather than as a path: every
 * record as its own page shreds the report into one-hit rows, and a
 * record page is worth one row per KIND ("email records opened"), not
 * one per record. It is not a privacy device - a send id points at a
 * record its holder can already open (docs/ENGINEERING.md, "Product
 * identifiers versus measurement"). The bridge reports these pages as
 * their kind, and a document that loads on one (the mail's footer links
 * straight here) skips the embed's raw-URL hit and reports the same
 * normalized page by beacon instead, so the landing counts once, cleanly.
 */
const PRIVATE_RECORD = /^\/((account|admin)\/[^/]+\/.|agent\/)/;

export function loadTinylytics() {
  if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname))
    return;

  // Always, and before the early returns below: patching pushState is what
  // makes the rest of the session countable.
  const { landing } = bridgeRouteChanges();

  // The embed reads the address bar as it executes, so it is the one thing
  // that must not run while a magic token is in it. Nothing is lost by
  // skipping it: the document hit it would have recorded is the /signin view
  // we deliberately do not keep, and every hit after this one is a beacon
  // built from the ROUTE (analyticsLocation), never from the raw URL.
  if (window.location.pathname.startsWith("/signin")) return;
  if (PRIVATE_RECORD.test(window.location.pathname)) {
    landing();
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = `https://tinylytics.app/embed/${SITE_ID}/min.js?hits&countries&events&beacon`;
  document.body.appendChild(script);
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
  let segments = pathname.split("/").filter(Boolean);
  // An agent's console is a place, /agent/<public_id>/... (2026-09-23):
  // which agent is never reported, only the kind of page (privacy.md: a
  // page of your own records reports its kind, not which record).
  if (segments[0] === "agent") segments = ["agent", ...segments.slice(2)];
  const page = segments.length ? `/${segments.slice(0, 2).join("/")}` : "/";
  const url = new URL(page, origin);
  // A record page under the console (a call, an email, feedback, a
  // tracked subject, an admin's account or email) reports as its kind,
  // never which one: /account/activity/e, not the send id.
  if (
    ["account", "admin", "agent"].includes(segments[0]) &&
    segments.length > 2
  ) {
    const kindOf =
      segments[1] === "activity" &&
      ["c", "e"].includes(segments[2]) &&
      segments[3]
        ? `${page}/${segments[2]}`
        : page;
    return { path: kindOf, url: new URL(kindOf, origin).toString() };
  }
  const id = segments.slice(2).join("/");
  if (id) url.searchParams.set("id", decodeURIComponent(id));
  return { path: page, url: url.toString() };
}

function bridgeRouteChanges() {
  let last = analyticsLocation();
  const beacon = (next, referrer) => {
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
  const send = () => {
    const next = analyticsLocation();
    // /signin reports nothing, and it also ENDS the view before it: sign out,
    // sign back in, and landing on the page you left is a new view, not the
    // same one continuing.
    if (next === null) {
      last = null;
      return;
    }
    if (next.url === last?.url) return;
    const referrer = last ? last.url : document.referrer;
    last = next;
    beacon(next, referrer);
  };
  const original = history.pushState.bind(history);
  history.pushState = (...args) => {
    original(...args);
    send();
  };
  window.addEventListener("popstate", send);
  // The document hit the embed is not allowed to record on a private
  // record: the same normalized page, by beacon, with the real referrer.
  return {
    landing: () => {
      if (last) beacon(last, document.referrer);
    },
  };
}

/**
 * A browser-side failure, as a Tinylytics event (2026-09-12). The origin
 * logs every request that reaches it; the class of problem this exists
 * for is the one that never does — a fetch that hangs or dies before
 * the edge, a script error in the view. Tinylytics' collector counts a
 * click on a data-tinylytics-event node, so a programmatic event is a
 * hidden node clicked once. Best-effort: never throws, never on
 * localhost, and silent until the embed has loaded.
 *
 * `value` must never carry a URL, a token or free text from an error;
 * callers pass a route KEY or a bounded label.
 */
export function trackEvent(event, value) {
  try {
    if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname))
      return;
    const node = document.createElement("button");
    node.type = "button";
    node.hidden = true;
    node.setAttribute("data-tinylytics-event", event);
    if (value) node.setAttribute("data-tinylytics-event-value", value);
    document.body.appendChild(node);
    node.click();
    node.remove();
  } catch {
    // Analytics is best-effort and must never turn one failure into two.
  }
}
