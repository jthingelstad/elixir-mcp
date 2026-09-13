---
slug: events
title: "Events and the activity feed"
description: "The push lane: elixir_events returns one synthesized entry per subject since your bookmark, with a summary sentence, always-present sections and named notables; who is a subject for a person and for an agent; the window and bookmark semantics; what the feed never does."
section: using
order: 16
navTitle: "Events"
icon: bell
lede: "Notifications: what happened to the players and clans you track, summarized so a person can read it and an agent can act on it."
console: ["Your feed", "/account/activity", "Console ▸ Activity"]
---

# Events and the activity feed

Most tools answer a question you asked. The activity feed is the other
direction: it tells you what happened to the subjects you track since you
last looked, so a scheduled agent can read one thing and decide what to
drill into, and so a person can read the same thing and simply know.

The feed is **synthesized when you read it**, from the record and the
per-subject ledger. Nothing is queued, fanned out or pruned. A reader that
comes back after a month gets a month's entry (capped at 30 days).

## `elixir_events`

| Argument | Type | Default | Notes |
|---|---|---|---|
| `from` | string | your bookmark, else 24 hours ago | an ISO instant, or `YYYY-MM-DD` at local midnight in your timezone; capped at 30 days before `to` |
| `to` | string | now | an ISO instant, or a date covering that whole local day |
| `mark_seen` | boolean | `true` | move your bookmark to this window's end |
| `sections` | string[] | all | keep only these sections in each entry; summary, subject, window and notables always stay |
| `verbosity` | `full` \| `compact` | `full` | compact keeps the summary, subject, window and notables and drops every section |
| `timezone` | IANA zone | the account's | for date-only bounds and the summary's "since" label |

Response: `{ window: { from, to }, entries: [...], quiet: [...], subjects,
next_cursor, seen_through, has_more, notes, docs, meta }`.

- `next_cursor` is `window.to`. Pass it back as `from` to continue.
- `seen_through` is your bookmark after this call. With `mark_seen: false`
  it is unchanged.
- `has_more` is always `false`: an entry summarizes its whole window.
- `meta.events_pending` on any response counts subjects of yours the
  recorder has admitted something for since your bookmark.

### One bookmark per account

`mark_seen` moves a single instant on the account. Two consumers that both
mark will move each other's window. Either give each consumer its own
[agent](/docs/agents) (each has its own bookmark), or read with
`mark_seen: false` and keep your own `from`. The code for the second
shape is on the [agents page](/docs/agents#consuming-the-activity-feed).

## Who is a subject

Subscriptions are implicit; nothing to configure.

| Reader | Subjects | Entries |
|---|---|---|
| a person | every player they track with notify on (primary, alts, friends, watching); every clan they added with notify on | one `player_activity` per player, one `clan_activity` per clan |
| an agent | the clan it represents; any player it tracks explicitly | one `clan_activity`; its members appear **inside** that entry, never as rows |
| an integration | none | no feed |

The entry's shape follows the subject, not the account: a person who adds
a clan gets the same clan entry an agent gets. `notify_off` on a subject
silences it without touching its recording.

## The entry

Every entry opens with `summary`, a sentence written for a person with
every number taken from the sections below it, and carries `window`
`{ from, to }` and `notables`, a list of the named moments in the window.
Sections are **always present** and `null` when nothing happened, so a
reader never learns which keys appear when.

### A player's entry (`player_activity`)

| Section | What it says |
|---|---|
| `battles` | played, won, lost, drawn, three-crown wins, by mode group, net ladder trophies, and `late_captures` (battles the record learned in the window but that were played more than a day before it) |
| `trophies` | `from` and `to` at the window ends, `best`, `new_best`, `as_of` |
| `arena` | `{ from, to }` arena ids when the arena changed |
| `ranked` | `{ from, to }` league names when the Path of Legends league changed |
| `collection` | collection level `{ from, to }` when it moved, cards `unlocked` by name, cards `leveled` |
| `badges` | badges `earned` (a tiered badge levelled up) and `legendary` (a one-off badge) |
| `clan` | current clan and role, and `changes`: joined or left, with the clan named |
| `war` | recorded war battles and the policy days they fell on |
| `presence` | `last_battle_at`, `days_quiet`, `days_since_poll`, `returned_after_days` |

Notables: `best_trophies_band` (a new best crossing a 500 band),
`arena_promotion`, `ranked_promotion`, `collection_level` (a multiple of
5), `career_wins` (a multiple of 1,000), `legendary_badge`, `badge_level`,
`clan_joined`, `clan_left`, `returned` (a battle after seven or more quiet
days). Thresholds are disclosed so a beginner climbing four arenas in a
day and a maxed veteran read the same way.

### A clan's entry (`clan_activity`)

| Section | What it says |
|---|---|
| `activity` | battles played while a member, members active, members now, by mode group, late captures; `basis` says `recorded`, or explains that an activity-scope clan records roster and war only |
| `roster` | `joined`, `left` (with the departing role and observed tenure) and `role_changes`, each named with a timestamp; `bounced` (joined and left inside the window); `size` at each end |
| `war` | season and week, `day_kind` and `war_day` at the window end, the boat's `fame` and `place_of_five`, `race_finished_at` once the boat has crossed the line, `decks` `{ as_of, untouched, partial, finished, participants }` on a war day, and `resolved`: weeks that finished inside the window with fame, rank and trophy change |
| `presence` | `quiet_crossed`: members who crossed a rung (5, 10, 20 recorded-quiet days) inside the window, each with `days_since_poll` so the reader can tell their silence from ours; `returned`; `never_recorded` |
| `standouts` | `most_battles`, `new_bests`, `arena_promotions`, `ranked_promotions`, `collection_levels`, `badges`, every list bounded and named |
| `donations` | the week's total across members, how many were counted, the leader |

Lists are capped (`items` plus `more`). A clan entry is produced even when
nothing happened: a clan's silence is the clan's activity.

### `quiet`

Tracked players with nothing in the window get no entry. They are listed
under `quiet` with `days_quiet` and `days_since_poll`, so a silent friend
is visible without a row per silent friend.

## What the feed never does

- **It never tells you what time it is.** A war day opening or closing is a
  clock fact; `game_clock` carries `war_day_closes_at`,
  `next_war_day_opens_at`, `next_training_starts_at` and `week_ends_at` so a
  routine that cares schedules itself. A routine that does not care never
  sees war in its feed except as what its clan did.
- **It never gives advice.** "Quiet past 10 days" is a fact with a disclosed
  rung; whether that means anything is the reader's call.
- **It never assumes what the reader is for.** The same entry serves a
  clan-management routine, a highlights bot, a recruiter watching churn, a
  war-only agent, and a person reading the console. Each reads the sections
  it cares about; `sections` trims the rest from the wire.

## Account events

Feedback responses (`meta.feedback_responses_pending`, `elixir_my_feedback`),
recordings starting and stopping, and account tier changes are addressed to
the account and shown on the console's Activity page.

## A routine that uses it

1. Read `game_clock` once; if you care about war, schedule yourself from
   `war_day_closes_at`.
2. Call `elixir_events` from your saved `from` with `mark_seen: false`;
   read each entry's `summary`, then the sections you handle.
3. Drill with the data tools for anything that moved: `clans_roster`,
   `war_current`, `clans_participation`, `players_summary`.
4. Save `next_cursor`.

On first run the window is the last 24 hours; an agent that posts a month
of backlog into a channel is the most common mistake with a feed like this,
and the cap and the default exist to prevent it.
