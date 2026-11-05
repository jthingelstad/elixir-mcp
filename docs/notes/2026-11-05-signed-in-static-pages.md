# 2026-11-05 — Three bugs from the design review

**The static half knows a browser has a session.** `/` and `/docs/*` showed
Sign in and Create your account to people who were signed in. The session
cookie is HttpOnly and those pages make no origin call, so the app now leaves
a hint in `localStorage` (`elixir.session`: an expiry and the player's name)
and `assets/session-hint.js`, a blocking script in the head, sets
`data-session` before the first paint. Both faces are in the markup and the
stylesheet shows one, so nothing swaps after load, which is what the bar's old
"always Sign in" rule protected. The name reaches the bar as CSS custom
properties read by `content`. The hint holds a name only when it is a player's;
the address is never written to browser storage. It is a hint and never
authority: a stale one costs a click that lands on sign-in. Sign-out clears it
before leaving, since no session read could run first.

**The clan map no longer aborts its boundary.** `renderToString` does not wait
for a `lazy` view: it aborts the Suspense boundary and the browser reports React
#419 on every visit. The server and hydration now draw the waiting line and the
view loads after. `apps/web/test/ssr.test.jsx` pins it.

**New agent opens in place.** The button on Connections sent people to
`/console/account/agents` and left them to find the form under the table. The
form is now `NewAgent`, used on Connections in place and on the agent list.
The design review recorded that address as on no rail; the code marks
Connections there, so the fault was losing your place, not the rail.

**A test that aged out.** `clan-sync.test.mjs` counted a missed delivery on a
fixed date against the real clock's 30-day window, and failed from 2026-11-05.
It now counts today.

No MCP or JSON API change.
