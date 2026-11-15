# Home's "N new" pill (2026-11-14)

The owner's feedback close-out, item 4: on Home, a pill appears when new
feed items have arrived; tapping it loads them; nothing moves under the
reader. It must be a cheap count or newest-id probe, paused while the tab
is hidden, within route budgets that tests pin.

## What was there

The feed (`useHomeFeed`, an infinite query on `["me", "home", "feed"]`)
refetched every loaded page on window focus once 60 s stale, and again
when your own battles landed (own-refresh's `LANDED_KEYS` include
`["me", "home"]`). Either could reflow the page under a reader who had
scrolled.

## What changed

- **The probe.** `GET /api/me/home/feed/new?since=<ISO>` answers
  `{ new, built_at }`: how many of the stored week's items (`home_feed`)
  sort after `since`, the newest item the feed shows (`sort_at`, else
  `at`, the feed's own order). One statement on the account's one row,
  after the session's two; never a build, never a record table. Pinned
  in `services/web-api/test/signed-in-budget.test.mjs` (3 statements, 80
  shared buffers, no bounded table scanned; 31 buffers on the synthetic
  record) and by `home.test.mjs` (counts, a sitting by its last battle,
  no row is 0 and builds nothing, a bad `since` is 400, signed out 401).
  `since` must be within two weeks back and not past now plus a minute.
- **Freshness comes from the wake, not the probe.** The five-minute
  timeline-sync run already rebuilds the row of anyone who read Home in
  the last three days once it is past FRESH, so the count follows the
  record within about twenty minutes without the probe waking anything.
- **Not counted:** highlights and attested facts, which the feed reads
  live over the stored items. Counting them would cost the heavy
  `windowHighlights` read a minute per open tab. A new highlight shows at
  the next read of the feed. [engineering]
- **The client.** `useHomeFeedNew(since)` polls once a minute
  (`FEED_NEW_POLL_MS`) with `refetchIntervalInBackground: false`, so
  TanStack holds it while the tab is hidden, and asks again on focus. The
  feed no longer refetches on focus. Own-refresh landing skips an
  *active* feed query (`notOpenFeed`) and asks the count instead (its key
  is under `["me", "home"]`); a feed nobody has open is marked stale as
  before. The pill floats in a zero-height sticky row (the grid gap given
  back), so it moves nothing when it comes or goes. Its tap lets go of
  pages past the first, refetches the first, scrolls the feed's top into
  view (instant under reduced motion) and puts focus there.

## Words

- The pill: "N new" (for example "1 new"), its accessible name
  "Show N new item(s)".
- Docs: The timeline (Home's feed) and Freshness and gaps (your own
  battles on Home).

## Product questions

- Should the pill also count a new highlight? Left out for cost; asked
  here, not built. [engineering]
- The count includes a sitting that grew (more battles in the same
  sitting moves its `sort_at`). That is new games, so it counts.
  [engineering]

## Tests

Unit: `apps/web/test/home-feed-new.test.jsx` (the count's `since`, the
pill and its tap, landing asks the count not the feed). e2e:
`apps/web/e2e/home-new-pill.spec.ts` at 320, 390 and 1280 (nothing moved,
no feed read until the tap, no count while hidden, first page alone on
the tap, focus at the top, axe, nothing sideways).
