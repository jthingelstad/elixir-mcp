---
slug: timeline
title: "The timeline"
description: "elixir_timeline: what happened to the players and clans you track since your read pointer, as items newest first (battle sessions, named moments, roster and war moments, presence) plus one summary entry per subject; who is a subject for a person and for an agent; the window and read-pointer semantics; what the timeline never does."
section: agent
order: 8
navTitle: "Timeline"
icon: bell
lede: "What happened to the players and clans you track, newest first, written so a person can read it and an agent can act on it."
console: ["Your timeline", "/console/account/timeline", "Console ▸ Timeline"]
---

# The timeline

Most tools answer a question you asked. The timeline is the other
direction: it tells you what happened to the subjects you track since you
last looked, newest first like a newsfeed, so a scheduled agent can read
one thing and decide what to consider, and so a person can read the same
thing and simply know.

It is **synthesized when you read it**, from the record and the per-subject
ledger. Nothing is queued, fanned out or pruned. A reader that comes back
after a month gets a month's timeline (capped at 30 days, and at the newest
150 items).

## `elixir_timeline`

| Argument | Type | Default | Notes |
|---|---|---|---|
| `from` | string | your read pointer, else 24 hours ago | EXCLUSIVE: items observed after it; an ISO instant, or `YYYY-MM-DD` at local midnight in your timezone; capped at 30 days before `to` |
| `to` | string | now | INCLUSIVE, compared at the millisecond served; an ISO instant, or a date covering that whole local day |
| `days`, `weeks` | integer | none | the last N days or weeks ending now: sugar for `from` |
| `season` | string or number | none | one season's span (`current`, `previous`, `2026-08` or `135`), to now while it runs, as on every windowed tool (9.1.0); still capped at 30 days, and `from`/`to`/`days`/`weeks` given win over it |
| `mark_read` | boolean | `true` | move the read pointer (the reader's, or the account's) to this window's end |
| `reader` | string | none | this consumer's own pointer, by a short name (`^[a-z0-9][a-z0-9-]{0,31}$`; 3.18.0): an omitted `from` reads since it, `mark_read` moves it, `read_to` reports it; the account's unnamed pointer and every other reader's are untouched |
| `sections` | string[] | all | keep only items and entry sections in these sections |
| `kinds` | string[] | all | keep only items of these kinds (the table below, or `account_*`); entries are untouched. A consumer that wakes on a few kinds reads only those |
| `player_tag` | string | none | keep only items about this player: their moments and sessions, and on a clan's timeline their member moments and sessions; applied before the cap; never moves the read pointer (7.1.5-7.1.7) |
| `verbosity` | `full` \| `compact` | `full` | compact keeps items, entry summaries and player notables, and drops entry sections including clan standouts |
| `timezone` | IANA zone | the account's | for date-only bounds and the text's times |

Response: `{ window: { from, to }, read_to, timeline: [...], timeline_more,
timeline_more_to, entries: [...], quiet: [...], subjects, next_cursor,
has_more, notes, docs, meta }`.

- `timeline` is **newest first** by `at` (when a moment happened), like a
  newsfeed (7.0.0). A window selects items by `observed_at`, when the record
  learned them, in `(from, to]`. So an item can happen before `from` (it was
  observed late), and a moment in the window that was observed after `to`
  is in the next one.
- `next_cursor` is always `window.to`. Pass it back as `from` to continue
  from the present.
