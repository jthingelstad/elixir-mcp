# 2026-11-23 — Cross-site writes are refused, and a sign-in link asks

Two hardening changes to signing in, one request each.

## Cross-site request defence, in one place

The session cookie is `SameSite=Lax`, which keeps it off another site's
POST. But every other `poapkings.com` subdomain is the same site, and its
forms and requests carry the cookie. Two places trusted the cookie alone:
the OAuth consent POST (`authorizePost`, `step=session`, which could
complete a consent with `grant=` and `confirm=1`) and the web API's
writes, which lean on the `x-elixir-client` header (opt-in per route).

One rule now, `foreignRequest(event, ownOrigin)` in
`packages/auth/src/origin.mjs`. `Sec-Fetch-Site` decides when the browser
sends it: `same-origin` is Elixir's own page and `none` is the person's
own act (the address bar, a bookmark), which no page can cause; anything
else is foreign. A browser too old to send it is judged by `Origin`: one
that is present and not Elixir's own origin is foreign. A request naming
neither passes. This is the rule Go's `http.CrossOriginProtection`
applies.

- **Consent** (`services/mcp/src/oauth-routes.mjs`): every step of the
  POST is refused when foreign, before anything is read, mailed or
  granted, with a plain page ("Start again from the app"). The own origin
  is the issuer's (`new URL(issuer).origin`), the source the MCP door's
  own Origin check already uses.
- **Family sign-in with no page** (`authorizeGet`): when `Sec-Fetch-Site`
  is `cross-site`, the signed-in page is shown to tap instead of a code
  being issued. Drop's redirect is `drop.poapkings.com` to
  `elixir.poapkings.com`, same-site, so its sign-in is unchanged; a typed
  address or a bookmark (`none`) is unchanged too.
- **Web API** (`services/web-api/src/handler.mjs`): one check at the top
  of the handler, for every method but GET and HEAD that carries the
  session cookie. Exempt: `POST /api/email/unsubscribe`, whose signed
  link is its credential and which a mail client posts from anywhere. The
  `x-elixir-client` rule is unchanged and still applies after this. The
  own origin is a new `siteOrigin` option (default
  `https://elixir.poapkings.com`), set in `index.mjs` from the one
  constant Clan's links already used.

Legitimate writers, checked: the app and its service worker (same-origin
fetches), the site's help form (same-origin), the unsubscribe page's
button (same-origin) and a mail client's one-click POST (exempt), the
installed app (a PWA, same origin), the collector door and MCP (their
own Lambdas, no cookie), Drop (a confidential client: its server calls
`/oauth/token` and `/api/v1/me` with no cookie, and its browser only
navigates to `/oauth/authorize`), and the tests, which call the handler
without either header. There is no local API runner (`apps/web/AGENTS.md`);
one run behind Vite's proxy would pass `siteOrigin`.

The edge: `origin` and `sec-fetch-site` join `SiteApiOriginRequestPolicy`
and `OauthAuthorizeOriginRequestPolicy`. An origin request policy is not
part of the cache key, and every behaviour using these two keys its cache
on `Authorization` alone (`WebPrivateCachePolicy`), now pinned in
`services/mcp/test/infra-controls.test.mjs`. To stay within CloudFront's
ten, the three `x-collector-*` headers leave the site API's list: the
collector door is `/api/collector/*`, served through
`McpOriginRequestPolicy`, which forwards them, and nothing behind `/api/*`
reads them. `packages/collector-door/test/edge.test.mjs` read the wrong
policy and now reads the one the collector behaviour names.

Nothing a person sees changes.

## The sign-in handoff asks, unless it is the browser that asked

`POST /api/auth` stored the asking browser's address, and `/redeem`
compared it: from the same address the waiting screen was signed in at
once. So someone on the same network who knew a person's email could
start a sign-in, and when that person tapped the link within fifteen
minutes the other browser was signed in with no question.

Jamie, 2026-11-23, asked for this to be investigated; removing the
shortcut is engineering's call. A redeem with a waiting screen returns
`confirm`, and only the link's screen's Allow (`POST /api/auth/handoff`)
readies `/poll`. The address is no longer stored in `started_from`
(nothing else read it); the browser label, country and time stay, for the
question.

One case is not asked, and it is a proof where the address was a guess:
the app keeps the poll id of the sign-in it asked for (localStorage, the
link's fifteen minutes) and sends it with the redeem. Only the screen
that asked ever held that id, so a redeem that presents it
(`holdsPollId`) is the link opened in another tab of the same browser;
`offerHandoff({ sameScreen: true })` readies the waiting tab at once and
the answer is `handoff: { state: "done" }`. Another request's id, or
none, is asked as above.

The question was rewritten for someone meeting it on a phone from a link
they may not have asked for: "Sign in the other screen too?", what Elixir
knows of that screen and no more, a plain "tap No" for anyone who did not
ask, and **No, just this device** as the first and main button.

Still asked although it is one person's own device: a link that opens
in a different browser or app than the one that asked (the installed
app asked, the mail app opened Safari), since they share no storage.

MCP and JSON API unchanged. No migration.
