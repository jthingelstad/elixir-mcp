# 2026-11-12 — People to follow, Find's sections, and cheers on player and battle pages

Part B of the design canvas's remaining pieces, on Jamie's go: "Approved:
build the remaining canvas pieces (bell, cheers on battle and player pages,
Home side panel, Find, You with Stats, Clan Members follow-all and map,
signed-out shell, Settings slots)". This pull request is cheers on the
player and battle pages, Home's side panel and Find; the shell, You and the
bell, and Clan's and Settings' pieces are their own pull requests.
DECISIONS: "Reactions, not comments" gains an [engineering, 2026-11-12]
tail; "People to follow states why, and ranks nobody" is new
[engineering, 2026-11-12]. Briefs: `docs/product/home.md`, `structure.md`.

## What changed

- **Cheers on a player page and a battle page.** `GET /api/me/cheers`
  (`services/web-api/src/routes/cheers.mjs`, logic `cheersOnPage` in
  `src/cheers.mjs`) takes `?player=<tag>` or `?battle=<id or short id>` and
  answers the items there that are in the reader's own feed now, each with
  its counts and `my_cheer`, plus the subjects a cheer on them names. The
  feed is rebuilt only for the page's subjects the reader follows: the
  player and their clan now, or the battle's players and clans; a battle's
  items are those whose `facts.battle.battle_id` or proof battle (`proofOf`,
  now exported from `feed.mjs`) is this battle. Signed in only, an agent
  refused (`not_entitled`), not in `AGENT_SCOPED_ROUTES`; 240 reads an hour
  on `cheerread#<account>`; an unknown or ambiguous battle is 404. The
  player page's own read (`GET /api/player`) and the public battle JSON are
  unchanged. The client reuses #765's `Cheers` with `useCheer` generalised
  to the list an item lives in (`usePageCheered`); the battle page draws an
  **In your feed** panel for signed-in readers only, and the shared
  highlight page draws none (`BattleView cheers={false}`). The existing
  `PUT /api/me/cheers` check (the item in your feed now) is the write's
  guard as before.
- **People to follow** (`src/people.mjs`, `GET /api/me/people/suggested`):
  up to five players, round-robin over three sources so no one fills the
  panel: players the account's own players met in the last seven days
  (twice or more as opponents, or once as a 2v2 teammate; a battle counts
  once however many of your players were in it), the home clan's current
  members in name order, and players followed by the accounts that
  verified a player you follow (counted per account; named by the
  verified player, game name). A player in two sources is one row with
  both reasons. Every claimed player (own, followed, watched) is left out.
  Each is priced with `playerCosts` from the read itself, so the panel
  makes no per-person cost request. The answer carries reasons as data
  (`why: [{kind, ...}]`); the words are the client's (`whyLine`).
- **Find's sections.** `GET /api/me/people/battles`: the last 30 days, at
  most 30 players, most met then most recent, each with `against`,
  `with_you`, the reader's side's wins, losses and draws against them,
  `last_met`, `following` and its cost. `GET /api/me/people/clan`: the home
  clan's members priced by `followPlan` (the same as Follow everyone in),
  with their roles. Find is tabs in the canvas's order, Your clan, Search,
  From your battles, Clan directory and Your link, opening on Search (the
  phone's search door, and where `/home/friends` lands); the three about
  your own players only when you have one. No Near you, not even a
  placeholder (#768).
- **This week's race.** `readClanPanel` reads `war_current` (compact) and
  adds `race_now`: the day kind, war day, place by fame among the
  standings and fame, or finished; nothing on a non-war day and nothing
  when the race is not recorded.
- The three people routes are signed-in only, agents refused, one bucket
  `people#<account>` at three times the hourly limit (Home's panels are
  counted the same way). Each answers as a Home panel (`{ ok, ... }`, a
  failure `{ ok: false }`), and the client reads each apart, so Home's
  first paint and Find's first tab never wait on them. On a phone the side
  panels sit below the feed.
- `FollowButton` takes a cost already known (`cost`), so a list priced by
  its own read asks nothing more.

## Defaults taken [engineering]

Cheers on a player or battle page only for an item in the reader's own feed
now; no cheers on a shared highlight; the people windows (seven days for
the panel, 30 days and 30 players for Find) and the met-twice threshold;
clanmates in name order; the friends-follow source counting only accounts
that verified a player (their follows are public among members); Find
opening on Search; the race line's place by fame among the standings.

## Tests

`services/web-api/test/canvas-social.test.mjs` (cheers on both pages, the
stranger and signed-out refusals, the three people reads, no nickname or
rating keys, interleave and the race shape), `apps/web/test/people.test.js`
(the words), `apps/web/test/player-page.test.jsx` (cheers only on feed
items), and `apps/web/e2e/canvas-social.spec.ts` at desktop and phone
widths with axe.

No migration. MCP and the JSON API unchanged.
