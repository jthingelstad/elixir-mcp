# 2026-11-26 — The stored Timeline, stage 5: clans' stories, compared in shadow

Stage 4 (`docs/notes/2026-11-25-timeline-story-build.md`) took Home's
followed players from `timeline_story` rows and kept building every
clan. Clans are most of a Home build's cost. This stage writes the clans'
stories as rows too (`subject_kind = 'clan'`) and compares them with a
build. Nothing is served from clan rows yet.

## What is stored

- **Which clans.** Every clan some account's Timeline reads as a subject:
  `TIMELINE_CLANS_SQL` (`recorded-players.mjs`), `account_clan` with
  `notify` on. A clan followed with its Timeline off is not written.
- **One telling per clan.** `buildSubjectStories(db, "clan", tag)` builds
  the clan at comprehensive scope, occurred basis, items only, with no
  account lines and no attested fact (an account's own). An activity
  reader's week is cut from the same rows: it is the comprehensive
  telling without `quiet_crossed` and `returned`, which buildClanEntry
  reads for comprehensive clans only. That is a pure scope filter, so one
  telling serves both scopes.
- **Span: 8 days** (`STORY_CLAN_SPAN_DAYS`), the Timeline's week and a
  day. A story an observed week tells can have been played up to a day
  before the week (a return learned a day or more late is never told), so
  the day covers it. A read older than the span is refused `span`
  (`readClanRows`). A clan's write deletes its own rows the build no
  longer tells, older ones included. The daily trim's 35 days on
  `timeline_story` covers clans no longer written.
- **What each window selects a story by.** A window is cut from the rows
  (`clanWindowItems`, `entries.mjs`) by the instant its build would
  select each kind by. The rows carry that instant server-only, as
  `_superset` (the `SUPERSET` symbol in a built item):
  - A ledger row (roster and war) keeps its `window_end`. That is also
    the row's `observed_at` column.
  - A standout keeps every rung crossing of its sitting with the battle's
    played and learned instants. `standoutInWindow` gives the window's
    item: `at` is the first crossing in the window, `observed_at` the
    latest learned, `facts.newly` their labels, or null when the window
    learned none.
  - A return keeps when the battle that ended the gap was learned.
  - Member moments are stored uncapped. The cap (100) is applied when a
    window is cut, in the builder's order: newest first, then by story id
    (`memberMomentOrder`, now the build's own tie-break too). `more` and
    `dropped` come out as a build's.
- **Superset columns.** A clan row's `observed_at` column is the latest
  instant any observed window could select the story by, so
  `observed_at > from` holds for every window that tells it. Its
  `sort_at` (a sitting's last battle, any other item's `at`) is likewise
  at or after anything an occurred window selects it by. A read by
  either column takes a superset, and the cut makes it exact. The
  `observed_at` a reader is served stays the build's.

## What stays live

`memberTag` reads (a member's own clan view) are never answered from clan
rows. Every read path still serves players only: `readSubjectStories`
and `readPlayersStories` throw or select `subject_kind = 'player'`.

Some things a window's build decides cannot be held by rows, and the
comparison names them as causes rather than bugs:

- Payload dedup of member moments, and `tellBadges`' day grouping, run
  over the 8-day build, not the 7-day window.
- `collapseRepeats` runs over 8 days, not 7.
- Current members only, quiet crossings' silence and `days_since_poll`
  are measured at the write's now. They agree at compare time.
- A member moment learned a day or more after it occurred, and a ledger
  row that occurred more than a day before the span, fall outside it.
- `week_resolved`'s members are read from current `war_participation`.
- A sitting's `open` depends on the window's end.

## The sweep

Only the jobs' five-minute sweep wakes a clan (`{ v: 1, story_clan,
since }`, `storyClanWake`). No admission wakes one. Clans come after the
players and share their 20 s probe budget, at most `SWEEP_CLANS` (3) a
sweep. A clan is due when it is unwritten, older than the floor (6 h),
or the news probe says so. The probe is `clanNews`: one `timelineNews`
statement over the clan sources (ledger, member moments, member battles,
quiet; no attested facts) plus a `clan_lifecycle` occasion check.

`TimelineStoryClans` (`off` or `shadow`, default `shadow`, preserved
across deploys) reaches only the timeline-sync lane as
`TIMELINE_STORY_CLANS`. At `off` the sweep still writes wakes, and the
lane takes each wake and does nothing with it.

The staleness op (`timeline_story_staleness`) answers for clans under
`clans`. The player fields are unchanged.

## The log line

After each clan write the lane builds the clan alone for the 7-day
observed week ending at the write's now, at comprehensive and again at
activity scope. It cuts the same week from the rows just written and
compares them by story id (`compareWeeks`, reused with the stored side
named `stored`). It logs one line a write:

```json
{"at":"timeline_story_clan_shadow","clan":"<10 hex>","stories":0,"written":0,"deleted":0,"write_ms":0,"read_ms":0,
 "comprehensive":{"computed":0,"stored":0,"only_computed":0,"only_stored":0,"revision":0,"content":0,"order_same":true,"ids":{},"groups":[],"groups_cut":0,"build_ms":0,"cut_ms":0},
 "activity":{"...":"the same"}}
```

`clan` is a short sha256 of the tag, never the tag. `ids` holds up to
five story ids a class, and `groups` the counts by kind, class, cause and
field. A comparison that throws logs `{"failed": <class>}` in place of
the scopes, and the write stands. `{"refused": "span"|"unwritten"}`
means the rows could not answer the week.

## What comes next

After a clean day of shadow lines, serve Home's clans from their rows:
Home's mixed build reads a clan from `readClanRows` and cuts its week the
way the comparison does, and builds only the clans refused.
