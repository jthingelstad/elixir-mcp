---
slug: timeline
title: "The timeline"
description: "elixir_timeline: what happened to the players and clans you track since your read pointer, as items newest first (battle sessions, named moments, roster and war moments, presence) plus one summary entry per subject; who is a subject for a person and for an agent; the window and read-pointer semantics; cross-posting a timeline to Discord; what the timeline never does."
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
| `from` | string | your read pointer, else 24 hours ago | EXCLUSIVE: items after it, by the window's `basis`; an ISO instant, or `YYYY-MM-DD` at local midnight in your timezone; capped at 30 days before `to` |
| `to` | string | now | INCLUSIVE, compared at the millisecond served; an ISO instant, or a date covering that whole local day |
| `basis` | `occurred` \| `observed` | `observed` for a poller, else `occurred` | what the window bounds ([Two kinds of window](#two-kinds-of-window)): `occurred` is what HAPPENED in it, `observed` what the record LEARNED in it. A poller is a read with a `reader`, a read from the stored pointer (no `from`), or one passing `mark_read: true` |
| `days`, `weeks` | integer | none | the last N days or weeks ending now: sugar for `from` |
| `season` | string or number | none | one season's span (`current`, `previous`, `2026-08` or `135`), to now while it runs, as on every windowed tool; still capped at 30 days, and `from`/`to`/`days`/`weeks` given win over it |
| `mark_read` | boolean | `true` on an observed read | move the read pointer (the reader's, or the account's) to this window's end. An occurred read never moves a pointer, and asking it to (`mark_read: true` with `basis: occurred`) is refused |
| `reader` | string | none | this consumer's own pointer, by a short name (`^[a-z0-9][a-z0-9-]{0,31}$`): an omitted `from` reads since it, `mark_read` moves it, `read_to` reports it; the account's unnamed pointer and every other reader's are untouched |
| `sections` | string[] | all | keep only items and entry sections in these sections |
| `kinds` | string[] | all | keep only items of these kinds (the table below, or `account_*`); entries are untouched. A consumer that wakes on a few kinds reads only those |
| `player_tag` | string | none | keep only items about this player: their moments and sessions, and on a clan's timeline their member moments and sessions; applied before the cap; never moves the read pointer |
| `evidence_item_id` | string | none | one visible item's `id` (`tl_` and 20 hex characters): read that item's recorded games instead of the feed ([Recorded evidence](#recorded-evidence)); pass the original `from` and `to`. Never moves any read pointer |
| `evidence_offset` | integer | 0 | 0 to 10,000: where the page of games starts |
| `evidence_limit` | integer | 25 | 1 to 25 games per page |
| `expected_evidence_version` | string | none | the item's `evidence.version`; required after the first page, so a page never shifts under changed evidence |
| `skip_empty` | boolean | `false` | for polling: a window with no item this read's `kinds` would keep is answered without reading the subjects, so `timeline`, `entries` and `quiet` are empty and `entries_skipped` is `true`. The pointer, `next_cursor` and `meta` move as on any read ([Polling cheaply](#polling-cheaply)) |
| `verbosity` | `full` \| `compact` | `full` | compact keeps items (without `follow`), entry summaries and player notables, and drops entry sections including clan standouts |
| `timezone` | IANA zone | the account's | for date-only bounds and each item's `local` |

Response: `{ window: { from, to }, read_to, timeline: [...], timeline_more,
timeline_more_to, entries: [...], entries_skipped, quiet: [...], subjects,
next_cursor, has_more, notes, docs, meta }`.

- `timeline` is **newest first** by `sort_at`, like a newsfeed: when the
  story happened (a sitting's last battle, else `at`). `applied.basis`
  says what the window bounded.
- `next_cursor` is always `window.to`. Pass it back as `from` to continue
  from the present.
- **A busy window keeps its newest.** Past the 150-item cap (or the
  response's size budget), `timeline` holds the items after the newest one
  left out (by the window's basis), and the older ones are counted, not served: a
  reader catching up after days away lands on what is happening now, and
  the entries still summarize the whole window. To read the older items
  on purpose, pass the same `from` with `to` at the cut, which the note
  names and `timeline_more_to` carries (`null` when nothing was cut), the
  same `basis`, and `mark_read: false`.
- `read_to` is your pointer after this call. With `mark_read: false` it is
  unchanged: that is the dry run. It is `null` until something has been
  marked read on the account; the default window is then the last day.
- `has_more` is `true` when the cap cut the window. `timeline_more` says how
  many older items this call's filters would have shown that it left out.
- `meta.timeline_pending` on any response counts subjects of yours the
  recorder has admitted something for since the oldest named reader's
  pointer when any reader has marked in the last 30 days (a reader silent
  longer is dead and no longer counts), else since the account's own.

### Two kinds of window

The record learns about a game when a collector reads the player's log,
which can be minutes or hours after it was played. So a window can mean
two things, and `basis` says which:

- **`occurred`**: the items that happened in `(from, to]`, by `sort_at`.
  This is "what happened on Saturday": Friday's games learned on Saturday
  are not in it. It is the default for a read that is not a poller, and it
  never moves a read pointer, because a game played in the window can
  still be learned after the read.
- **`observed`**: the items the record learned in `(from, to]`, by
  `observed_at`. This is the poller's window: read from where you left off
  and nothing learned late is ever skipped. An item that happened before
  `from` carries `late: true`; tell it as the earlier day's story (its
  `local` says which day), or leave it out. It is the default for a read
  with a `reader`, a read from the stored pointer, and a read passing
  `mark_read: true`.

A clan entry's `activity` follows the basis too: on an occurred read it
counts the battles played in the window (`activity.basis` is `played`).

### One pointer per reader

**Every agent has its own pointer.** An agent is its own account, so an
agent's connection reads and marks the agent's pointer, never yours or
another agent's. Give each app its own agent: two apps sharing one agent
connection share its pointer and move each other's window, which is the
case `reader` below exists for, and a second agent is the better answer.

Without `reader`, `mark_read` moves a single instant on the account, and
two consumers that both mark move each other's window. With `reader`
each consumer names its own pointer and marks it alone; the
account's unnamed pointer stays a person's own client's. A consumer that
keeps its own cursor still can (`mark_read: false` and its own `from`), but
`meta.timeline_pending` then counts against a pointer it never moves. The
code for both shapes is on the [agents page](/docs/agents#consuming-the-timeline).

## Who is a subject

Subscriptions are implicit; nothing to configure.

| Reader | Subjects | On the timeline |
|---|---|---|
| a person | every player they track with notify on (primary, alts, friends, watching); every clan they added with notify on | each player's sessions and moments; each clan's roster, war and members' moments |
| an agent | every clan it tracks with notify on (the clan it acts for, and any other); every player it tracks with notify on, always `watching`, never "me" | each clan's roster, war and members' moments; each player's sessions and moments. A clan's members appear **on the clan's timeline**, never as subjects of their own |
| an integration | none | nothing |

The entry's shape follows the subject, not the account: a person who adds a
clan gets the same clan entry an agent gets. `notify_off` on a subject
silences it without touching its recording.

## Items

Every item is `{ id, revision, at, sort_at, at_unix, local, observed_at,
late, subject_tag, subject_name, nickname?, subjects, kind, schema,
section, text, visibility, publishable, facts, follow }`:

| field | what it is |
|---|---|
| `id` | the story the item tells: opaque (`tl_` and 20 hex characters), the same in every read and every window. It names the happening, not the reader, and a read serves each `id` once ([One story, one item](#one-story-one-item)). Never a ledger sequence number |
| `revision` | how far the story has grown: 1 for a moment that never grows. A sitting's is its battles the record holds so far, so a sitting told at 20 battles and read again at 40 is the same `id` at a higher `revision`; a crossing's is its proof's attachment revision |
| `at` | when it happened; what that means for each kind is in [the facts table](#the-facts-keys-by-kind) |
| `sort_at` | the instant the feed is ordered by and an occurred window selects on: a sitting's last battle, else `at` |
| `at_unix` | `at` in Unix seconds, for a renderer's own clock |
| `local` | `at` on the reader's clock: `date` (`YYYY-MM-DD`), `time` (`HH:MM`), `weekday` (`Sat`) and `tz` |
| `observed_at` | when the record learned it, which an observed window selects on; a polled moment can be learned well after `at` |
| `late` | an observed read learned it, but it happened before `from`; always `false` on an occurred read |
| `subject_tag`, `subject_name` | whose story it is: a player or a clan, by the in-game name; `subject_tag` is null on your account's items |
| `nickname` | your private nickname for the subject player, when you set one; never in `text`, never published |
| `subjects` | every player and clan the story is about, `{ tag, kind, name }`, players first: a member's sitting names the member and the clan |
| `kind`, `section` | what it is (below); `section` is the entry section it belongs to, so `sections` filters items and entries together |
| `schema` | `<kind>/<version>`: the shape its `facts` follow. A kind's version moves when its facts or the meaning of its `at` change |
| `text` | one sentence a person can read, with no time in it: render the time from `at_unix` or `local` |
| `visibility`, `publishable` | who may see it (`public` for the game record; `clan`, `player` or `leaders` for an attested fact, by its type; `owner` for your account's own administration), and whether it may be posted outside Elixir: `public`, `clan` and `player` may; `leaders` and `owner` never |
| `facts` | the numbers and names `text` was written from |
| `follow` | where the item leads: the reads that expand it into its story, each `{ tool, args }`, a tool you may call and the arguments to call it with ([Where an item leads](#where-an-item-leads)). Full verbosity only |

| kind | subject | what it is |
|---|---|---|
| `battle_session` | player | a run of recorded battles with no gap of 30 minutes or more, `open` while it may still be going. On a player's own timeline every sitting is an item, a single battle included; a clan's members' ordinary sessions are not items there (see `session_standout`, and `player_tag` below). A reader that moves its pointer sees each sitting once; a member read (`player_tag`) keeps no pointer, so a sitting still being learned can come back with a running total under the same `id` at a higher `revision`: update, never retell. |
| `session_standout` | a clan's member | a member's session that crossed a disclosed rung: `won_in_a_row` 5 / 10 / 20, ladder `trophy_net` ±150 / ±300 / ±500, `battles` 20 / 40 in one sitting. Once per rung: a session is never re-reported, and a window that learns more of the same session without a new rung carries nothing; a new rung is the sitting's `id` at a higher `revision`. The clan entry lists the five strongest under `standouts.sessions` with the rungs under `standouts.session_rungs`. Absolute trophy bands on purpose - a win is worth about the same at every ladder floor |
| `badge_earned`, `legendary_badge_earned` | player, or a clan's member | a tiered badge levelled up, or a one-off badge: `facts.badge` is the badge's API identifier (`MasterySkeletonWarriors`), `facts.badge_label` the badge as a player says it (`Guards Mastery`), `facts.name` the member on a clan's timeline. A level-up is an item only at the badge's final level or a multiple of five (`max_level` is absent on the oldest rows); the entry's `badges` counts every level-up |
| `arena_changed` | player, or a clan's member | arena moved, named from the arena catalog. When the record holds the crossing, `facts.promoted_by` names the win that reached the new arena's floor and `at` is that battle's instant rather than the poll's; absent means a capture gap, never a guess |
| `ranked_promotion` | player, or a clan's member | Path of Legends league went up, by name. `facts.promoted_by` names the promoting battle when the record holds it: the last win played in the league below (a ranked battle is stamped with the league it started in), with `at` at that battle |
| `best_trophies_band` | player, or a clan's member | a new personal best crossing a 500 band; `facts.band` is the band, `facts.crossed_by` the Trophy Road win whose result first reached it, `at` at that battle |
| `collection_level_step`, `career_wins_step` | player, or a clan's member | collection level at a step that widens with the level (every 5 below 100, every 50 to 1,000, every 100 above; `facts.step` says which); career wins at a multiple of 1,000. `career_wins_step` carries `facts.step` and, when every win between the two snapshots is on the record (the window's wins reconcile with the lifetime counter), `facts.crossed_by` is the 1,000th win itself, `at` at that battle |
| `card_unlocked` | player, or a clan's member | a card the player did not have: `facts.card` is the card, `facts.name` the member on a clan's timeline (level-ups are a count in the entry, never items) |
| `card_form_unlocked` | player, or a clan's member | an Evolution or Hero form the player newly unlocked: `facts.card` is the card, `facts.form` is `evolution` or `hero`, and the text says it as a player does ("unlocked Hero Valkyrie"). One item per form, so a card that gains both at once is two. `at` is the profile read that saw it: the unlock happened **no later than** that, after some earlier read the record may not hold (collectors skip a profile that has not changed), so no earlier bound is served. Recorded from 2026-09-28 and never backfilled: a form unlocked before then is in `players_collection`'s `forms_unlocked`, never here |
| `clan_joined`, `clan_left` | player | the player moved clans. A join is one Elixir saw happen, between two roster reads of the clan: the first time Elixir sees a player in a clan (the clan's first roster read, or the first read that records that member) is a baseline, never a join (from 2026-10-08; moments written before then are unchanged) |
| `member_joined`, `member_left`, `member_role_changed` | clan | who, with the role; a departure is raw, the game cannot tell a leave from a kick (a clan's leaders can, through Elixir Clan: `departure_classified`), so its sentence says the member departed, never that they left; a classified kick says the member was removed. The same baseline rule: a clan's first roster read, and the first read of a clan that was read only for its tracked players before it was tracked, name nobody as joining |
| `bracket_observed` | clan | the record's first sight of a new war week: `season_id`, `section_index`, `is_colosseum`, and `rivals[]` - the other four clans with `tag`, `name` and `recorded` (whether the hub records that clan, so a scout knows what it can drill). The week's start *time* is not here; `game_clock` has it |
| `race_finished` | clan | the boat crossed the finish line, with fame |
| `week_resolved` | clan | the week finished: fame, rank among the five, war trophy change, and each member's week by points |
| `quiet_crossed`, `returned` | player, or a clan's member | a member crossed 5, 10 or 20 recorded-quiet days (never while the silence is ours: `days_since_poll` rides along), or played again after seven or more |
| `account_*` | your account | feedback answered (`account_feedback_responded`), recordings started or stopped, clans added or removed (the text names the clan; one Elixir made on its own says "automatically" and whose clan it followed), role changes (`account_role_changed`), connections, by the app's name. A burst of one kind within a minute (six connections revoked at once) is one item with `count`. Never publishable |
| `departure_classified`, `role_change_made`, `award_granted`, `award_standing`, `member_away`, `clan_message` | clan | [attested facts](/docs/integrations#attested-facts): what a person did in the clan through a family app (a leader says a departure was a kick or a leave; a promotion made; the clan's own award; a member away; a Clan Leader Message or clan chat line), and what the app itself computed (`award_standing`: where a member stands in one of the clan's awards). Section `attested`; `facts` is the fact's detail plus `player_tag` and `name` for the member it is about (and `previous_name` beside a standing's `previous_player_tag`), `attested_by` (`app`, `player_tag`, `name`, `role`; the last three null on the app's own fact) and `visibility`. Shown only to a reader whose verified player (an agent's owner's) is in the clan; an away only to a **person** whose verified player leads it, never to an agent. A departure's kind reaches the clan and its agent. `at` is when it happened; it is selected by when Elixir recorded it |
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
150-item cap bounds them, keeping the newest. The clan entry's `war` is
the calendar's week at the window's end: its fame and place are that week's
recorded race, and null when the record holds no race for it. Its `decks`
(who is untouched, partial and finished) is served only when the window
ends inside the war day still being played and the race has not finished,
the same day-in-progress picture as `war_current.decks_today`, and is
`null` for any other window (decks count against four a war day only up
to the finish):
a closed war day is never split out, because war facts are weekly
([Battle model](/docs/battles#war-weeks-points-and-fame)). A window
that ends before that week's race closed reads the race as it stood then: fame
and place at the last war day closed by `to`, no `race_finished_at`, and
`as_of_window_end: true`. Where the record holds no closed day for
that week by then (a Colosseum week, or war day 1 still open), fame and place
are `null`, not 0: `war_history` has the week's days.

A clan entry's `activity` counts the battles played in the window on an
occurred read, and the battles the record learned in it on an observed
one, where `activity.played_here_learned_later` counts battles played in it
that the record learned afterwards (a history backfill).

The timeline's total and `clans_standings`' differ by design, and neither
is wrong. The timeline counts each battle **once**, played while in the clan.
`clans_standings` counts each member's battles by **play time**, so a friendly
between two members is one battle on the timeline and one on each member's
row, and a member who joined mid-window brings the battles they played for
another clan (its note names them). On 2026-09-23's game day that was 292
learned (293 played) against 312: 13 of one member's friendlies were against
clanmates.

A battle the record learned more than a day after it was played (a history
backfill, a log polled late) is a late capture: counted in the entry's
`battles.late_captures` and never narrated, whatever the window.

### One story, one item

A story about a player you follow who is also a member of a clan you
follow is news on both timelines, and is still **one item**: the
player's (`subject_tag`), naming both in `subjects`. A member's sitting
that is also a clan standout is served as the `session_standout`, which
carries everything the session would. So a consumer never sees one `id`
twice in a read, and `text` names everyone by their in-game name.

### Telling the story

A moment that gains its proof late is served again under the same `id`
at a higher `revision`, with the battle in its `facts` and `text`: an
update to that moment, not another achievement.

Post once per `id`, and only an item that is `publishable`. When a later
read serves an `id` you have told at a higher `revision`, the story grew: update it, or say "and now...", and
never retell it. The same `id` at the same or a lower `revision` is a
story you have told; say nothing. Keep the ids you have told, with the
revision you told each at, and a timeline read through overlapping
windows, a member read, or a read after a restart never repeats itself.

### Where an item leads

The timeline says that something happened; the rest of the record says
how. Each item's `follow` names the reads that tell more, built from the
item itself, so an agent never has to work out which tool holds the
story or how to name the moment to it:

| kind | `follow` |
|---|---|
| `battle_session`, `session_standout` | this item's own [recorded evidence](#recorded-evidence) (`elixir_timeline` with `evidence_item_id`, this window and basis), then `battles_performance` over the sitting's span |
| `ranked_promotion`, `arena_changed`, `best_trophies_band`, `career_wins_step` | the battle that proved it (`battles_query` by `battle_id`), when the record holds it, then `players_summary` |
| `badge_earned`, `legendary_badge_earned` | `players_profile` |
| `collection_level_step` | `players_collection` |
| `card_unlocked`, `card_form_unlocked` | `players_collection`, then `cards_card` for that card and that player |
| `member_joined`, `member_left`, `member_role_changed` | `players_summary` for the member, then `clans_roster` |
| `clan_joined`, `clan_left` | `players_summary` (the clan may be one nobody records) |
| `bracket_observed` | `war_rivals` for the clan and its bracket |
| `race_finished`, `week_resolved` | `war_history` for that season and week |
| `quiet_crossed`, `returned` | `players_summary`, then the member's last ten battles (`battles_query`) |
| attested facts | `players_summary` for the member |
| `account_*` | nothing: `[]` |

Call them as they are, in order of how close they stay to the moment. They
are addresses, not advice: what to make of the answer is yours (or your
agent's). A tool
your connection may not call is left out.

### Rendering an item

`text` is a time-free sentence, so a renderer puts the time where its
reader expects it, on the reader's clock: Discord's own timestamp,
`<t:{at_unix}:f>` for the date and time or `<t:{at_unix}:R>` for "2 hours
ago", which every member sees in their own zone; or `local.weekday` and
`local.time` where the reader's zone is the account's. Never announce a
clock time in prose: `game_clock` is the schedule.

### Recorded evidence

The Console's **View games** and **View crossing** open a read-only evidence
panel. Sessions list exact canonical games in play order (time, then game
ID), 25 per page, with links to their existing public battle pages. These
are the games of the sitting the item counts, from its first battle through
its last, which can reach before the read window: a standout's evidence is
its whole sitting, so `evidence.count` and `facts.battles` agree, and the
battle that crossed each rung is in `facts.crossings`. Page controls appear
only when more canonical games remain. Closing the panel returns to its original
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
revision, `revision` and observation time advance when the proof arrives.

An agent passes `evidence_item_id` to `elixir_timeline`, with the original
`from` and `to`, `evidence_offset` (default 0), `evidence_limit` (1–25), and
`expected_evidence_version` from the item (required after the first page).
An evidence read returns that one item and its page, without full summary
entries, so even a busy feed has room for supporting game facts. The response's `evidence`
carries `item_id`, the item's evidence fields, `offset`, `limit`, and
`battles` with canonical `battle_id`, `at`, `type`, `mode_group`,
`outcome`, `crowns`, `trophy_change`, `url`, `short_id` and
`relation` (`constituent` or `proved_crossing`), plus `next_offset` or null.
A read that cannot be served is refused as `bad_request`, and the message
names why: `evidence_changed` (refresh the item before continuing),
`version_required` (a later page without `expected_evidence_version`),
or `evidence_unavailable` (the item is not visible in that window, or
carries no evidence). An `evidence_offset` or `evidence_limit` out of range
is refused by argument validation, as any argument is. Evidence reads always
keep the read pointer, including when `mark_read` is omitted.
Paging constituent games does not change the newsfeed's cap or ordering.
The membership fingerprint and page share one database snapshot; concurrent
capture asks for a refresh instead of silently shifting game offsets.

Each result belongs to that game's mode. A ranked win and its +30 progress
are ranked evidence, not Trophy Road progress. Current profile trophies,
another mode's results and broader season statistics are separate context;
they do not prove that milestone. Evidence serves the same canonical facts
to authorized MCP agents as to people.

Evidence is limited to the reader's visible timeline subjects. Private
attested facts keep their membership and role checks and carry no game
links. References point at canonical history; no battle payload or extra
history copy is stored. The Console's seven-day view is a read window, not
a retention limit. This panel does not create an
Action, draft a message, send a notification, or grant an award.

### The `facts` keys, by kind

`text` is written from `facts`, and `facts` is what a consumer branches on.
Each kind is versioned on its own (`schema` on the item). The keys below
are on every item of the kind (a value may be `null` where the row says
so); keys in brackets appear only when the record holds them. Every item
about a player, a member's moment on a clan's timeline included, carries
`player_tag` and `name` (the in-game name).

| kind | version | `at` is | `facts` |
|---|---|---|---|
| `battle_session` | 2 | the sitting's first battle; `sort_at` is its last | `player_tag`, `name`, `started_at`, `ended_at`, `duration_s`, `battles`, `won`, `lost`, `drawn`, `by_mode` (battles per mode group), `trophy_net` (the session's ladder net), `trophy_net_peak` (the running ladder net furthest from zero), `won_in_a_row`, `open`, `decks` (up to three `{ label, battles }`, by archetype label), `events` (`{ event_tag, name, battles }` per event or challenge played) |
| `session_standout` | 3 | the battle that crossed the first new rung; `sort_at` is the sitting's last battle | the session's keys, plus `crossed` (every rung passed, as `won_in_a_row>=5`, `trophy_net>=300`, `battles>=20`), `newly` (the rungs this window learned) and `crossings` (each rung's `{ rung, key, threshold, value, at, battle_id }`: the value at the battle that crossed it, signed, so a trophy rung crossed going down reads negative, and that battle), [`teammate`] (`{ player_tag, name, battles }`, the 2v2 partner: tell a pair's sittings once), [`best_win`] (the win over the highest-rated opponent, the battle shape below plus `mode`) |
| `badge_earned` | 2 | the profile read that saw the level | `player_tag`, `name`, `badge`, `badge_label`, [`level`, `max_level`, `prior_level`] |
| `legendary_badge_earned` | 2 | the profile read that saw it | `player_tag`, `name`, `badge`, `badge_label` |
| `arena_changed` | 2 | the promoting battle when `promoted_by` is there, else the read that saw the move | `player_tag`, `name`, `from`, `to` (arena ids), `from_name`, `to_name`, [`promoted_by`] |
| `ranked_promotion` | 2 | the promoting battle when `promoted_by` is there, else the read that saw the league | `player_tag`, `name`, `from`, `to` (league numbers), `from_name`, `to_name`, [`promoted_by`] |
| `best_trophies_band` | 2 | the crossing battle when `crossed_by` is there, else the read that saw the best | `player_tag`, `name`, `best`, [`band`, `crossed_by`] |
| `collection_level_step` | 2 | the profile read that saw the level | `player_tag`, `name`, `level`, `step` |
| `career_wins_step` | 2 | the crossing win when `crossed_by` is there, else the read that saw the count | `player_tag`, `name`, `wins`, [`step`, `crossed_by`] |
| `card_unlocked` | 2 | the profile read that saw the card | `player_tag`, `name`, `card`, `card_id`, `rarity` |
| `card_form_unlocked` | 2 | the profile read that saw the form (it happened no later) | `player_tag`, `name`, `card`, `card_id`, `rarity`, `form` (`evolution` or `hero`) |
| `clan_joined` | 2 | the roster read that saw the join | `player_tag`, `name`, `kind`, `clan_tag`, `clan_name`, `at` |
| `clan_left` | 2 | the roster read that saw the departure | `player_tag`, `name`, `kind`, `clan_tag`, `clan_name`, `role`, `at` |
| `member_joined` | 1 | the roster read that saw the join | `player_tag`, `name`, `role`, `roster_size_before`, `roster_size_after` |
| `member_left` | 1 | the roster read that saw the departure | `player_tag`, `name`, `role_at_departure`, `joined_observed_at`, `roster_size_before`, `roster_size_after` |
| `member_role_changed` | 1 | the roster read that saw the new role | `player_tag`, `name`, `role_before`, `role_after`, `direction`, `roster_size_before`, `roster_size_after` |
| `bracket_observed` | 1 | the record's first sight of the week | `season_id`, `section_index`, `is_colosseum`, `rivals[]` (`tag`, `name`, `recorded`) |
| `race_finished` | 1 | the finish, when the race log gives it, else the read that saw it | `season_id`, `section_index`, `fame`, `finish_time` |
| `week_resolved` | 2 | the read that saw the week close | `season_id`, `section_index`, `is_colosseum`, `fame`, `rank`, `trophy_change`, `members` (`player_tag`, `name`, `decks_used`, `points`, most points first; `text` names the top three) |
| `quiet_crossed` | 2 | the last battle plus the rung's days | `player_tag`, `name`, `rung` (5, 10 or 20), `days_quiet`, `days_since_poll`, [`role` on a clan's timeline] |
| `returned` | 2 | the battle that ended the absence | `player_tag`, `name`, `after_days` |
| `account` | 2 | the first event of the burst | every `account_*` kind: the event's own detail (a feedback id and status, a subject tag, a tier), `count` (events in the burst) and `apps` (the apps named) |
| `departure_classified` | 1 | when it happened, as attested; selected by when Elixir recorded it | `kind`, [`left_at`], `player_tag`, `name`, `attested_by`, `visibility` |
| `role_change_made` | 1 | as above | `from`, `to`, `player_tag`, `name`, `attested_by`, `visibility` |
| `award_granted` | 1 | as above | `award`, `season_id`, [`place`], `player_tag`, `name`, `attested_by`, `visibility` |
| `award_standing` | 1 | as above | `award`, `award_id`, `season_id`, `place`, `value`, `unit`, `as_of`, [`previous_player_tag`], `player_tag`, `name`, `attested_by`, `visibility` |
| `member_away` | 1 | as above | [`until`], `player_tag`, `name`, `attested_by`, `visibility` |
| `clan_message` | 1 | as above | `channel`, [`title`], `body`, `attested_by`, `visibility` |
| `personal_record` | 2 | as above | `game`, `score`, [`previous_best`], `player_tag`, `name`, `attested_by`, `visibility` |

A `promoted_by`, `crossed_by` or `best_win` battle is the one shape described above
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

## Cross-posting to Discord

A timeline can be posted to a Discord channel as it happens: a person's
own timeline, or an agent's (its clan and the players it tracks), turned
on by the account's owner on Console ▸ Timeline under **Cross-post to
Discord**. Profile, and each agent's page, say whether it is on. It is
set in the console only, never through MCP or the JSON API.

- **What posts.** Every `publishable` item the timeline holds for that
  account, not otherwise filtered: the same subjects, sections and kinds
  a scheduled agent reads. What is not publishable never leaves Elixir:
  an item only a clan's leaders may see (a member's away), and your
  account's own administration.
- **When.** About a minute after the record learns something about one
  of the subjects, the timeline is read from the cross-post's own place
  in it and anything new is posted. Nothing polls. An attested fact (a
  leader's word in Elixir Clan, a family app's record) wakes it the same
  way. A quiet rung crossed by the clock posts with the next thing the
  record learns about that subject. Nothing from before it was turned on
  is posted. The cross-post's place never moves your read pointer, a
  reader's, or `meta.timeline_pending`.
- **One line per item:** the item's sentence with names made literal,
  then links back to Elixir (the battle, the race week, the member, the
  subject), never previewed. Discord's post time says when; only an item
  over three hours old (a late proof, a quiet rung) adds how long ago
  (`<t:{at_unix}:R>`, from a sitting's last battle). Nothing pings
  anyone.
- **Edited, never repeated.** When an item grows (a sitting adds
  battles, or closes), its message is edited in place; a sitting posted
  while going is edited to its final count within about 45 minutes of
  its last battle. A message deleted in the channel stays deleted. A
  post whose answer from Discord is lost is never sent again: a missing
  line beats a duplicate.
- **The webhook.** Only Discord's own webhook address is accepted;
  saving one posts a first line so you can see it works. It may end in
  `?thread_id=` and a thread's id, to post into that thread. A forum
  channel's is refused (use a text channel's, or one thread's). Elixir
  keeps it sealed, shows it shortened, and never logs it. When Discord
  says it no longer exists, cross-posting turns off and the panel says
  why; turning it back on, or a new webhook, starts from that moment.
- **When Discord refuses a line,** it alone is skipped. Lines go at most
  about 25 a minute, under Discord's limit, so a busy war day takes a
  few minutes; a line still undelivered after many tries counts as not
  delivered.
- **The last deliveries.** The panel lists the last 20 lines of the past
  30 days (posted, edited, refused in Discord's words, not delivered, or
  "no answer") and counts those not delivered. Rate a posted line 👍 or 👎,
  with a note: feedback to Elixir, which cannot see your channel.

A clan's leaders can also post the clan's own activity to a channel,
chosen by category and set by the clan's policy, from Elixir Clan's
Social ▸ Discord ([The clan's activity in
Discord](/docs/clan-policy#the-clans-activity-in-discord)). The panel
names each clan you follow that does, with one of your verified players
in it: what it tells is in your timeline too, so a server carrying both
channels tells it twice.

## What the timeline never does

- **It never tells you what time it is.** A war day opening or closing is a
  clock fact; `game_clock` carries `war_day_closes_at`,
  `next_war_day_opens_at`, `next_training_starts_at` and `week_ends_at` so a
  routine that cares schedules itself.
- **It never gives advice.** "Passed 10 recorded-quiet days" is a fact with a
  disclosed rung; whether that means anything is the reader's call, or
  their agent's, which may draw conclusions and suggest what to do. The same
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
- **It never changes for the mail.** The mail chooses what to say from
  it: the milestone email sends only the big firsts (a legendary badge
  among them), the weekly emails count card unlocks and badge levels
  rather than listing them, and the friends
  email draws a clan's summary as a headline and its next three clauses
  ([Email](/docs/email)). The timeline itself keeps every item, newest
  first.

## A routine that uses it

1. Read `game_clock` once; if you care about war, schedule yourself from
   `war_day_closes_at`.
2. Call `elixir_timeline` as your own `reader`, with `kinds` naming what
   you wake on; skip the call when the last response's
   `meta.timeline_pending` was 0. If `timeline` is empty, there is nothing
   to consider. Otherwise read the items, then the entries for the shape of
   the window.
   Pass `skip_empty: true` when you poll and act only on items
   ([Polling cheaply](#polling-cheaply)).
3. Drill with the data tools for anything worth more: `clans_roster`,
   `war_current`, `clans_participation`, `players_summary`.
4. Nothing to save: your reader's pointer is the window's end. A consumer
   without a `reader` saves `next_cursor` and marks only if it owns the
   account's pointer.

On first run the window is the last 24 hours; an agent that posts a month
of backlog into a channel is the most common mistake with a feed like this,
and the cap and the default exist to prevent it.

## Polling cheaply

Most polls find nothing new. With `skip_empty: true`, Elixir first asks
whether anything in the window could be an item this read keeps: a
recorded battle, a ledger moment, a roster move, a quiet rung crossed by
the clock, an account event or an attested fact, among your subjects and
the `kinds` you named. When nothing could, it answers at once:
`timeline`, `entries` and `quiet` are empty, `entries_skipped` is `true`,
and a note says so. Everything else is as on any read: the window,
`next_cursor`, `read_to`, the reader's pointer and `meta`, including
`meta.timeline_pending`.

When the window does hold an item, the read is exactly the read without
`skip_empty`, entries included, and `entries_skipped` is `false`. A
`sections` filter does not narrow the check, so a read filtered only by
section may build and then serve nothing. An evidence read always builds.

Read without `skip_empty` when you want the entries of a quiet window,
for example a summary posted when nothing happened.

## One member, and the window's bounds

`player_tag` keeps one player's items: their own moments and sessions, and on
a clan's timeline their member moments and sessions. It is
applied before the item cap, `applied.player_tag` echoes it, a tag that is
not one of your players or a member of your clans says so, and a member read
never moves the read pointer. On a clan's timeline a member's session
item is a sitting of two or more battles; on a player's own timeline a
single battle is a session item too.

Every window is **(from, to]**, by `sort_at` on an occurred read and by
`observed_at` on an observed one, compared at the millisecond the tool
serves: `from` is exclusive and `to` inclusive, so the busy-window note's
`to` reaches the item at the cut. On an observed read a clan entry's
`activity` counts the battles the record learned in the window:
`activity.learned_here_played_before` counts ones played in the day before
`from` and recorded here (counted), `activity.played_here_learned_later` ones
played in the window and recorded after `to` (not counted).
