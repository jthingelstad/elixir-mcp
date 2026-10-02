---
slug: choosing-a-tool
title: "Choosing a tool"
description: "Which tool answers which shape of question, the four call sequences most answers follow (how am I doing, scout a bracket, name to tag to drill, how have I moved), and the conventions every tool shares on one screen: defaults, windows, verbosity, notes and docs, live reads and the timezone argument."
section: agent
order: 3
navTitle: "Choosing a tool"
icon: compass
lede: "The tool reference is exhaustive. This page is the map: question in, tool out."
---

# Choosing a tool

The [tool reference](/docs/tools) lists every tool with every argument. This
page is the shorter thing an agent reads first: given the shape of a
question, which tool answers it, in what order, and the handful of
conventions that hold everywhere.

## Question shape to tool

| The question sounds like | Call |
|---|---|
| How am I doing? Start here. | `players_summary` |
| Over a window, or since X compared with before | `battles_performance` (`from`/`to`, `before_after`, `group_by: "week"`; pass `mode`, or read the per-mode-group split, `modes`, it returns without one) |
| What decks do I play, and how do they do? | `battles_decks` (a page of decks, each one line of card names; `next_offset` for more), `battles_decks({ deck_hash })` for one deck's cards in full, `battles_query({ deck_hash })` for its battles |
| Show me the battles themselves; the workhorse | `battles_query` (filters, cursor, `verbosity: "compact"`) |
| A link to one battle, to hand a person | the row's `url` from `battles_query`, [the battle's public page](/docs/battles#a-battles-page); `battles_query({ battle_id })` also takes the short id or the `url` |
| What day is it in the game? Season, war day, when it rolls | `game_clock` |
| My clan today: standings, who still has decks | `war_current` (`decks_today` can guide a nudge only while `race_finished_at` is null) |
| Every current member's W/L/D over a short window | `clans_standings({ days: 1, min_battles: 1 })`, or explicit `from`/`to`; each row carries the ladder `net_trophies` and the `current_streak` too, and one member's battle-by-battle detail is `battles_performance` |
| Which clanmates played this exact deck? | `battles_decks` for a `deck_hash`, then `battles_query({ deck_hash })` without `player_tag`, and compare the returned tags with `clans_roster`; this is exact deck evidence, not a playstyle similarity score |
| Who has gone quiet? | `clans_roster`, reading `last_seen_in_game` beside `last_recorded_battle` |
| Who should be promoted, demoted or removed? | Elixir serves the facts and the clan decides: `clans_participation` (war decks, battles and donations per member per week), `clans_standings` (win rate and activity over a window, with who joined mid-window and whose battles were not captured), and `clans_roster` (role, tenure, `last_seen_in_game`). Read a member's week with the capture note in view: a low count can be a capture gap. |
| What did every member do this week, and the weeks before? | `clans_participation` (battles, ranked battles and donations per member per week, and war decks used per race week, in one call) |
| How has the clan moved over the season: score, war trophies, members, the members' trophies? | `clans_timeline` (one point per game day, with the aggregates over the members' rows) |
| How has each member's trophies or rank moved day by day? | `clans_members_timeline` (every member's day series in one call; compact for first, last and delta) |
| Scout the bracket | `war_rivals`, then `war_current({ clan_tag, live: true })` or `clans_roster({ clan_tag, live: true })` for one rival |
| What does "LavaLoon" / "bridge spam" mean, or what is this deck called? | `cards_archetype` (`name`, or `cards`; nothing for the vocabulary) |
| Rarest badge, who holds one | `badges_rarity`, `badges_holders` |
| A name to a tag, or tags to names | `players_search`, `players_names` |
| What happened since I last looked? | `elixir_timeline` (items newest first and an entry per subject, then drill with the data tools) |
| How have I moved: trophies, rank, a lifetime counter, day by day? | `players_timeline` (one point per game day; `metrics` picks the series) |
| Which of my cards carry, which enemy cards beat me? | `battles_cards` (`perspective: "mine"` or `"opponent"`) |
| Who do I keep meeting, and how does it go? | `battles_opponents` |
| Two to four players side by side | `battles_compare` (`mode`, or read each player's per-mode-group split, `window.modes`) |
| Were my cards above or below my opponents' this window? | `players_summary` (`mean_level_gap` on each deck), `battles_decks` and `battles_cards` rows (`mean_level_gap`); the record describes the gap and does not score it, see [Methodology](/docs/methodology#card-levels-described-not-adjusted-for) |
| How did this player or clan's members play week by week? | `battles_trends` with a `segment` |
| Card facts, earliest selected-history play, and who in my clan played or holds it | `cards_card` (one call; [Cards](/docs/cards)) |
| The profile, the collection, how complete the record is | `players_profile`, `players_collection`, `elixir_coverage` |
| Past war weeks: final ranks, boat fame, one member's points and decks | `war_history` (`seasons`, or `season_id` and `section_index` for one week's whole roster) |
| What was on in the game: events, challenges, side modes, by day | `game_events` |
| Track someone, say who they are to you | `elixir_track_player`, `elixir_track_clan`, `elixir_my_players`, `elixir_nickname` |
| Resolve a human on an agent's surface to a player (agent connections only) | `elixir_identify`, `elixir_my_identities` |
| Something is missing or took too many calls | `elixir_send_feedback`; `elixir_my_feedback` says what happened to it |
| What the service holds and who fetches it | `elixir_data_insights`, `elixir_collectors` |
| How is this documented? | `elixir_docs`, `elixir_examples`, `elixir_updates`, `elixir_changelog` |

