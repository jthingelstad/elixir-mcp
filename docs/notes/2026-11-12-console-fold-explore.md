# 2026-11-12 — The Console folds, part two: Explore

Jamie's ruling of 2026-11-12 (part one: `2026-11-12-console-fold-admin.md`):
Explore's useful reads move into You and the player pages, the rest retires,
and `/console` only redirects. With this change no page lives under
`/console/`.

## What moved

- **A player's record and profile** are the player page's **Record** tab
  (`apps/web/src/home/PlayerRecord.jsx`, `?tab=record` opens it): the last
  30 days from `players_summary` and the last profile read from
  `players_profile`, through `POST /api/explore` as Explore read them, only
  when the tab opens. It never draws a nickname. Any signed-in member could
  read both through Explore; the page needs sign-in, as Explore did.
- **The lookup and Players browse** are Find and the search sheet. A typed
  war week opens your clan's War tab on its season (`/clan/<tag>/war/<S>`),
  only when your clan runs Clan; a deck hash opens nothing.
- **A battle's record** is `/battle/<id>`. **A clan's record** is the clan
  directory (`/clan/directory`); your own clan opens itself in Clan.
- **The first-use steps' links** ("View recorded profile", and the battles
  link, now "Open the player page") point at the player page instead of
  Explore (`src/lib/record-journey.js`; only the destination and that label
  changed).
- **Unlinked:** the battle page's clan names and `ClanRefs` are plain text;
  the player page's "Full record" link is gone.

## Retired

The deck record and Decks browse (Stats keeps your own decks), the paged
battle and deck lists, the clan record's page, the weeks browser, the
"recent lookups" list (browser storage) and Explore's rail and help. The
nickname editor on the player record is gone; Settings › Players & tracking
already sets one, and so does `elixir_nickname`.

## Redirects (`apps/web/src/lib/moved.js`)

| Old `/console/explore/...` | New |
| --- | --- |
| (bare), `players`, `clans`, anything unknown | `/home/find` |
| `player/<tag>`, `profile/<tag>`, `list/battles:<tag>`, `list/decks:<tag>` | `/home/player/<tag>` (Find when the tag is not one) |
| `battle/<hex id>` | `/battle/<id>` (Home otherwise) |
| `clan/<tag>`, `list/members:<tag>` | `/clan/directory` |
| `week/<clan>~<S>~<W>` | `/clan/<clan>/war/<S>` |
| `weeks`, `list/weeks:<clan>` | `/clan`, `/clan/<clan>/war` |
| `meta`, `deck/<hash>`, `list/deckbattles:<hash>` | `/home/you/stats/decks` |

## Gaps left for Clan (`packages/clan*`, not edited here)

- Clan's non-member bounce at `/clan/<tag>` and the directory's tile link
  for a clan you are not in still write `/console/explore/clan/<tag>`; both
  land on the directory. Elixir has no page for a clan you are not in.
- A war week deep link names a season, not a week within it.
- `/clan/maintain` links `/console/admin/feedback` (redirected).
- Mail and Discord syndication still write `/console/explore/...` and
  `/console/admin/...` links; the redirects carry them.

## Pinned

`moved.test.js` (every Explore address and mail's old links land),
`app.test.jsx` (no route under `/console`), `player-page.test.jsx` (the
Record tab reads only when opened, draws no nickname, `?tab=record`),
`search.test.jsx`, `ssr.test.jsx` (signed out, the player page and the old
addresses are the wall), the e2e journeys in `console.spec.ts`,
`recorder-onboarding.spec.ts`, `settings.spec.ts`, `signin-return.spec.ts`
and `native-ssr.spec.ts`.

`POST /api/explore` keeps its name: Find, the search sheet, Stats and the
Record tab read through it, and a rename touches the web API, the edge and
the tests for no reader's gain.

MCP and the JSON API unchanged.
