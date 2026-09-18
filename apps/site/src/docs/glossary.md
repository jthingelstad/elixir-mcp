---
slug: glossary
title: "Glossary"
description: "The words Elixir MCP uses, each in a sentence or two: recorded and tracked, claims and relationships, scope and segment, decided battles and head-to-head, the game day, series, stamps, kinds and the four trophy kinds, the policy day and war vocabulary, forms and deck identity, principals and budgets, and the response fields and controls that carry caveats."
section: record
order: 20
navTitle: "Glossary"
icon: book-a
lede: "Sixty-odd words the service uses precisely, so a search for one of them finds the page that uses it."
---

# Glossary

Short definitions, grouped. Each links to the page that carries the detail.
The words here are the ones the tools use in argument names, response keys
and notes; when a note says "decided" or "policy day", this is what it means.

## The record

**recorded** — a subject the service is capturing, or has captured: its
history is in the corpus. Everything recorded is readable by every account.

**tracked** — a subject on *your* account: you asked for it to be recorded
with `elixir_track_player` or `elixir_track_clan`, and it occupies one of
your slots. Tracked means recorded; there is no separate watch step. Before
1.0.0 this was "added". See [Recording](/docs/recording#added-means-recorded).

**claim** — the link between your account and a player tag you track. Claims
are taken at your word (`claim_status: unverified`); several accounts may
claim the same player and share one recording.

**relationship** — who a tracked player is to you: `primary` (you; exactly
one), `alt` (also you, another tag), `friend`, or `watching` (the default).
The primary is what omitting `player_tag` means on a personal connection.

**reason** — why a subject is recorded: claimed, tracked as a clan, collected,
or recorded by the maintainer. The widest reason wins; the recording stops
only when no reason remains. See [One recording, many reasons](/docs/recording#added-means-recorded).

**scope** — how deeply a clan is recorded. `activity` polls the roster,
current race and race log; `comprehensive` also records every current
member's battles and profile, following joins and leaves.

**corpus** — everything recorded, across every subject and every account. It
is the matchmaking neighbourhood of the clans and players recorded (a few
hundred thousand players observed around a few dozen recorded clans), not a
random sample of the ladder, and a number over all of it describes nobody
in particular. One population among the others a segment tool can score,
named with `segment: "corpus"`, never a default; a corpus read carries
`population` (the recorded clans and players it was drawn from).

**segment** — the population a segment tool scores: `"mine"` (the caller's
clan: the agent's, or the primary player's), `"corpus"`, `{ player_tag }`,
`{ clan_tag }` (the clan's current members) or `{ collection }`. Every
population is stated; omitting `segment` answers the corpus and the first
note says so.

**collection** — a curated, named group of players or clans (a slug such as
`pros`) that records its members at its own scope.

**capture gap** — a stretch the recorder did not see: a burst that rolled off
the ~30-battle log between polls, a week observed without a standings
capture, a subject nobody polled. `elixir_coverage` measures it for a player;
a `null` in a war week reports it rather than writing zero.

**freshness** — the age of the oldest relevant poll behind an answer,
`meta.freshness_seconds`; `null` when a required source has never been polled.

**completeness** — how much of a player's expected play the record actually
holds, from `elixir_coverage`; `meta.completeness_note` appears when it is
known to be short.

**collector** — a volunteer machine that fetches Clash Royale data with its own
API key and posts it back; the fleet the recorder runs on. See
[Running a collector](/docs/operators).

**live lane** — the one path that reaches the Clash Royale API at read time:
`live_fetch`, and `live: true` on `players_profile`, `clans_roster`,
`war_current`, `battles_query` and the board tools. Asynchronous: a fresh
read is served if in hand, otherwise queued for the next collector and
answered from the record with `live_status`. Capped per day by tier.

## Battles and numbers

**decided battle** — a head-to-head battle whose outcome is a win or a loss.
Draws, unresolved outcomes and boat battles are not decided.
`decided_battles = decided_wins + decided_losses`.

**decided_battles vs battles** — `battles` is every recorded battle in a
window; `decided_battles` is the win-rate denominator. The difference is
draws, unresolved outcomes and boat battles. See
[Decided battles and denominators](/docs/battles#decided-battles-and-denominators).

**head-to-head** — a battle with opposing sides, as against a boat battle
(an attack on a static defense). `three_crown_rate` is over head-to-head
battles.

**duel** — a river-race duel of up to three games, recorded as one row:
crowns summed, `deck_hash` null, decks under `deck.rounds[]`.

**boat battle** — a war attack on a rival's boat defense, `type_class:
"boat"`. Outside every decided denominator; a boat win still counts in `wins`.

**both perspectives** — every battle is one row seen from each participant's
side; `me`, `teammates` and `opponents` are relative to the tag asked about.

**player-battle observation** — the unit the meta tools count: one
participant in one decided battle. Both sides of a match can contribute, so
observations are not independent matches.

**shrunk win rate** — a win rate pulled toward the corpus prior in proportion
to how few observations back it. Formula and floors on
[Methodology](/docs/methodology#deck-and-card-meta-exactly-what-is-counted).

**Pilot Score** — a player's actual win rate minus the win rate the level gap
of their battles would predict: a descriptive residual, not a skill rating.

**Level Curve** — win rate by deck-average level difference across the
corpus, the baseline Pilot Score subtracts.

**timeline** — `elixir_timeline`: what happened to the players and clans you
track since your read pointer, as items in order (battle sessions, named
moments, roster and war moments, presence) plus one summary entry per
subject. A **session** is a run of one player's battles with no gap of 30
minutes or more.

## War and the clock

**policy day** — the day the recorder keeps for every clan, rolling at
10:00 UTC, instead of each clan's drifting race reset. See
[The policy day](/docs/clocks#the-policy-day).

**war day** — `war_day`, 1-based: battle days 1 to 4 of a war week; `null`
on a training day.

**day_in_week** — 0-based position in the week: 0 to 2 training, 3 to 6
battle days.

**period, section, week, season** — one policy day; the game's word for a
week (0-based `section_index`); the same week 1-based; first Monday of the
month to first Monday of the next.

**Colosseum** — the final section of every season, scored differently in the
game; its practice days still report as training.

**points vs fame** — points are what each member contributes to the race;
fame belongs to the boat, the clan's total. Fame is never divided among
members here. See [War weeks, points and fame](/docs/battles#war-weeks-points-and-fame).

**boat** — the clan's river-race vessel: the thing fame accrues to and the
thing a boat battle attacks.

**clan_score** — the game's own strength number for a clan, as the race poll
reports it per bracket clan; on `war_current.standings[]`, the exact week's
`war_history.standings[]` and `war_rivals` rows (latest observed).

**repair_points** — what repairing the boat cost in a race: per clan on the
standings, per member on participation. Never fame, never points.

**PoL, Trophy Road** — Path of Legends is the ranked ladder (`mode:
"ranked"`, with `league_number`); Trophy Road is the trophy ladder
(`mode: "ladder"`).

**game day** — the day every daily series and the war grid are keyed by:
the date whose 10:00 UTC start an instant falls after, pure UTC arithmetic,
so a season roll and a war day never straddle a row. `day` on a point is a
game day; the year graphic on a player's page is on UTC calendar days
instead. See [The game day](/docs/clocks#the-game-day).

**series** — a day-grained history read as points: `players_timeline`,
`clans_timeline` and `clans_members_timeline`, one point per game day, the
last observation of the day winning. A series takes `from`/`to` as game
days and floors an instant to its day, saying so under
`applied.window.floored`.

**stamp** — the instant that produced a value: `observed_at` (a point's
newest observation of either writer), `profile_observed_at` (the profile
poll that wrote the lifetime block; `clans_roster.lifetime` carries it too,
beside the older `as_of`), `roster_observed_at` (the roster poll that wrote
the clan columns), and on war and roster events `started_observed_at`,
`finished_observed_at`, `joined_observed_at`. Null means that writer never
touched the row.

**source** — where a value came from, said locally each time: on a series
point, `api` (a recorded payload) or `elixir-bot` (the import from POAP
KINGS' earlier bot); on `applied.window`, `argument`, `default`,
`unbounded`, `season`, `fixed` or, on `elixir_timeline`, `pointer`; on
`trophy_floor`, how the floor was learned; on a `players_search` match, what
matched.

**kind** — a local enum, five of them: a series point's snapshot kind
(`daily`, `pre_reset`, `season_roll`); a timeline item's kind
(`battle_session`, `ranked_promotion` and the rest, on
[Timeline](/docs/timeline)); a war period's kind (`war`, `training`,
`colosseum`); a badge's kind (`one_off`, `tiered`); an entry's kind
(`player_activity`, `clan_activity`). `crosses[].kind` is always `season`.

**progress bucket** — one of the profile's side ladders (the seasonal
Trophy Road, 2v2 League, Merge Tactics), each with its own trophies, best
trophies and arena, keyed by the game's own `progress` key and read with
`players_timeline({ progress_key })`. A bucket at zero is not a row.

**the four trophy kinds** — `trophies` is Trophy Road, the number on the
profile; `season_trophies` is the seasonal Trophy Road (resets on the roll;
`best_trophies` and `season_best_trophies` are their peaks); `pol_trophies`
is the Path of Legends standing, the number `rankings_players` and
`rankings_timeline` call `rating` (the same figure, verified equal on the
live API); `progress[].trophies` is a side mode's. `trophy_change` is one
battle's swing; `net_trophies` is the recorded ladder sum over a window on
`battles_performance` and `clans_standings` (one spelling since 4.0.0); a
timeline session's `trophy_net` is the same sum over that session.

**league_number, pol_league** — the same Path of Legends league under two
names: `league_number` on a battle row (the league the battle started in),
`pol_league` on a series point and the profile (1 is unranked); one name
at the next major.

**tenure, YearsPlayed** — how long an account has existed, read from the
`YearsPlayed` badge; unknown when the badge is absent, which is usually an
account under a year old.

## Cards and decks

**deck_hash** — a deck's identity: SHA-256 over sorted card ids with their
forms plus the tower troop, never levels. See
[Deck identity and forms](/docs/battles#deck-identity-and-forms).

**form** — a card's Evolution or Hero variant, a bit field (1 = Evolution,
2 = Hero, 3 = both). Part of deck identity; never a level.

**tower troop** — the card in the princess-tower slot (Tower Princess, Cannoneer,
Dagger Duchess, ...); part of deck identity.

**maxLevel vs maxLevelRarityScale** — the in-game 1 to 16 cap every recorded
tool uses, and the API's per-rarity cap that only `live_fetch` payloads show.

**deck_selection** — how the deck a battle was played with was chosen:
`collection` is the player's own deck; `draft`, `draftCompetitive`, `pick`,
`predefined`, `warDeckPick` and the like are decks chosen on the spot, which
have a `deck_hash` but no identity the player will play again. On
`battles_query` rows (inside `context` at full verbosity).

## Principals and the service

**door** — an MCP endpoint: `/mcp` for a person, `/a/<public_id>/mcp` for an
agent. A credential works at exactly one door.

**principal** — who is calling: a `person` (you, over OAuth), an `agent` (a
runtime you own that acts for one clan), or an `integration` (a platform
using the REST API with its own key). See
[Users, agents and integrations](/docs/connections).

**budget account** — whose daily quotas a call spends. An agent spends its
owner's call budget and live lane; an integration spends its own.

**on_behalf_of** — on an agent connection, the end user's id in your own
space (`discord:1234`), mapped once with `elixir_identify`; omit
`player_tag` and the tools mean that person.

**external_id** — the same id as stored: the key `elixir_my_identities` lists
and `elixir_identify` maps.

**nod** — what an event is: a signal that something happened over here, with
a count and no analysis, so a routine can skip the tools that would have
found nothing. See [Timeline](/docs/timeline).

**coalesced** — an event topic that folds every unread row for one subject
into a single row with a running `count`; discrete topics arrive one per
occurrence.

**request_id** — the id minted for one call and stamped into `meta`; quote it
when reporting an answer.

**contract version** — the semver of the tool surface, `meta.contract_version`
and the first part of `serverInfo.version`; `elixir_changelog` lists what each
one changed.

## Responses

**applied** — the one echo block on a response: the window (`from`, `to`,
`timezone`, `source`, the `season` it starts in, `crosses`,
`season_age_days`), `limit`, `sort`, `mode`, `segment`, `verbosity`, as
the tool actually used them. Read it before quoting a bound.

**control** — the field beside a number that says what population produced
it: a row's `modes` (battles per mode group) and `dominant_mode`,
`mean_level_gap` and `level_gap_battles`, `trophy_floor`, `partial` with
`covers` on a clipped week or month, `population` on a corpus read,
`comparable` on a ranked list. One module computes them for every tool,
and a note fires only when a control detects a confound. See
[Methodology](/docs/methodology).

**comparable** — `false` on a ranked list (`clans_standings`,
`battles_decks`, the meta tools) when two rows were played in different
modes (each at least 60% in its own) or against level gaps half a level
apart, with the note naming the pair; rank within one mode and similar
gaps, or pass `mode`.

**floor** — the Trophy Road floor a player stood on in a window: a loss ON
the floor costs nothing (`trophy_change` null), so `net_trophies` counts
wins in full and those losses at zero. `trophy_floor` names the floor, the
arena and the losses it absorbed; `floored: true` is the tell. The rating
floor on a Path of Legends board (`floor_rating`) is a different floor: the
last placed player's rating.

**manifest** — the recorder's declaration of what every key of every API
payload becomes: the table and column it lands in, a derived value, or a
documented drop. A nightly census samples the day's archived payloads
against it and files a key the API added or retired as a work item, so a
field the tools serve can be traced to the key it came from and a field
the API sends cannot go unnoticed.

**notes** — `notes[]`, one-sentence caveats a response asks you to repeat
with its numbers.

**docs pointer** — `docs`, a `page#section` you can hand to `elixir_docs` or
read at `elixir://docs/<page>#<section>` for the formulas behind the answer.

**verbosity** — the one size control: `full` (default) or `compact`, which
drops the bulk (decks, tower hitpoints, curve rows, participant arrays) and
keeps the identities and counts.
