# 2026-11-12 — Home's week is stored (#649)

Home's feed built the last seven days of every followed player and clan on
each first page. Jamie's bar (2026-11-12): Home ready in under 2 s at p95,
no 504s in a week. Migration 0245; MCP and the JSON API unchanged.

## Where the time went

`npm run web-latency -- --days 3` (Nov 9 15:06 to Nov 12 15:06 CT):
`GET /api/me/home/feed` p95 15,151 ms (n 3, new that morning),
`GET /api/me/timeline` p95 17,101 ms with three timeouts,
`GET /api/me/home/latest` p95 16,223 ms.

`{explain_timeline}` for the heaviest account (55 players, 3 clans), its
seven days at 15:07 CT: 12,284 ms, 10,499 ms of it in the database. The
batched player read (`players.batch`, the per-tag lateral form) 6,820 ms;
the ledger 874, presence 515, sittings 298; the clan entries' member
battles 559, quiet gaps 400, members 269. The cold run at 13:58 CT was
18.3 s. Replayed warm, the same statements are a fraction of that: the
time is cold I/O. The instance is a db.t4g.micro (shared_buffers 180 MB,
about 100 MB freeable) and `battle_participant`'s indexes alone are
264 MB, so a week of 55 players does not stay cached between visits.

Computing on read cannot reach 2 s on this instance, and Jamie's ruling
allows a stored feed when it cannot.

## What changed

- **`home_feed` (0245):** one row per account, the builder's finished week
  (`accountLines: false`, as Home read it), its window, when and how long
  it took, the time zone and a digest of the subjects it was built for.
  The two server-only fields (a sitting's sparkline, an item's evidence
  source) are kept as `_spark` and `_evidence_source` and restored under
  their symbols on read; JSON never serves them.
- **The read** (`readHomeWeek`, `packages/tools/src/activity/home-feed.mjs`)
  serves the row when its subjects digest and time zone match and it is no
  older than three hours. Past fifteen minutes it also writes a wake.
  With no row, a changed subject list (follow, unfollow, notify, nickname),
  another time zone or a row past three hours, it builds as before, stores
  and serves. An older build never replaces a newer one.
- **Live over the row:** highlights (one statement over `battle_highlight`)
  replace the stored copies, so a post, an edit or a removal shows at
  once. Cheers, the chips' counts and the **New** marker were already the
  read's own.
- **More and evidence** read the stored row when it is the week the first
  page named; if the row has since been rebuilt, that week is built again
  (the old 90 s memo).
- **The background build:** a `{ v: 1, home_feed: <account> }` object on
  the outbox's `timeline-sync/` lane; the timeline-sync Lambda builds and
  stores the week, skips a row younger than fifteen minutes, and logs and
  drops a failure (never retried; the next wake or read builds it). Wakes
  come from a read past fresh and from a new five-minute rule
  (`elixir-mcp-home-feeds`, jobs `{ home_feeds: true }`) for accounts that
  read Home in the last three days, ten a run, oldest row first. One wake
  object per account a quarter hour. No new queue or IAM.
- `{account_remove}` deletes the account's row.

## The trade

The newest battles reach Home up to about twenty minutes late (fifteen
minutes fresh, the five-minute rule, the queue's one-minute delay, the
build). The docs (`/docs/timeline`) and What's new say so. Nothing changes
what an item says or who may see it: the items are the same builder's, for
the same reader, and any change to whom the account follows rebuilds.

DECISIONS "Whether the timeline is stored is a performance choice"
[engineering] now has its answer for Home; the line is the rulings
session's to update.

Not changed: Settings › Timeline, the bell, `/home/latest` (no caller
since the one-feed Home, 3566a824), `elixir_timeline` and the clan feed
still build on read.
