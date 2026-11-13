/** Every link into Elixir, in one place. The app paths are the ones
 *  Elixir's own docs front-matter names (`console:` on recording.md and
 *  verify.md).
 *
 *  Same-origin paths (2026-10-20): Clan is served on Elixir's one
 *  origin, so a link into the app stays on whichever origin the page
 *  is on (a preview or a local build no longer jumps to production) and
 *  the views follow it in-app with the kit's Link. The docs are site
 *  documents, not app routes: those are plain anchors. Every caller is a
 *  browser view; nothing outside the page reads these. */
export const ELIXIR_LINKS = {
  home: "/",
  tracking: "/settings/players",
  verify: "/settings/players/verify",
  elixirHome: "/home",
  addPlayer: "/home#add-player",
  connections: "/settings/connections",
  verifyDocs: "/docs/verify",
  connectionsDocs: "/docs/connections",
};

/** True for a link the app routes (Home, the account's pages), false for a site
 *  document (the docs), which is a page load. */
export const inApp = (href) =>
  href.startsWith("/settings/") ||
  href === "/home" ||
  href.startsWith("/home#");
