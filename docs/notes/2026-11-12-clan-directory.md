# 2026-11-12 — The clan directory

Social slice 10, first half (#768, tracker #752, plan note
`2026-11-11-social-build-plan.md`). The directory only: location, a player
map and players near you wait on a legal view of young players (VISION,
Open) and are not built. DECISIONS: "Nothing runs until a clan has a
policy" (saving a policy is how a clan opts in, searched on its policy and
description), "Clan reads Elixir through a closed in-process reader" (the
policy and its description are public in the clan directory), "Everyone
signs in; shared posts stay public" (public means any signed-in member).

## What it is

`/clan/directory`, a grid of clan tiles with filters, for any signed-in
person, with a clan or none. Its doors: the search sheet's Look up group
(before typing, and when a typed word means finding a clan), the clans
chooser, and the no-clan refusal page. The navigation is not restructured:
slice 7's new top bar and Find tab can carry it later.

## The read, and the boundary

One reader, `readClanDirectory` in `@elixir-mcp/auth/clan-context` (the
approved seam), authorizes and projects in one statement:

- Only an approved person reads. An agent, an integration or an
  unapproved account gets `not_a_person`.
- Listed: every recorded clan (`clan` row) whose `policy#<clan>` pointer
  names a saved version. A clan Elixir does not record is not listed.
- The policy leaves the database already cut to nine values (war intent,
  posture, playing together, the four category switches, the removal
  switch and its day); the tile turns them into war intent, how strict,
  together, what counts and the removal day, with Clan's defaults for an
  unsaved field. Who saved it, the note, every minimum and clock, the
  Recruit pitch and all other Clan state stay in the database.
- The record's facts: the clan's name, type and in-game description
  (`clan`), and its size and trophies to join from its newest
  `clan_snapshot_daily` row. All are game facts that Explore's clan page
  and `clans_roster` already show to members.
- `yours`: whether the reader holds a verified, current membership in the
  clan, so the tile opens Clan for their own clan and Explore for another.

Clan's handler serves it as `GET /api/clan/directory` (dependency
`directory`, wired in `services/web-api/src/clan.mjs`); web-api resolves a
person first, so signed out is a 401. It takes no advisory lock and calls
no MCP tool. `clan-boundary.test.mjs` pins that only that wiring calls the
reader; MCP and `/api/v1` do not, and the contract is unchanged.

## Order and filters

By lower-cased name, then tag. Never by size, trophies or policy, and the
filters run in the browser over the tiles in that order, so a filter hides
and never reorders. Every filter is a fact a tile shows: search (name, tag,
description), Clan Wars, how strict, removal (none, at least 14 or 30
days), room (recorded size under 50), and your trophies (trophies to join
at or under a number; unknown is left out while it is set). A bound of 500
clans per read; past it the page says it shows the first 500 by name.

## Defaults taken

Each is `[engineering, 2026-11-12]` on the DECISIONS line "Nothing runs
until a clan has a policy":

- Listed by name, then tag.
- The in-game description, not the Recruit pitch.
- No badge art (the app has none): a two-letter crest from the name.
- No location filter: the record keeps a `location_id` and no names.
- A clan with a saved policy is listed at any size, below ten members
  included.
- Minimums are not shown or filtered.
- The app only: no MCP tool, no `/api/v1` operation, and agents are not
  readers.
- The search sheet's door is a Look up row until the Find tab exists.

## Versions

MCP and JSON API unchanged. No migration.