- **A busy window keeps its newest.** Past the 150-item cap (or the
  response's size budget), `timeline` holds the items observed after the
  newest one left out, and the older ones are counted, not served: a
  reader catching up after days away lands on what is happening now, and
  the entries still summarize the whole window. To read the older items
  on purpose, pass the same `from` with `to` at the cut, which the note
  names and `timeline_more_to` carries (`null` when nothing was cut), and
  `mark_read: false`.
- `read_to` is your pointer after this call. With `mark_read: false` it is
  unchanged: that is the dry run. It is `null` until something has been
  marked read on the account; the default window is then the last day.
- `has_more` is `true` when the cap cut the window. `timeline_more` says how
  many older items this call's filters would have shown that it left out.
- `meta.timeline_pending` on any response counts subjects of yours the
  recorder has admitted something for since the oldest named reader's
  pointer when any reader has marked in the last 30 days (a reader silent
  longer is dead and no longer counts), else since the account's own.

### One pointer per reader

**Every agent has its own pointer.** An agent is its own account, so an
agent's connection reads and marks the agent's pointer, never yours or
another agent's. Give each app its own agent: two apps sharing one agent
connection share its pointer and move each other's window, which is the
case `reader` below exists for, and a second agent is the better answer.

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

Every item is `{ id, revision, at, observed_at, subject_tag,
subject_name, kind, section, text, facts }`:

| field | what it is |
|---|---|
| `id` | the story the item tells (9.15.0): opaque (`tl_` and 20 hex characters), the same in every read and every window. It names the happening, not the reader, so a member's moment has one id on the clan's timeline and on the player's own, and a sitting's `battle_session` and `session_standout` share one. Never a ledger sequence number |
| `revision` | how far the story has grown (9.15.0): 1 for a moment that never grows. A sitting's is its battles counted from its first battle, which a window can start after (a `session_standout`'s, up to the last rung this window learned), so a sitting told at 20 battles and read again at 40 is the same `id` at a higher `revision` |
| `at` | when it happened |
| `observed_at` | when the record observed it, which is what selects it into a window (6.25.0); a polled moment can be observed well after `at` |
| `subject_tag`, `subject_name` | whose timeline it is on: a player or a clan (a member's moment is on the clan's); `subject_tag` is null on your account's items |
| `kind`, `section` | what it is (below); `section` is the entry section it belongs to, so `sections` filters items and entries together |
| `text` | a sentence a person can read |
| `facts` | the numbers and names `text` was written from |

