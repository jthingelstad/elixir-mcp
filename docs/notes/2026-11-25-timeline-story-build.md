# 2026-11-25: The stored Timeline, stage 4, Home's week from stored stories

Stage 3 (`docs/notes/2026-11-24-timeline-story-read.md`) served the
player page from `timeline_story` rows. This stage lets Home's stored
week (`home_feed`, built by `buildHomeWeek`) take its followed players'
stories from the same rows, and build only what rows cannot give. It
ships in compare-only mode: Home is served exactly what it was, and the
lane logs how the stored mix differs.

Home's week is rebuilt in the background about 200 times a day, at p50
1.5 s and at most 3.3 s, reading seven days of every followed player and
clan each time. Its item count sits at the 150 cap.

## What changed

- **One reader for both doors.** `readPlayersStories(db, tags, { fromMs,
  toMs, basis, now })` in `story-store.mjs` answers a Map of tag to
  `{ ok: true, items, written_at }` or `{ ok: false, reason }`. It reads
  every tag's marker in one statement and every served tag's rows in one
  more; the news probe is still one per player, one at a time.
  `readSubjectStories` (stage 3) is the same code (`readStories`) for one
  tag.
- **A seam in the builder.** `buildTimeline`'s option `storedPlayers: {
  read, now }` reads the player subjects through `read` before anything
  else. A player answered `ok` is not built and not prefetched: their
  items are `saidStories(rows)`, with the reader's nickname put back on
  each, as `buildPlayerEntry` puts it. Refused players are built and
  prefetched as before. Clans, people items (still for every followed
  player), highlights, attested facts, `tellItems`, `mergeStories`, the
  sort, the cap and `finishItem` run over the combined items as before.
  The stored items enter at their subject's place in the loop, so ties in
  the merge and the sort fall as they did.
- **Items only.** With the seam on, `entries` and `quiet` leave the
  stored players out. Home stores no entry, so Home is the only caller.
  `elixir_timeline`, the bell's week, the RSS feed's own build and cheers
  are unchanged.
- **Bounded.** `withStatementTimeout` runs the read under a 500 ms
  statement timeout. On a client with no open transaction it opens one
  (`begin`, `set_config(..., true)`, `commit`), as stage 3's page does.
  Inside a caller's transaction it uses a savepoint and puts the setting
  back, so a cancelled statement leaves the caller's transaction usable.
  It tells the two apart by `transaction_timestamp() <>
  statement_timestamp()`, which is false only for a transaction's first
  statement. The news probes stop after 1.5 s in all (`budget`). Any
  error builds every player, counted as `error` with the error's class.
- **The switch.** Stack parameter `TimelineStoryBuild` (`off`, `shadow`,
  `on`; default `shadow`, classed PRESERVED in
  `infra/scripts/parameters.mjs`) sets `TIMELINE_STORY_BUILD` on the
  timeline-sync function and the web-api function. `storyBuildOf` reads it
  at each edge; anything else is `off`.

## The modes

| Mode | What is stored | What else runs |
| --- | --- | --- |
| `off` | the computed week, as before | nothing |
| `shadow` | the computed week, as before | after the store, a second build with the seam, compared with the first; anything it throws is a count |
| `on` | the mixed week | nothing |

The shadow is the lane's alone. A build on read (a read that finds no
servable row) stores the computed week in `shadow` as in `off` and logs
nothing: a person's read never waits for a second build that only
compares. In `on` a build on read stores the mixed week, as the lane
does.

## When a player is built

The stage 3 reasons (`unwritten`, `stale`, `news`, `open`), and:

| Reason | Meaning |
| --- | --- |
| `past` | The window ended more than a minute before `now`. Rows tell the store's present. Stage 3's session read keeps serving past windows. |
| `span` | The window starts before the 35 days the write covered. Both readers ask it. |
| `budget` | The news probes used their 1.5 s before this player. |
| `error` | The read failed or a statement passed 500 ms. Every player is built. |

## What the rows give, and what stays live

Entry items are always `public` (`itemVisibility`), and `buildTimeline`
filters no visibility for Home, so the read takes `public` rows and
leaves out the `people` and `attested` sections. A people item is never
stored (stage 3), and `factItems` reads attested facts live for every
subject, as before, so a stored copy would tell a fact twice.

## Observed basis

Home reads the observed basis: what the record learned in the window.
The read selects rows by `observed_at` in `(from, to]`; the occurred basis
selects by `sort_at`, as stage 3 does. What `observed_at` holds per kind,
against what the observed build selects by:

| Kind | Row `observed_at` | The build selects by | Same? |
| --- | --- | --- | --- |
| `battle_session` | the newest `created_at` of its battles | a battle learned in the window | yes |
| ledger moments | the proof's `observed_at`, else the window's end | the same | yes |
| `clan_joined`, `clan_left` | the instant it was seen | the same | yes |
| `war_week_played` | the week's end | the same | yes |
| `week_form` | `computed_at` | the same | yes |
| `quiet_crossed` | the crossing instant | the crossing instant | yes |
| `member_role_changed` | `occurred_at`, else the window's end | the window's end | no, when it happened before `from` and was seen after |
| `returned` | the battle's time | the battle learned in the window | no, when the battle was played before `from` and learned after |

A row's `observed_at` is never before its `sort_at`, so this select is
the same as `sort_at <= to and (sort_at > from or observed_at > from)`
for every window ending now. `finishItem` marks an item `late` from its
`sort_at` as before.

## Where the mix cannot equal the build

The shadow labels each of these:

- **`observed_basis`**: the two kinds above, and anything learned in the
  window that happened before the 35-day span. Badges grouped by day
  (`tellBadges`) can split differently on a day that straddles `from`.
- **`said_gate`**: the build tells a quiet crossing when the entry says
  anything, including what is not an item (a notable, a card unlocked);
  `saidStories` keeps a crossing only beside another stored story. A
  week whose only item is a crossing, said through a notable, differs.
- **`window`**: a story within two days of `from`. Also, a moment
  written twice is told once, at its first instant: when the first is
  before the week, the week's build tells the second and the rows hold
  only the first. Far from `from`, that shows as `settled`.
- **`cap_edge`**: at the 150 cap, one build's last items can be the
  other's first dropped.
- **`unwritten`**: learned after the player's write (a news probe that
  missed it, or a race with the write).
- **`computed`**: a difference on a story no stored player tells: a
  clan's copy merged with a stored player's copy.
- **`settled`**: none of these. This is what must be explained before
  `on`.

As in stage 3, a name changed with no wake waits for the floor, and a
stored crossing's `days_since_poll` is the write's.

## The comparison

`compareWeeks` in `home-feed.mjs` compares the two finished timelines by
item id: `only_computed`, `only_mixed`, `revision`, and `content` (one
revision, another `finishedHash`: the whole finished item, the reader's
own fields included, with key order ignored). `order_same` says whether
the ids both tell come in one order. `groups` counts differences by
kind, class, cause and, for content, the field (`changedFields`).

## The log line

One line per build of the lane in `shadow` or `on` (`door:
"home_sync"`), and per build on read in `on` (`door: "home_read"`). The lane's
`home_feed_built` line no longer carries it. Made-up values:

```json
{"at":"home_feed_story_build","door":"home_sync","mode":"shadow","players_stored":11,"players_computed":{"unwritten":2,"news":1},"read_ms":38,"computed_ms":1480,"mixed_ms":610,"diff":{"computed":150,"mixed":150,"only_computed":0,"only_mixed":0,"revision":0,"content":1,"order_same":true,"ids":{"only_computed":[],"only_mixed":[],"revision":[],"content":["tl_3f9a0c1d2e4b5a6c7d8e9f"]},"groups":[{"kind":"quiet_crossed","bucket":"content","cause":"settled","field":"facts.days_since_poll","n":1}],"groups_cut":0}}
{"at":"home_feed_story_build","door":"home_sync","mode":"on","players_stored":0,"players_computed":{"error":11},"read_ms":502,"read_error":"57014","build_ms":1390}
```

No tag, account, name or item content: counts, ms, story ids, kinds and
field names.

How much of a week the rows answer, and why not:

```
filter @message like /home_feed_story_build/
| stats sum(players_stored) as stored, sum(players_computed.unwritten) as unwritten,
        sum(players_computed.news) as news, sum(players_computed.error) as errors
  by mode
