---
slug: timeline
title: "The timeline"
description: "elixir_timeline: what happened to the players and clans you track since your read pointer, as items in order (battle sessions, named moments, roster and war moments, presence) plus one summary entry per subject; who is a subject for a person and for an agent; the window and read-pointer semantics; what the timeline never does."
section: using
order: 16
navTitle: "Timeline"
icon: bell
lede: "What happened to the players and clans you track, in order, written so a person can read it and an agent can act on it."
console: ["Your timeline", "/account/activity", "Console ▸ Activity"]
---

# The timeline

Most tools answer a question you asked. The timeline is the other
direction: it tells you what happened to the subjects you track since you
last looked, in order, so a scheduled agent can read one thing and decide
what to consider, and so a person can read the same thing and simply know.

It is **synthesized when you read it**, from the record and the per-subject
ledger. Nothing is queued, fanned out or pruned. A reader that comes back
after a month gets a month's timeline (capped at 30 days and 200 items).

## `elixir_timeline`

| Argument | Type | Default | Notes |
|---|---|---|---|
| `from` | string | your read pointer, else 24 hours ago | an ISO instant, or `YYYY-MM-DD` at local midnight in your timezone; capped at 30 days before `to` |
| `to` | string | now | an ISO instant, or a date covering that whole local day |
| `mark_read` | boolean | `true` | move your read pointer to this window's end |
| `sections` | string[] | all | keep only items and entry sections in these sections |
| `verbosity` | `full` \| `compact` | `full` | compact keeps items, entry summaries and player notables, and drops entry sections including clan standouts |
| `timezone` | IANA zone | the account's | for date-only bounds and the text's times |

Response: `{ window: { from, to }, read_to, timeline: [...], timeline_more,
entries: [...], quiet: [...], subjects, next_cursor, has_more, notes,
docs, meta }`.

- `timeline` is oldest first. `next_cursor` is `window.to`; pass it back as
  `from` to continue.
- `read_to` is your pointer after this call. With `mark_read: false` it is
  unchanged: that is the dry run.
- `has_more` is always `false`; `timeline_more` says how many items the cap
  left out.
- `meta.timeline_pending` on any response counts subjects of yours the
  recorder has admitted something for since your pointer.

### One read pointer per account

