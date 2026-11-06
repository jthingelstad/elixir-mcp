# 2026-11-06 — The flip, redesign step 3b

One bar on every page, Home as the landing, and the word Console out of what a
reader sees. Clan and Ladder keep their rails; Settings' paths stayed under
`/console` until step 6 ([settings and search](2026-11-06-settings-and-search.md)); mail keeps its words until step 8.

**One map.** `apps/web/src/lib/moved.js` holds every path that moved, read by the
root route's `beforeLoad` and pinned by `apps/web/test/moved.test.js`. Query and
hash survive, so the magic link in mail (`/console/signin#login_token=`) still
signs in and a `return_to` still arrives. An address under a prefix the app owns
that matches nothing gets the missing state, not a trip to the site's 404.

**Two CloudFront behaviours.** `/signin` and `/data/service` are new, taking the
distribution to 22 of 25. The rest of `/data` stays static, so a client redirect
could not serve either path on a first load. The stack update ships with the
deploy; until it has propagated `/signin` would reach the site, so the deploy
order matters only for that short window.

**The bar is one manifest.** `packages/ui/src/family.json` draws the React bar,
the static bar in `base.njk` and the mail footer. The static bar carries both
faces in its HTML and the session hint picks one before first paint, as the
signed-in static pages already did.

**What Overview's going left behind.** Home's new-account steps replace its
checklist, and the battle activity graphic stays on each player's record. The
full `FirstAnswer` is drawn by no page now: the record page uses its compact form
and Connections holds the questions, so its non-compact branch is dead code with a
unit test. The rail's Timeline dot became the count on Home's Timeline tab; the
Settings rail has no mark. An agent's Timeline keeps the old evidence panel, whose
focus handling lost its end-to-end cover when that spec moved to Home's in-place
disclosure.

**Choices with no ruling** `[engineering, 2026-11-05]`:

- Discord sharing's home until step 6 was Settings, Connections
  (`#timeline-discord`); Home's Timeline linked to it. Step 6 gave it
  `/settings/connections/discord`.
- "Your feedback" joins the Settings rail; the static avatar opens Settings.
- A new account lands on `/home`, not Tracking; Home's steps lead there.
- The front page's Console tile is called Home and its button opens `/home`: the
  smallest edit that stops it naming a place that is gone. Step 7 owns the page.
- Usage's row for your own reads is called Website, kind `website`.
- A missing address under an app prefix answers 200 from the server, as it did;
  the page says missing. A real 404 needs the server to know the route table.

**Left for later.** `packages/tools` and MCP strings said Console in a few
refusals ("Console, Verify"); contract 11.17.1 retired them at step 6. `area: "console"` in feedback stays as a stored value; it reads
as Elixir everywhere it shows.
