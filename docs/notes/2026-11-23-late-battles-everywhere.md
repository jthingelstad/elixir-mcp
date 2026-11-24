# 2026-11-23 — Every read tells late battles at their played time

Jamie, 2026-11-23: "I don't know that we should ever delete a battle just
because it was late… we would want to build out a full profile instead",
and "as long as the timestamps are honored".

A late capture is a battle Elixir learned more than a day after it was
played (`battle_time < created_at - interval '1 day'`): a history
backfill, a log polled late, Check for new battles on a player nobody
follows. Every timeline read left them out until today, and
`2026-11-23-player-page-late-battles.md` (#1221) made the player's page
the one exception through a `lateBattles` option, with a second read in
`readSitting` and `readRecordedItem` for links the feeds had made. This
change makes telling them the builder's behaviour and removes the option
and both fallbacks, which answers both Codex findings on #1221 (the
timely-anchored mixed sitting, and the missing What's new entry).

## What reads one way now

The player's page, the Timeline and its stored stories, the Clan feed,
the account page, item refs (`readRecordedItem`), session pages
(`readSitting`), shares, the bell's week, cheers and `elixir_timeline`
all call `buildTimeline` with no late option.

- **Occurred** reads select a battle by when it was played, whenever it
  was learned.
- **Observed** reads select by when it was learned, however long before
  the window it was played. The battles played since a day before
  `from` come off the player-time (or clan-time) index as before. The
  earlier ones can only be late captures, so they come off
  `battle_created_at` (`playerBattlesSql().earlier`, the batched
  `prefetchStatements().earlier`, and `clanLearnedQuery`'s probe, which
  hands the clan's ids, `earlier_ids`, to `clanMemberBattlesQuery` and
  `clanMostQuery` so a clan read walks them once). Such
  an item is told at its played time and carries the existing
  `late: true` (it happened before `from`). Windows still select by the
  battle's own times, never its distance from `from` (Gym #211).
- **Sittings** (player and clan members, `battle_session` and
  `session_standout`), `sittingDetails`, `sittingAnchors` and the
  evidence read count every own battle. A sitting begun on time and
  finished late, or begun late and finished on time, is one id and one
  version everywhere.
- **Returns** keep the `timelyOf` rule: a return is never judged from a
  late batch. A clan's member return now skips a gap closed by a late
  battle too, which it did not check before.
- **Counts.** `battles.late_captures` and a clan's
  `activity.late_captures` count the told battles that were late
  captures (computed from the rows, no statement of their own); a read
  that serves no entry still leaves the player's null. The clan's
  `learned_here_played_before` counts every battle learned in the window
  and played before `from`, not only the day before.
- `timelineNews` checks `player_battles` and `clan_member_battles` with
  the same earlier arm, so it never says no to a window holding only
  late captures.

## Sends stay about new play

`learnedLate(item)` (a server-only symbol, stored as `_learned_late`) is
true for a sitting whose every battle from its anchor was a late capture
(`sittingAnchors`' `bool_and`). The send paths:

| Send | What it does with a late sitting |
| --- | --- |
| Digest mail (`build-digest.mjs`) | its filter drops sitting kinds with `learnedLate` |
| Timeline to Discord (`syndication/sync.mjs`) | `game` is `isPublishable && !learnedLate`, for the window and the open-sitting re-read |
| Clan activity channel (`syndication/clan-sync.mjs`) | `wanted` and the leaders' preview drop it |
| Close-friends web push (`push/close-friends.mjs`) | unchanged: it tells only sessions whose last battle is under two hours old by play time, which a late sitting never is |
| The bell (`web-api/bell.mjs`), activity-today mail, the push drain | unchanged: they tell reactions, follows, comments and answers, never sittings |
| RSS (`routes/cheers.mjs`) | unchanged: a pull feed of Home's stored week, so it carries late sittings at their played time |

A sitting with any timely battle is news as before. Nothing else about who
gets what changed.

## MCP

No field is removed or renamed. `late_captures` keeps its place and now
counts told late captures; item `late` is unchanged. The timeline note
for clan counts says `learned_here_played_before` counts battles played
before `from` however long before. Entries carry no output schema, so the
tool fingerprint does not move (`tools.cdecb01e3f44` before and after).
`docs/timeline-tool` says late recordings are told.

## Stored stories and item ids

No migration and no backfill. Existing rows:

- A stored sitting that spanned late battles was built without them. Its
  evidence fingerprint no longer matches the full read, so its View
  games reads `evidence_changed` until the store writes the row again
  from a fresh build.
- `_evidence_source.late_battles`, written by #1221 since this morning's
  deploy, is ignored on restore.
- A sitting's id comes from its first battle. Only a sitting whose first
  battles were late and a later one on time, within its 30 minutes,
  changes id: the feeds anchored it at the first timely battle, and now
  anchor it at its first battle (as the page did since #1221). A log
  read has to land inside about half an hour past the one-day mark for
  that, so it is rare. For those, cheers, comments and shares keyed on
  the old id stay in their tables but no longer attach to the item, and a
  share or item ref naming the old id no longer opens. A sitting begun on
  time keeps its id; only its revision and version grow. No fallback was
  kept for the rare case.

## Cost

An observed read now always walks the window's learned battles off
`battle_created_at` for the earlier ones, where Home, the Clan feed and
the bell's week had skipped the late count (`lateCounts: false`, #649,
2026-11-13). The 2026-11-13 notes put that walk at about 750 ms and
343,000 buffers for the Clan feed's week and 263,921 buffers for a Home
feed of 56 (per tag; the batch reads it once), most of it probing the
participants of the week's late captures, which are nearly all history
backfills. The statements keep the shapes those notes pinned (one walk
of the week, participants by key; `prefetch-plan` and
`clan-learned-plan` tests). The budget tests say it: Home's built week
is one statement more (the batched walk; the timeline page's count it
replaces was already one), the bell's two more (one a player it reads
alone) and about 300 buffers more, and the Clan landing's Feed walks the
week once, its battle read exempt from the quarter-of-the-table bound
in a seed where half the other clans' battles were learned this week
(`clan-landing-budget`). The cheap next step, if the Feed's time
matters, is #649's: a stored per-clan late-capture rollup, or an index
`battle (created_at) include (battle_time)` so the walk reads no heap.
Either is a migration and was not made here.

## Tests

- `packages/tools/test/timeline-late-battles.test.mjs`: told whole by
  default; an observed read marks it late; a sitting begun on time and
  finished late is one id at every window; a clan's timeline tells a
  member's late sitting under the member's id with the clan's counts;
  batched equals alone on both bases.
- `services/web-api/test/player-page.test.mjs`: the page's late sitting
  and every feed read share an id and version; two mixed sittings (late
  anchor, timely anchor) are one story on the page, in the feeds, on the
  session page and by item ref.
- `packages/syndication/test/sync.test.mjs`: a sitting learned two days
  late is told on the timeline (late, at its played time) and never
  cross-posted.
- `prefetch-plan` and `clan-learned-plan` pin the earlier reads' rows
  and plans; `clan-landing-budget` and `signed-in-budget` hold each
  read to one walk of the week (none for a stored RSS poll).
