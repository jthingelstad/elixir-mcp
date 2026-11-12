# The bell reads a stored week (#649)

2026-11-12, round two of the feed-speed work.

## Before

`GET /api/me/bell` built the last seven days of the account's own
verified players with the timeline builder on every read, to find the
items other people cheered. Over three days (`npm run web-latency -- --days 3`)
it took p95 12,064 ms, n 32, ten reads past 3 s. The bell sits on every
signed-in page.

## What changed

`bell_week` (0247) keeps that build per account, the way `home_feed`
(0245) keeps Home's week:

- A read with no row, a row whose own players differ (`own_key`), or a
  row older than three hours builds now and stores it.
- A read of a row older than fifteen minutes is served and wakes the
  timeline-sync lane, which rebuilds it (`refreshHomeWeek` refreshes the
  bell row first).
- Highlights and attested facts are read live over the row, as Home
  does: a post, an edit or a removal shows at once. Cheers, followers and
  answers are always the read's own.

Home's week is not the bell's: it is capped and holds only notifying
claims, so the bell keeps its own row.

## What a reader sees differently

An item the builder makes from battles recorded after the row was built
(at most about fifteen minutes, three hours if no one reads) cannot
gather its cheers in the bell until the row is rebuilt. Cheers on items
already in the row show at once. The Actions item is read live from
`/api/me/home/needs` and is not part of this row.

`{account_remove}` deletes the row with the account's others.
