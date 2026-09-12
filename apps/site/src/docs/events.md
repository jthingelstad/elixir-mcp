---
slug: events
title: "Events and the clan pulse"
description: "The push lane: elixir_events arguments and cursor semantics, every topic with the payload fields a reader may rely on, who is subscribed to what, the daily clan pulse digest, and why a second consumer must keep its own cursor."
section: using
order: 16
navTitle: "Events"
icon: bell
lede: "Notifications, the event feed, and what an agent can raise."
console: ["Your feed", "/account/activity", "Console ▸ Activity"]
---

# Events and the clan pulse

Most tools answer a question you asked. The event feed is the other
direction: it tells you something happened so a scheduled agent can wake up
and look instead of polling everything on a timer. Reading it needs only
`cr:read`, and since 1.0.0 the tool is annotated `readOnlyHint: true`:
advancing your own seen-cursor is a bookmark, not account state anyone else
can see, so a client that auto-approves read-only tools does not prompt on
every poll.

## `elixir_events`

| Argument | Type | Default | Notes |
|---|---|---|---|
| `since` | integer ≥ 0 | the account's seen position | an `event_id`; events after it are returned |
| `topics` | string[] ≤ 12 | all | an unknown topic is `bad_request` listing the valid ones |
| `limit` | 1 to 200 | 50 | |
| `mark_seen` | boolean | `true` | advance the account's cursor to the last event **shown** |

Response: `{ events: [{ event_id, topic, subject_tag, count, payload,
created_at }], next_cursor, seen_through, has_more, meta }`.

- `next_cursor` is the last returned `event_id`, or your `since` when the
  page is empty. Pass it back as `since`.
- `seen_through` is the account's acknowledged position after this call.
  With `mark_seen: false` it is unchanged.
- With a `topics` filter, acknowledgement stops at the first event the filter
  excluded, so a war-only routine can never clear an unread feedback reply it
  did not show. The gap search starts from the account's real position, not
  from this page's `since`.
- Events prune after 30 days.

### One cursor per account

`mark_seen` moves a single number on the account. Two consumers that both
mark will each acknowledge events the other never displayed. Either give each
consumer its own [agent](/docs/agents) (each has its own feed and cursor), or
poll with `mark_seen: false` and keep your own `since`. The code for the
second shape is on the [agents page](/docs/agents#consuming-the-event-feed).

`meta.events_pending` on any response, including this tool's own, counts rows
past the account cursor. A consumer that never marks will always see it
non-zero; that is fine. `meta.feedback_responses_pending` rides beside it, so
a feed poll also says whether `elixir_my_feedback` is worth a call.

## Who hears what

Subscriptions are implicit; nothing to configure.

| Stream | Delivered to |
|---|---|
| player | every account that added the player with notify on; every **agent** whose clan currently contains the player |
| clan | every account that added the clan with notify on (people and agents) |
| account | the account itself |

A person who adds a clan hears its roster and war events, not every member's
badge shelf. An agent hears its members' player events because the clan is
its subject. An integration receives no feed at all. `notify_off` on a
subject silences it without touching its recording.

## Topics

`payload` is a floor: the keys listed are the ones a reader may rely on.
Coalesced topics fold every unread row for the same subject and topic into
one row with a running `count`; discrete topics arrive one per occurrence.

### Player stream, coalesced

| Topic | When | Payload |
|---|---|---|
| `battles_recorded` | new battles captured for the player | `{ count }` |
| `badge_earned` | a tiered badge levelled up (progress inside a level is not a nod) | `{ count }` |
| `legendary_badge_earned` | a one-off badge was awarded | `{ count }` |
| `arena_changed` | the player's arena id changed | `{ count }` |
| `best_trophies_peak` | a new personal best | `{ count }` |
| `career_wins_milestone` | career wins crossed a multiple of 1,000 | `{ count }` |
| `collection_level_milestone` | collection level went up | `{ count }` |
| `pol_promotion` | Path of Legends league went up; a season reset going down is not a nod | `{ count }` |
| `card_unlocked` | a card the player did not have appeared in their collection | `{ count }` |
| `card_leveled` | a card's level went up (counts ticking toward the next level are not a nod) | `{ count }` |

A subject's first snapshot emits nothing: a newly added player arrives with
a full badge shelf and that is history, not news.

### Clan stream, discrete

| Topic | When | Payload |
|---|---|---|
| `member_joined` | somebody joined | `{ player_tag, name }` |
| `member_left` | a membership closed; the API cannot tell leaving from being kicked, and neither can we | `{ player_tag, name, role }` |
| `member_role_changed` | promoted or demoted | `{ player_tag, name, prev_role, new_role, direction }` |
| `war_day_open` | a new war day first observed | `{}` |
| `clan_war_week_finished` | the week closed | `{}` |
| `clan_pulse` | the daily digest, 07:00 UTC | the digest (below) |

### Account stream

| Topic | When | Payload |
|---|---|---|
| `feedback_responded` | the maintainer answered something you filed | `{}` |
| `recording_started`, `recording_stopped` | your own recordings changed | `{}` |
| `account_tier_changed` | your role changed | `{}` |
| `role_changed` | deprecated alias of `account_tier_changed`, sent alongside it during the deprecation window; not the clan role event | `{}` |

A topic's presence in these tables is a schema, not news: seeing it listed
never means one occurred.

## The clan pulse

One digest per added-with-notify clan per UTC day, emitted at 07:00 UTC,
idempotent per clan and day.

```json
{ "date": "2026-09-09", "battles_24h": 212, "members_active_24h": 19, "members_total": 47,
  "top_24h": [{ "player_tag": "#…", "name": "…", "battles": 31 }],
  "quiet": [{ "player_tag": "#…", "name": "…", "days_quiet": 9, "days_since_poll": 0, "recorded_since": "2026-07-08T…" }],
  "never_recorded": 2, "never_recorded_members": [{ "player_tag": "#…", "name": "…" }],
  "war": { "kind": "war", "war_day": 2, "decks_today": { "untouched": 12, "partial": 6, "finished": 22, "participants": 40 } },
  "roster_changes_24h": { "joined": 1, "left": 0 },
  "note": "…" }
```

- `quiet` holds up to 10 members with no recorded battle in more than five
  days. Read `days_since_poll` beside `days_quiet`: `0` and `9` means the
  silence is theirs; `7` and `9` means most of it is ours; `null` means never
  polled, which is deliberately not reported as zero.
- `never_recorded_members` are named, not merely counted, because `quiet` is
  built from recorded battles and structurally cannot contain them.
- `war` is present only while the latest observed period is nominally still
  open. Its `kind` is `training` or `war`; `war_day` appears only on a war
  day, and `decks_today` only when recorded current participants exist. These
  counts trail actual play and are never final. Unlike `war_current`, the
  pulse names its discriminator `kind`, not `day_kind`.
- `roster_changes_24h.joined` and `.left` are counts, not member lists;
  individual changes arrive as `member_joined` and `member_left` events.
- `battles_24h` counts battles played while in this clan.

It carries facts, never judgments. Thresholds beyond the five-day floor are
your routine's.

## A routine that uses it

1. Call `elixir_events` from your saved cursor with the topics you handle.
2. On `clan_pulse`: read the digest; drill with `clans_standings` or
   `battles_trends` if something moved; write the brief.
3. On `war_day_open`: note the day; in the evening read
   `war_current.decks_today.untouched` for who still needs to play.
4. On `member_joined` / `member_left`: update your notes, greet, or flag.

On first run start from the newest event; an agent that posts a month of
backlog into a channel is the most common mistake with a feed like this.
