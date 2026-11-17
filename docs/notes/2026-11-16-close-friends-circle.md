# 2026-11-16 — Close friends and Your circle this week

Jamie, 2026-11-16: "I love 'your circle this week'... a way to show close
friends versus just follows." A person stars some of the friends they
follow as close friends; Home shows how those few played this week, and
the feed can show only them.

**The mark** is `claim.close` (migration 0281), a boolean on the friend
claim itself, checked so only a friend claim that is not primary can
carry it. Removing the follow removes the mark; a relationship change away
from friend, or making the player your primary, clears it
(`packages/claims/src/index.mjs`). It is set by `POST /api/claims` (and
`/api/me/players`) with `action: "close_on" | "close_off"`, refused to an
agent principal, 409 for a player that is not a friend follow
(`setClose`, `packages/claims/src/close.mjs`). A linked follow (0277) is
one follow, so marking one of an account's Verified players marks every
friend follow the reader has of that account's Verified players, and a
player the link takes later takes the mark the others carry
(`settleCloseLink`, called from `linked.mjs`). Unmarking is only ever the
reader's own tap.

**Who sees it:** the account that set it, and nobody else. It is read in
four places, each the reader's own: `GET /api/me` claims (`close`), the
player page's reader block (`you.close`), the feed items' `groups`
(`close`) and `GET /api/me/home/circle`. No player page, account page,
follow list, bell line, mail, digest, account_event, `/api/v1` or MCP tool
carries it, and no account_event is written for a mark.
`services/web-api/test/close-friends.test.mjs` pins the owner-side reads.
DECISIONS: "A close friend is a private mark".

**The circle** (`services/web-api/src/circle.mjs`, `GET
/api/me/home/circle`, the home panel gate and rate bucket). The week is
`gameWeekStartMs`, Monday's reset, the one Your week reads. Two statements
and the stored week, whatever the circle's size: one over the record for
each friend's battles, days played in the reader's zone and last battle
(boat defenses out); the sittings, the newest session page and up to two
moments come from the stored Home week (`readHomeWeek`), never a read per
friend; profile images in one more. A friend whose sittings the stored
week does not hold keeps their battles and names no sitting rather than
zero. Order: last battle, newest first, then friends with none by name.
No wins, losses, rate or score is returned. With nothing marked it returns
up to six suggestions from the reader's friend follows, those who follow
back first, then clanmates, then name, each with why as a fact.

**The web** (`apps/web/src/home/Circle.jsx`, `close.jsx`). Above the feed
in Home's main column: a strip of faces with one line of fact each that
scrolls sideways inside itself, about one card tall on a phone; "See all"
opens a list with sittings, moments, the newest session and the star. The
offer state shows the suggestions with a star each. Nothing to offer, or
a failed read, draws nothing. The star is on the player page beside
Following, on Settings' Friends rows and in the circle.

**The filter** is a Close friends Show chip, offered once one is marked,
with its count (`counts.close`). The choice is kept per account in this
browser (localStorage, every access guarded; Everyone when storage is
blocked or the kept chip is no longer offered). Read markers: like every
Show chip it only chooses what is drawn; opening the feed moves your place
to the window it showed, whichever chip is on, as the 2026-10-20 ruling
has it, so the bell's dot and New mean the same under every chip.

On a phone the Show chips and New now wrap as one row once there are five
Show chips, so New follows the last chip instead of taking a line.

**No notifications.** A "close friend played" notification would hook into
the stored week's build (`buildHomeWeek`, timeline sync) or the bell's
read (`services/web-api/src/bell.mjs`), selecting sittings whose subject
is in `closeTags(db, accountId)` (`services/web-api/src/feed.mjs`).

MCP 13.4.0 and JSON API 5.1.0, unchanged. Migration 0281 (`claim.close`,
a constant default: no rewrite).

Follow-up (Codex on #1079): the circle read kept only the first 60 marks
by tag, on the belief that the player slots bound them. They do not (a
player already recorded, staff), so the read now returns every marked
friend.
