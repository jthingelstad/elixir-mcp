# 2026-11-27 — The stored Timeline, stage 6: Home's clans from stored stories, compared in shadow

Stage 4 (`docs/notes/2026-11-25-timeline-story-build.md`) took Home's
followed players from `timeline_story` rows. Stage 5
(`docs/notes/2026-11-26-timeline-story-clans.md`) wrote each followed
clan's stories as rows and compared them with a build, serving nothing.
This stage lets Home's stored week take its followed clans' stories from
those rows too, and build only the clans the rows cannot answer. It
ships in compare-only mode: Home is served exactly what stage 4 serves,
and the lane logs how a week with clans from rows differs.

## What changed

- **One clan reader.** `readClansStories(db, tags, { fromMs, toMs, basis,
  now, statementMs, probesMs })` in `story-store.mjs` answers a Map of
  tag to `{ ok: true, items, written_at }` or `{ ok: false, reason }`.
  It is the players' code (`readStories`) with `kind: "clan"`: one
  marker statement, one news probe a clan (`clanNews`), one row select
  for every clan served. The rows are every row whose `observed_at`
  column is after `fromMs` (the superset stage 5 stores), restored and
  not cut. `readClanRows`, stage 5's write-time read, is the same code
  with only `unwritten` and `span` asked.
