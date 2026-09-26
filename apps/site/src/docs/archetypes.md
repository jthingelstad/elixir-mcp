---
slug: archetypes
title: "Deck archetypes"
description: "How Elixir names a deck's shape - its win condition and family - from the cards, and how a name a person uses resolves back to decks. The six families, the grammar, the vocabulary's sources, the cycle bound and how it was measured, and what a label is not."
section: record
order: 19.5
navTitle: "Archetypes"
icon: shapes
lede: "Royal Hogs bridge spam, Hog cycle, Log Bait - the names players use, on every deck Elixir serves, and understood when a person says one."
---

# Deck archetypes

Players talk about decks by name, and Elixir speaks the language in both
directions. Every deck object it serves — on `battles_query`,
`battles_decks` (the one deck asked for by `deck_hash`; its list rows
carry the label alone, `archetype_label`), `battles_meta_decks`,
`cards_card` and `players_summary` — carries an `archetype`: the deck's **family** and **win condition(s)**, a
descriptive **label** composed from them, and the average elixir the deck
runs at. And a name a person uses — a family, a label, or a community
name like *LavaLoon* — is understood by the deck readers' `archetype`
argument, which narrows a list to that shape.

```json
"archetype": {
  "family": "bridge_spam",
  "win_conditions": [{ "id": 26000059, "name": "Royal Hogs", "form": "evolution" }],
  "label": "Evo Royal Hogs bridge spam",
  "average_elixir": 3.62,
  "basis": "cards and the catalog's current elixir costs; the win condition's form is in the label, other cards' forms are not",
  "grammar_version": "2026-09",
  "roles_version": "2026-09-20T17:51:59.000Z"
}
```

**A label is a noun, never a verdict.** It is Elixir's descriptive name
for the deck's *shape*, built from what the community means by each word;
it is not a claim about what players call that exact eight cards, and it
says nothing about how the deck performs. There is no matchup table and
no "family X beats family Y" anywhere in Elixir, on purpose.

## Two layers, kept apart

The community keeps two things separate, and so does Elixir.

**Families** are a small, stable taxonomy that the deck sites filter on and
every guide teaches — **beatdown, control, cycle, bait, bridge spam,
siege** — plus `unclassified` for a deck whose cards carry no cost at all.
A deck has one family. Some guides add "hybrid"; here a deck may carry two
win conditions, which is how a hybrid shows.

| `family` | What the community means | Where it is said |
| --- | --- | --- |
| `beatdown` | build a large push behind a high-hitpoint tank; accept elixir deficits to overwhelm | Red Bull, GamingOnPhone, TrophyCoach |
| `control` | defend efficiently, counter-push, chip; win over time | GamingOnPhone, TrophyCoach |
| `cycle` | cheap cards, fast rotation back to a chip win condition | every guide; "2.6 Hog" |
| `bait` | force the opponent's small spells with spell-vulnerable swarm, then punish | every guide; "Log Bait" |
| `bridge_spam` | fast units at the bridge to deny a build-up and punish mistakes | RoyaleAPI's filter, TrophyCoach |
| `siege` | attack the tower from your own side with X-Bow or Mortar | every guide, RoyaleAPI |

**Named decks** — "2.6 Hog", "LavaLoon", "PEKKA Bridge Spam",
"Splashyard" — are hand-curated titles for particular card sets. Deck Shop
titles each exact deck by hand; no site publishes a rule for them. Elixir
does not assert one: it never labels a deck "LavaLoon". It *understands*
those names when a person uses them (see resolving, below).

## The grammar

`<win condition(s)> <family>` — "Royal Hogs bridge spam", "Hog Rider
cycle", "Lava Hound Balloon beatdown", "X-Bow siege". The win condition's
form is said the way players say it — "Evo Royal Hogs bridge spam", "Hero
Musketeer control" — and other cards' forms are not, so two deck
identities that differ only in a support card's form share a label. A
deck with no attested win condition is named by its cost alone:
"Cycle", "Control", "Beatdown".

Composition, in order:

1. **The win conditions in the deck, by priority.** A siege building
   anchors first, then the heavy tanks (Golem, Lava Hound, Electro Giant,
   Goblin Giant, Elixir Golem, Three Musketeers, in that order), then
   Graveyard, then Giant and Royal Giant, Balloon, Sparky, then a Goblin
   Barrel with a real bait package (two or more bait units), then
   P.E.K.K.A and Mega Knight, then light bait (a Barrel with one bait unit,
   Skeleton Barrel), then the chip and bridge win conditions (Hog Rider,
   Ram Rider, Royal Hogs, Battle Ram, Miner, Wall Breakers, Goblin
   Drill), then the newer bridge cards (Ronin, Boss Bandit, Elite
   Barbarians). A Golem names the deck before the Miner beside it.
