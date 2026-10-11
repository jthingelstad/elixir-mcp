# 2026-10-11 — The clan's own model is told the record

No MCP or JSON API change. Migration 0220 (`clan_activity_discord_told.item_at`).

## Why

Jamie, 2026-10-11: "Right now when I use 'use clans voice' it is terrible.
It removes all context and makes it generic dribble. The intent is to
become even more contextual and pull in the variety of data elixir has."
The drafts were told a frozen line and a placeholder for the name; the
Discord rewrite was told only Elixir's sentence ("the model sees only the
line", DECISIONS 2026-10-10). Both are reversed: the DECISIONS line "The
clan's model is told the record, never only the line" replaces it.

## One builder

`clan-engine/src/context.mjs`, pure, for both uses:

- `clanContext`: the clan block (name, pitch, the channel's voice, goals,
  member count, last four ranked war weeks). Stable text per clan, sent as
  the request's `context`, a system block with `cache_control`, so it is
  the cached prefix (tools, then system, then the clan).
- `memberLines(m, { scope })`: `full` (trophies, best, arena, career wins,
  collection level, tenure and earlier stints, war weeks as decks and
  points, moments, awards) or `contribution` for a removal or departure
  (tenure and weeks played only). Fame per member never.
- `actionLines(kind, …)`: an Action's evidence per kind; never a hold, a
  leader's note, a removal's rationale or inactivity numbers.
- `itemFactLines(facts)`: a timeline item's facts, without ids, tags,
  times, evidence or attestation fields.
- `inventedNumbers`, `unknownNames`: a draft carrying either is warned
  (`checks` / `warnings`), a Discord post refused.
- `strictTool`: `strict: true`, `additionalProperties: false`, and the
  schema keywords strict mode refuses removed.

The facts come from `syndication/src/story-facts.mjs` (`clanStoryFacts`),
recorded facts only, read by web-api for drafts and by the sync for posts.

## Drafts

`drafts.mjs` passes the member by name and the leader's note; the prompts
ask for one or two facts that make the moment personal. `{winners}` and
the removal, departure and chat-filter rules stay. Effort is `medium`
(`DRAFT_EFFORT`), stated in every request.

A draft on Opus 5.5 at medium effort can outlast the web API's 30 s, so
drafts (Action words, the recruiting pitch and the Discord preview) are
started and collected: `model.write(…, { defer: true })` starts the
bridge request with a 50 s provider wait (`DEFERRED_RELAY_MS`) and waits
what the request has left; with no answer yet it returns `{ pending }`,
and the page asks again with it every 2.5 s for up to 100 s
(`clan-web/src/lib/pending.js`). `model.collect` records
`outcome_unknown` once `PENDING_MS` (110 s) passes. The relay takes
`clan-model/request/` from a queue of its own (`ClanModelQueue`,
BatchSize 1), so a 50 s wait never shares the relay's 60 s with mail.

## The Discord rewrite

`clan-sync.mjs`:

- one packet per post (`rewriteLine`): Elixir's line, the item's facts,
  the member's record (contribution scope for departures) and how often
  the channel told about them this week; the number and name checks read
  the whole packet plus the clan block;
- with the rewrite on, never-told groupable milestones of one kind in a
  run are one post under the first item's key (at most five, 500
  characters); refused, Elixir's lines are stacked in that one message;
- every name an item holds is protected, opponents and clans included
  (Codex P2 on #411); a link is refused, never stripped; the clan-name
  concern is gone with the clan block;
- a leader's word on a departure edits the departure nearest its
  `left_at` within a day (0220 records each told item's time), never the
  player's latest (Codex P2 on #411); a legacy row without a time is used
  only when it is the player's only departure;
- the model call runs outside any transaction: the run plans under the
  row lock, releases it, asks the model, then writes only if the
  connection is unchanged (`skipped: "changed"` otherwise). The clan's
  advisory lock (`0x636c616e`, the tag's hash) keeps two syncs of one clan
  apart meanwhile;
- effort `low` (`ACTIVITY_EFFORT`).

## Accounting

- `ACTIVITY_USES_PER_DAY` (50) counts model requests, each of which may
  write several posts; the docs say so.
- A use whose outcome is unknown is counted toward the monthly cap at its
  reservation's estimate (#455).
- The preview (`POST /activity-discord/preview`) is a leader's use: it is
  recorded with `preview: true`, counts toward the leaders' 20 a day, not
  the channel's 50, and posts or tells nothing.

## Not done

- A removal classification seen before its `member_left` item is still
  marked told and lost (as before this change).
