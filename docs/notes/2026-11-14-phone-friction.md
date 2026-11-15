# 2026-11-14 — Phone friction: a quiet Home, one-row tabs (#1016)

The rest of the experience review's phone findings
(`docs/design/experience-review/README.md`). No MCP, JSON API or database
version changes (MCP 13.1.1, JSON API 5.1.0, no migration).

## A quiet Home

An empty week used to read "Choose who you follow" with a line about
notify switches and a Settings link: account maintenance where a player
wanted friends. Now it names its reason from the passport's
`owner.profile.follows` (`quietFeed` in `apps/web/src/home/logic.js`):

- no follows: "Your feed is waiting for friends";
- any follow unread in 24 hours (`unknown`), or one with a battle the
  stored week has not caught (`active`): "Still catching up". Unread is
  never called quiet;
- every follow read and none played in 7 days: "The players you follow
  have been quiet" (one follow: "The player you follow has been quiet");
- counts not read: "Nothing in the last seven days", which claims neither.

Its one action is **Find your people** (`/home/find`, which opens on
Suggested: your battles, your clan, friends of follows, each with why and
nobody ranked). People to follow moves under the line in the main column,
so a phone shows it before Your week; the side panel steps aside, so no
name is drawn twice, and the starter set (People you know) still wins
when it is listed. No new read: the passport is the one ProfileList
already reads on Home (and is asked only once the feed is empty), and the
suggested read moves rather than doubles.

## The starter gate counts follows who play

People you know showed while the account followed fewer than five
players. An account following five quiet players lost it with nobody to
see. The gate (`starterSet` in `services/web-api/src/people.mjs`, and
`setup.following_played` in `first-answer.mjs`, read by `offersStarter`)
now counts follows with a battle in the last 7 days, an `exists` on
`battle_participant` per claim inside the statements already made
(`battle_participant_player_time_cover` serves it), counted only to five
(`limit`), all the gate needs. Uncapped, the budget test's 26-week seed
took `/api/me/first-answer` to 278 shared buffers against its ceiling of
200, one probe per follow; capped, it stops once the gate is decided and
sits back under. The pinned statement budgets (12 and 8) and buffer
ceilings are unchanged.

## Tabs keep one row on a phone

At 320 and 390 the player page's six tabs and Clan's six wrapped to two
or three lines, because a 760px rule set every `.kit-tabs` to wrap (the
visual direction of earlier today chose it for player tabs). Options
weighed: fewer tabs or a More menu (hides destinations, changes what one
tap reaches), grouping (a new hierarchy for one finding), or one row that
scrolls. One row won:

- every tab stays one tap away and nothing is removed or renamed;
- addresses and deep links are unchanged, and `Tabs` already scrolls the
  open tab into view, so `/clan/<tag>/policy` opens with Policy showing;
- it is what the clan docs already promised ("the tabs stay in one row
  ... scrolling sideways") and what Find and Stats did;
- the review's worry about partial edge labels is answered with a
  chevron (`›`, `‹`) on the edge that has more, drawn from the existing
  `data-more-*` scroll hint, hidden from screen readers and inert to taps.

It is CSS only (`packages/design/src/components.css`), so every kit tab
bar gets it; `wrap` (Agents) still wraps.

## Settings › Profile

Nothing left: #1015 put You in Elixir (the shared Avatar and PlayerName,
the passport row) before Account, and Main player renders `PlayerName`
with its verified mark. `e2e/passport.spec.ts` pins the order.

## Tests

`apps/web/test/home-quiet.test.jsx`, `people.test.js`,
`services/web-api/test/starter-follows.test.mjs`, `first-answer.test.mjs`,
and `apps/web/e2e/phone-friction.spec.ts` at 320, 390 and 1280 (one row,
no sideways page scroll, deep links, axe). `verified-player.spec.ts` now
asks Find's tabs for one row inside the page rather than every tab inside
390px.
