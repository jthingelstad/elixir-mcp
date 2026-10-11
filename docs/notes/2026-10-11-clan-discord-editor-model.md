# 2026-10-11 — A clan's Discord channel: the model as editor

Jamie, 2026-10-11, approved: "rebuild Elixir Clan's Discord AI mode as an
editor in elixir-mcp: read-only research on the clan's record, may skip
and merge items, no time or links, checked against what it read". This
is the second of three pull requests. The first (#503, #504) built the
stories and Elixir's own render. This one replaces the line-by-line
rewrite with an editor. The preview follows. No migration. MCP and JSON
API unchanged; the delivery history's skip gains an optional
`rewritten: true` (contracts `TimelineDiscordSkip`, internal).

## The editor (`clan-engine/src/editor.mjs`, pure)

- `editorStory` turns a planned post into a packet: `STORY <key>
  (kinds; N moments)`, an `EDIT` line for a post already in the channel,
  the departure's required words, Elixir's version, the facts, ABOUT
  lines and this week's history counts. It also notes the names the
  render says and whether the story must stand `alone` (a departure, a
  leader's word on one, an edit).
- `editorRequest` asks for at most `EDITOR_STORIES_MAX` (12) stories in
  one request, at low effort. The tools are strict: three lookups
  (`member_record`, `member_battles`, `channel_recent`) and the answer,
  `write_posts` (`posts[{keys, text}]`, `skips[{key, reason}]`).
  `editorNext` adds the model's turn exactly as it came (thinking
  included), the lookups' answers and the round's note. Round 3 says "no
  more lookups".
- `editorProblem` refuses a post when it is empty or has a link, a
  mention (including a bare `@word`) or a clock time. It also refuses
  one past 600 characters, one that drops a name its stories' renders
  say, and one with a number or proper name the clan, its stories or
  the run's lookups never gave. A departure must use the record's word
  (departed / removed / left) and none of the others.
- `editorAnswer` puts a merged post under the earliest key of its
  stories. It refuses a merge that includes an `alone` story
  (`merge_refused`) and the skip of one (`skip_refused`). It cleans a
  skip's reason of links, mentions and backticks and caps it at 120
  characters.

## Lookups (`syndication/src/editor-research.mjs`)

Read-only, through the sync's own client. A name is matched exactly,
ignoring case, against current members only: a former member or a
stranger is "No current member…".

- `member_record`: `clanStoryFacts` plus `memberLines`, never the run's
  own items.
- `member_battles`: the last 7 days, at most 10, with the mode by
  `modeGroupOf`, the opponent, the archetype label (never
  "unclassified"), the trophy change, and when in words (`agoWords`).
- `channel_recent`: the relay's delivery history, posted or edited in
  the last 3 days, at most 15, unescaped.

A round runs at most 6 lookups; extra calls are answered "Not looked
up". A failing lookup is answered "That lookup failed". Each answer is
at most 1,500 characters.

## The run

- `syncClan` now try-locks the clan's session lock. A run that finds
  another under way writes a hold wake and returns `busy`, instead of
  waiting inside a batch.
- On the sync or hold queue, a clan with ready stories whose model is
  on writes a `timeline-editor/` wake (once a minute per clan) and stops
  there. Nothing is written; the editor's run plans again.
- On the new queue `elixir-mcp-timeline-editor` (BatchSize 1,
  MaxConcurrency 2, visibility 360 s, DLQ shared, no delay), the same
  function runs `edit`: up to three rounds, each one
  `writeUnattended(..., { run, round })` through the model bridge. The
  bridge waits `min(50 s, remaining − 15 s)`. A round starts only with
  25 s left. With fewer than 60 s left the handler returns the wake
  `later`.
- The function timeout goes from 60 s to 180 s. The other queues'
  visibility is already 360 s.
- `writeRun` applies the answer:
  - a merged post goes out under the lead's key with the highest
    revision of its stories, and the merged stories' told rows take
    the lead's `story_key`, so they stand as told with others;
  - a model skip goes to the delivery history as `rewritten: true` with
    the model's reason, and its told rows become
    `skipped`/`skip_reason = "editor"`;
  - everything else posts the render.
  - The result logs `rounds`, `lookups`, `merged`, `model_skips` and
    `refused`.

## The model service

- `writeUnattended` takes `{ run, round }`. The day's cap
  (`ACTIVITY_USES_PER_DAY` = 50) now counts runs: a run's rounds are
  one use, and a use recorded before runs counts as one each. The cap is
  checked only on a run's first round. The monthly spend cap is checked
  on every round, and each round is a call record carrying `run` and
  `round`.
- A request with `messages` goes to `anthropic.turn`:
  - `tool_choice` auto with parallel calls allowed, the same cached
    system blocks, and `THINKING_ROOM`;
  - a refusal or `max_tokens` is an error, and a turn with neither an
    answer nor a lookup is `no_answer`.
- The bridge validates `turn`: 1 to 5 messages, the first a user's; 1
  to 8 tools, all strict, the answer among them; `max_tokens` at most
  8192.

## Cost (estimate, not yet measured live)

Prices are Sonnet 5.5 list: $2 per million tokens in, $10 out, and
cache reads at a twentieth.

- A first round of a few stories is about 3-4K tokens in (about 1K of
  them a cached prefix) and 0.5-1K out: about 1 to 1.5 cents.
- A lookup round adds the turn and up to 6 × 1,500 characters of
  answers: about 1 to 1.5 cents more.
- So a run is about 1 to 3 cents, and with two or three stories a run,
  under a cent to about a cent a story.

`/docs/limits` says so. The key's use log has each request's real
tokens: read them after the first runs and correct the docs if they
differ.

## Unchanged

- The timeline cross-post (`lines.mjs`, `sync.mjs`).
- Code mode (no key, or the editor off).
- Delivery and the departure words.
- The preview (`clanRewritePreview`) still asks for one line per story
  until the third pull request makes it the editor.