`mark_read` moves a single instant on the account. Two consumers that both
mark will move each other's window. Either give each consumer its own
[agent](/docs/agents) (each has its own pointer), or read with
`mark_read: false` and keep your own `from`. The code for the second shape
is on the [agents page](/docs/agents#consuming-the-timeline).

## Who is a subject

Subscriptions are implicit; nothing to configure.

| Reader | Subjects | On the timeline |
|---|---|---|
| a person | every player they track with notify on (primary, alts, friends, watching); every clan they added with notify on | each player's sessions and moments; each clan's roster, war and members' moments |
| an agent | the clan it represents; any player it tracks explicitly | the clan's items; its members appear **on the clan's timeline**, never as subjects |
| an integration | none | nothing |

The entry's shape follows the subject, not the account: a person who adds a
clan gets the same clan entry an agent gets. `notify_off` on a subject
silences it without touching its recording.

## Items

Every item is `{ at, subject_tag, subject_name, kind, section, text,
facts }`. `text` is a sentence a person can read; `facts` are the numbers
and names it was written from; `section` is the entry section the item
belongs to, so `sections` filters items and entries together.

| kind | subject | what it is |
|---|---|---|
| `battle_session` | player | a run of recorded battles with no gap of 30 minutes or more: battles, record, modes, ladder trophy net, `open` while it may still be going. Single battles never appear. |
| `badge_earned`, `legendary_badge_earned` | player, or a clan's member | a tiered badge levelled up, or a one-off badge, by name |
| `arena_changed` | player, or a clan's member | arena moved, named from the arena catalog |
| `ranked_promotion` | player, or a clan's member | Path of Legends league went up, by name |
| `best_trophies_band` | player, or a clan's member | a new personal best crossing a 500 band |
| `collection_level_step`, `career_wins_step` | player, or a clan's member | collection level at a multiple of 5; career wins at a multiple of 1,000 |
| `card_unlocked` | player, or a clan's member | a card the player did not have, by name (level-ups are a count in the entry, never items) |
| `clan_joined`, `clan_left` | player | the player moved clans |
| `member_joined`, `member_left`, `member_role_changed` | clan | who, with the role; a departure is raw, the game cannot tell a leave from a kick |
| `race_finished` | clan | the boat crossed the finish line, with fame |
| `week_resolved` | clan | the week finished: fame, rank among the five, war trophy change |
| `quiet_crossed`, `returned` | player, or a clan's member | a member crossed 5, 10 or 20 recorded-quiet days (never while the silence is ours: `days_since_poll` rides along), or played again after seven or more |
| `account_*` | your account | feedback answered, recordings started or stopped, tier changes, connections |

Members' moments on a clan's timeline are capped per response; the entry's
standouts keep the aggregate.

A profile-derived moment (arena, ranked league, best band, collection
level, badges, cards) is written once, by the first profile poll that
sees it; later polls the same day rewrite the day's snapshot and never
the moment. An arena move is polled for as soon as the player's own
battles vouch for it (see [Recording](/docs/recording/), the profile
arena request), so it arrives within the battle log's cadence rather
than the profile's.

## Entries

One per subject, summarizing the same window. Every entry opens with
`summary` and carries `window`. A player entry carries `notables`; a clan
entry carries its named standouts under `standouts`. Its sections are
**always present** and `null` when nothing happened; compact verbosity
keeps player `notables` and drops clan `standouts` with the other sections.

A player's entry: `battles` (played, record, sessions, by mode, ladder
trophy net, late captures), `trophies`, `arena`, `ranked`, `collection`,
`badges`, `clan` (current clan and moves), `war`, `presence`
(`last_battle_at`, `days_quiet`, `days_since_poll`, `returned_after_days`).

A clan's entry: `activity` (battles, sessions, members active, by mode;
`basis` says `recorded`, or that an activity-scope clan records roster and
war only), `roster` (joined, left with tenure, role changes, size at each
end), `war` (season and week, the day at the window end, fame and place,
`race_finished_at`, `decks` on a war day with `as_of`, weeks `resolved`),
`presence` (quiet rung crossings, returns, never recorded), `standouts`
(most battles, new bests, arena and ranked promotions, collection levels,
badges, each bounded and named), `donations`.

Tracked players with nothing in the window get no entry; they are listed
under `quiet` with `days_quiet` and `days_since_poll`. A clan always gets an
entry: a clan's silence is the clan's activity.

## What the timeline never does

- **It never tells you what time it is.** A war day opening or closing is a
  clock fact; `game_clock` carries `war_day_closes_at`,
  `next_war_day_opens_at`, `next_training_starts_at` and `week_ends_at` so a
  routine that cares schedules itself.
- **It never gives advice.** "Passed 10 recorded-quiet days" is a fact with a
  disclosed rung; whether that means anything is the reader's call.
- **It never assumes what the reader is for.** The same items serve a
  clan-management routine, a highlights bot, a recruiter watching churn, a
  war-only agent, and a person reading the console. Each reads the sections
  it cares about.

## A routine that uses it

1. Read `game_clock` once; if you care about war, schedule yourself from
   `war_day_closes_at`.
2. Call `elixir_timeline` from your saved `from` with `mark_read: false`.
   If `timeline` is empty, there is nothing to consider. Otherwise read the
   items, then the entries for the shape of the window.
3. Drill with the data tools for anything worth more: `clans_roster`,
   `war_current`, `clans_participation`, `players_summary`.
4. Save `next_cursor`; move the pointer with `mark_read` only if this
   consumer owns it.

On first run the window is the last 24 hours; an agent that posts a month
of backlog into a channel is the most common mistake with a feed like this,
and the cap and the default exist to prevent it.
