# 2026-11-06: Settings and search, redesign step 6

Your account has one prefix, an agent is a page, and the bar's magnifier and
question mark open in place. `apps/web/src/lib/settings.js` is the rail and path
shape; `pages/SettingsPage.jsx` draws every frame.

**Paths.** `/settings/{profile, players, players/verify, players/<tag>,
emails, emails/sent, emails/<id>, connections, connections/discord, sign-ins,
usage, usage/requests, usage/requests/<id>, feedback, feedback/<id>, collectors,
collectors/new, collectors/<name>, agents/<id>/<tab>}`. Every old account address
is in `lib/moved.js`, pinned by `apps/web/test/moved.test.js`, with its query and
hash. The turn-off page and Discord's returns now emit the new paths. Mail itself
keeps its paths until step 8, so what it sends today and what is already in inboxes
both reach Settings through the map.

**Two CloudFront behaviours.** `/settings` and `/settings/*`, taking the
distribution to 24 of 25. A first load has to reach the app, so a deploy that has
not propagated would send `/settings` to the site's 404 for that short window.
Explore stays under `/console/explore`, leaving the one behaviour spare.

**Agents.** The rail's switcher is gone, and with it every page scoped by
`/console/agent/<id>`. New agent opens in place on Connections, and the agent has
five tabs: Overview, What it reads, Usage, Connections, Settings. Its timeline and
feedback are pages linked from Overview. `RailSwitcher` stays, for Clan and Ladder.

**Search.** The sheet mounts on open, so the bar costs nothing until someone
presses it, and opening costs one roster read when the account has a home clan.
Typing waits 500 ms and three characters before `players_search` through
`/api/explore`, which sits in the account's hourly bucket (300, shared with MCP)
and joins nicknames only for the caller's own account, so a search reads no other
account's private names. Roster names are game names. A tag reads the record, one
read per tag. One name, one door: a clan goes to Clan only when `me.features` says
the reader has it, otherwise to the record.

**Follow.** `home/follow.jsx` is shared by Home and the search sheet. It runs only
from its confirm dialog. It is the same friend claim as Home: no player of your
own gets the server's refusal.

**Help.** A drawer per the shell boards. The text is in `*/help.js` next to the
pages; Clan's is in `shell/clan-help.js`, because `packages/clan-web` was being
built by another session. Send feedback carries the page in `context`. Static
pages keep their Search and Help links, since the sheet needs the app.

**Confirmed now, with the kit's `ConfirmAction`.** Disconnect an app or Discord,
Sign out a device, Sign out everywhere else, Suspend, Issue a new key, Revoke,
Remove (a clan, an identity, an agent's player), Replace token, Correct tag, Stop
tracking. No dialog: mail switches, Turn off, Dismiss, Resume, Restore, Remove on
a suspended agent, and the avatar's Sign out.

**Contract 11.17.1.** Refusals and hints say Settings; no field changed. The stored
value `area: "console"` stays and shows as Elixir.

**Choices with no ruling** `[engineering, 2026-11-05]`:

- Search shows 5 per group before typing and 8 once typed.
- A name miss reads "Nothing here matches that. A player tag finds anyone on
  record."
- Another tracked clan opens its record, not Clan.
- A clan tag that misses offers Follow as a player, the only path the server has.
- Your own Discord panel draws only when Discord login is configured or you have
  linked.
- The page-view analytics for an agent's page send the kind of page, never its id.
- An agent's player gets a confirm on Remove, which the boards did not draw.

**Explore from the app.** The bar has no Explore entry, so the search sheet is its
door: a typed deck hash or war week opens the record for no read, a week names the
home clan's race as Explore's own lookup does, and a "Look up" row goes to the
lookup. `[engineering, 2026-11-06]`

**Known gaps.** Mail's wording is step 8.