| kind | subject | what it is |
|---|---|---|
| `battle_session` | player | a run of recorded battles with no gap of 30 minutes or more: battles, record, modes, ladder trophy net, `won_in_a_row`, `open` while it may still be going. On a player's own timeline every sitting is an item, a single battle included; a clan's members' ordinary sessions are not items there (see `session_standout`, and `player_tag` below). A reader that moves its pointer sees each sitting once; a member read (`player_tag`) keeps no pointer, so a sitting still being learned can come back with a running total under the same `id` at a higher `revision`: update, never retell. |
| `session_standout` | a clan's member | a member's session that crossed a disclosed rung: `won_in_a_row` 5 / 10 / 20, ladder `trophy_net` ±150 / ±300 / ±500, `battles` 20 / 40 in one sitting. The session shape plus `crossed` (every rung so far) and `newly` (the rungs this window learned); `at` is the battle that crossed the first new rung. Once per rung: a session is never re-reported, and a window that learns more of the same session without a new rung carries nothing; a new rung is the sitting's `id` at a higher `revision`. The clan entry lists the five strongest under `standouts.sessions` with the rungs under `standouts.session_rungs`. Absolute trophy bands on purpose - a win is worth about the same at every ladder floor |
| `badge_earned`, `legendary_badge_earned` | player, or a clan's member | a tiered badge levelled up, or a one-off badge: `facts.badge` is the badge's API identifier (`MasterySkeletonWarriors`), `facts.badge_label` the badge as a player says it (`Guards Mastery`, 4.2.0), `facts.name` the member on a clan's timeline. A level-up is an item only at the badge's final level or a multiple of five (`max_level` rides on rows written since 3.9.0); the entry's `badges` counts every level-up |
| `arena_changed` | player, or a clan's member | arena moved, named from the arena catalog. When the record holds the crossing, `facts.promoted_by` names the win that reached the new arena's floor and `at` is that battle's instant rather than the poll's; absent means a capture gap, never a guess |
| `ranked_promotion` | player, or a clan's member | Path of Legends league went up, by name. `facts.promoted_by` names the promoting battle when the record holds it: the last win played in the league below (a ranked battle is stamped with the league it started in), with `at` at that battle |
| `best_trophies_band` | player, or a clan's member | a new personal best crossing a 500 band; `facts.band` is the band, `facts.crossed_by` the Trophy Road win whose result first reached it, `at` at that battle |
| `collection_level_step`, `career_wins_step` | player, or a clan's member | collection level at a step that widens with the level (every 5 below 100, every 50 to 1,000, every 100 above; `facts.step` says which); career wins at a multiple of 1,000. `career_wins_step` carries `facts.step` and, when every win between the two snapshots is on the record (the window's wins reconcile with the lifetime counter), `facts.crossed_by` is the 1,000th win itself, `at` at that battle |
| `card_unlocked` | player, or a clan's member | a card the player did not have: `facts.card` is the card, `facts.name` the member on a clan's timeline (level-ups are a count in the entry, never items) |
| `card_form_unlocked` | player, or a clan's member | an Evolution or Hero form the player newly unlocked (9.14.0): `facts.card` is the card, `facts.form` is `evolution` or `hero`, and the text says it as a player does ("unlocked Hero Valkyrie"). One item per form, so a card that gains both at once is two. `at` is the profile read that saw it: the unlock happened **no later than** that, after some earlier read the record may not hold (collectors skip a profile that has not changed), so no earlier bound is served. Recorded from 9.14.0 (2026-09-28) and never backfilled: a form unlocked before then is in `players_collection`'s `forms_unlocked`, never here |
| `clan_joined`, `clan_left` | player | the player moved clans |
| `member_joined`, `member_left`, `member_role_changed` | clan | who, with the role; a departure is raw, the game cannot tell a leave from a kick (a clan's leaders can, through Elixir Clan: `departure_classified`) |
| `bracket_observed` | clan | the record's first sight of a new war week: `season_id`, `section_index`, `is_colosseum`, and `rivals[]` - the other four clans with `tag`, `name` and `recorded` (whether the hub records that clan, so a scout knows what it can drill). The week's start *time* is not here; `game_clock` has it |
| `race_finished` | clan | the boat crossed the finish line, with fame |
| `week_resolved` | clan | the week finished: fame, rank among the five, war trophy change |
| `quiet_crossed`, `returned` | player, or a clan's member | a member crossed 5, 10 or 20 recorded-quiet days (never while the silence is ours: `days_since_poll` rides along), or played again after seven or more |
| `account_*` | your account | feedback answered (`account_feedback_responded`), recordings started or stopped, role changes (`account_role_changed`), connections |
| `departure_classified`, `role_change_made`, `award_granted`, `award_standing`, `member_away`, `clan_message` | clan | [attested facts](/docs/integrations#attested-facts) (9.2.0): what a person did in the clan through a family app (a leader says a departure was a kick or a leave; a promotion made; the clan's own award; a member away; a Clan Leader Message or clan chat line), and what the app itself computed (`award_standing`, 9.6.0: where a member stands in one of the clan's awards). Section `attested`; `facts` is the fact's detail plus `player_tag` and `name` for the member it is about (and `previous_name` beside a standing's `previous_player_tag`), `attested_by` (`app`, `player_tag`, `name`, `role`; the last three null on the app's own fact) and `visibility`. Shown only to a reader whose verified player (an agent's owner's) is in the clan; an away only to a **person** whose verified player leads it, never to an agent. A departure's kind reaches the clan and its agent (9.3.0). `at` is when it happened; it is selected by when Elixir recorded it |
| `personal_record` | player | an attested fact from a family app's own game (Elixir Drop): `game`, `score`, `previous_best`, `attested_by`. Section `attested` |

A battle a moment names (`promoted_by`, `crossed_by`) is one shape everywhere:
`battle_id`, `battle_time`, `type`, `opponent` (`player_tag`, `name`,
`starting_trophies`) for a 1v1 or `opponents` for a team battle, `crowns`,
`crowns_against`, `trophy_change`, and `trophies_after` when the battle
carried a starting count (a Ranked battle does only in league 7, where it
is the rating; leagues 1-6 carry a win's `+30` and nothing else). The arena moment adds
`arena_floor`. The item's text says it: "moved to Royal Crypt from
Executioner's Kitchen, on a 3-0 win over Jotaro (5,976), +30 to 6,000".

Every member moment and every `session_standout` is an item; the response's
150-item cap bounds them, keeping the newest (7.0.0). The clan entry's `war` is
the calendar's week at the window's end: its fame and place are that week's
recorded race, and null when the record holds no race for it. Its `decks`
(who is untouched, partial and finished) is served only when the window
ends inside the war day still being played, the same day-in-progress
picture as `war_current.decks_today`, and is `null` for any other window:
a closed war day is never split out, because war facts are weekly
([Battle model](/docs/battles#war-weeks-points-and-fame)). A window
that ends before that week's race closed reads the race as it stood then: fame
and place at the last war day closed by `to`, no `race_finished_at`, and
`as_of_window_end: true` (7.1.2). Where the record holds no closed day for
that week by then (a Colosseum week, or war day 1 still open), fame and place
are `null`, not 0: `war_history` has the week's days.

A clan entry's `activity` counts the battles the record learned in the window.
`activity.played_here_learned_later` counts battles played in it that the
record learned afterwards (a history backfill); for what was played in a past
window, `clans_standings` counts by play time.

The two totals differ by design, and neither is wrong. The timeline counts
each battle **once**, learned in the window, played while in the clan.
`clans_standings` counts each member's battles by **play time**, so a friendly
between two members is one battle on the timeline and one on each member's
row, and a member who joined mid-window brings the battles they played for
another clan (its note names them). On 2026-09-23's game day that was 292
learned (293 played) against 312: 13 of one member's friendlies were against
clanmates.

A battle the record learned more than a day after it was played (a history
backfill, a log polled late) is a late capture: counted in the entry's
`battles.late_captures` and never narrated, whatever the window (7.1.2).

### Telling the story

Evidence is separate from story growth: an existing
moment may gain proof under the same `id` and `revision`. Compare its
`evidence.version` before describing the new proof; this is an update to
that moment, not another achievement.

Post once per `id`. When a later read serves an `id` you have told at a
higher `revision`, the story grew: update it, or say "and now...", and
never retell it. The same `id` at the same or a lower `revision` is a
story you have told; say nothing. Keep the ids you have told, with the
revision you told each at, and a timeline read through overlapping
windows, a member read, or a read after a restart never repeats itself.

### Recorded evidence

The Console's **View games** and **View crossing** open a read-only evidence
panel. Sessions list exact canonical games in play order (time, then game
ID), 25 per page, with links to their existing public battle pages. These
are the games from the anchored sitting through the item's end; a clan
standout ends at the last rung this read learned. This can reach before the
read window. The evidence count describes that scope, while the item's
session facts continue to describe its original read window.
The panel names both scopes: a 15-game sitting can have ten linked games when
its latest new milestone occurred at game ten. The later five games belong to
the sitting summary. They are outside that milestone's evidence interval, rather
than a hidden second page. Page controls appear only when more canonical games
remain inside the evidence interval. Closing the panel returns to its original
row; narrative cells wrap to keep evidence controls visible on desktop.

Every supported item carries `evidence.kind`, `version`, `observed_at`,
`count` and `completeness`. `observed_at_basis` distinguishes recorded
capture/observation time from `legacy_window`: old rows retain the original
observation window because their proof attachment time was not recorded. A sitting says `recorded_only`: actual capture
completeness is **unknown**, even when all its recorded games are listed.
`anchor_bound` means the 200-step search may omit its beginning. `open` says
whether the sitting was still open at this read. Boat defenses and games
captured more than a day late remain outside these sessions.

A crossing says `proved` only when its canonical game establishes it.
For a ranked promotion, the observed profile league change is paired with the
last recorded winning Path of Legends game stamped in the prior league. Its
API-reported `trophy_change` belongs to that ranked game. In the lower leagues
the win field is +30 without a starting rating; it does not establish a Trophy
Road increase or a measured rating change. Keep a player's current Trophy Road
standing and wider mixed-mode statistics separate from the crossing's evidence.
Otherwise it says `unknown`; it never substitutes the nearest game. A
roster-observed arena move can later gain proof: its original logical
origin is frozen before enrichment, its ID stays the same, and its evidence
revision and observation time advance when the proof arrives. Existing
legacy rows resolve their origin without a historical rewrite.

An agent passes `evidence_item_id` to `elixir_timeline`, with the original
`from` and `to`, `evidence_offset` (default 0), `evidence_limit` (1–25), and
`expected_evidence_version` from the item (required after the first page).
An evidence read returns that one item and its page, without full summary
entries, so even a busy feed has room for supporting game facts. The optional response `evidence`
contains `battles` with canonical `battle_id`, `at`, `type`, `mode_group`,
`outcome`, `crowns`, `trophy_change`, `url`, `short_id` and
`relation` (`constituent` or `proved_crossing`), plus `next_offset` or null.
A changed version asks the reader to refresh the item before continuing;
an unavailable or no longer visible item returns no evidence. Evidence
reads always keep the read pointer, including when `mark_read` is omitted.
Paging constituent games does not change the newsfeed's cap or ordering.
The membership fingerprint and page share one database snapshot; concurrent
capture asks for a refresh instead of silently shifting game offsets.

Each result belongs to that game's mode. A ranked win and its +30 progress
are ranked evidence, not Trophy Road progress. Current profile trophies,
another mode's results and broader season statistics are separate context;
they do not prove that milestone. Evidence offers concise canonical facts
to authorized MCP agents as well as people, without changing posting behavior.

Evidence remains subject to the reader's existing visible Timeline subjects.
Private attested facts retain their existing membership and role checks and
do not gain game links. References use retained canonical history; no battle
payload or extra history copy is stored. The Console's seven-day view is a
read window, not a new retention policy. This panel does not create an
Action, draft a message, send a notification, or grant an award.

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
| `card_form_unlocked` | `card`, `card_id`, `rarity`, `form` (`evolution` or `hero`) |
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
level, badges, cards and their forms) is written once, by the first profile poll that
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
trophy net, late captures), `trophies`, `arena`, `ranked`, `collection`
(the level's move, `unlocked` cards, `forms_unlocked` as a player says
them, "Hero Valkyrie", and a count of level-ups), `badges`, `clan` (current clan and moves), `war` (`battles`: the war
battles the player played in the window, boat defenses excluded, with no
split by war day), `presence` (`last_battle_at`, `days_quiet`,
`days_since_poll`, `returned_after_days`).

A clan's entry: `activity` (battles, sessions, members active, by mode;
`basis` says `recorded`, or that an activity-scope clan records roster and
war only), `roster` (joined, left with tenure, role changes, size at each
end), `war` (season and week, the day at the window end, fame and place,
`race_finished_at`, `decks` with `as_of` only while the window ends in the
war day in progress, weeks `resolved`),
`presence` (quiet rung crossings, returns, never recorded), `standouts`
(most battles, new bests, arena and ranked promotions, collection levels,
badges, standout sessions with their rungs, each bounded and named),
`donations`.

Clan presence is historical: its quiet and never-recorded summary uses
membership at the requested window's end. Quiet-crossing and return items
include people who belonged at the time of that moment, even if they left
before the window ended. A later departure, a rejoin or a future newcomer
cannot move someone into or out of an earlier window's presence population.

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
- **It never passes an app's word off as the game's.** An attested fact
  (section `attested`) is what a person said through a family app, and
  says so in `attested_by`; the game's own record of the same moment
  (`member_left`, `member_role_changed`) stays beside it, raw.
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

## One member, and the window's bounds

`player_tag` keeps one player's items: their own moments and sessions, and on
a clan's timeline their member moments and sessions (7.1.5-7.1.7). It is
applied before the item cap, `applied.player_tag` echoes it, a tag that is
not one of your players or a member of your clans says so, and a member read
never moves the read pointer. On a clan's timeline a member's session
item is a sitting of two or more battles; on a player's own timeline a
single battle is a session item too.

Every window is **(from, to]** by when the record observed an item, compared
at the millisecond the tool serves: `from` is exclusive and `to` inclusive,
so the busy-window note's `to` reaches the item at the cut. A clan entry's
`activity` counts the battles the record learned in the window:
`activity.learned_here_played_before` counts ones played in the day before
`from` and recorded here (counted), `activity.played_here_learned_later` ones
played in the window and recorded after `to` (not counted).
