# 2026-11-24: The stored Timeline, stage 3, the player page reads the rows

Stage 1 (`docs/notes/2026-11-23-timeline-story-store.md`) stored each
recorded player's stories, and stage 2
(`docs/notes/2026-11-23-timeline-story-fresh.md`) kept them fresh. This
stage serves them: the player page, its games' read and its session
read take a player's stored stories when the store can prove them
current, and compute exactly as before when it cannot. Players only.
`elixir_timeline` (MCP) and clans still compute.

## What changed

- **The store holds every recorded player.** `RECORDED_PLAYERS_SQL`
  (`packages/tools/src/recorded-players.mjs`, re-exported from
  `tools/shared.mjs`) is a direct active recording, or an open member of
  a clan recorded at comprehensive scope. The sweep and the staleness op
  (`story-store.mjs`), the admission's wake (`story-wake.mjs`, one
  indexed statement) and the backfill op all read it. An activity-scope
  clan (the automatic follow of a primary's clan) polls only its roster,
  so its members are not in the set. A member who leaves drops out of the
  set; their rows stay until the daily trim.
- **A return is told at every return.** `returned` was built only at the
  window's first battle, so a 35-day write and a 7-day read disagreed
  about a return in the middle of the span. Now every timely battle after
  a gap of seven days or more since the player's previous battle is a
  `returned` story, with the same id (`moment("returned", tag, at)`) and
  facts (`after_days`). Candidates are only the battles whose previous
  timely battle in the window is seven days back; each is confirmed by one
  single-row query. The entry's `presence.returned_after_days` is still the
  first battle's. The shadow no longer labels `returned` as `window`.
- **The reader.** `readSubjectStories(db, "player", tag, { fromMs, toMs,
  visibilities, now })` in `story-store.mjs` answers the rows whose
  `sort_at` lies in the window and whose visibility is one asked, newest
  first, each back under its symbols (`restoredItem`), or a refusal (below).
- **The page's timeline from rows.** `storedTimeline(db, tag, items,
  options)` in `entries.mjs` finishes stored items with the same tail
  `buildTimeline` uses (`tellItems`, `finishTimeline`: the told ids, the
  filter, the sort, the cap and `finishItem`). What the store never
  holds it reads live, as the computed page does: the player's
  verification (`people`, one query), and the player's Drop games when a
  signed-in reader may see them (`pageGameReader`).
- **A verification is never stored.** A `player_verified` item tells an
  account's claim and that account's identity. Its owner can remove the
  claim or delete the account at any time, and no probe sees either, so a
  stored copy would have said "verified" for up to six hours after.
  `unstored` in `story-store.mjs` keeps every people item out of the
  write, the read and the shadow's comparison; a row written before this
  change is skipped by the read and deleted at the player's next write.
- **One order.** Stored rows carry no build order, so two stories at the
  same instant could swap between a stored and a computed page.
  `finishTimeline` now sorts every timeline, built or stored, by `sort_at`
  newest first, then by `at`, then by id. Only the order of exact ties
  changed, for every door that reads the builder.
- **One door function.** `pageTimeline` in
  `services/web-api/src/routes/player.mjs` is what the page
  (`GET /api/player`), its games' read (`GET /api/player/evidence`) and
  its session read (`GET /api/player/session`, and signed out through
  `readSitting` for a shared sitting) all call. With the switch on it tries
  the stored read first, in its own transaction under a 500 ms statement
  timeout (`STORY_READ_MS`), and computes on any refusal or error. So the
  three doors choose the same way, and an item's id and evidence version
  agree between them.
- **The switch.** Stack parameter `TimelineStoryRead` (`on` by default,
  classed in `infra/scripts/parameters.mjs`, so a deploy never resets it)
  sets `TIMELINE_STORY_READ` on the web-api function. `off` computes every
  read and logs nothing new. The web app is unchanged.
- **The shadow keeps comparing.** With both switches on and the page
  served from rows, the page also computes, for the shadow alone, and the
  summary says `served: "stored"` (or `"computed"`). A stored page compared
  with itself would prove nothing.

## When the read computes

| Reason | Meaning |
| --- | --- |
| `unwritten` | No `timeline_story_subject` marker: never written, or outside the stored set. |
| `stale` | The write is older than the six-hour floor plus a 30-minute margin (`STORY_READ_MARGIN_MS`): the player left the set, or the sweep is not running. |
| `news` | The record learned something the stored kinds can tell since the write (`subjectNews`: `timelineNews` over the stored kinds). A read right after a live fetch or an admission computes. |
| `open` | A stored sitting in the window says `open` and its last battle is over 31 minutes old: the clock closed it and no write has yet. |
| `error` | The read failed or ran past 500 ms. The line carries the error's class (`57014` is the timeout), never its message. |

## Accepted as stored

- **The stored telling is canonical.** Rows are taken by `sort_at` as the
  35-day write told them, never re-cut to the read's window, so the
  window-edge differences stage 2 listed stop being differences.
- **`days_since_poll`** on a stored `quiet_crossed` item is the write's,
  in whole days and at most the floor old, and is served as stored.
- **A profile-only change** (a name) waits for the floor when no wake was
  written: no probe sees it.
- **The cap.** The page's cap (150) counts what the rows tell. A battle
  highlight is never stored, so the stored page's `timeline_more` never
  counts one. The page drops highlights anyway (a post about a battle is
  the Posts list's), so this differs only past the cap.

## The log line

One line per read while the switch is on, from whichever door (made-up
values):

```json
{"at":"timeline_story_read","door":"page","source":"stored","reason":null,"stories":38,"ms":9}
{"at":"timeline_story_read","door":"session","source":"computed","reason":"news","stories":0,"ms":4}
{"at":"timeline_story_read","door":"evidence","source":"computed","reason":"error","error":"57014","stories":0,"ms":502}
```

`door` is `page`, `evidence` or `session`; `stories` counts the rows
served (0 when computed). No tag, id or value.

How often each door is served from rows, and why not:

```
filter @message like /timeline_story_read/
| stats count(*) as reads by source, reason, door
| sort reads desc
```

What the stored read costs against the computed fallback:

```
filter @message like /timeline_story_read/
| stats pct(ms, 50) as p50, pct(ms, 95) as p95 by source, door
```

With the shadow on, whether stored pages still agree:

```
filter @message like /timeline_story_shadow/ and served = "stored"
| stats sum(only_computed) as oc, sum(only_stored) as os, sum(revision) as rev, sum(content) as ct
```

## Stage 4

- The observed basis that MCP's `elixir_timeline` reads: rows are cut by
  `sort_at` (when it happened), and `observed` windows select by
  `observed_at`.
- Clans, still waiting on their reader-dependent scope.

No migration, and no MCP or `/api/v1` contract change. One new stack
parameter and environment variable; no new IAM or AWS resource.