```

Whether the mix agrees, by cause:

```
filter @message like /home_feed_story_build/ and mode = "shadow"
| stats sum(diff.only_computed) as oc, sum(diff.only_mixed) as om,
        sum(diff.revision) as rev, sum(diff.content) as ct,
        sum(diff.order_same = 0) as reordered, count(*) as builds
```

What the mix would save:

```
filter @message like /home_feed_story_build/ and mode = "shadow"
| stats pct(computed_ms, 50) as computed_p50, pct(mixed_ms, 50) as mixed_p50,
        pct(read_ms, 95) as read_p95
```

## Why not the MCP tool

Since the Discord agent retired on 2026-11-23, `elixir_timeline` had 27
calls in 36 hours, all of them the deploy's acceptance suite, at 269 ms
average and 440 ms p95. The stage 1 note measured 1.2 s average and 4.8 s
p95 when a poller read 30 days. Its contract returns `entries` and
`quiet` for every player at every verbosity, and reads the observed basis
for any past window. Rows hold none of that, so serving it from rows
would need a breaking tool change for no measured gain. It keeps
computing.

## What is next

- Turn `TimelineStoryBuild` to `on` after a clean day of `settled` at
  zero.
- Clans' rows, once their reader-dependent scope is settled.
- Home read directly from rows, with no stored week between.
- Then `home_feed` can go.

No migration, and no MCP or `/api/v1` contract change. One new stack
parameter and environment variable; no new IAM or AWS resource.
