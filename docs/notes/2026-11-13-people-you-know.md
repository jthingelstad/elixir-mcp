# 2026-11-13 — People you know: Home's suggested follows, friendlies first, and Follow back

No MCP tool, `/api/v1` operation or contract version changes. Migration
0264 adds one nullable column, `account.starter_hidden_at`. What's new 239.

Jamie, 2026-11-13: "i really like mining friendly battles for follows...
those are probably folks they know!" and, the same day, "the suggested
follows is CRITICAL for first user experience... we should make sure that
if someone isn't following players (or a super small amount) that we
should bring the suggested user list even if it isn't their first login."

## What changed

- **People you know** (`GET /api/me/people/starter`,
  `services/web-api/src/people.mjs` `starterSet`): at the top of Home, on
  every visit, while the account follows fewer than five players (friend
  claims; its own primary and alts and its clans do not count). Read
  apart from the feed and offered again on each visit; no stored flag
  says who gets it, and no backfill or mail reaches the accounts that
  already follow few: they see it the next time they open Home.
  - Order: clanmates Elixir records already (free, not counted); then
    from the last 30 days of the account's own players' battles,
    friendly-battle opponents, then 2v2 teammates, then clanmates battled
    in clan chat; then the other current clanmates by their last battle.
    No order by trophies, wins or any score. Game names only; never a
    player the account owns, follows or watches.
  - At most 10 that would take a slot (fewer when fewer are left), 50 in
    all (the follow-all's cap).
  - Every row is ticked; untick, then **Follow these**, the follow-all a
    clan's Follow everyone uses (`POST /api/me/follow-all`, priced again
    and refused whole past the slots left). Nothing is followed without
    the tap.
  - **Not now** (`POST /api/me/people/starter/hide`) stamps
    `account.starter_hidden_at`; Home leaves the list off for 30 days,
    then offers it again while the account still follows few. Home's
    first read carries `starter_hidden_until`, so Home does not even ask
    for the list while it is put aside. Find is unaffected.
  - With nobody to suggest (no player of its own, or nobody found), one
    line points to Find's search and the Follow me link.
  - Follow these sits beside the heading and the cost line below the
    rows, so a 375 × 667 phone's first screen holds the button and three
    rows with their reasons (`apps/web/e2e/home-starter.spec.ts` measures
    it against the bottom tabs, at 375 × 667, 390 × 844 and desktop).
- **How a friendly battle is identified:** the battle's own type,
  `battle.type` and its copy `battle_participant.type`. `friendly` is a
  friendly two players set up; `clanMate` and `clanMate2v2` are clan chat
  friendlies. Named once as `FRIENDLY_TYPES` beside `CLANMATE_TYPES` in
  `packages/contracts/src/modes.ts`; all are mode group `casual`.
  `unknown` is not one: it also carries event battles.
- **People to follow and From your battles** put friendly opponents and
  2v2 teammates first, then most met, and the panel's sources take turns
  in the order battles, players your follows follow, clan. Their words
  are facts: "You played a friendly battle this week", "Your 2v2
  teammate", "Ada follows them", "In your clan, played today".
- **Follow back:** the bell's New followers named the follower's verified
  player but had no Follow; each row was a link. A named follower now has
  **Follow back** (the one confirmed, priced Follow) unless the reader
  already owns, follows or watches that player (`can_follow_back` in
  `services/web-api/src/bell.mjs`). The bell names one verified player
  per follower account, so an alt of theirs is not offered.

## The reads

`services/web-api/test/people-budget.test.mjs` holds each people read to a
statement count and every plan to never scanning `battle`,
`battle_participant` or `player` whole nor reading more than a quarter of
one, over the seeded clan of `clan-landing-seed.mjs` (49 members, three
weeks of logs, four other clans' copies) plus a friendly and a 2v2. Each
of the account's own players' battles is one index range
(`battle_participant_player_time_cover`, a lateral per own player); no
statement batches players with `player_tag = any(...)`. As measured on
that seed (`PEOPLE_BUFFERS=1`):

| Read | Statements | Shared buffers |
| --- | --- | --- |
| `/api/me/people/starter` | 11 | 1,216 |
| `/api/me/people/suggested` | 11 | 476 |
| `/api/me/people/battles` | 8 | 880 |
| `/api/me/people/clan` | 11 | 269 |

Most of the starter's buffers are the clanmates' last battles, one probe
each on the same cover index.

## Automatic following: decided against

Pre-checked by design today. Following the set without the tap is one
call where the account's first read lands (or on a Home read that finds
`offer` true): `followEach(db, account, await followPlan(db, id,
(await starterSet(db, id)).people.map((p) => p.tag)), liveRead)` in
`services/web-api/src/routes/player.mjs`, the loop the follow-all route
already runs, with the panel turned into a notice of who was followed.
Decided 2026-11-13: the set stays pre-checked with one confirmed Follow
these, never followed automatically (a follow shows in the other person's
bell, so automatic would announce a new account to people without its
choosing). Jamie agreed with that recommendation; DECISIONS, "Home
suggests follows to anyone following few".