Read `comparable` before ranking: where a response carries it (`clans_standings`,
`battles_decks`), `false` means two rows were played in
different modes or against different level gaps, and the note names them.

Every recorded-data tool is unlimited within the daily call budget. The
tools that spend the live lane are `live_fetch` and the {{ tools.liveFlagCount }} with a `live`
flag; everything else reads the record.

## Four sequences

**How am I doing.** `players_summary` for the headline (trophies, the fixed
last 30 days, the most-played deck), then `battles_performance` with a window
or `before_after` for the comparison the person actually asked about, then
`battles_decks` if the answer is about decks. Read `meta.freshness_seconds`
before quoting a number.

**Scout a bracket.** `game_clock` to know whether it is a battle day, then
`war_current` once for your own standings and the five clans in the race,
then `war_rivals` for what the record knows about each rival, then, for the
one that matters, `war_current({ clan_tag, live: true })` or
`clans_roster({ clan_tag, live: true })`: a fresh read of any clan, recorded
or not — served at once if one is in hand, otherwise queued while the record
answers with `live_status.state: "pending"` and when to call again.
If a rival's recorded roster returns `not_recorded`, follow its exact
`clans_roster({ clan_tag, live: true })` retry hint; `live_pending` means wait
`retry_after_s` and repeat, not that the roster is unobtainable. A live read
records that observation but does not start an ongoing clan watch.

**Name to tag to drill.** `players_search({ query })` resolves a name (your
nicknames and clanmates rank first), then any player tool with the tag. In
the other direction, `players_names` resolves up to 100 tags without the
live lane, and `players_profile({ live: true })` fetches one the corpus has
never named.

**How have I moved.** `players_timeline` for the series itself (trophies by
default; `metrics` picks Path of Legends, a lifetime counter or the clan
rank; one point per game day with `day`, `kind` and the stamps that wrote
it), then `battles_performance({ group_by: "week" })` for the win rate and
mode split behind each stretch of it (clipped weeks say `partial`), and
`battles_decks` for the `mean_level_gap` behind each deck, so a move can be
read beside the card levels it was made with. Read
`applied.window.crosses` on every one: a season roll resets the seasonal
trophies and the ranked standing, so the two sides of it are not one series.

## Conventions on one screen

- **Omit `player_tag` to mean the caller**: a person's primary player, or
  whoever `on_behalf_of` maps to on an agent connection. Omit `clan_tag` to
  mean the primary player's current clan (an agent's: the clan it acts
  for); when that clan is not recorded, or there is none, the call is
  refused with the fixing call in the hint, never answered for another
  clan. Nothing is looked up first.
- **Segment tools name a subject.** `battles_trends`, `cards_card` and `badges_*` require `"mine"` (your clan), `{player_tag}` or `{clan_tag}`. A clan read describes its current members. There is no corpus segment.
- **Windows are `from`/`to`**, ISO instants or `YYYY-MM-DD` resolved in the
  account's timezone; a date-only `to` covers that whole day. The daily
  series (`players_timeline`, `clans_timeline`, `clans_members_timeline`)
  run on game days and floor an instant to its day, saying so. `days` and
  `weeks` are sugar; `season` (`current`, `previous`, `2026-08` or `135`)
  bounds one season on every windowed tool, `elixir_timeline` included, and
  is the default on `cards_card`.
  Every windowed response echoes `applied.window` with a `source` of
  `argument`, `default`, `unbounded`, `season` or `fixed`, the `season` it
  starts in and `crosses`, every season roll inside it (a note fires when
  there is one); see
  [Windows and timezones](/docs/clocks#windows-and-timezones) and
  [Seasons](/docs/clocks#seasons).
- **`verbosity: "compact"` is the one size control**, accepted on every
  tool. It drops the bulk and keeps identities and counts (a tool with one
  size says so in a note); a result over the delivery cap answers
  `result_too_large` naming the arguments that narrow it.
- **Every response carries `notes[]` and `docs`.** The notes are one-sentence
  caveats to repeat with the numbers; `docs` is a `page#section` for
  `elixir_docs` where the formulas live.
- **`live: true` asks for a fresh read** on `players_profile`, `clans_roster`,
  `war_current`, `battles_query`: served at once if a
  read inside the API's cache window is in hand, otherwise queued while
  the record answers now with `live_status.state: "pending"` and when to
  call again. `live_fetch` is the raw catch-all and the last resort; it
  refuses a battle log, which never fits the cap.
- **`timezone`** on any windowed tool names an IANA zone for that call's
  date-only bounds and local labels, for agents serving people in several
  zones.
- **Errors are a closed set** with a `hint` naming the next call; check the
  body, not only the transport flag. The codes are on the
  [Protocol reference](/docs/protocol#errors).
- **A heavy aggregation can return `query_timeout`** rather than a partial
  answer. Retry after a few seconds, or narrow `from`/`to`; lowering `limit`
  only reduces output, not scan cost. Keep the request id if it persists.
