# 2026-11-14 — Your own battles, read when you open Elixir

The owner signed in to share a win he had just played, and the battle was
not in Elixir yet: the session clock reads a battle log every 30 minutes
at best, and Home's stored week can be up to about 20 minutes behind
that. Opening the app now asks for your own battles on the live lane, so
the app feels live without a second mechanism.

## What changed

- **`POST /api/me/refresh`** (`services/web-api/src/routes/refresh.mjs`,
  rules in `src/own-refresh.mjs`). A person's own write: the contract
  header is required, an agent gets 403 `not_entitled`, and the route is
  not in `AGENT_SCOPED_ROUTES`. It asks `liveFetch` for a recording
  `player_battlelog` read of the account's verified primary, then its
  verified alts, three at most. Answer: `{ queued, players: [{ tag, state,
  retry_after_s? }] }`, `state` one of `fresh` (read in the last two
  minutes; nothing minted), `queued` (a read is minted or already open),
  `skipped` (the floor, the bucket or the allowance said no, or the player
  is not recorded). Every refusal is a 200 with `queued: false`.
- **The floor.** One ask per account per five minutes, across every tab
  and device: a conditional `update account set own_refresh_at = now()`
  (migration 0271). Six concurrent asks mint once; the test pins it.
- **The charge.** Each mint takes one token from the one global bucket
  (`takeLiveToken`, inside `liveFetch`), then one from
  `refreshday#<account>`, a UTC-day bucket the size of the person's live
  quota (`liveBudgetFor`: member 20, leader 100, family 250, partner 1000,
  owner and admin unlimited). With no token nothing is minted and nothing
  is charged; with the allowance spent the token goes back. A mint that
  joined an open job gives its allowance back.
- **`GET /api/me/refresh`**, the page's poll: per player `{ tag, read_at,
  pending }` and `feed_current`. When a read landed after Home's stored
  week was built, it wakes one rebuild through the timeline-sync outbox
  with `since` (id `home.<account>.since.<ms>`, so once per read), and
  `refreshHomeWeek` no longer keeps a fresh row built before `since`.
- **The app** (`apps/web/src/lib/own-refresh.js`) asks once when a
  signed-in app with a verified player of its own starts, again after
  five minutes or more hidden, when the freshness chip is opened, and when
  the person's own player page or the highlight composer opens. A queued
  read is polled at the lane's `retry_after_s` (clamped to 5 to 60 s),
  four times at most, never while hidden; once it lands, Home, player
  pages and their games are read again. Nothing blocks a render or shows
  an error.
- **The chip** (`FreshChip`) says "Checking for new battles…" while a
  read is on its way, and its "N min ago" now moves on every 30 seconds
  while the page is open (it used to stop at the age of the first render).

## Any player's page: Check for new battles

Added in the same pull request at the lead session's ask: a button on
every player page that asks for a fresh read of that player.

- **On your own player** it is your own refresh, the chip's action.
- **On anyone else** it is `POST /api/me/refresh` with `player_tag`:
  one recording `player_battlelog` read on the live lane. A log read in
  the last two minutes answers `fresh`, and a read already open answers
  `queued`; neither spends anything. Then, in the database: one ask per
  account per player per two minutes (a `refreshone#<account>#<tag>`
  row in `rate_limit`, keyed by the two-minute slot and inserted once, so
  taps at once pass once; across a slot's edge the first tap's read is
  still open and the second joins it), the global token, 10 an hour
  (`refreshother#<account>`) and then the person's live quota itself
  (`liveday#`), as any deliberate live read. A refusal gives back what it
  took. `GET /api/me/refresh?player_tag=` is its poll.
- **10 an hour** is half a Member's live quota (20 a day): a Member's day
  lasts at least two hours of tapping, and a Leader's 100 cannot go in one
  sitting. An account whose live quota is unlimited (owner, admin;
  `liveBudgetFor`) is not held to it either, as every per-account live
  allowance treats it; the two-minute floor and the global bucket still
  hold for everyone.
- **A player Elixir does not know** answers `skipped` and reads nothing.
  The page itself already says "Elixir has not recorded this player" with
  Follow, which is the way to start recording (the first read,
  `requestFirstRead`, runs on a follow); the button is not drawn there, so
  there is no second path.
- **What a one-off read stores.** The same as any recording live read:
  the receipt (kept 28 days), the payload in the archive (its S3
  lifecycle), the battles with both sides (kept a year by battle time,
  like every battle), name stubs for the players in them, and a
  `poll_state` row. The scheduler plans only players someone records or a
  recorded clan's members, so the `poll_state` row starts nothing. The
  player stays a ghost (no recording), so the ghost-player rule (metrics
  count recorded players only) holds without change; no retention rule
  needs changing.
- Button words: "Check for new battles", "Checking…", "Updated just
  now", "Try again in N min". It is a full-size `btn` (44 px), keyboard
  reachable, its words its label, in a polite live region.

## Why its own allowance

The live quota (`liveday#`) is only spent by an agent's or a person's MCP
live reads. Verification (`routes/verify.mjs`) and Clan's live reads are
unmetered, so they cannot be starved. Sharing `liveday#` would let opening
the app spend a member's 20 a day before their agent asked for anything:
an ask can mint up to three reads every five minutes. So the refresh has
its own day bucket of the same size, and no existing number moved. To
share instead, change `REFRESH_DAY` to the live quota's bucket. [engineering]

## Decisions taken mid-build [engineering]

- Verified players only, the primary included. An unverified claim is a
  tag anyone can type; reading it on someone's behalf is a follow's job.
- A player with no comprehensive recording is skipped, as the first read
  is: the refresh reads only what Elixir records for you already.
- Home's stored week is rebuilt on a landed read rather than its 15
  minute freshness being shortened for everyone.

## Not built

Refreshing the people you follow. Each followed player costs about 21
fetches a day on the schedule (#760). Refreshing your five most-followed
on every ask would add up to five live reads an ask: at about four asks a
person a day, 20 reads a person, 6,000 a day for 300 people, most of the
live share (about 8,640 a day). Not built as an automatic read; the
button above is the deliberate one-player version.

No new CR endpoint, scheduled job, SQS queue or analytics event.

Migration 0271. MCP 13.1.1 and JSON API 5.1.0 unchanged.
