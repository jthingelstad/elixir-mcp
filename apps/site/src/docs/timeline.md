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
after a month gets a month's timeline (capped at 30 days and 150 items a page).

## `elixir_timeline`

| Argument | Type | Default | Notes |
|---|---|---|---|
| `from` | string | your read pointer, else 24 hours ago | an ISO instant, or `YYYY-MM-DD` at local midnight in your timezone; capped at 30 days before `to` |
| `to` | string | now | an ISO instant, or a date covering that whole local day |
| `mark_read` | boolean | `true` | move the read pointer (the reader's, or the account's) to this window's end |
| `reader` | string | none | this consumer's own pointer, by a short name (`^[a-z0-9][a-z0-9-]{0,31}$`; 3.18.0): an omitted `from` reads since it, `mark_read` moves it, `read_to` reports it; the account's unnamed pointer and every other reader's are untouched |
| `sections` | string[] | all | keep only items and entry sections in these sections |
| `kinds` | string[] | all | keep only items of these kinds (the table below, or `account_*`); entries are untouched. A consumer that wakes on a few kinds reads only those |
| `verbosity` | `full` \| `compact` | `full` | compact keeps items, entry summaries and player notables, and drops entry sections including clan standouts |
| `timezone` | IANA zone | the account's | for date-only bounds and the text's times |

Response: `{ window: { from, to }, read_to, timeline: [...], timeline_more,
entries: [...], quiet: [...], subjects, next_cursor, has_more, notes,
docs, meta }`.

- `timeline` is oldest first by `at` (when a moment happened). A window
  selects items by `observed_at`, when the record learned them, in
  `(from, to]`. So an item can happen before `from` (it was observed late),
  and a moment in the window that was observed after `to` is in the next one.
- `next_cursor` is `window.to`, or, when the 150-item cap cut the window,
  1 ms before the first left-out item's `observed_at`. Pass it back as `from`
  to continue: nothing is lost at the cut and nothing repeats (6.34.0).
- `read_to` is your pointer after this call. With `mark_read: false` it is
  unchanged: that is the dry run. It is `null` until something has been
  marked read on the account; the default window is then the last day.
- `has_more` is `true` when the cap cut the window. `timeline_more` says how
  many items this call's filters would have shown from the cut on.
- `meta.timeline_pending` on any response counts subjects of yours the
  recorder has admitted something for since the oldest named reader's
  pointer when any reader has marked in the last 30 days (a reader silent
  longer is dead and no longer counts), else since the account's own.

### One pointer per reader

