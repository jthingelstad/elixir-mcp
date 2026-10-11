# 2026-10-11 — A clan's Discord channel is an editor (code mode)

Jamie, 2026-10-11: "it can't just be syndication of the timeline because
that's share of the timeline … it can either use AI or it can use some
code to figure out a better way to frame up what's happening." The
channel had been the timeline's own lines (`discordLine`), one per item,
with the chrome and links of the cross-post. This is the first of three
pull requests. It adds the story builder and Elixir's own render (code
mode, the default without a key). The model mode with research and the
editor preview follow.

Migration 0221. MCP and JSON API unchanged.

## Stories (`clan-engine/src/stories.mjs`)

- `buildStories` groups fresh items into stories. A story is one
  member's one battle: an arena move, best rung and promotion that share a
  `battle_id`. It may also be a same-kind milestone across members (up to
  `STORY_GROUP_MAX` = 5, never one member's two), a sitting, or anything
  else on its own. It is keyed by its first item's id, and told
  rows remember the key (`story_key`).
- Skips by rule, each with a reason in `STORY_SKIPS`, recorded once:
  - `badge_level`: a level-up below the badge's top;
  - `only_grew`: a told story whose digest did not move. A sitting moves
    on a new best win or a run five longer, and a story told with others
    stands;
  - `already_told`: the same member's same battle, or the same arena,
    league, rung or milestone value within `STORY_RETOLD_MS` (7 days).
- `storyReady` holds a story until it has been quiet for
  `STORY_HOLD_QUIET_MS` (4 min), or until `STORY_HOLD_MAX_MS` (10 min)
  after its first item.
- `renderStory` writes deterministic prose with no clock time, no link and no tag.
  A story over three hours late opens with words ("Earlier today",
  "Yesterday", "3 days ago"). Identical clauses across members merge
  ("Ada and Bo passed 5,000 career wins."). A new best follows #502:
  the crossing, then "They went on to a best of N". A departure says
  departed and a kick says "was removed". `leadSafe` escapes a leading
  `#`, `-` or `1.`.

## Context (`syndication/src/story-context.mjs`)

A single-member battle story is told the deck's record in its mode
(ladder or Ranked) this season, named by archetype label only when
classified. It also gets a second promotion within 24 hours and the
clanmates already in the arena reached. Other stories get nothing more.
Members' tenure and stints come from the existing `clanStoryFacts`.

## The run (`syndication/src/clan-sync.mjs`)

- Held stories clamp the pointer to just before their first item. A
  departure classification is held with its departure. A hold wake goes to
  the new `timeline-hold` outbox lane, on queue `elixir-mcp-timeline-hold`
  (DelaySeconds 300, the same function, DLQ shared with sync). A post
  usually lands about six minutes after the activity, and at most about
  fifteen.
- Told rows gain `story_key`, `battle_id`, `told_value`, `digest`,
  `skipped` and `skip_reason` (0221). A story's size is counted at read
  time.
- With the clan's model on, each story's packet carries Elixir's render as
  the line to rewrite. The checks and the fallback are unchanged, and a
  refused rewrite posts the render.
- The delivery history carries skips (`outcome: "skipped"`, with the
  reason and an excerpt), deduped by reference and reason. They are not
  counted as missed. A clan channel's page lists 40 (`DISCORD_CLAN_HISTORY_MAX`);
  a person's cross-post keeps 20.

## Unchanged

The timeline cross-post (`lines.mjs`, `sync.mjs`) and its #502 stamp.
Delivery: a refused line skips alone, per-channel pacing, unknown
outcomes never retried, edits in place, threads. DECISIONS line 147 is
rewritten for the editor in both modes and keeps the cross-post's stamp
rule.
