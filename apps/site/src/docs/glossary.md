---
slug: glossary
title: "Glossary"
description: "The words Elixir MCP uses, each in a sentence or two: recorded and tracked, claims and relationships, scope and segment, decided battles and head-to-head, the policy day and war vocabulary, forms and deck identity, principals and budgets, and the response fields that carry caveats."
section: record
order: 20
navTitle: "Glossary"
icon: book-a
lede: "Forty-odd words the service uses precisely, so a search for one of them finds the page that uses it."
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

**corpus** — everything recorded, across every subject and every account: the
population the segment tools default to. It is the matchmaking neighbourhood
of the clans and players recorded, not a random sample of the ladder.

**segment** — a slice of the corpus a meta tool scores: `{ player_tag }`,
`{ clan_tag }` (the clan's current members) or `{ collection }`. Omit the
whole object for the corpus.

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

**pulse** — `clan_pulse`, the daily 07:00 UTC digest event for a tracked clan:
battles, active members, who went quiet, war state, roster changes.

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

**PoL, Trophy Road** — Path of Legends is the ranked ladder (`mode:
"ranked"`, with `league_number`); Trophy Road is the trophy ladder
(`mode: "ladder"`).

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
found nothing. See [Events](/docs/events).

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
`timezone`, `source`), `limit`, `sort`, `mode`, `segment`, `verbosity`, as
the tool actually used them. Read it before quoting a bound.

**notes** — `notes[]`, one-sentence caveats a response asks you to repeat
with its numbers.

**docs pointer** — `docs`, a `page#section` you can hand to `elixir_docs` or
read at `elixir://docs/<page>#<section>` for the formulas behind the answer.

**verbosity** — the one size control: `full` (default) or `compact`, which
drops the bulk (decks, tower hitpoints, curve rows, participant arrays) and
keeps the identities and counts.
