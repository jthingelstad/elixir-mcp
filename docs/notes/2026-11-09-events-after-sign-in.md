# 2026-11-09 — Events arrive in a session that began at sign-in

A document that starts on `/signin` (where a magic token can be in the
address bar) or on a record page (a call, an email, a Settings record, a
roster search) never loads the Tinylytics embed, and the SPA never loads
another document. `trackEvent` works by clicking a `data-tinylytics-event`
node for the embed's listener, so every event in such a session was dropped:
`web.error`, `web.api_*`, `console.invite_copied` and Clan's `clan.*`. A new
person's first session starts at sign-in, so first use was invisible (#508).

**What changed** (`apps/web/src/analytics.js`): when the loader skips the
embed, it installs its own click listener for the same nodes and sends each
event by beacon to the address the embed's own event request uses,
`/collector/<site>?url=…&path=…&referrer=…&event=…&event_value=…`, with `url`
and `path` from the route (`analyticsLocation`), never the address bar. On
`/signin` it sends nothing. It keeps the embed's rules: a primary click, a
dotted name, and nothing once the reader has opted out (`tinylytics_ignore`).
A session that loaded the embed is unchanged: the embed still sends its
events. Clan's `trackEvent` is the same hidden click, so its events arrive
through the same listener without a change in `packages/clan-web`.

**Why the beacon, not a late embed:** read from `tinylytics.app/js/script.js`
as served on 2026-11-09. The embed calls `triggerUpdate()` as it executes,
which records a hit for `window.location.href`; there is no attribute that
keeps its listener but drops that hit (`data-ignore` drops events too, and
`data-spa` governs only History counting). Loaded late it would count a
second hit of a view the bridge already counts. Its event request is the
collector address plus two parameters, which the bridge already builds.

**Two first-use events** `[engineering]`: `home.player_added` (a player added
from Home's steps) and `home.first_read_landed` (the first read landing while
those steps are open, not when the page opens on one already landed). Neither
carries a value: no player, tag or account.

No contract, API or migration change; the privacy page's promise (visits and
errors counted in aggregate, no account attached) holds as written.
