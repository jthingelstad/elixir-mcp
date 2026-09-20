# Deck archetypes: naming a deck, and knowing what a name means — design, 2026-09-20

**Ask (Jamie):** players talk about decks by name — "Royal Hogs bridge
spam", "Hog cycle", "Log Bait" — and Elixir has to speak that language in
both directions: name any deck it holds, and know what decks a name
refers to when a player asks. The first concrete consumer is Elixir Clan:
"what decks do our players use?", answered by archetype and win
condition, not by eight card names. Matchup expectations are out
("that was a mistake in elixir-bot and should not come forward at
all"), and nothing in the design may be specific to one clan.

**Method.** Read `elixir-bot/capabilities/decks.py` (`_classify`, the
`deck_profile` table, the "decks worth trying" rule), then the public
convention: RoyaleAPI's archetype filters, Deck Shop's deck titles,
RoyaleTracker's archetype list, the Fandom `Deck:` pages, four
archetype guides, and the open-source classifiers. Sized the record:
203,321 deck identities, 123 catalog cards, `deck_card` with forms,
`deck_meta_season` at 425k rows. Design only; nothing applied.

---

## 0. Summary

The community keeps two layers apart and so will Elixir. **Families**
are a small, stable, universal taxonomy — beatdown, control, cycle,
bait, bridge spam, siege — that RoyaleAPI filters on and every guide
teaches. **Named decks** ("2.6 Hog Cycle", "LavaLoon", "PEKKA Ghost
bridge spam") are hand-curated titles for particular card sets; no site
publishes a rule for them, the CR API carries no archetype, and the
game names nothing.

Elixir will carry the family layer as **vocabulary, never verdict**: a
deterministic, versioned, sourced rule set in `packages/contracts` that
composes a descriptive label — `<win condition(s)> <family>` — from a
deck's cards and the catalog's elixir costs. It rides every deck object
at the one seam all of them pass through (`deckIdentities`), so an agent
says "Royal Hogs bridge spam" because the payload does. The same rules
run backwards: a name — a family, a composed label, or one of the
attested community aliases — resolves to `{ family, win_conditions }`,
which is a filter and a grouping on the meta readers. Elixir Clan's
question becomes one call: `battles_meta_decks { segment: { clan_tag },
group_by: "archetype" }`, rows per archetype with the members who play
it.

Generic by construction: every rule cites public usage, thresholds are
the community's quoted numbers checked against the whole corpus (not
one clan's decks), and the label is presented as *descriptive* —
Elixir's name for the deck's shape, not a claim about what people call
it or how good it is. Three phases; phase 1 is one additive minor.

---

## 1. What players say (findings)

**Two layers, everywhere.**

| Layer | What it is | Who uses it | Stable? |
| --- | --- | --- | --- |
| Family | beatdown · control · cycle · bait · bridge spam · siege (some add *hybrid*) | RoyaleAPI deck search (`type=Archetype_BeatdownAny`, `Archetype_BridgespamAny`…), TrophyCoach (five of the six), Red Bull, GamingOnPhone, GameRant, GladiatorBoost | yes — the same six for years |
| Named deck | "2.6 Hog Cycle", "Log Bait", "LavaLoon", "PEKKA Bridge Spam", "Splashyard", "Miner Poison", "Hog EQ", "Giant Graveyard", "Archer Queen Royal Hogs" | Deck Shop (titles every exact deck by hand: "PEKKA Ghost bridge spam", "PEKKA Zap bridge spam", "Mighty Miner PEKKA bridge spam"), RoyaleTracker (eleven named, with descriptors), the Fandom wiki (`Deck:` pages) | no — editorial, casing drifts, new ones every balance patch |

**The grammar of a name is `<win condition> [<distinguishing card>] <family>`**, with the family sometimes elided when the win condition implies it ("Hog EQ", "Miner Poison") and sometimes the whole thing a portmanteau ("LavaLoon", "Splashyard", "LumberLoon"). The average elixir is a prefix on cycle decks only ("2.6 Hog", "2.9 X-Bow").

**Nobody publishes an algorithm.** RoyaleTracker states no assignment
rules; Deck Shop's titles are human; the open-source attempts are a
hand-curated library of ~30 proven decks scored against a collection,
or k-means with k=3 that recovers only cycle/control/beatdown. The
graph and ML work classifies *cards*, not decks.

**Where sites disagree, it is at the edges**, and the edges are the
same ones elixir-bot's comments argue about: Royal Hogs is *bridge spam*
to TrophyCoach and *bait* to GamingOnPhone; "cycle" is "under 3.5"
elixir in guides and 2.6–3.0 in named decks; whether a P.E.K.K.A deck is
bridge spam or control depends on its partners, not on the P.E.K.K.A.

**elixir-bot's `_classify` is the community grammar, locally
justified.** Its vocabulary is exactly the six families and the
`<win condition> <family>` label. What is clan-local is the *evidence*:
`CYCLE_MAX = 3.3` was set "in practice" from clan decks against a
community "under 3.5"; Royal Hogs → bridge spam was "King Thing's
call". The calls agree with the web; the justification has to move to
the web. The bot also carries a 6×6 matchup matrix from clan outcomes,
which this design does not bring forward.

---

## 2. Goals and non-goals

**Goals**

1. Every deck object Elixir serves carries its archetype: family, win
   condition(s), average elixir, a descriptive label, and the basis and
   version of the rule that produced it.
2. A name resolves: a family, a composed label, or a community alias →
   `{ family, win_conditions }`, usable as a filter and a grouping.
3. "What decks do the members of this clan play?" is one call, answered
   by archetype and win condition with the members named.
4. Every rule is generic and sourced; thresholds are validated on the
   whole corpus; the classifier is versioned so a rule change is a
   contract event, not drift.

**Non-goals**

- No matchup expectation, no "family X beats family Y", no expected
  advantage number. Facts about a player's own record by opposing
  family may come later, as facts; not in this design.
- No quality claim in a label. `label` is a noun.
- No named-deck catalog as output. Elixir does not assert that a deck
  "is 2.6 Hog Cycle"; it says "Hog Rider cycle, 2.6". Aliases are used
  for *understanding a name*, never for *asserting one* (§5).
- No LLM in the classifier. The same eight cards name the same
  archetype on every call and every surface.
- No `hybrid` family. A deck gets one family and a list of win
  conditions; a second win condition is how a hybrid is visible.

---

## 3. The vocabulary

### 3.1 Families (closed enum)

| `family` | Definition (the community's) | Attested |
| --- | --- | --- |
| `beatdown` | build a large push behind a high-hitpoint tank; accept elixir deficits to overwhelm | Red Bull, GamingOnPhone, TrophyCoach ("Golem, Lava Hound, and Giant decks that build a big push behind a tank") |
| `control` | defend efficiently, counter-push, chip; win over time | GamingOnPhone (P.E.K.K.A, Mega Knight, Miner, Graveyard), TrophyCoach ("Graveyard Poison, X-Bow, and Mortar decks that win on chip and defense") |
| `cycle` | cheap cards, fast rotation back to a chip win condition | all guides; named decks "2.6 Hog", "2.9 X-Bow" |
| `bait` | force the opponent's small spells with spell-vulnerable swarm, then punish | all guides; "Log Bait" |
| `bridge_spam` | fast units at the bridge to deny the opponent a build-up and punish mistakes | RoyaleAPI filter; TrophyCoach ("Bandit, Battle Ram, and Royal Hogs decks that pressure both lanes") |
| `siege` | attack the tower from one's own side with X-Bow or Mortar | all guides |
| `unclassified` | no recognised win condition; the family fallback did not apply | Elixir's own honesty value; elixir-bot measured ~2% of live decks here |

Siege and control overlap in the guides (TrophyCoach files X-Bow under
control); Elixir keeps `siege` because RoyaleAPI and the named decks
("X-Bow siege", "Mortar cycle") do, and because "attacks from its own
side" is a property of the cards, not an opinion.

### 3.2 Win conditions

A win condition is a card whose purpose is to damage the tower. The
label anchors on the most deck-defining one, in priority order (a Golem
names the deck before the Miner beside it). The list is the community's
and is kept as data in contracts, one row per card id, with its priority
tier and the source that attests it as a win condition:

| Tier | Cards (catalog id) | Family they imply | Note |
| --- | --- | --- | --- |
| 1 siege | X-Bow 27000008, Mortar 27000002 | `siege` (Mortar at cycle cost → `cycle`, label "Mortar cycle") | "2.9 X-Bow", "Mortar cycle" are named decks |
| 2 heavy tanks | Golem 26000009, Lava Hound 26000029, Electro Giant 26000085, Goblin Giant 26000060, Elixir Golem 26000067, Three Musketeers 26000028 | `beatdown` | Lava Hound + Balloon → win_conditions both, label "Lava Hound Balloon beatdown" (alias LavaLoon); Goblin Giant + Sparky both |
| 3 graveyard | Graveyard 28000010 | `control` | "Splashyard", "Giant Graveyard" |
| 4 giants | Giant 26000003, Royal Giant 26000024 | Giant → `beatdown`; Royal Giant → `control` (community: "RG cycle" at cycle cost → `cycle`) | |
| 5 balloon | Balloon 26000006 | cycle cost → `cycle`, else `beatdown` | "LumberLoon" |
| 6 sparky | Sparky 26000033 | `beatdown` | |
| 6.5 bait package | Goblin Barrel 28000004 with ≥ 2 bait units | `bait` | the package is the tell (a lone barrel is chip) |
| 7 heavy bridge | P.E.K.K.A 26000004, Mega Knight 26000055 | with a bridge partner → `bridge_spam`; else `control` | "PEKKA Bridge Spam" vs "PEKKA control" |
| 8 light bait | Goblin Barrel + 1 bait unit; Skeleton Barrel 26000056 | `bait` | |
| 9 chip / bridge | Hog Rider 26000021 (cycle cost → `cycle` "Hog cycle", else `control`), Ram Rider 26000051, Royal Hogs 26000059 (`bridge_spam`; cycle cost → `cycle`), Battle Ram 26000036, Miner 26000032 (+ Wall Breakers → `cycle`; cycle cost → `cycle`; else `control` "Miner control"), Wall Breakers 26000058, Goblin Drill 27000013 | as noted | Royal Hogs → bridge spam is TrophyCoach's reading; GamingOnPhone says bait; Elixir follows the deck sites, and says so in the rule's source line |
| 9.5 newer bridge | Ronin 26000106, Boss Bandit 26000103, Elite Barbarians 26000043 | `bridge_spam` | attested by Deck Shop titles ("Boss Bandit bridge spam"); Ronin's attestation to confirm before v1 |
| 10 fallback | none | by average elixir: ≤ cycle bound → `cycle`; ≥ beatdown bound → `beatdown`; else `control`; label is the bare family | never invent a win condition |

Bait units (the package test): Princess, Goblin Gang, Skeleton Army,
Dart Goblin, Rascals, Goblins, Spear Goblins, Guards, Firecracker.
Bridge partners (the P.E.K.K.A / Mega Knight test): Bandit, Battle Ram,
Ram Rider, Royal Ghost, Royal Hogs, Wall Breakers, Prince, Dark Prince,
Lumberjack, Golden Knight, Boss Bandit, Ronin.

**To attest before v1** (in the catalog, absent from elixir-bot's rules,
too new for the guides): Rune Giant 26000101, Goblin Machine 26000096,
Goblinstein 26000099, Spirit Empress 28000025, Goblin Demolisher
26000095, Minion Giant 26000107, Mighty Miner 26000065 (Deck Shop:
"Mighty Miner PEKKA bridge spam" — a partner, or a win condition?). A
card not on the list is not a win condition; a deck built around one
lands honestly in tier 10 until the community names it. That is the
right failure: "control" for a Rune Giant deck is vague, "Rune Giant
beatdown" invented would be wrong with authority.

### 3.3 Thresholds

Two numbers, both the community's, both to be checked against the corpus
before they are pinned:

- **Cycle bound.** Guides say "under 3.5"; the named cycle decks run
  2.6–3.0. elixir-bot uses 3.3 from clan evidence. Proposal: **≤ 3.4**
  (the guides' number, inclusive of what they mean), then measure: the
  distribution of average elixir over every corpus deck containing Hog
  Rider, and over every deck containing Royal Hogs, tells whether the
  population is bimodal and where the trough sits. If the corpus says
  3.3, the source line says "guides: under 3.5; corpus trough 3.3
  (2026-09, n=…)".
- **Beatdown bound (fallback only).** 4.0, the low end of "heavy decks
  run 4.0–5.2"; used only when no win condition matched.

Mirror carries no cost and is excluded from the average, as the deck
sites do; a deck whose cards carry no cost at all averages `null` and is
`unclassified`.

### 3.4 Composition and forms

- `label` = win conditions joined by space, then the family in its
  display form: "Royal Hogs bridge spam", "Lava Hound Balloon beatdown",
  "Hog Rider cycle", "Mortar cycle", bare "Cycle" / "Control" /
  "Beatdown" / "Unclassified" for tier 10. Lower-case families, card
  names as the catalog spells them (never "Hog", never "PEKKA": the
  aliases handle the shorthand on the way *in*).
- The label is **form-blind**: Evo Royal Hogs and base Royal Hogs are
  both "Royal Hogs bridge spam". `deck_hash` is form-aware, so several
  identities share one label; the note says so, and `cards[].form` is
  still on every deck.
- `average_elixir` rides beside the label at two decimals; readers who
  want "2.6 Hog cycle" compose it.

### 3.5 Versioning

`rules_version` is a date-stamped string (`"2026-09"`) on every
archetype object and in the changelog. A rule change — a new card
attested, a threshold moved — bumps it and is a contract minor. The
stamped column of phase 2 carries the version it was stamped with, so a
re-stamp is a nightly job over the rows whose version is old.

---

## 4. Direction one: naming a deck

### 4.1 Where

`deckIdentities(db, hashes)` in `services/mcp/src/tools/shared.mjs`
already joins `deck_card` to `card` for every deck object the contract
serves: `battles_query` rows, `battles_decks`, `battles_meta_decks`
(`decks[]` and `unfieldable[]`), `cards_card.decks`, `players_summary`'s
current and best deck. Add `elixir_cost` to that join and compute
`archetype` there. One seam, every surface, no new tool, no storage.
`renderDecks` (the per-battle card rows with levels) gets the same
object on the deck it renders.

### 4.2 The object

```json
"archetype": {
  "family": "bridge_spam",
  "win_conditions": [{ "id": 26000059, "name": "Royal Hogs" }],
  "label": "Royal Hogs bridge spam",
  "average_elixir": 3.62,
  "basis": "cards and catalog elixir costs; form-blind",
  "rules_version": "2026-09"
}
```

`family` is the closed enum in the output schema. `label` is a string.
One note on any response that carries deck objects, once: *"archetype
is Elixir's descriptive name for a deck's shape — its win condition and
family, from the cards and their costs — not a claim about what players
call it or how it performs; several deck identities (forms) share one
label."*

### 4.3 The module

`packages/contracts/src/archetypes.ts`: the family enum, the win
condition table (§3.2) with source lines, the bait and bridge sets, the
thresholds, `classifyDeck(cards: {id, name, elixir_cost}[]) →
Archetype`, `RULES_VERSION`. Written fresh with `decks.py` open (golden
rule 7), in the family's shared package so Drop, Clan and the Discord
preview carry one vocabulary through the pinned dependency, and so
elixir-bot can read the label off MCP and retire its own `_classify`
when it is ready (the standing direction: less native data work in the
bot).

---

## 5. Direction two: knowing what a name means

An agent hears "Royal Hogs bridge spam", "Hog cycle", "LavaLoon",
"log bait", "PEKKA bridge spam", "2.6 Hog", "RG", "Splashyard". Elixir
resolves it in three layers, first match wins, and always echoes what it
resolved to:

1. **A family** (`bridge spam`, `beatdown`…, spelling and case free) →
   `{ family }`, any win condition.
2. **A composed label** (`<card(s)> <family>`) → the card(s) by catalog
   name (the existing `cards_catalog` name resolution, which already
   takes "Hog", "PEKKA", "RG"-style shorthand by its `query`), plus the
   family.
3. **An alias**: a short, sourced table of the attested community names
   that the grammar does not produce —

   | alias | resolves to | source |
   | --- | --- | --- |
   | LavaLoon | Lava Hound + Balloon, beatdown | RoyaleTracker, Fandom |
   | LumberLoon | Balloon + Lumberjack | RoyaleTracker |
   | Log Bait / Logbait | Goblin Barrel, bait | RoyaleTracker, Deck Shop |
   | Splashyard | Graveyard, control | RoyaleTracker |
   | Miner Poison | Miner + Poison, control | RoyaleTracker |
   | Hog EQ | Hog Rider + Earthquake | RoyaleTracker |
   | 2.6 Hog / Hog 2.6 / Hog cycle | Hog Rider, cycle | Fandom, TrophyCoach |
   | Giant Graveyard | Giant + Graveyard | RoyaleTracker |
   | PEKKA Bridge Spam | P.E.K.K.A, bridge_spam | Deck Shop, RoyaleTracker |
   | Rocket cycle | Rocket, cycle (a tier-10 cycle with Rocket) | RoyaleTracker |
   | RG cycle | Royal Giant, cycle | TrophyCoach |

   Twenty-odd rows, each with a source; a table, not a rule. Aliases
   are read on the way in only — Elixir never labels a deck "LavaLoon",
   it labels it "Lava Hound Balloon beatdown" and, when an alias matches
   the resolved shape, may carry `aliases: ["LavaLoon"]` on the
   resolution so the agent can answer in the player's word.

An unresolvable name is refused `bad_request` with the six families and
the grammar in the hint, the way `segment` is — never a silent empty
list that reads as "nobody plays that".

### 5.1 Where a name is accepted

- **`battles_meta_decks { archetype: "royal hogs bridge spam" }`** and
  `battles_meta_cards` — a post-aggregation filter like `containing`,
  echoed as `applied.archetype: { family, win_conditions, resolved_from,
  aliases }`. Population denominators stay the population's.
- **`cards_card`**'s `decks` and **`battles_decks`** take the same filter
  (a player's own decks of one archetype).
- **`elixir_docs`**: a page `archetypes` — the six families with their
  definitions and sources, the win condition table, the grammar, the
  aliases, the thresholds and how they were checked. The vocabulary is
  discoverable without a call, and public.

### 5.2 One small tool, or none

"Name this deck" from eight card names the agent has in hand (a
screenshot, a player's message) and "what does *Splashyard* mean" with
no data attached are both real, and neither is a meta read. Two
options, in order of preference:

- **None.** `cards_catalog` already resolves names; `elixir_docs
  archetypes` carries the vocabulary; an agent with eight names calls
  `battles_meta_decks { segment: "corpus", containing: [ids] }` and
  reads the archetype off the first row. Three calls for a question a
  player asks in one breath — and no answer if the exact deck is not in
  the corpus.
- **`cards_archetype`**, one read-only tool in the cards group with two
  shapes: `{ cards: [ids or names] }` → the archetype object for that
  set (no record needed; pure), and `{ name }` → the resolution, with
  the corpus count of decks and players of that shape this season. About
  a kilobyte on `tools/list`. Recommended if phase 1 produces the
  question in the audit; not in phase 1.

---

## 6. The Elixir Clan question

"What decks do our players use?" → **`battles_meta_decks { segment: {
clan_tag }, group_by: "archetype" }`**:

```json
"archetypes": [
  {
    "family": "bridge_spam",
    "win_conditions": [{ "id": 26000059, "name": "Royal Hogs" }],
    "label": "Royal Hogs bridge spam",
    "players": 7,
    "members": [{ "player_tag": "#…", "name": "…", "battles": 41, "deck_hash": "…" }],
    "battles": 212, "wins": 118, "losses": 94, "win_rate": 0.557,
    "share": 0.19,
    "decks": 5
  }
]
```

Rows per (family, win_conditions) — the label — ordered by players then
battles; `members[]` for a clan or collection segment (names beside
tags, 6.3.0), counts only for the corpus. The sort is by *who plays*,
not by win rate, and `shrunk_win_rate` is deliberately absent from the
archetype row: the same label sits at 83% and 40% in elixir-bot's own
measurement, and a pooled family rate would read as a tier list. A
second `group_by: "family"` collapses to six rows for "how much of the
clan is beatdown". The per-member half — "what does *Vijay* play" —
is `players_summary.current_deck.archetype`, already there after
phase 1.

For Elixir Clan, one call per evaluation stays the rule: it reads
`clans_participation` today; the archetype read is a second, separate
question, on the member page or the clan page, and this is its one
call.

---

## 7. Data model

**Phase 1 — read-time.** Nothing stored. `classifyDeck` runs over the
returned rows' cards, at most forty decks a call. Rules change, labels
change, no migration.

**Phase 2 — stamped.** Grouping a clan's season (thousands of deck rows
from `deck_meta_season`) or filtering the corpus by archetype cannot
classify every candidate deck at read time. Expand-and-contract on
`deck`: `archetype_family text`, `archetype_label text`,
`archetype_win_conditions integer[]`, `archetype_rules_version text`,
indexed on `(archetype_family)` and `(archetype_label)`. Stamped by
`deck-cards.mjs` when a deck row is first written (the cards are in
hand), backfilled once over 203k rows in the nightly (minutes), and
re-stamped by the nightly for every row whose `rules_version` is not
current after a bump. `deck_meta_season` joins `deck` on `deck_hash`,
so `group_by: "archetype"` is a `group by d.archetype_label` over the
rollup — the same cost as today's deck rows. The stamp is a cache of a
pure function with its version beside it; the truth stays the rule.

---

## 8. Verification (generic by construction)

1. **Port equivalence.** The TypeScript rules against elixir-bot's
   `_classify` over one fixture of ~60 decks covering every tier and
   every edge (bait package vs lone barrel, P.E.K.K.A with and without a
   partner, Royal Hogs at 3.2 and 3.8, Mirror, no-cost cards, Lava Hound
   with and without Balloon). Both repos pin the fixture.
2. **Corpus distribution.** Run the rules over all 203k decks: the share
   per family, the share `unclassified`, the top thirty labels by
   players. A family over 40% or `unclassified` over 5% is a rule
   problem to look at before shipping.
3. **Public hand-check.** The top 100 corpus decks by players this
   season, labelled, beside their Deck Shop / RoyaleAPI titles where
   those exist. Every disagreement is either a wrong rule (fix), a
   missing alias (add), or a genuine community ambiguity (document the
   choice in the source line).
4. **Thresholds.** The elixir histograms of §3.3 before the numbers are
   pinned; the numbers and the histograms go in the docs page.
5. **Resolution round-trip.** Every alias resolves; every composed label
   Elixir can emit resolves back to itself; the six families resolve
   case-free; "Ronin control" (a label Elixir would not compose) refuses
   with the hint.

The clan database is not used for any of this. It can be used for one
extra check — the POAP KINGS decks both records hold should carry the
same label under both classifiers — but that is a port test, not a
truth test.

---

## 9. Consumers

- **Agents (Claude over MCP, the Discord preview).** No prompt change
  needed for direction one: the label is on the value. The server
  instructions gain one clause: *"decks carry archetype — say the label,
  not eight cards; a name a person uses resolves through the archetype
  argument or the archetypes docs page."* The bot's "SOUND LIKE A
  PLAYER" paragraph is what this replaces.
- **Elixir Clan.** `group_by: "archetype"` on the clan segment (§6);
  `players_summary.current_deck.archetype` per member.
- **elixir-bot.** Unchanged now. When its MCP pin reaches the phase-1
  contract it may read `archetype` off `battles_decks` /
  `players_summary` and retire `_classify` and `deck_profile`'s label
  columns; the matchup matrix retires with nothing replacing it. A
  direction, not a step in this design.
- **Drop, poapkings.com.** Nothing required; the vocabulary is in
  contracts if they want it.

---

## 10. Phases

| Phase | Ships | Contract | Effort |
| --- | --- | --- | --- |
| 1 | `archetypes.ts` in contracts (rules, sources, thresholds, aliases); `archetype` on every deck object via `deckIdentities` and `renderDecks`; the `archetypes` docs page; the archetype note; the `archetype` filter on `battles_meta_decks` / `battles_meta_cards` / `battles_decks` / `cards_card` (read-time, over the returned rows — so a filter narrows what is returned; a corpus-wide filter waits for the stamp); verification 1, 2, 3, 4, 5 | additive minor | a day: the port and its fixture, the docs page with sources, the corpus run |
| 2 | the stamped columns on `deck`, the backfill and re-stamp job; `group_by: "archetype" \| "family"` on `battles_meta_decks` with `members[]`; the archetype filter over the whole population | additive minor + one migration | a day |
| 3 | `cards_archetype` if the audit shows the question; a player's own record by opposing family on `battles_performance`, as facts, if asked for | additive minor | half a day each |

---

## 11. Decisions for Jamie

1. **The cycle bound: pin 3.4 (the guides) or the corpus trough, if it
   differs?** Recommendation: the corpus trough, documented with the
   histogram; the guides' number as the tie-break.
2. **Royal Hogs → bridge spam** (deck sites) over bait (one guide)?
   Recommendation: bridge spam; the rule's source line records the
   disagreement.
3. **The newer cards** (§3.2, "to attest"): leave them unrecognised
   until the community names them, or attest from Deck Shop titles now?
   Recommendation: attest what Deck Shop titles today (Boss Bandit,
   Mighty Miner as partner), leave the rest to tier 10.
4. **The tool (§5.2):** none in phase 1, `cards_archetype` only if the
   audit shows agents reaching for it. Recommendation: none.
5. **Where the vocabulary is documented publicly:** a new
   `/docs/archetypes` page (recommended: it is a reference with sources,
   and `elixir_docs` serves it), or a section on `cards`.

---

*Sources read for this design: RoyaleAPI deck search archetype filters
(`Archetype_BeatdownAny`, `Archetype_BridgespamAny`); RoyaleTracker
"Best Clash Royale Deck Archetypes 2026"; TrophyCoach deck finder;
Deck Shop deck detail pages (PEKKA bridge spam variants); Clash Royale
Fandom `Deck:` pages (Modern Hog Cycle, LavaLoon); Red Bull "4 ways of
using archetypes"; GamingOnPhone, GameRant and GladiatorBoost archetype
guides; aasifnid/clash-royale-deck-builder; the deck clustering
analysis (Martell Flores). elixir-bot: `capabilities/decks.py`,
`capabilities/deck_intel.py`, `db/schema.py` v28.*

---

## 12. Addendum — Jamie's decisions and three amendments (2026-09-20, later)

**Decided.** (1) The cycle bound comes from the corpus trough, with the
histogram published. (2) "bridge spam" for Royal Hogs. (3) Attest only
what public titles attest today; the rest of the newer cards land
honestly in tier 10 — and the maintenance path is §12.3, not a deploy.
(4) The resolver tool is deferred to its own phase (it is exactly
"take a deck by name and resolve what that could be"). (5)
`/docs/archetypes`. No special casing for named decks, confirmed; the
alias table stays an input-side convenience and becomes admin-editable
(§12.3). This is the last large capability elixir-bot holds that the
family needs in the right place.

### 12.1 Forms in the label

The community says "Evo Hogs", "Evo Knight bait", "Evo Archers PEKKA
bridge spam", so the label carries the **win condition's** form:
`"Evo Royal Hogs bridge spam"`, `"Hero Musketeer control"`
— the `Evo` / `Hero` prefix on the card it belongs to, catalog names
otherwise. Other cards' forms do not enter the label. So the label is
form-aware exactly where players are, and `win_conditions[]` carries
`form` beside `id` and `name`. Two identities that differ only in a
support card's form still share a label; the note stays.

### 12.2 Upgrades know the archetype

When Elixir suggests card upgrades in deck compositions (`fit` on
`battles_meta_decks`, 6.4.0), the archetype is part of the advice: it is
usually easier to change the win condition and stay in the family a
player already plays than to change family. So, once the label exists:

- `fit` gains `plays_family: true|false` and `plays_archetype:
  true|false` — whether the player's own fielded decks in the window
  (their `battles_decks`) include this row's family / this row's exact
  label. Computed from the player's decks' archetypes, no new query
  shape.
- `unfieldable[]` and the upgrade path stay as they are, but a note
  ranks the reading: *"Rows in a family you already play cost the least
  to adopt; a row sharing your family with a different win condition is
  the usual next step; a row in a new family is a new deck to learn as
  well as levels to buy."*
- `battles_meta_decks { fit_for, same_family: true }` (phase 2, with the
  stamp) narrows to the families the player already fields.

Nothing here scores; it says what the player already does, beside what
the row would need.

### 12.3 The admin card catalog (a good idea, with a boundary)

**The request.** An admin page listing the card catalog, opening any
card to edit meta about it — coarse-grained, a checkbox that a card is
a win condition — with the aliases of §5 editable there too; not a
balance-change tracker, though a step in that direction.

**Assessment: yes.** It fixes the one weakness of §3.2 as designed —
that attesting Rune Giant or Goblin Machine as a win condition would be
a code change, a contract minor and a deploy, for what is one line of
community fact. It also puts the vocabulary where the owner can see all
of it at once, which no code file does. The cost is a real one and worth
stating: the classifier's *facts* move from a code table into a
database table, so the family's shared `contracts` package stops being
the one place the vocabulary lives. That is the right trade, because
the family already gets the vocabulary through MCP responses, not by
importing the table — Drop and Clan never classify a deck themselves.

**The split that makes it safe: grammar in code, vocabulary in data.**
The *rules* — the priority tiers, the bait-package test, the
bridge-partner test, the cycle/beatdown bounds, the composition of a
label, what `unclassified` means — stay in `packages/contracts`, tested
and versioned as code. The *facts about cards* — which cards are win
conditions and at which tier, which family a win condition implies,
which cards are bait units, which are bridge partners — become rows of
a `card_role` table seeded from §3.2 (with its source lines) by a
migration, read by the classifier at run time, and edited in Admin.
`rules_version` becomes two-part: the code's `grammar_version`
("2026-09") and the data's `roles_version` (the latest `updated_at` of
the table, as a date-time), both on every archetype object; a change to
either re-stamps the phase-2 column nightly.

**What the page holds** (Admin ▸ Cards, beside Collections — the same
"an admin-managed catalog" shape):

- **The list:** every catalog card — id, name, type (troop / building /
  spell / tower troop, from the id range), rarity, elixir cost, forms
  available, and the role columns: win condition (tier), implied family,
  bait unit, bridge partner; a "role changed" stamp and by whom; a
  filter for *unattested* (no role, appears as the most expensive card
  in ≥ N tier-10 decks this season — the corpus telling the admin which
  cards want a decision, which is the whole point of (3)).
- **The card:** the catalog facts read-only (the API owns them), then
  the editable roles: `win_condition` (off, or a tier 1–9.5 from §3.2),
  `implied_family` (one of the six; with the cycle-cost switch as a
  second choice where §3.2 has one, e.g. Hog Rider → control, cycle at
  cycle cost), `bait_unit`, `bridge_partner`, and a **required** `source`
  line on every change (a URL or "corpus 2026-09: …"), the thing that
  keeps the vocabulary generic and auditable. Every save writes an
  `account_event` (`card_role_changed`, before → after) and bumps
  `roles_version`.
- **Aliases:** a second tab, one row per alias — the text, the cards
  (by catalog id) and family it resolves to, its source; add, edit,
  retire. Read by the resolver of §5; never by the labeller.
- **What is not there, on purpose:** named decks (no table, no tab — a
  future section if ever pursued, and it would live here); balance
  history (a card's cost and stats stay the API's and the catalog's
  `as_of` says when they last changed); anything that scores a card;
  editing the grammar (thresholds are code, read from the corpus
  histogram, not typed in).

**How it changes the phases.** Phase 1 grows by the migration (`card_role`
seeded from §3.2, `deck_alias` seeded from §5) and the classifier
reading them instead of a literal table; the admin page can land in
phase 1 or 2 without changing the contract, since it edits data the
tools already read. The verification of §8 is unchanged except that the
fixture pins the *seed*, and an admin edit is expected to change labels
— that is what it is for.

### 12.4 Where the vocabulary lives, revised: the docs repo, imported (supersedes the editable table of §12.3)

Jamie, on the required source line: onerous for a person, natural for
an agent — and the domain's **Understand Clash Royale** objective
already browses for new cards and balance changes daily and writes what
holds for any caller to `cr-agent-api-docs`, with sources. Card roles
and aliases are that kind of fact. And on versioning by season: no.

**Not bound to the season table.** The meta (what is popular, what
wins) is already versioned by season in `deck_meta_season`; nothing to
build. The vocabulary (which cards are win conditions, bait units,
bridge partners) changes by accretion a few times a year, and when it
changes **history is relabelled on purpose**: a July deck built on Rune
Giant was always a Rune Giant beatdown, Elixir lacked the word. A role
is a property of the card, not of the month it was learned in; a
season-bound role would freeze old decks under old ignorance. Costs
change through the daily catalog fetch on their own; labels use the
catalog's current cost, as the deck sites do, and `basis` says so.
"Roles as of season 135" is the file at the commit before that roll —
derivable if ever asked, never modelled.

**The data:** `cr-agent-api-docs/data/card-roles.json` (one entry per
card: id, name, `win_condition` tier or null, `implied_family` with the
cycle-cost alternative where one exists, `bait_unit`, `bridge_partner`,
`source`, `attested_at`) and `data/deck-aliases.json` (alias → card ids
+ family, source). The docs build's validator requires a source on
every entry, every id to be a catalog card, every family to be one of
the six: the onerous line lands on the agent, which has the URL it just
read. Git history is the ledger — who, when, why, revertable —
and `roles_version` is the commit date. The domain agent's objective
gains one sentence: *card roles and deck aliases are game facts you
maintain in `data/`; the unattested list Elixir publishes is your
queue.*

**The import:** the nightly jobs run reads the two files at their
pinned commit into `card_role` and `deck_alias` (refusing a file that
fails the same validation), stamps `roles_version`, and re-stamps
every deck whose stamp is older. Not vendoring: nothing is edited
locally, the version rides every archetype object, and drift is
visible. Contracts keeps the grammar; the file holds the vocabulary.

**Admin ▸ Cards shrinks to a read-only page:** the catalog with its
roles, the `roles_version` in force and when it was imported, a link
to the file — and the one operational list, **unattested cards**: no
role, and the defining (most expensive) card in ≥ N `unclassified`
decks this season. That list is what the agent reads too, so a card
that needs a decision gets one before anyone notices. No editor, no
source box, no approval workflow, no named decks.

**Testing the agent for this job.** The seed *is* the test: before the
nightly import is wired, Understand Clash Royale is given one bounded
run — produce `card-roles.json` for the current catalog from public
sources — and the output is checked three ways: agreement with §3.2 on
the win conditions the community has named for years (every
disagreement explained by a source or it is a miss), every source URL
resolving and saying what the entry claims (spot-checked by hand), and
**no role invented** for the cards §3.2 leaves unattested. The
standing gates after that are mechanical: the docs validator on every
commit, the import's refusal of an invalid file, and Elixir's
`unclassified` share on the docs page (a rising share is the agent
falling behind; a falling one with no commits is a card list that
never needed it).

---

## 13. Phase 1 shipped — 2026-09-20 (contract 6.5.0)

`0781364`, `0ff4179`; the vocabulary at `cr-agent-api-docs` `6c4f517`.
The cycle bound measured on the corpus: trough at 3.5 for Hog Rider,
Royal Hogs and Miner; `CYCLE_MAX` 3.4 confirmed (3.375 is cycle). 24% of
season battles carry no attested win condition; the unattested queue
(Goblinstein, Giant Skeleton, Rune Giant, Minion Giant, Royal Recruits)
belongs to Understand Clash Royale. Details in `docs/NOTES.md` under the
same date. Phase 2 (the stamp, `group_by: "archetype"` with members) is
next.

