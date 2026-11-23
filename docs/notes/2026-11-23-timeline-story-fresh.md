# 2026-11-23 — The stored Timeline, stage 2: keep the rows fresh

Stage 1 (`docs/notes/2026-11-23-timeline-story-store.md`) stored each
recorded player's stories once, from an op. This stage rewrites a
player's stories soon after the record learns something about them, so
the rows can be trusted before any reader is served them. No reader is
served a row yet. Players only.

## What changed

- **Migration 0315, `timeline_story_subject`.** One row per subject:
  `written_at` (when the last committed write's build began), `stories`
  and `build_ms`. `timeline_story.built_at` cannot say when a subject was
  last written, because it moves only on a row whose content changed. The
  daily trim drops a row at 35 days by `written_at`, which only happens to
  a player no longer recorded.
- **`writeSubjectStories` stamps the marker.** The write takes a
  transaction-scoped advisory lock on the subject, and a build that began
  before the committed one rolls back (`superseded: true`), so an older
  build never overwrites a newer one. Its counts are unchanged otherwise.
- **The trigger is the admission's existing wake.** After its commit,
  ingest already calls `deps.wake(db, tag)` when an admission wrote facts
  (`packages/ingest/src/pipeline.mjs`). The collector now runs
  `wakeSyndication` and then `wakeStories`
  (`packages/tools/src/activity/story-wake.mjs`) there. A failure in
  either is logged as `timeline_wake_failed` and never fails the
  admission. A read that learned nothing wrote no facts and wakes nothing.
- **The wake is one outbox object per player per minute.**
  `timeline-sync/story.<md5(tag)>.<minute>.json`, written once
  (`IfNoneMatch`), holds `{ v: 1, story_player, since }`, where `since`
  is the end of its minute. The timeline-sync queue holds it 60 s, so it
  is read after its minute has closed. The run calls
  `refreshSubjectStories`, which skips the build when the subject was
  written at or after `since`. It logs `timeline_story_written` with
  counts, or `timeline_story_failed` with the error's class, and deletes
  the object either way. The tag is in neither line.
- **A sweep rides Home's five-minute run.** `home_feeds` (jobs,
  `rate(5 minutes)`) now also runs `storiesToWake` and writes the same
  wake for at most 25 players, in this order:
  - `open`: a sitting stored open (`facts.open`) whose last battle is
    over 31 minutes old.
  - `unwritten`: recorded, never stamped. These are the stage-1 rows, so
    the first sweeps rewrite every player, 25 every five minutes.
  - `news`: `timelineNews` over the stored kinds since `written_at`.
    Probes run oldest write first and stop at 20 s. A player written in
    the last two minutes is not probed.
  - `floor`: not written for six hours.
  A failure in the sweep is logged as `timeline_story_sweep_failed`, and
  Home's run still answers. Its result gains `stories` (counts, no tag).
- **The shadow says why.** The player page still logs one
  `timeline_story_shadow` summary line, now last. Before it, it logs one
  `timeline_story_shadow_diff` line per group of differences. The 300 ms
  statement timeout and "serve the page either way" are unchanged.
- **`{timeline_story_staleness}`**, a read-only migrate op, answers in
  counts (`.claude/skills/ops/ops.md`).

## What wakes a write, and what does not

