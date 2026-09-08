/**
 * The static site's ONE session-aware element.
 *
 * This used to inject Explore, Account and Admin into the nav to make the two
 * halves of the site look like a single application. It could not work, and
 * the reason is structural rather than a bug: these pages are CDN-cached, so
 * the signed-out nav is what ships, and anything session-dependent has to be
 * patched in after /api/me answers. Every static page a signed-in visitor
 * opened therefore RESHAPED ITS NAVIGATION a few hundred milliseconds in --
 * three links appearing, the sign-in button being replaced by a plain text
 * link that did not even match its styling. That is the clunk.
 *
 * You cannot have a cached page and a session-shaped nav at once. So the nav
 * no longer changes shape: the link row is public, identical for everybody,
 * and only the meta slot swaps -- same element, same classes, same box, so
 * nothing reflows. The app half renders its own navigation and is allowed to
 * look like an application, because it is one.
 *
 * Progressive enhancement on purpose: with JavaScript off, or this request
 * failing, the signed-out control stands and still leads somewhere real.
 */
(() => {
  const meta = document.querySelector(".nav1__meta");
  if (!meta) return;

  fetch("/api/me", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      // /api/me answers 200 with {authenticated:false} when signed out -- it
      // does not 401 -- so r.ok says nothing about whether a session exists.
      // Testing the response instead of this field once showed Account to
      // signed-out visitors and replaced Sign in with a link to nowhere.
      if (me?.authenticated !== true) return;
      const control = meta.querySelector("a");
      if (!control) return;
      // Swap in place. Replacing the node is what lost the button styling.
      control.href = "/account/overview";
      control.textContent = "Account";
    })
    .catch(() => {
      /* Signed out, offline, or the door is down: the public control stands. */
    });
})();
