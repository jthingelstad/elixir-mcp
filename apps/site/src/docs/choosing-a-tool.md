---
slug: choosing-a-tool
title: "Choosing a tool"
description: "Which tool answers which shape of question, the three call sequences most answers follow (how am I doing, scout a bracket, name to tag to drill), and the conventions every tool shares on one screen: defaults, windows, verbosity, notes and docs, live reads and the timezone argument."
section: using
order: 9
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
| Over a window, or since X compared with before | `battles_performance` (`from`/`to`, `before_after`, `group_by: "week"`) |
| What decks do I play, and how do they do? | `battles_decks`, then `battles_query({ deck_hash })` to drill |
| Show me the battles themselves; the workhorse | `battles_query` (filters, cursor, `verbosity: "compact"`) |
| What day is it in the game? Season, war day, when it rolls | `game_clock` |
| My clan today: standings, who still has decks | `war_current` (`decks_today` is the nudge list) |
| Who has gone quiet? | `clans_roster`, reading `last_seen_in_game` beside `last_recorded_battle` |
| Scout the bracket | `war_rivals`, then `war_current({ clan_tag, live: true })` or `clans_roster({ clan_tag, live: true })` for one rival |
| What is the meta, for a clan or the corpus? | `battles_meta_decks` / `battles_meta_cards` with a `segment` |
| Rarest badge, who holds one | `badges_rarity`, `badges_holders` |
| A name to a tag, or tags to names | `players_search`, `players_names` |
| What changed since I last looked? | `elixir_events` (a nod, then drill with the data tools) |
| How is this documented? | `elixir_docs`, `elixir_examples`, `elixir_updates`, `elixir_changelog` |

Every recorded-data tool is unlimited within the daily call budget. The
tools that spend the live lane are `live_fetch` and the four with a `live`
flag; everything else reads the record.

## Three sequences

**How am I doing.** `players_summary` for the headline (trophies, the fixed
last 30 days, the most-played deck), then `battles_performance` with a window
or `before_after` for the comparison the person actually asked about, then
`battles_decks` if the answer is about decks. Read `meta.freshness_seconds`
before quoting a number.

**Scout a bracket.** `game_clock` to know whether it is a battle day, then
`war_current` once for your own standings and the five clans in the race,
then `war_rivals` for what the record knows about each rival, then, for the
one that matters, `war_current({ clan_tag, live: true })` or
`clans_roster({ clan_tag, live: true })`: one live fetch each, for any clan,
recorded or not.

**Name to tag to drill.** `players_search({ query })` resolves a name (your
nicknames and clanmates rank first), then any player tool with the tag. In
the other direction, `players_names` resolves up to 100 tags without the
live lane, and `players_profile({ live: true })` fetches one the corpus has
never named.

## Conventions on one screen

- **Omit `player_tag` to mean the caller**: a person's primary player, or
  whoever `on_behalf_of` maps to on an agent connection. Omit `clan_tag` to
  mean the recorded clan. Nothing is looked up first.
- **The segment tools default to the corpus.** `battles_meta_decks`,
  `battles_meta_cards`, `battles_trends`, `cards_synergy`, `badges_rarity` and
  `badges_holders` take a nested `segment: { player_tag | clan_tag |
  collection }`; omit the whole object for everything recorded.
- **Windows are `from`/`to`**, ISO instants or `YYYY-MM-DD` resolved in the
  account's timezone; a date-only `to` covers that whole day. `days` and
  `weeks` are sugar. Every windowed response echoes `applied.window` with a
  `source` of `argument`, `default`, `unbounded` or `fixed`; see
  [Windows and timezones](/docs/clocks#windows-and-timezones).
- **`verbosity: "compact"` is the one size control.** It drops the bulk and
  keeps identities and counts; a result over the delivery cap answers
  `result_too_large` naming the arguments that narrow it.
- **Every response carries `notes[]` and `docs`.** The notes are one-sentence
  caveats to repeat with the numbers; `docs` is a `page#section` for
  `elixir_docs` where the formulas live.
- **`live: true` reads the game first** on `players_profile`, `clans_roster`,
  `war_current` and `battles_query`: one live fetch, then the usual shape.
  `live_fetch` is the raw catch-all and the last resort; it refuses a battle
  log, which never fits the cap.
- **`timezone`** on any windowed tool names an IANA zone for that call's
  date-only bounds and local labels, for agents serving people in several
  zones.
- **Errors are a closed set** with a `hint` naming the next call; check the
  body, not only the transport flag. The codes are on the
  [Protocol reference](/docs/protocol#errors).
