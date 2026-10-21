/** Every link into Elixir, in one place. The console paths (under
 *  /console since 2026-09-28) are the ones Elixir's own docs front-matter
 *  names (`console:` on recording.md and verify.md).
 *
 *  Same-origin paths (2026-10-20): Clan is served on Elixir's one
 *  origin, so a link into the Console stays on whichever origin the page
 *  is on (a preview or a local build no longer jumps to production) and
 *  the views follow it in-app with the kit's Link. The docs are site
 *  documents, not app routes: those are plain anchors. Every caller is a
 *  browser view; nothing outside the page reads these. */
export const ELIXIR_LINKS = {
  home: "/",
  tracking: "/console/account/tracking",
  verify: "/console/account/verify",
  overview: "/console/account/overview",
  connections: "/console/account/connections",
  verifyDocs: "/docs/verify",
  connectionsDocs: "/docs/connections",
};

/** True for a link the app routes (the Console), false for a site
 *  document (the docs), which is a page load. */
export const inApp = (href) => href.startsWith("/console/");
