/**
 * The addresses mail from before 2026-09-28 still carries: the bare root paths
 * from when the console sat at the root. They reach this 404 page, so they go on
 * from here, in the browser, with their query and fragment. `/account/*` goes
 * under /console, where the app's one map (apps/web/src/lib/moved.js) takes it
 * the rest of the way. Everything else stays what it was: a 404.
 *
 * The rule is its own function so a test can read it without a browser. No new
 * CloudFront behaviour: this costs none.
 */
(function (root) {
  function oldRootPath(pathname) {
    const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
    if (/^\/(account|explore|admin)(\/|$)/.test(path)) return `/console${path}`;
    return null;
  }
  root.elixirOldRootPath = oldRootPath;
  if (!root.location) return;
  const to = oldRootPath(root.location.pathname);
  if (to) root.location.replace(to + root.location.search + root.location.hash);
})(globalThis);
