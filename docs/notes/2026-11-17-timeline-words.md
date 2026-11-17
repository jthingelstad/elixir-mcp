# 2026-11-17 — Timeline, Profile and Notifications

The tabs and pages a person reads were renamed: Home is the **Timeline**,
You is **Profile**, and the bell's list and its wide-screen label are
**Notifications**. The bell is what happened; Settings › Notifications
(its page head now "Notification settings") is how you are told, and
Settings › Profile's head is "Profile settings", so neither reads as the
tab or the bell. Find, Clan, Cheer, Session, Follow, Close friends and
Your circle keep their names. "Sitting" no longer appears in anything a
person reads, the timeline's own sentences included: it is "session"
("played 12 battles in one session", "N battles in M sessions").

## Addresses

Only the feed moved (DECISIONS "Timeline, Profile and Notifications").

| Old | New |
| --- | --- |
| `/home`, `/home/` | `/timeline` (301) |
| `/home?bell` | `/timeline?bell` (301, query kept) |
| `/home?search` | `/timeline?search` (301, query kept) |
| `/home#<hash>` | `/timeline#<hash>` (the browser keeps the fragment over the 301) |
| `/home/find`, `/home/you`, `/home/you/stats/...`, `/home/player/<tag>`, `/home/player/<tag>/session/<id>`, `/home/account/<id>`, `/home/account/<id>/passport`, `/home/passport`, `/home/follow/<tags>`, `/home/@<handle>` | unchanged |

The web API answers `GET`/`HEAD` `/home` and `/home/` with a 301 to
`/timeline` plus the raw query, `cache-control: no-store`, so the edge
keeps no redirect and a rollback serves `/home` again at once
(`services/web-api/src/app-pages.mjs`). The client router forwards the
same way (`movedTo` in `apps/web/src/lib/moved.js`, applied in the root
route's `beforeLoad`, search and hash kept) for a build or cache that
reaches the app without the server's answer. A signed-out deep link to
an old address lands on the same page after sign-in.

Links Elixir makes moved to the new addresses: mail (the welcome, the
digest, the activity mail, the email pages), the RSS channel and its
fallback item link, web push's fallback target and the service worker's
click fallback, the site's 404 and email pages, `llms.txt`, the shell's
product bar and the Stamps' Cheerleader action ("Open your Timeline").
The push drain's cheers notice now leads with the item's session page
(`session_path`, checked against `/home/player/<tag>/session/<id>`),
then the battle, then the player, then the Timeline.

## Infrastructure

`infra/template.yaml` gains two CloudFront behaviours, `/timeline` and
`/timeline/*`, copied from `/home/*` (the api origin, the private web
cache policy, cookies forwarded). The distribution goes from 20 to 22
path patterns of the default 25. A deploy updates the distribution;
until it has propagated, `/timeline` can reach the default behaviour,
whose router asks the site bucket for `/timeline/index.html` and fails
over to the API without a cookie. The web API answers that path with the
bare app shell and no bootstrap (`private, no-store`), and the browser
reads the session through `/api/me`, so nobody signed in sees the
signed-out page in that window. The smoke check fetches `/timeline` and
asserts the `/home?bell` 301.

The PWA manifest's `start_url` is `/timeline`; its `id` stays `/home`,
the installed app's identity, so installed apps are not duplicated.

## Unchanged

Internal names (`apps/web/src/home`, `HOME`, `homeRoute`), API routes
(`/api/me/home/*`), the database, stored keys, MCP tool names and field
names (`battle_session`, `more_sittings`) are as they were.

MCP 13.4.1 (a patch: `elixir_timeline` item `text` says "session" where
it said "sitting"; wording only) and JSON API 5.1.0 unchanged. No
migration.
