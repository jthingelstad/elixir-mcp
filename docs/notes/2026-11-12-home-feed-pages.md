# 2026-11-12 — Home's feed: thirty a page, players read together (G1)

G1 of the side-by-side walk: Home's feed was slow and sometimes never
loaded. A busy account's seven days were up to 150 items, built serially,
one subject after another (about fifteen statements a player), and the
client retried a timed-out read, so a 504 at the 18.5 s deadline became a
blank box for most of a minute.

- `GET /api/me/home/feed` answers thirty items a page (`FEED_PAGE`), with
  `total`, `next` (an opaque cursor naming the week and the offset) and,
  on the first page only, `counts` for each chip across the whole week and
  `new` since the timeline's seen marker. `cursor` reads on in the same
  week; a cursor the server did not make, or wider than seven days, is
  400 `invalid_cursor`. Chips, sparklines, battle links and cheers are
  added to the page's items only.
- A built week is kept 90 s per instance for the reads that name its
  window: More and an item's evidence. The first page always builds
  fresh, so a post or a cheer shows at once.
- An item's evidence (View games, View crossing) is read from the feed's
  own week, `GET /api/me/home/feed?evidence_item_id=…`: Home's week leaves
  the account's own lines out, so the timeline's evidence read could lack
  an item a busy week pushed past its cap (Codex on #795).
- `buildTimeline` reads every player subject's battles, the snapshots
  either side of the window, deck identities and event titles in one
  batch (`players.batch`, `prefetchPlayers`), then builds each entry from
  it. Each entry is the one its player reads alone (pinned in
  activity-entries.test.mjs). On by default (`batchPlayers`), so
  `elixir_timeline` and `/api/me/timeline` gain it too, with the same
  output.
- `clan.learned` (observed basis): the narrated count reads the clan's own
  `(clan_tag, battle_time)` range and asks each battle's primary key when
  it was learned; the late count asks participants only for late
  captures. The per-battle probe of every battle learned in the window
  made a 30-day read 4.2 s (#649). Its plan is pinned in
  clan-learned-plan.test.mjs.
- The web app reads the feed as pages (`useInfiniteQuery`), shows More with
  "N of total shown", and does not retry on its own: a failed read says
  "Your feed didn't load" with Try again.

MCP and the JSON API unchanged.
