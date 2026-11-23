# 2026-11-23 — The stored Timeline, stage 1: store and compare

The Timeline outside Home is computed for each reader on every read.
`buildTimeline` (`packages/tools/src/activity/entries.mjs`) reads each
subject's battles, ledger, snapshots and moves again for every reader.
MCP `elixir_timeline` averaged 36 queries and 1.2 s of database time a
call, with a p95 of 4.8 s and timeouts. The direction is to store each
subject's stories once and read them with one select plus a viewer
layer. This stage only stores and compares. No reader is served a row.

## What changed

- **Migration 0314, `timeline_story`.** One row per subject and story id
  (`subject_kind`, `subject_tag`, `story_id`) holding kind, section,
  revision, `at`, `sort_at`, `observed_at`, visibility, a `content_hash`,
  `built_at` and the item as jsonb. Indexes cover the subject by
  `observed_at` and by `sort_at`, and a plain `sort_at` index serves the
  retention trim.
- **Nothing that depends on a viewer is stored.** That means no nickname,
  no `text`, no `local`, and none of `finishItem`'s other fields
  (`at_unix`, `late`, `visibility` in the item, `publishable`, `schema`).
  The server-only symbols go in as `_spark`, `_deck` and
  `_evidence_source` (`storedItem`).
- **`writeSubjectStories(db, kind, tag, span)`**
  (`packages/tools/src/activity/story-store.mjs`) runs the builder for
  the subject with no viewer: UTC, no account, occurred basis, no cap.
  In one short transaction it upserts the rows whose revision or hash
  moved, then deletes rows inside the span that the build no longer
  tells. Rows outside the span are kept. Players only for now. Drop games
  and battle highlights are not stored, because both belong to a reader.
- **`{timeline_story_backfill}`** writes every recorded player's last 35
  days in batches. The cursor is `md5(player_tag)`, so no tag appears in
  the answer. Each batch answers counts, the cursor, what remains and the
  table's size. The batch that answers `done` also gives rows and the
  average item size, and vacuums the table (`.claude/skills/ops/ops.md`).
- **Retention.** `timeline_story` joins the daily trim at 35 days by
  `sort_at` (`packages/record/src/retention.mjs`).
- **The player page's shadow.** After the page builds its timeline, it
  compares that timeline with the rows and logs one line,
  `timeline_story_shadow`. The line holds counts of stories only
  computed, only stored, at another revision or with other content, up
  to five ids of each, the newest `built_at`, and `ms`. It never carries
  a tag or an item. The comparison runs in its own transaction under a
  300 ms statement timeout. A failure is a `timeline_story_shadow_failed`
  line with the error's class, and the page is served either way. The
  stack parameter `TimelineStoryShadow` (`on` by default, preserved by
  deploys) turns it off.

## Differences to expect in the shadow

Until stage 2 writes when the record learns something, a row is as old
as the op that wrote it. Stories newer than `newest_built_at` are
expected to differ. Beyond that, these are built for a window and so can
differ between a 35-day write and a 30-day page:

- `returned` is computed at the window's first battle (`presenceOf`).
- `quiet_crossed` and its `days_since_poll` are computed at `toMs`.
- A sitting's `open` flag is computed at `toMs` (`sessionsOf`,
  `sessionEvidence`).
- A sitting that starts more than a day before `from` is cut short by the
  wider fetch (`playerBattlesSql`).
- Repeat collapsing and first-event ids are worked out within the window.
- Occurred-basis ledger rows must also be observed after `from`
  (`ledgerWindowSql`).
- Clan moves are selected by when they were observed.
- A player who says nothing in the window gets no items.
- A change of name changes the content hash.

The observed basis that MCP reads builds sittings from learned battles
only, so occurred-basis rows will not match it as they stand. That is for
stage 4. Clans wait for their own stage, because a clan's scope depends
on the reader and its standouts count only what the window learned.

Migration 0314. No MCP or `/api/v1` contract change.
