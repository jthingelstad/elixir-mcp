# 2026-11-23: A Timeline read reaches back one week

The owner, on the Timeline's look-back: "we would answer timeline by
either count or time, and I think that the timeline in the product
experience should have the same look back as the MCP endpoint… to me it
feels like AT MOST 1 week of events."

What changed:

- **One constant.** `TIMELINE_LOOKBACK_DAYS = 7` in
  `packages/tools/src/activity/lookback.mjs`. Home's week, the player
  page (`PAGE_DAYS`), the account page (`ACCOUNT_PAGE_DAYS`), the clan's
  Timeline (`FEED_DAYS`), the personal and clan Discord cross-posts'
  reach (`REACH_MS` in `packages/syndication`) and `elixir_timeline` all
  read it. The player and account pages went from 30 days to 7; the
  cross-posts' reach went from 30 days to 7; Home and the clan's
  Timeline were already 7.
- **`elixir_timeline`.** An older `from`, or a read pointer older than
  the week, is held to it (a minute's grace stays silent, so a caller's
  "exactly a week" on its own clock reads whole) and a note names the
  data tools. A window whose `to` is a week ago or earlier, a closed
  season included, is refused as `bad_request`, with the data tools in
  the hint. Evidence reads go through the same window.
- **`limit`.** An optional integer, 1 to 500: the newest N items after
  `kinds`, `sections` and `player_tag`. Its cut is the busy window's:
  `has_more`, `timeline_more`, `timeline_more_to`. A read with `limit`
  never moves a pointer, so the pointer can never pass items the limit
  left out; `limit` with `mark_read: true` is refused.
- **Not a look-back.** An item's permalink (up to a year), a session's
  page (`SESSION_REACH_DAYS`, 30 days) and the stored Timeline
  (`STORY_SPAN_DAYS`, 35) keep their reach. The data tools' windows are
  unchanged.
- **Acceptance.** A Gym case whose timeline read starts before the week
  is skipped live and said aloud (`pastTheWeek` in
  `acceptance/gym-interp.mjs`); a bite still replays it.

Known consequences:

- **Award standings over MCP.** `award_standing` facts are written only
  when a member's place is new or moves (`packages/clan/src/manage/standings.mjs`),
  and the timeline is the only MCP read that carries them. A member whose
  place has not moved in a week is therefore no longer in a timeline read.
  The Discord agent's ask routine read a season's standings this way; its
  instruction now says the timeline carries the week's standing changes
  and that a season's totals come from `clans_participation`. Whether
  Elixir should serve current award standings as a read of their own is
  open (a GitHub issue).
- **Live Gym coverage.** The Gym cases filed with windows before the week
  replay as bites only.
