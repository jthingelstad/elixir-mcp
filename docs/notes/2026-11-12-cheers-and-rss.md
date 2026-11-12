# 2026-11-12 — Cheers on the feed, and your timeline's RSS link

Social slice 7 (#765, tracker #752), second of two pull requests; the first
(feed, sparklines, navigation) is `2026-11-12-home-feed.md`. Jamie's ruling,
asked and answered on 2026-11-12: "Slice 7, Home: one feed with chips
Everyone, Friends, Clan and You, session sparklines, a new top bar and phone
tabs (Home, Find, Clan, You, bell) replacing Home's three tabs, and
reactions. Which reactions?" — "Yes, six cheers (Recommended)". The RSS
link is DECISIONS "Your timeline is an RSS feed" [Jamie, 2026-11-11].
DECISIONS: "Reactions, not comments" and "Your timeline is an RSS feed", each
with an [engineering, 2026-11-12 (#765)] tail. Briefs: `docs/product/home.md`,
`structure.md`.

## What changed

- **Migration 0243, expand only.** `timeline_cheer` (account, item id,
  cheer; primary key account and item, so one per person per item; the
  cheer checked against the six keys; an index on the item) and
  `timeline_feed_link` (account, the token's SHA-256, unique). Nothing
  reads or drops an existing table.
- **Cheers.** `PUT /api/me/cheers` (`services/web-api/src/routes/cheers.mjs`,
  logic in `src/cheers.mjs`) takes `{ item_id, cheer, subjects }`: a cheer
  sets or changes yours, `null` takes it back. The contract header is
  required, an agent is refused (`not_entitled`) and the route is not in
  `AGENT_SCOPED_ROUTES`; 120 an hour on `cheer#<account>`. A cheer is stored
  only when the item is in the person's own feed now: the server rebuilds the
  last seven days for the item's subjects the account follows (one to a few,
  never the whole feed) and looks for the id. Taking one back needs no check.
  The answer is the item's counts and `my_cheer`.
- **Counts on the feed.** `GET /api/me/timeline` adds `cheers` (nonzero
  counts by key) and `my_cheer` to each item but the account's own
  (`section: "account"`), in one grouped query. Item ids are the story id of
  the happening, never of the reader, so every reader counts the same. An
  agent's pages read the same route (counts, `my_cheer` null), but its
  Timeline page (`views/account/Timeline.jsx`) draws no cheers; should
  `Cheers.jsx` ever render under an agent's scope it shows the counts
  read-only.
- **The page.** `apps/web/src/home/Cheers.jsx` under each item that carries
  `cheers`: a chip per cheer the item has (count, pressed when yours), Cheer
  opening the six, "You and 2 others" / "3 people", an alert when a
  cheer is not saved, and one write at a time per item (its chips wait for
  the answer, so answers never land out of order). `useCheer` (`lib/queries.js`) shows the change at once
  and puts the server's counts, or the old item back on a failure.
- **The RSS link.** `GET|POST|DELETE /api/me/rss` read, make or reset, and
  turn off the link (resets 10 an hour on `rsslink#<account>`). The token is
  24 random bytes, base64url; only its SHA-256 is stored, so POST's answer is
  the one time the link is shown. `GET /api/rss/<token>.xml` serves RSS 2.0:
  the owner's last seven days, read non-interactively (no leaders-only
  facts), without the account's own items, newest 50, each item's `guid` its
  story id. Names are game names (never the account's nicknames) and every
  string is XML-escaped; the channel carries the Supercell disclaimer. A token
  that opens nothing is a plain 404; 60 reads an hour on `rss#<account>`;
  `cache-control: private, max-age=300`, `x-robots-tag: noindex`. It lives
  under `/api/` because the distribution has no cache behaviour left, and
  `/api/*` caches nothing at the edge, so a reset or turn-off stops the link
  at once.
- **Settings.** Connections & agents has a Your RSS link panel (Make my link,
  then Reset link and Turn off, each confirmed). What members see says who
  sees a cheer and who holds the link, and links Connections.
- **Account removal.** `ops-account-remove` deletes both tables' rows.
- **Public boundary.** `GET /api/rss/*` is classed "private link": no session,
  the token is its credential.

## Defaults taken [engineering]

The link shown once (a fingerprint only); the panel on Connections rather
than What members see, which holds no controls; no cheers on the account's
own items; a cheer only on an item in your feed now; the limits (120 cheers,
60 feed reads, 10 resets an hour); the feed's 50 items and seven days; cheers
on Home's feed only.

## Open

- Cheers on the player page and the battle page, which the canvas draws.
- The canvas's bell shows "Reactions to your items"; the bell carries none
  ("Home is one feed" says so). A product call.
- Whether the link should be shown again later, which means storing it.
- `/api/me/home/latest` and `/api/me/home/friends` stay for bundles still
  open from before the first pull request; a follow-up removes them.

MCP and the JSON API unchanged.