| The record learns | What wakes the write |
| --- | --- |
| The player's own battle log or profile | The admission's wake |
| Their battle, through another recorded player's log | The sweep's news probe (`player_battles` by `created_at`) |
| A clan read's join, leave or role change, or a war week | The sweep's news probe (`player_clan_moves`); a clan admission wakes its clan tag, which is not a recorded player |
| A ledger moment or a week's form | The admission's wake, or the probe (`player_moments`, `player_week_form`) |
| An attested fact (a leader's word, a Drop game) | The probe (`attested`) |
| Nothing, but the clock moved | See the clock classes below |

## Clock-dependent stories

- **A sitting's `open` flag** is computed at the write's `toMs`. It is
  handled now: the sweep's `open` reason rewrites a player whose stored
  open sitting has gone quiet. It closes within about 8 minutes of the
  sitting ending (30 minutes after its last battle).
- **`quiet_crossed` rungs (5, 10 and 20 days)** are handled now. The news
  probe's `player_quiet` source sees a rung crossed since the write, so
  the sweep rewrites the player within about 7 minutes of the crossing.
- **`days_since_poll`**, and anything else computed at `toMs` that no
  probe sees, is handled only by the six-hour floor. **Stage 3 must**
  compute it in the viewer layer at read time, or leave it out of the
  stored item and the content hash.
- **`returned`** is built at the window's first battle, so a 35-day write
  and a 30-day read can disagree anywhere in the window. **Stage 3 must**
  serve the stored version (the 35-day span is the canonical window) or
  recompute it at read. The shadow labels it `window`.
- **Window-edge effects** cover a sitting cut by the wider fetch, repeats
  collapsed inside the window, and a ledger row observed after `from`.
  These differ only within two days of the read's `from`. Once reads
  serve rows they stop being differences. Until then the shadow labels
  them `window`. **Stage 3 must** filter stored rows by `sort_at` and
  accept the stored telling.
- **The window's slide** needs nothing. Rows outside a write's span are
  kept, the trim drops them at 35 days, and the floor deletes inside the
  span what the build no longer tells.

## Repair, and how stale a row can be

Nothing needs a person. A failed write leaves `written_at` where it was.
The record is then newer than the write, so the next sweep's news probe
wakes the player again. A lost wake (an outbox put that failed, a Lambda
that died, a dead letter) is the same case. A change no probe sees (a
profile-only change whose wake was lost) waits for the floor.

| Case | Worst-case staleness |
| --- | --- |
| News an admission announced | about 2 minutes: up to 60 s to the end of the minute, 60 s on the queue, then the build |
| News only the sweep sees, or a failed or lost wake | about 7 minutes: 5 minutes to the next sweep, then the wake's 2 |
| A sitting going quiet | about 8 minutes after it closes |
| What no probe sees | 6 hours and 7 minutes (the floor) |
| More than 25 players due at once | `ceil(due / 25)` × 5 minutes, open sittings first |

The admission path is about two minutes, not one, because the queue's
60 s delay is shared with every timeline-sync lane and was left alone.

## Cost

Assumptions: the stack's 69 recorded players today. A write of 35 days
is planned at 0.5 s of database time. This was not measured live: the op's
`build_ms_avg` and `build_ms_max` measure it from the first sweeps. A news
probe is planned at 30 ms, about seven indexed exists.

- **Writes.** The planner reads a playing player's battle log at most
  every 30 minutes, so admissions wake a write at most about twice an hour
  per playing player. Closing a sitting adds about one. The sweep is capped
  at 25 writes every five minutes (300 an hour). The floor adds 69 / 6 h,
  about 12 an hour.
- **Probes.** At most 20 s a sweep, so at most 240 s an hour. Today
  69 × 30 ms is about 2 s a sweep, or 25 s an hour.
- **Worst case today**, every player playing the whole hour: about 290
  writes (145 s) plus 25 s of probes. That is about 170 s of database
  time an hour, under 5% of one core.
- **At 10× (690 players)**, every player playing: about 1,700 writes (850 s)
  plus probes at their 240 s cap. That is about 1,100 s an hour, about 30%
  of one core, or 15% of the current 2-vCPU instance. Two levers come before any
  instance change: a coarser wake bucket than the minute, and a longer
  floor.
- **Per admission**, one indexed `recording` lookup. Each write is one
  timeline-sync invocation, inside the existing queue's batch.

## The shadow lines

One `timeline_story_shadow_diff` line per group, at most 25 (the
summary's `groups_cut` counts the rest):

```json
{"at":"timeline_story_shadow_diff","kind":"battle_session","bucket":"content","cause":"settled","field":"facts.name","n":1}
```

`bucket` is `only_computed`, `only_stored`, `revision` or `content`.
`cause` is one of three:

- `unwritten`: there is no write yet, or the story was learned after it.
- `window`: a `returned` story, or one within two days of the read's
  `from`.
- `settled`: neither of those. This is what stage 3 must explain.

`field` is set for `content` only. It is a top-level key, or `facts.<k>`
or `evidence.<k>`, read from at most ten stored items, and `unread` past
that. It is never a value.

Then the summary, last (made-up values):

```json
{"at":"timeline_story_shadow","computed":41,"stored":40,"only_computed":1,"only_stored":0,"revision":1,"content":2,"ids":{"only_computed":["tl_0f3c9a1b2d4e5f607182"],"only_stored":[],"revision":["tl_9e8d7c6b5a4f3e2d1c0b"],"content":["tl_1a2b3c4d5e6f70819203","tl_aa00bb11cc22dd33ee44"]},"newest_built_at":"2026-11-23T15:58:02.114Z","written_at":"2026-11-23T16:01:00.020Z","lag_s":95,"newest_learned_at":"2026-11-23T16:02:11.870Z","stale":true,"groups_cut":0,"groups":3,"ms":14}
```

`stale` is true when the newest computed story was learned after
`written_at`. Which kinds still differ, and why:

```
filter at = "timeline_story_shadow_diff"
| stats sum(n) as stories by kind, bucket, cause, field
| sort stories desc
```

How often the record runs ahead of the write:

```
filter at = "timeline_story_shadow"
| stats count(*) as pages, pct(lag_s, 95) as lag_p95 by stale
```

## Stage 3 decides

- Read time versus stored: `days_since_poll`, `returned` and the window
  edges (above).
- The observed basis that MCP reads (stage 4 in the stage-1 note).
- Clans, still waiting on their reader-dependent scope.

Migration 0315. No MCP or `/api/v1` contract change, and no new IAM or
AWS resource: the collector, jobs and timeline-sync roles already write
and read `timeline-sync/` in the outbox bucket.