Without `reader`, `mark_read` moves a single instant on the account, and
two consumers that both mark move each other's window. With `reader`
(3.18.0) each consumer names its own pointer and marks it alone; the
account's unnamed pointer stays a person's own client's. A consumer that
keeps its own cursor still can (`mark_read: false` and its own `from`), but
`meta.timeline_pending` then counts against a pointer it never moves. The
code for both shapes is on the [agents page](/docs/agents#consuming-the-timeline).

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
| `battle_session` | player | a run of recorded battles with no gap of 30 minutes or more: battles, record, modes, ladder trophy net, `won_in_a_row`, `open` while it may still be going. Single battles never appear. |
| `session_standout` | a clan's member | a member's session that crossed a disclosed rung: `won_in_a_row` 5 / 10 / 20, ladder `trophy_net` ±150 / ±300 / ±500, `battles` 20 / 40 in one sitting. The session shape plus `crossed` (every rung so far) and `newly` (the rungs this window learned); `at` is the battle that crossed the first new rung. Once per rung: a session is never re-reported, and a window that learns more of the same session without a new rung carries nothing. The clan entry lists the five strongest under `standouts.sessions` with the rungs under `standouts.session_rungs`. Absolute trophy bands on purpose - a win is worth about the same at every ladder floor |
| `badge_earned`, `legendary_badge_earned` | player, or a clan's member | a tiered badge levelled up, or a one-off badge: `facts.badge` is the badge's API identifier (`MasterySkeletonWarriors`), `facts.badge_label` the badge as a player says it (`Guards Mastery`, 4.2.0), `facts.name` the member on a clan's timeline. A level-up is an item only at the badge's final level or a multiple of five (`max_level` rides on rows written since 3.9.0); the entry's `badges` counts every level-up |
| `arena_changed` | player, or a clan's member | arena moved, named from the arena catalog. When the record holds the crossing, `facts.promoted_by` names the win that reached the new arena's floor and `at` is that battle's instant rather than the poll's; absent means a capture gap, never a guess |

A battle a moment names (`promoted_by`, `crossed_by`) is one shape everywhere:
`battle_id`, `battle_time`, `type`, `opponent` (`player_tag`, `name`,
`starting_trophies`) for a 1v1 or `opponents` for a team battle, `crowns`,
`crowns_against`, `trophy_change`, and `trophies_after` when the battle
carried trophies (ranked battles carry none). The arena moment adds
`arena_floor`. The item's text says it: "moved to Royal Crypt from
Executioner's Kitchen, on a 3-0 win over Jotaro (5,976), +30 to 6,000".
| `ranked_promotion` | player, or a clan's member | Path of Legends league went up, by name. `facts.promoted_by` names the promoting battle when the record holds it: the last win played in the league below (a ranked battle is stamped with the league it started in), with `at` at that battle |
| `best_trophies_band` | player, or a clan's member | a new personal best crossing a 500 band; `facts.band` is the band, `facts.crossed_by` the Trophy Road win whose result first reached it, `at` at that battle |
| `collection_level_step`, `career_wins_step` | player, or a clan's member | collection level at a step that widens with the level (every 5 below 100, every 50 to 1,000, every 100 above; `facts.step` says which); career wins at a multiple of 1,000. `career_wins_step` carries `facts.step` and, when every win between the two snapshots is on the record (the window's wins reconcile with the lifetime counter), `facts.crossed_by` is the 1,000th win itself, `at` at that battle |
| `card_unlocked` | player, or a clan's member | a card the player did not have: `facts.card` is the card, `facts.name` the member on a clan's timeline (level-ups are a count in the entry, never items) |
| `clan_joined`, `clan_left` | player | the player moved clans |
| `member_joined`, `member_left`, `member_role_changed` | clan | who, with the role; a departure is raw, the game cannot tell a leave from a kick |
| `bracket_observed` | clan | the record's first sight of a new war week: `season_id`, `section_index`, `is_colosseum`, and `rivals[]` - the other four clans with `tag`, `name` and `recorded` (whether the hub records that clan, so a scout knows what it can drill). The week's start *time* is not here; `game_clock` has it |
| `race_finished` | clan | the boat crossed the finish line, with fame |
| `week_resolved` | clan | the week finished: fame, rank among the five, war trophy change |
| `quiet_crossed`, `returned` | player, or a clan's member | a member crossed 5, 10 or 20 recorded-quiet days (never while the silence is ours: `days_since_poll` rides along), or played again after seven or more |
| `account_*` | your account | feedback answered, recordings started or stopped, tier changes, connections |

Every member moment and every `session_standout` is an item; the response's
150-item cap and `next_cursor` bound them (6.34.0). The clan entry's `war` is
the calendar's week at the window's end: its fame, place and decks are that
week's recorded race, and null when the record holds no race for it.

### The `facts` keys, by kind

`text` is written from `facts`, and `facts` is what a consumer branches on.
Every member's moment on a clan's timeline adds `player_tag` and `name` (the
member) to the keys below; a clan's own item carries the clan's keys only.

