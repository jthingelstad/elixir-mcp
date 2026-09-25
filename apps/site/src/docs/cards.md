---
slug: cards
title: "Cards in the record"
description: "How a card is recorded: the catalog and its types and forms, the 1-16 level scale, card rows on every battle side, deck identity, the collection snapshot, and the season rollups; then which tool answers which card question, and cards_card, which answers most of them in one call."
section: record
order: 19
navTitle: "Cards"
icon: layers
lede: "One card, every place the record holds it, and the one call that gathers them."
---

# Cards in the record

The record holds a card in five places, and 5.0.0 added the reader shaped
like the card. This page is the card model - what each place stores and on
what scale - and the map from a card question to the tool that answers it.

## The five places a card lives

| where | one row is | what it carries |
| --- | --- | --- |
| **the catalog** | a card or tower troop, as the API's `/cards` last listed it; a card never leaves | id, name, **type** (troop, building, spell, tower troop - from the id range, which the API does not spell out), rarity, elixir cost, icons, the forms that exist, when it entered the catalog and when it last changed |
| **a battle side's cards** | one card one side played in one battle | the card, its **form** (base, evolution or hero), its slot (0 = the tower troop), its **level** on the 1-16 scale |
| **a deck identity** | the exact set of card:form pairs plus the tower troop, as `deck_hash` | the cards, each with its form; never levels |
| **a collection** | a recorded player's card as the profile last showed it | level, count toward the next level, the forms unlocked, star level, when it was observed |
| **the season rollups** | season × mode group × card × form (and the same by trophy band) | decided observations, wins, losses, distinct players, the mean level gap; rebuilt nightly, incremented hourly |

