# 2026-11-12 — The player page and following

Social slice 6 (#764, tracker #752, plan note
`2026-11-11-social-build-plan.md`). Jamie's ruling, asked and answered on
2026-11-12: "Slice 6, the player page: should every player name anywhere open
one player page (Timeline, Highlights, Moments, Follows, Follow me link),
replacing your 11-05 rules "One name, one door" and "Mail links follow the
reader" (own player to Ladder, clanmate to Clan, others to the record)?" —
"Yes, one page (Recommended)": "Every name opens the player page; Ladder and
Clan stay reachable from it. Members see follows, followers and badges, as
DECISIONS already says." DECISIONS: "Every player name opens one player page"
(new), "A name in mail opens the player page; a clan's link follows the
reader" (rewritten), "What is public about an account", "Invites carry no
referral ids", "A follow costs a slot only when Elixir records the player
because of you", "Search's Follow is the same confirmed action as Home's".

## What changed

- **One page per player.** `/home/player/<tag>` (`apps/web/src/home/Player.jsx`),
  read by `GET /api/player?tag=` (`services/web-api/src/routes/player.mjs`),
  signed-in only, one charge on the hourly `mcp#<account>` bucket. Head: game
  name, tag, clan, trophies (latest snapshot). Tabs: Timeline (30 days,
  `buildTimeline` with no account, basis occurred, public-visibility items
  only, no attested facts, the subject entered with no nickname), Highlights
  (`playerHighlights`, new in `packages/tools/src/activity/entries.mjs`, all
  time, newest 30), Moments (the timeline's player-moment kinds), Follows.
- **Follows, followers, badges.** Only for a player an account verified (the
  verified self claim; #556 keeps it to one): follows are that account's
  friend claims (not watching), at most 100 listed; followers are person
  accounts with a friend claim on the player, each named by its own verified
  player and the rest counted (`unnamed`). Badges: verified player, and that a
  Discord is linked (never the username).
- **The one door.** `playerHref` (`apps/web/src/lib/player.js`) is what every
  web name links to: search rows (`doorFor`), Friends, the battle page,
  Ladder's opponents, Explore's member tables and battle rows, Settings ›
  What members see and a tracked player's page. Mail (`playerDoor` in
  `packages/mail/src/render.mjs`) and Discord lines
  (`packages/syndication/src/lines.mjs`) build the same address; the mail
  reader no longer reads clanmates. Clan doors in mail still follow the
  reader. Explore's record keeps its address and is linked as Full record.
- **Following several.** `GET /api/me/follow-plan` (`player_tags` or
  `clan_tag`) prices each player with `playerCosts` and sums free, slots and
  slots left; `POST /api/me/follow-all` re-prices and refuses whole with 429
  `quota_exceeded` and the reason when the slots are not left, else follows
  each (`addPlayer`, follow) and asks a first read only for players whose
  recording started. At most 50 players; a clan is its current members.
- **Follow me links.** `/home/follow/<tag>,<tag>` (`FollowMe.jsx`): tags only.
  Signed out, Home's sign-in wall shows Join Elixir
  (`/signin?signup&return_to=<link>`) and Sign in, naming no player. Signed
  in, each player with its cost and Follow, and Follow all for several. Your
  own page copies yours (one aggregate `home.follow_me_copied` event).
- **Follow asks first.** `FollowButton` (`apps/web/src/home/follow.jsx`) is a
  `ConfirmAction` (new `danger={false}`: a plain primary confirm) naming the
  player, that they are not told, and the cost.
- **Search.** Each player row reads "tag · clan · trophies";
  `players_search` matches carry `trophies` (MCP 11.21.0).

## Defaults taken [engineering, 2026-11-12]

- Addresses under `/home`: the distribution is at 25 of 25 behaviours.
- Follows and followers only for a verified player (the narrow reading);
  follows mean friends, not watched players.
- An unnamed follower (no verified player) is counted, never named.
- The page never shows a nickname, the reader's own included.
- Follow-all: refused whole past the limit; 50 at most; first reads only for
  players whose recording this started.
- Signed out, a Follow me link names no player.
- Clan's own member pages (slice 8) keep their names' links; follow-my-clan is
  offered from a player's page only.

## Product questions

- Should a player no account verified show who follows them (their followers
  are accounts too)? Built: nothing shown.
- Should Clan's own name links open the player page too? (Slice 8's.)
- Should `/console/explore/player/<tag>` redirect to the player page?
- May a signed-out Follow me link show the tags or names it carries?

## Tests

`services/web-api/test/player-page.test.mjs` (page shape, follows and
followers, no nickname or Discord username, unverified player, 400/404, plan
pricing, follow-all refused whole and then made), `apps/web/test/player-page.test.jsx`,
the signed-in route sweep, `packages/mail/test/doors.test.mjs`, and
`apps/web/e2e/player-page.spec.ts` (a name opens the page; Follow asks and
shows its cost; a Follow me link signed out), desktop and phone.
