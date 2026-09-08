---
slug: events
title: "Events and the clan pulse"
navTitle: "Events & the pulse"
description: "The push lane: what wakes an agent up. Battles recorded, members joined and left, war days opening, and a daily clan digest of facts — never judgments."
order: 32
section: reference
---

# Events and the clan pulse

Most tools answer a question you asked. The event feed is the other direction:
it tells you when something happened, so a scheduled agent can wake up and look
rather than poll everything on a timer.

Call `elixir_events` from your cursor. `meta.events_pending` on any response
tells you there is something new.

## What the feed carries

Everything you **add** — players via `elixir_add_player`, clans via
`elixir_add_clan` — feeds this pipe while its notify setting is on. Turning
notify off silences a subject without touching its recording.

| Topic | When |
|---|---|
| `battles_recorded` | new battles captured for a subject (coalesced until read) |
| `member_joined` / `member_left` / `member_role_changed` | roster changes on a clan you added |
| `clan_pulse` | a daily digest per clan, ~07:00 UTC |
| `war_day_open` | a new war day was first observed |
| `clan_war_week_finished` | the week closed |
| `feedback_responded` | the maintainer answered something you filed |
| `recording_started` / `recording_stopped`, `role_changed` | your own account |

Their presence in this list is a **schema, not news**. Seeing a topic here never
means one occurred.

## The clan pulse

One digest per clan per day: battles in the last 24 hours, how many members were
active, the top few, who has been quiet and for how long, war-day deck counts,
and roster changes.

It carries **facts, never judgments**. It will tell you somebody has been quiet
for six days. It will not tell you to kick them — thresholds beyond the
reporting floor belong to you, because different clans have different cultures.

One honest caveat rides with it: *quiet* means **no recorded battles**, and
recording start dates differ. Somebody who joined last week has not been quiet
for a month; they have been unrecorded for most of it.

## A routine that uses it

The shape a scheduled clan agent wants:

1. Call `elixir_events` from your saved cursor.
2. On `clan_pulse` — read the digest, drill with `clans_standings` or
   `battles_trends` if something moved, write the brief.
3. On `war_day_open` — note the day; check `war_current` in the evening and read
   `decks_today.untouched` for who still needs to play.
4. On `member_joined` / `member_left` — update your notes, greet, or flag.

Facts in, judgment in your routine. The service stays observation-only.

## Cursors

`elixir_events` advances a **single seen-cursor per account**. If two things
poll the same account, each will acknowledge events the other has not shown
anybody.

Two ways to be safe:

- Give each consumer its own [agent](/docs/agents), which is the reason agents
  have their own feeds.
- Or poll with `mark_seen: false` and keep your own cursor, passing `since`
  explicitly. Nothing is acknowledged and nothing can be consumed out from
  under you.

If you filter by `topics`, acknowledgement stops at the first event the filter
excluded — a war-only routine can never clear an unread feedback reply it never
showed you.

## Seed, do not drain

On first run, start from the newest event rather than replaying the backlog.
An agent that wakes up and posts a month of history into a channel is a bad
first impression, and it is the most common mistake with a feed like this.