- **A seam in the builder.** `buildTimeline`'s option `storedClans: {
  read, now }` reads the clan subjects through `read` before the loop. A
  clan answered `ok` is not built: its items are its window cut for the
  subject's scope (`clanWindowItems`, stage 5's cut), at the clan's place
  in the loop, with its `more` and `dropped`, and it has no entry.
  Refused clans are built as before. Players, people items, highlights,
  attested facts, `tellItems`, `mergeStories`, the sort and the cap run
  over the combined items as before.
- **A member's own view never reads clan rows.** With `memberTag` set,
  the read is not called and every clan is counted `member`.
- **Bounded.** The clan read has its own 500 ms statement budget and its
  own 1.5 s of news probes, beside the players' read. Any error builds
  every clan, counted `error` with the error's class.
- **Kept apart.** The clans' counts are `finished.stored_clans`, and
  which clans were served and when each was written is
  `finished.stored_clans_written`: Maps of their own, keyed by clan tag,
  never shared with the players' (a player's and a clan's tag can be one
  string).
- **The switch.** Stack parameter `TimelineStoryBuildClans` (`off`,
  `shadow`, `on`; default `shadow`, classed PRESERVED in
  `infra/scripts/parameters.mjs`) sets `TIMELINE_STORY_BUILD_CLANS` on the
  same two functions as `TIMELINE_STORY_BUILD`: timeline-sync and the web
  API. `storyClansBuildOf` reads it at each edge; anything else is `off`.
  It is read only while `TimelineStoryBuild` is `on`; otherwise it is
  `off` whatever it says.

## When a clan is built

| Reason | Meaning |
| --- | --- |
| `unwritten` | No clan marker in `timeline_story_subject`. |
| `stale` | The write is older than the six-hour floor plus 30 minutes. |
| `span` | The window starts before the 8 days the write covered. |
| `past` | The window ended more than a minute before `now`. |
| `basis` | The window is not observed. Only observed weeks were compared in stage 5; Home reads observed. |
| `budget` | The news probes used their 1.5 s before this clan. |
| `news` | `clanNews` found something learned since the write. |
| `open` | A stored standout says its sitting is open, and its last battle is 30 minutes old or more: the clock closed it and no write has yet. |
| `member` | A member's own view (`memberTag`): never from rows. |
| `error` | The read failed or a statement passed 500 ms. Every clan is built. |

Clan rows can carry `open`: a standout's facts are its sitting's
(`sessionFacts`), `open` included. So the read refuses it as the
players' read refuses an open `battle_session`. The sweep wakes such a
clan first (`clansToWake`'s `open` count, before `unwritten`), and the
staleness op counts them as `clans.open_quiet`.

## The modes

| Mode | What is stored | What else runs |
| --- | --- | --- |
| `off` | stage 4's week: players from rows, clans built | nothing |
| `shadow` | the same week | after the store, a second build with clans from rows too, compared with the first; anything it throws is a count |
| `on` | the week with clans from rows | nothing |

The shadow is the lane's alone. A build on read stores stage 4's week in
`shadow` as in `off` and logs no clan line. In `on` a build on read
stores the week with clans from rows and logs its line with `door:
"home_read"`.

## The comparison

`compareWeeks` (stage 4's) compares the two finished timelines by item
id. Both builds read players' rows, moments apart, so a difference can be
a player's rows moving between them. A difference is a clan's only when
its id is one a clan subject told: each build records, per clan, the ids
its items carried before any merge (`finished.clan_told`, asked of the
first build by `clanTold`). The causes:

- **`not_clan`**: no stored clan told it: a player's copy, a people item,
  or a clan that was built in both.
- **`unwritten`**: learned after that clan's write (the earliest write,
  when several stored clans tell it): a news probe that missed it.
- **`cap_edge`**: at the 150 cap, one build's last items can be the
  other's first dropped.
- **`observed_basis`**: it sorts before the week. Kept from stage 4's
  comparison; no kind is labelled by kind alone, since a clan row keeps
  each kind's observed instant (`_superset`).
- **`window`**: a story within two days of `from`.
- **`settled`**: none of these. This is what must be explained before
  `on`.

What a cut from rows can still differ by, and the shadow will show as
`window` or `settled`:

- A quiet crossing's `days_since_poll` and silence are the write's.
- `collapseRepeats` and `tellBadges` ran over the write's 8 days, not 7.
- Rows are ordered `sort_at desc, story_id`, which can break a tie
  differently from a build's order before `collapseRepeats`; the finished
  order is total, so only which repeat is kept can move.
- `week_resolved`'s members are the write's current `war_participation`.

## The log line

`home_feed_story_build` is unchanged. A new `home_feed_story_clans` line
is logged per build of the lane in `shadow` or `on` (`door:
"home_sync"`), and per build on read in `on` (`door: "home_read"`).
Made-up values:

```json
{"at":"home_feed_story_clans","door":"home_sync","mode":"shadow","clans_stored":2,"clans_computed":{"unwritten":1},"read_ms":21,"base_ms":1210,"mixed_ms":340,"diff":{"computed":150,"mixed":150,"only_computed":0,"only_mixed":0,"revision":0,"content":0,"order_same":true,"ids":{"only_computed":[],"only_mixed":[],"revision":[],"content":[]},"groups":[],"groups_cut":0}}
{"at":"home_feed_story_clans","door":"home_sync","mode":"on","clans_stored":0,"clans_computed":{"error":3},"read_ms":503,"read_error":"57014","build_ms":1320}
{"at":"home_feed_story_clans","door":"home_sync","mode":"shadow","base_ms":1180,"mixed_ms":12,"failed":"XX001"}
```

No tag, account, name or item content: counts, ms, story ids, kinds and
field names.

How much of a week the clan rows answer, and why not:

```
filter @message like /home_feed_story_clans/
| stats sum(clans_stored) as stored, sum(clans_computed.unwritten) as unwritten,
        sum(clans_computed.news) as news, sum(clans_computed.open) as open,
        sum(clans_computed.error) as errors
  by mode
```

Whether it agrees, by cause:

```
filter @message like /home_feed_story_clans/ and mode = "shadow"
| stats sum(diff.only_computed) as oc, sum(diff.only_mixed) as om,
        sum(diff.revision) as rev, sum(diff.content) as ct,
        sum(diff.order_same = 0) as reordered, count(*) as builds
```

What it would save:

```
filter @message like /home_feed_story_clans/ and mode = "shadow"
| stats pct(base_ms, 50) as base_p50, pct(mixed_ms, 50) as mixed_p50,
        pct(read_ms, 95) as read_p95
```

## Switching on

After a clean day of `settled` at zero, with `TimelineStoryBuild` at
`on`:

```
AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs --param=TimelineStoryBuildClans=on
```

A deploy never resets it. `off` goes back the same way.

## What is not in this stage

`elixir_timeline`, the bell's week, RSS, cheers and a member's own clan
view still build their clans. Clan writes, the sweep's order and the
wakes are unchanged, apart from the sweep taking an open clan first. No
migration, and no MCP or `/api/v1` contract change (the tool fingerprint
does not move). One new stack parameter and environment variable; no new
IAM or AWS resource.
