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

An **agent** also hears about the players in the clan it runs, without adding
them one by one: an agent's subject is the clan. An **integration** has no
players of its own and receives no feed at all.

A notification is a nod, not a report — "something moved here, go look." The
payload carries a count and nothing else, because the data tools are cheap and
current, and an event that summarised would just be a staler copy of them.

### Coalesced

One unread row per subject per topic, with a running count. Three badges become
one nod that says three, not three notifications.

| Topic | When |
|---|---|
| `battles_recorded` | new battles captured for a subject |
| `badge_earned` | a mastery badge levelled up |
| `legendary_badge_earned` | a one-off badge was awarded |
| `arena_changed` | the player moved arena |
| `best_trophies_peak` | a new personal best |
| `career_wins_milestone` | career wins crossed a thousand |
| `collection_level_milestone` | collection level went up |
| `pol_promotion` | a Path of Legends promotion |

The two badge tiers are **separate topics rather than one topic with a tier
field**, so asking for the notable ones actually gets you the notable ones — and
a reader written against one name can never silently lose the other.

A subject's **first sighting emits nothing.** A newly added player arrives with
a full badge shelf and a complete history; treating that as news would bury the
feed on the day you added them.

### Discrete

Roster changes arrive one at a time, because *who* is the entire signal and
folding them to "3 changes" forces exactly the lookup the nod exists to save.

| Topic | When |
|---|---|
| `member_joined` | somebody joined a clan you added |
| `member_left` | somebody left it |
| `member_role_changed` | promoted or demoted |
| `war_day_open` | a new war day was first observed |
| `clan_war_week_finished` | the week closed |
| `clan_pulse` | a daily digest per clan, ~07:00 UTC |
| `feedback_responded` | the maintainer answered something you filed |
| `recording_started` / `recording_stopped` | your own recordings |
| `account_tier_changed` | your account tier changed |

`member_left` is **raw**. The Clash Royale API does not distinguish somebody
leaving from somebody being kicked, and neither do we — a "verified departure"
here would be a guess wearing a confident name. The event says a membership
closed; whether that deserves a farewell is your agent's call. The departing
role travels on the event because it is the one detail that cannot be recovered
once the membership closes.

`account_tier_changed` was called `role_changed`, one word away from
`member_role_changed`, which means the opposite thing. Both names are sent
during the deprecation window.

Their presence in these lists is a **schema, not news**. Seeing a topic here
never means one occurred.

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

That caveat used to be prose you had to apply yourself, one `elixir_coverage`
call per name. Each quiet member now carries it:

| Field | Meaning |
|---|---|
| `days_quiet` | days since the last battle **we recorded** |
| `days_since_poll` | days since we last successfully polled them (`null` = never) |
| `recorded_since` | the first battle of theirs we ever saw |

Compare the first two before calling anyone inactive. If `days_since_poll` is
0 and `days_quiet` is 9, the silence is theirs. If `days_since_poll` is 7, most
of that silence is ours. A `null` there means we have never polled them at all,
which is deliberately not reported as zero — a blind spot must not read as
freshness.

Members with no recorded history at all cannot appear in that list, because it
is built from recorded battles. They arrive as `never_recorded_members`,
named rather than merely counted, so a routine has somebody to actually look
at.

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