**Forms.** The API encodes a card's form as the bit field `evolutionLevel`
(`1` Evolution, `2` Hero, `3` both). Every card object a tool serves spells
the *played* form as one word, `form: "base" | "evolution" | "hero"`; the
collection's and catalog's *sets* of forms are `forms_unlocked` and
`forms_available`. Forms are never merged in a card row: a card played in
two forms is two rows. The one place forms merge on purpose is the
`all` row of `cards_card` and the anchor of `cards_synergy`, which say so.
See [Deck identity and forms](/docs/battles#deck-identity-and-forms).

**Levels.** Every recorded-data tool serves levels on the in-game 1 to 16
scale, whatever the rarity; the API's rarity-relative cap is
`maxLevelRarityScale` on the catalog for anyone joining to a raw payload.
The record describes level differences (`mean_level_gap` on deck and card
rows) and does not adjust for them:
[Methodology](/docs/methodology#card-levels-described-not-adjusted-for).

**What is not here.** Descriptions, stats, arena unlocks and release dates
are not in the API and not observed by the record. `cards_card` says when a
card first entered the catalog and when each form was first *played* in
the record, which is what it can know.

## One card in one call

`cards_card` gathers what the record knows about a card for a named
population (`segment: "mine" | "corpus" | {clan_tag | player_tag |
collection}`, required as on every segment tool), anchored by `card_id` or
an exact `card` name (`Witch` is never read as `Mother Witch`; a fuzzy
name is refused with the candidates). Default window: the current season to
date; `season`, `from`/`to` and `mode` as everywhere.

| block | what it holds | served for |
| --- | --- | --- |
| `card` | the catalog row with `type`, `forms_available`, `first_seen_in_catalog` (when Elixir first stored the card; every card already in the game on 2026-09-10, when storage began, carries that date), and `first_played {base, evolution, hero}` (the earliest recorded deck carrying each form) | every read |
| `season` | this window: `all` (forms merged) and `forms` (one row per form played), each with battles, W/L, players (every pilot seen in the population, opponents included on a corpus read), `usage_share` over the population's `decided_battles`, raw and shrunk win rate; on a corpus season read with `mode` omitted, `by_mode` splits it by mode group | every read (`by_mode`: corpus season reads) |
| `history` | one point per recorded season, same shape, from the rollups | corpus reads |
| `by_band` | the season's usage by trophy band, with `mean_level_gap` | corpus season reads, once the band rollup is filled |
| `partners` | the eight cards most played with it and their lift (`cards_synergy` has the full list for any segment) | corpus season reads |
| `decks` | the five most-played decks containing it, with their cards | every read |
| `excluded`, `prior_win_rate`, `prior_basis` | what the window held outside the decided head-to-head population (duels, boat battles, draws, unresolved, no deck), and the mean `shrunk_win_rate` shrinks toward: the corpus season's (`corpus_season`) or this population's own over the window (`segment_window`). A row below the sample floor says `insufficient_sample: true` (6.22.0) | every read |
| `members` | on a clan segment: `played` (each member's battles with it in the same population as `season`, so duels are out, win rate, `level_played`, forms) and `held` (each member's level, forms unlocked, star level from the collection snapshot), with how many members have a recorded collection | clan segments |

`verbosity: "compact"` keeps `card`, `season` and `history`. Every number
is a description of what was recorded, with the same caveats as the meta
tools: pooled player-battle observations, both sides can contribute, and a
card's win rate describes who played it as much as the card.

## Which tool for which card question

| question | tool |
| --- | --- |
| What is this card, which forms exist, what is its id? | `cards_catalog` (`query`, `ids`; `type` on every row) |
| Tell me about this card | `cards_card` |
| How much is it played and does it win, for a population? | `cards_card` (`season`), or `battles_meta_cards` with `cards: [ids]` for the row beside other cards |
| How has its usage moved across seasons? | `cards_card` (`history`, corpus) |
| What is it played with? | `cards_synergy` (any segment); `cards_card.partners` for the top eight |
| Which decks carry it? | `cards_card` (`decks`; `archetype` narrows them to one shape), or `battles_meta_decks` with `containing: [ids]` for the full ranked list |
| What is this deck called, or what does "LavaLoon" mean? | `cards_archetype` (`cards`, or `name`; every deck object already carries `archetype`) — see [Deck archetypes](/docs/archetypes) |
| Who in my clan plays it, and at what level? Who holds it? | `cards_card` with `segment: "mine"` (`members`) |
| Which tower troops does the meta use, and do they win? | `battles_meta_cards` with `tower_troops: true` (one row per tower troop over the same population) |
| Tell me about one tower troop, and who in my clan holds it | `cards_card` with the tower troop's id or name (`season.all`, `members`) |
| Which of MY cards carry, which enemy cards beat me? | `battles_cards` (`perspective`) |
| My battles with or against a card | `battles_query` (`with_card`, `with_cards`, `against_card`) |
| My collection: levels, forms, counts, and the level I actually field | `players_collection` (`fielded`) |
| Which meta decks can I field, and what would upgrades open? | `battles_meta_decks` with `fit_for` (`decks[]` fieldable as held, `unfieldable[]` with the missing card or form, `fit.upgrades` on every row); `battles_meta_cards` with `fit_for` carries `held` per row |

What beats a card across the corpus - the matchup question - is not
answered, and none is coming: matchup expectations were considered and
declined ([Deck archetypes](/docs/archetypes) says the same of decks).

## Tower troops

A deck is eight cards and a tower troop, the ninth card, and Elixir
records it on every battle side (slot 0) and in each `deck_hash`, so two
decks with the same eight cards and different tower troops are different
decks. `battles_meta_cards` with `tower_troops: true` reads the ninth card
over the same population, window and mode as the eight: `decided_battles`
is the same number, but each tower troop's `usage_share` is taken over
`tower_troop_known_battles`, the observations whose tower troop is known.
The API reports none on a river race battle, so those observations count
in `decided_battles` and in no tower-troop row. `cards_card` answers a tower troop's usage, win rate and a
clan's holders; its season history, top decks and partners are read for
the eight deck cards, and `cards_synergy` pairs deck cards only.
`players_collection` lists a player's tower troops and levels
(`support_cards`).

## A card's own page

Every card in the catalog has a public page at `/cards/<card id>` —
`/cards/28000015` is Barbarian Barrel. No sign-in: the catalog row, the
season-by-season series, the split by mode, and the Card of the Week
issue about it if one has been sent. The numbers are the ones
`cards_card` gives, refreshed with the nightly rollup.
