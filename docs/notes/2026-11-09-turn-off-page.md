# 2026-11-09 — A mail's turn-off link answers in Elixir's own page

Jamie, 2026-11-09: turning an email off left "a completely unstylized
page that just says ok", where it should be a product page that looks
like Elixir and gives places to go next.

**The defect.** `POST /api/email/unsubscribe` answered a page only when
the request's `Accept` named `text/html`, and the mail client's RFC 8058
one-click POST got a bare `ok`. The `/api/*` origin request policy
forwards no `Accept` header (`SiteApiOriginRequestPolicy`, nine of ten
slots used), so in production every press of the page's **Turn it off**
button got the mail client's answer. The route now tells them apart by
the body: RFC 8058 requires `List-Unsubscribe=One-Click`, and the button
sends none. The last header slot stays free.

**The page.** The site builds `email-page.html` (noindex, out of the
sitemap) on `base.njk`, so it carries the bar, the fingerprinted
stylesheet, the footer and the disclaimer. The web API reads it from the
site bucket like the 404 (`makeSiteShell`, a minute's cache), writes its
title and replaces the `data-email-page` section with the step: confirm,
turned off, an expired link (400, nothing changed) or an email that has
ended. Each step offers both session faces' ways on (Home and email
settings signed in; sign in and the site's home signed out) and the
email docs. When the shell cannot be read, or lacks the section, the
step answers the plain inline page as before, now with the same links.

**[engineering]** The token page drops the Tinylytics tag the layout
carries: the address holds a credential that turns mail off, and no
third-party script reads it. The built shell keeps the tag, so the
site's "every page counts its visit" test still holds for the file.

The web role reads one more key in the site bucket
(`email-page.html`), in the stack. No contract move; MCP 11.18.4 and
JSON API 3.4.0 unchanged.
