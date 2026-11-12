# 2026-11-12 — Clan › Members: Follow everyone and the map; Settings: slots and Location

Part of the remaining canvas pieces (Jamie, 2026-11-12: "Approved: build
the remaining canvas pieces (... Clan Members follow-all and map, ...
Settings slots)"; tracker #752). Four pieces, each from what was already
built. MCP and `/api/v1` unchanged (MCP 11.21.0); no migration.

## Clan › Members: the roster's head

The roster panel's head is now the canvas's: "N members", then how many
of them you follow, **Follow everyone** and **Clan map**. Every member who
reads Members sees it, not only leaders.

- **Follow everyone** is the player page's follow-all (#784), not a second
  copy: apps/web lends `FollowClan` (`apps/web/src/home/FollowClan.jsx`)
  to Clan through `createClanRoutes(parent, { FollowClan })`, which
  ClanShell provides on `HostContext` (`packages/clan-web/src/lib/host.js`).
  It reads `GET /api/me/follow-plan?clan_tag=` and writes `POST
  /api/me/follow-all` with the clan's tag, so it asks first with the plan's
  cost line, leaves the reader's own players out (the plan's `yours`; the
  line now says so, on the player page too) and is refused whole past the
  limit by the server as before.
- Past the limit the button stays shut and the plan's own refusal line is
  shown beside it (`role="status"`), so the reason is in sight rather than
  behind a dialog that could not go. Everyone followed: a shut "Following
  everyone". Nobody to follow but you: no button.
- **Clan map** links to `/clan/<tag>/members/map` exactly where the Map
  chip shows (`membersPages`: the clan is verified for you and its leaders
  keep social on). The map shows what it did before: today's roster
  members who added a place, to the clan's verified members. The lede now
  says "verified members", which is what the server enforces
  (`packages/clan/src/manage/social.mjs`).
- The foot's duplicate member count is gone; "Check again" stays.

## Settings › What members see: Location

`YourPlace` and its picker moved out of `ClanMap.jsx` into
`packages/clan-web/src/views/YourPlace.jsx`, which carries no Leaflet, so
Settings draws the same control without the map's library. `useMyPlace`
is now a gated read (it keeps the envelope), so a person with no verified
player (`/api/clan/me/place` 403 `unverified`) is told to verify one, with
a link to Players & tracking. Its words say who sees it as built: the
verified members of each clan your verified player is in, on that clan's
map, while its leaders keep the map on; nobody else, no link, no agent
(places live in Clan's ledger and only `social.mjs` reads them). No player
map and no "near you": the DECISIONS line's player map waits on a legal
view about young players, and nothing here promises it.

Settings is rendered on the server and the clan map is not, so the place
lists now load with the picker: `geo.js` reads them through Vite's
`import.meta.glob`, which the server bundle does not have, and evaluating
it there made the whole settings chunk bail out of the server render
(native-ssr's `/settings/players` caught it). `YourPlace` imports
`placeLabel` from `lib/place-label.js` and loads `geo.js` with a dynamic
import inside the picker's effects; `geo.js` re-exports `placeLabel`, so
ClanMap is unchanged.

## Settings › What members see: your follow slots

`GET /api/me/follow-slots` (web session API, `services/web-api/src/routes/
player.mjs` `followSlots`) answers `{used, free, limit, players}`, one row
per player the reader's pool follows. It reads `pooledFollows`, new in
`@elixir-mcp/claims` beside `pooledUsage`: the same `followed` set and the
same `playerCostSql`, so the rows that are not free are exactly
`players_used`, which is the `used` every Follow dialog says
(`/api/me/follow-cost`, `followPlan`). `services/web-api/test/
follow-slots.test.mjs` pins the two equal, before and after a stop.

Each row has `slot` (`used` or `free`), the free `reason`, the reader's
own relationship (`yours`: primary, alt, friend, watching) and the
reader's agents that track the player, by public id and name (their newest
key's name, a live one first). It names no other account.

The panel (`apps/web/src/views/account/Slots.jsx`) is a native
`<progress>` meter (`.st-slot-meter`; no inline style) labelled "Follow
slots: N of L used", then **Using a slot** and **Free, recorded anyway**.
A slot-using row's way to stop: **Stop following** (or **Stop watching**)
for the reader's own follow, asked first, through `POST /api/claims`
`remove`; **Open** to Players & tracking for the reader's own main player
or alt, whose removal has its own rules there; **Agent** to that agent's
reads for a player only an agent tracks. When an agent also tracks a
player the reader stops, the dialog says the slot stays until the agent
stops too.

## Defaults taken [engineering]

- Follow everyone shows to every member, shut past the limit with the
  refusal beside it, rather than hidden or opening a dialog that cannot go.
- The slot list shows only the reader's pool; another account is never
  named, even as the reason a follow is free ("Another account followed
  them first", as the Follow dialogs say).
- Location's words name the clan map only, and the narrower viewer set the
  server enforces (verified members), not "members".
- An agent's follow is stopped on the agent's page, not from the person's
  slot list.