2. **The family the anchor implies**, with three tests: a Goblin Barrel is
   *bait* only with at least one bait unit beside it (a lone barrel is
   chip); P.E.K.K.A, Mega Knight and Ram Rider are *bridge spam* only with
   a bridge partner beside them (Bandit, Battle Ram, Royal Ghost, Royal
   Hogs, Prince, Dark Prince, Lumberjack, Golden Knight, Boss Bandit,
   Ronin, Mighty Miner…), else *control*; and Hog Rider, Royal Hogs,
   Royal Giant, Balloon, Miner and Goblin Drill are *cycle* when the
   deck's average elixir is at or under the **cycle bound**, else their
   usual family.
3. **A paired second win condition**, when present: Balloon beside Lava
   Hound (LavaLoon), Sparky beside Goblin Giant, Wall Breakers beside
   Miner (which makes it cycle), Giant beside Graveyard (which makes it
   beatdown — the community's "Giant Graveyard").
4. **No win condition**: by cost — at or under the cycle bound *cycle*,
   4.0 and over *beatdown*, between them *control* — led by the card
   that **names** the deck when one is present: "Rune Giant beatdown" for
   a deck whose tower damage is chip from enchanted troops behind the
   tank. Such a card (`named_by`) is not a win condition and never
   anchors over one; `win_conditions` stays empty.

`secondary_win_conditions[]` carries every other attested win condition
in the deck, by priority — what the label leaves out — so "Miner control"
can be said as "Miner control, with Goblin Barrel and Boss Bandit"
without reading the cards.

The average excludes Mirror (it has no cost), as the deck sites do, and
uses the catalog's **current** costs: a balance change re-prices history,
which is how the sites read it too.

### The cycle bound

Guides say "under 3.5"; the named cycle decks run 2.6–3.1. Elixir pins the
bound where the record says the two populations part, and the record
agrees with the guides read literally. An eight-card average steps by an
eighth, so the question is whether 3.375 belongs with cycle or above it.
Over every deck recorded in season 2026-09 (204,957 identities, 570,488
battles), the battles per average for the three canonical chip win
conditions:

| average | Hog Rider | Royal Hogs | Miner |
| --- | --- | --- | --- |
| 2.625 | 12,231 | 63 | 225 |
| 2.75 | 8,993 | 184 | 792 |
| 2.875 | 2,057 | 6,058 | 5,437 |
| 3.0 | 1,951 | 1,149 | 2,073 |
| 3.125 | 2,039 | 2,246 | 1,828 |
| 3.25 | 2,157 | 878 | 2,719 |
| 3.375 | 3,628 | 1,909 | 1,849 |
| **3.5** | **1,853** | **612** | **1,040** |
| 3.625 | 2,776 | 909 | 1,325 |
| 3.75 | 2,982 | 1,454 | 5,404 |
| 3.875 | 2,603 | 1,387 | 1,479 |
| 4.0 | 2,329 | 785 | 1,215 |
| 4.125 | 4,297 | 2,071 | 738 |

The trough is at exactly 3.5 for all three: 3.375 sits on the plateau
below it, 3.5 is the dip before the heavier decks rise (Miner's 3.75 peak
is the Miner Poison control shape; Hog Rider's 4.125 the Hog EQ and
control shapes). So the bound in force, `CYCLE_MAX` in the contract, is
**3.4**: an average of 3.375 is cycle, 3.5 is not. The `archetype_census`
operator read reruns this over the whole record; the day the number
moves, this page says so. (Balloon and Royal Giant show the same dip at
3.5 with a second cluster at 2.875 and 3.0 respectively — "Balloon
cycle" and "3.0 RG cycle"; Goblin Drill runs broad from 2.5 to 3.375.)

## Where the vocabulary lives, and who keeps it

**Grammar in code, vocabulary in data.** The rules above are code in the
contract package and carry `grammar_version`. *Which* cards are win
conditions, at what priority, implying which family, and which cards are
bait units and bridge partners, are facts about cards with a public
source each: [`data/card-roles.json`](https://github.com/jthingelstad/cr-agent-api-docs/blob/main/data/card-roles.json)
in the standalone Clash Royale API reference, alongside
[`data/deck-aliases.json`](https://github.com/jthingelstad/cr-agent-api-docs/blob/main/data/deck-aliases.json)
and the reference's own page on
[how players name decks](https://github.com/jthingelstad/cr-agent-api-docs/blob/main/deck-archetypes.md).
The reference's build refuses an entry without a public URL, a family
outside the six, or a rewrite that drops a long-standing win condition.
Elixir imports the two files at deploy; the commit time is
`roles_version` on every archetype object, so a label can always be
traced to the vocabulary that produced it.

A card absent from the file is **not a win condition**, however new. A
deck built around one lands honestly on its bare family until a public
source names it; the reference lists those cards as `unattested`, and
the domain's research agent treats that list as its queue. The
vocabulary is not versioned by season: a role is a property of the card,
not of the month it was learned in, and when the vocabulary improves,
history is relabelled — the deck was always that shape.

Where the community disagrees, Elixir picks and says so in the entry's
source line: Royal Hogs is *bridge spam* (the deck sites) rather than
*bait* (one guide); an X-Bow or Mortar deck at cycle cost keeps the
*siege* family ("Mortar cycle" resolves to it by alias); P.E.K.K.A
is *control* in the guides and *bridge spam* on the deck sites, and the
partner test is the difference.

## Resolving a name

**`cards_archetype`** answers the two questions on their own, with no
population attached: `{ name }` says what a name means — family, win
conditions, the other names for that shape, and how much of this
season's record plays it — and `{ cards }` names a deck from up to eight
cards (ids or names; `Evo` / `Hero` before a name sets its form), with no
record required and a note on whether anyone recorded has played that
exact set. Called with nothing it returns the vocabulary itself.

`battles_meta_decks`, `battles_decks` and `cards_card` take `archetype`, a
string, resolved the same way in three layers, first match wins. A form
said before a win condition ("Evo Royal Hogs bridge spam") keeps to that
form's decks; a name without one ("Royal Hogs bridge spam") matches every
form of the card, and `cards_archetype` says so in a note (6.22.0).

1. **An alias** — the community names the grammar does not produce:
   *LavaLoon*, *LumberLoon*, *Log Bait*, *Splashyard*, *Miner Poison*, *Hog
   EQ*, *2.6 Hog*, *Hog cycle*, *Giant Graveyard*, *PEKKA Bridge Spam*,
   *Rocket cycle*, *RG cycle*, *Mortar cycle*, *X-Bow cycle*, *Wall
   Breakers cycle*, *Drill cycle*, *eBarbs bridge spam* and the rest of
   the aliases file, case and punctuation free.
2. **A family** — `bridge spam`, `beatdown`, and so on: any win condition.
3. **A composed label** — `<card(s)> <family>`, the cards by catalog name
   (`pekka` and `P.E.K.K.A` both), an `evo`/`hero` prefix setting the form:
   "evo royal hogs bridge spam" is Evo Royal Hogs, bridge spam, and keeps
   to that form's decks, as above.

The response echoes `applied.archetype` — `family`, `win_conditions`,
`resolved_from` (`alias`, `family` or `label`) and any `aliases` that name
the resolved shape — and a note says what was matched. A name that is
nothing is refused (`bad_request`) with the six families and the grammar
in the hint; it is never a silent empty list that reads as "nobody plays
that". The filter runs over every deck in scope over `min_battles`, by
its stamp, and denominators stay the population's.

## Who plays what

`battles_meta_decks { group_by: "archetype" }` folds a population's decks
by label — one row per "Royal Hogs bridge spam", "Hog Rider cycle",
"Graveyard control" — with `decks`, `battles`, the record, `players` and
`share`; `group_by: "family"` folds to the six families. On a clan,
player or collection segment each row carries **`members[]`**: who plays
the shape, their battles and wins in it, and their most-played deck of
it, so "what decks do our players use?" is one call answered the way a
player would say it. Rows are sorted by who plays them (players, then
battles) and carry **no shrunk rate**: the same label sits at 83% and
40% in one clan, and a pooled family rate would read as a tier list.
`decks[]` is empty with `group_by`.

Underneath, every deck in the record carries its archetype as a
**stamp** — written when a deck first appears, and caught up nightly for
every deck behind the current grammar or vocabulary version — so a
rule change or a vocabulary import reaches history by the next morning,
and the fold and the filter cover a whole season instead of its top
rows.

With `fit_for`, the meta reader also says which families, win
conditions and shapes the player already fields (`fit_for.plays`), and
on every row whether it is one of them (`fit.plays_archetype`,
`fit.plays_win_condition`, `fit.plays_family`). Adoption cost reads off
them in that order: the exact shape costs the least; the same win
condition in another family - Evo Royal Hogs cycle to a player who
fields Evo Royal Hogs bridge spam - is the card they have leveled and
learned played at a different pace, the usual next step; the same
family around a new win condition is a new card to level; a row sharing
neither is a new deck to learn as well as levels to buy. The win
condition is matched form included: Evo Royal Hogs is not Royal Hogs,
because the form is what is unlocked and leveled.

## What is not here

- **No matchup or expected-advantage number**, and none is coming. A
  player's own record by opposing family may arrive later, as facts about
  that player.
- **No quality in a label.** `shrunk_win_rate` and its kin are on the
  deck row, not on the archetype.
- **No named-deck catalog.** Aliases are read on the way in only.
- **No model.** The same cards and the same vocabulary name the same
  archetype on every call and every surface.
