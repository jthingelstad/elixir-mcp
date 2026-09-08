/**
 * Keep the static site's navigation in step with the app's.
 *
 * The two halves of this site render their own nav — Eleventy for content,
 * React for everything behind a session — and they had drifted: the app was
 * missing Updates entirely, and the static side can't know you're signed in,
 * so Explore, Account and Admin appeared and vanished as you crossed between
 * them. One site should not visibly change shape as you walk through it.
 *
 * The static nav is public and CDN-cached, so the signed-out shape has to be
 * what ships. This adds the rest afterwards, from the session the browser
 * already holds. Nothing here is a secret: they are links, and every route
 * behind them is authorised server-side regardless of what the nav says.
 *
 * Progressive enhancement on purpose — with JavaScript off, or this request
 * failing, the nav is simply the signed-out one rather than broken.
 */
(() => {
  const nav = document.querySelector(".nav1 nav");
  const meta = document.querySelector(".nav1__meta");
  if (!nav || !meta) return;

  fetch("/api/me", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      // `/api/me` answers 200 with {authenticated:false} when signed out — it
      // does not 401 — so `r.ok` says nothing about whether there is a session.
      // Testing the response instead of the body showed Account and Admin to
      // signed-out visitors, and replaced their Sign in link with one that
      // leads nowhere. The app has always checked this field; this now matches.
      if (me?.authenticated !== true) return;

      // Same order as the app: Home · Data · Explore · Account · Docs ·
      // Updates · Admin. Inserted rather than appended, so the shared items
      // do not move when the authed ones arrive.
      const link = (href, label) => {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = label;
        return a;
      };
      const docs = nav.querySelector('a[href="/docs"]');
      if (docs) {
        nav.insertBefore(link("/explore", "Explore"), docs);
        nav.insertBefore(link("/account/overview", "Account"), docs);
      }
      if (me.is_admin) nav.appendChild(link("/admin/requests", "Admin"));

      meta.textContent = "";
      meta.appendChild(link("/account/overview", "Account"));
    })
    .catch(() => {
      /* Signed out, offline, or the door is down: the public nav stands. */
    });
})();