| kind | `facts` |
|---|---|
| `battle_session` | `started_at`, `ended_at`, `battles`, `won`, `lost`, `drawn`, `by_mode` (battles per mode group), `trophy_net` (ladder only), `won_in_a_row`, `open` |
| `session_standout` | the session's keys above, plus `crossed` (every rung the session has passed, as `won_in_a_row>=5`, `trophy_net>=300`, `battles>=20`) and `newly` (the rungs this window learned) |
| `badge_earned` | `badge`, `badge_label`, `level`, `max_level`, `prior_level` (when there was one) |
| `legendary_badge_earned` | `badge`, `badge_label` |
| `arena_changed` | `from`, `to` (arena ids), `from_name`, `to_name`, and `promoted_by` (a battle, below) when the record holds the crossing |
| `ranked_promotion` | `from`, `to` (league numbers), `from_name`, `to_name`, and `promoted_by` when the record holds it |
| `best_trophies_band` | `best`, `band`, and `crossed_by` when the record holds it |
| `career_wins_step` | `wins`, `step`, and `crossed_by` when every win between the two snapshots is on the record |
| `collection_level_step` | `level`, `step` |
| `card_unlocked` | `card`, `card_id`, `rarity` |
| `clan_joined`, `clan_left` | `clan_tag`, `clan_name`, `at` |
| `member_joined` | `player_tag`, `name`, `role`, `roster_size_before`, `roster_size_after` |
| `member_left` | `player_tag`, `name`, `role_at_departure`, `joined_observed_at`, `roster_size_before`, `roster_size_after` |
| `member_role_changed` | `player_tag`, `name`, `role_before`, `role_after`, `direction`, `roster_size_before`, `roster_size_after` |
| `bracket_observed` | `season_id`, `section_index`, `is_colosseum`, `rivals[]` (`tag`, `name`, `recorded`) |
| `race_finished` | `season_id`, `section_index`, `fame`, `finish_time` |
| `week_resolved` | `season_id`, `section_index`, `is_colosseum`, `fame`, `rank`, `trophy_change` |
| `quiet_crossed` | `rung` (5, 10 or 20), `days_quiet`, `days_since_poll`, and `role` on a clan's timeline |
| `returned` | `after_days` |
| `account_*` | the event's own detail (a feedback id and status, a subject tag, a tier, a connection name) |

A `promoted_by` or `crossed_by` battle is the one shape described above
(`battle_id`, `battle_time`, `type`, `opponent` or `opponents`, `crowns`,
`crowns_against`, `trophy_change`, `trophies_after`, and `arena_floor` on the
arena moment).

A profile-derived moment (arena, ranked league, best band, collection
level, badges, cards) is written once, by the first profile poll that
sees it; later polls the same day rewrite the day's snapshot and never
the moment. An arena move is polled for as soon as the player's own
battles vouch for it (see [Recording](/docs/recording/), the profile
arena request), so it arrives within the battle log's cadence rather
than the profile's.

Trophy Road arenas have floors: reaching the floor puts a player in the
arena, and a loss never takes them below it again (a loss on the floor is
reported by the game with no trophy change; a loss just above it is
clamped). The last floor, 14,000, is where Trophy Road ends: a player
there stays there whatever they lose, and the seasonal road beyond it
resets each season. The promotion is therefore the win whose result first reaches
the floor, whoever it was against - near a gate that is usually someone
already standing on it, because matchmaking pairs a climber with the
players sitting on the floor above, but it need not be. The floor is read
from the record (the lowest trophies any snapshot has shown in that arena,
or this player's own gated loss), never assumed.

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
badges, standout sessions with their rungs, each bounded and named),
`donations`.

Tracked players with nothing in the window get no entry; they are listed
under `quiet` with `days_quiet` and `days_since_poll`. A clan always gets an
entry: a clan's silence is the clan's activity.

## What the timeline never does

- **It never tells you what time it is.** A war day opening or closing is a
  clock fact; `game_clock` carries `war_day_closes_at`,
  `next_war_day_opens_at`, `next_training_starts_at` and `week_ends_at` so a
  routine that cares schedules itself.
- **It never gives advice.** "Passed 10 recorded-quiet days" is a fact with a
  disclosed rung; whether that means anything is the reader's call. The same
  goes for a standout session: `crossed` names the rung, the reader decides
  whether five wins in a row is news in this clan.
- **It never assumes what the reader is for.** The same items serve a
  clan-management routine, a highlights bot, a recruiter watching churn, a
  war-only agent, and a person reading the console. Each reads the sections
  it cares about.

## A routine that uses it

1. Read `game_clock` once; if you care about war, schedule yourself from
   `war_day_closes_at`.
2. Call `elixir_timeline` as your own `reader`, with `kinds` naming what
   you wake on; skip the call when the last response's
   `meta.timeline_pending` was 0. If `timeline` is empty, there is nothing
   to consider. Otherwise read the items, then the entries for the shape of
   the window.
3. Drill with the data tools for anything worth more: `clans_roster`,
   `war_current`, `clans_participation`, `players_summary`.
4. Nothing to save: your reader's pointer is the window's end. A consumer
   without a `reader` saves `next_cursor` and marks only if it owns the
   account's pointer.

On first run the window is the last 24 hours; an agent that posts a month
of backlog into a channel is the most common mistake with a feed like this,
and the cap and the default exist to prevent it.
