# Cards in the record and over MCP — 2026-09-19

**Question (Jamie):** we denormalized the card data; how do cards show up
in the data set and in MCP, can an agent hold a whole conversation about
one card ("tell me all about Skeleton Army"), and what more is there to
do — folded into the 5.0.0 release that removes Pilot Score, so the
clients' one re-fetch of `tools/list` covers both.

**Method.** Read the schema and the readers; then hold the conversation
through the tools as an agent would and record what each question cost
and where it ran dry. Read-only; nothing applied. Skeleton Army
(26000012, epic, 3 elixir, Evolution available) is the running example.

---

## 0. Summary

The record's card data is in good shape and richer than the tools let
on. Every battle side stores its eight cards by **id, form and level**;
every deck has an identity built from card:form pairs; every recorded
player's collection is snapshotted; and the nightly rollups already hold
**per season × mode group × card × form** counters (plus a trophy-band
cut; the pair table of 0121 was dropped in 0122 and `cards_synergy` walks
`deck_card`). What is missing is the *reader shaped like a
card*: today an agent asking about one card must pull a 130-row meta
table and find its row, cannot ask for the card's history across seasons
(the rollup has it), cannot list decks that contain it, cannot ask who in
a clan plays or holds it, and cannot ask what beats it. Six of the seven
questions in a natural card conversation are answerable from data the
record already has; one (matchups) needs one more rollup.

Fold into 5.0.0: **one `cards_card` reader**, two additive filters, the
**form vocabulary settled** to one spelling (the breaking part, which is
why it rides the major), `type` on the catalog, and a `/docs/cards` page.
Matchups are a minor release after.

---

## 1. How cards live in the record

| table | one row is | what it carries | scale / notes |
| --- | --- | --- | --- |
| `card` | a card or tower troop, as last fetched from `/cards`; never leaves | id, name, kind (`card`/`support`), rarity, elixir, `max_level` (API rarity-relative), `max_evolution_level` (form **bit field**: 1 Evolution, 2 Hero), icons, `first_seen_at`, `observed_at` (last **change**), `catalog_seen_at` | the API gives no type, description, arena or stats |
| `deck` / `deck_card` | one deck identity / its cards | `deck_hash` (sorted card:form pairs + tower troop), `card_count`, first/last seen; `deck_card(card_id, form)` | levels are not identity; two forms of a card are two slots |
| `battle_participant_card` | one card one side played in one battle | card, **form** (0/1/2), slot (0 = tower troop), **level** (1–16 in-game scale), star_level, round (duels) | the per-battle level is what the Level Curve was built from |
| `player_card` | a recorded player's collection as last seen | level, count toward next, `evolution_level` (forms **unlocked**, bit field), star_level, first/last observed | the collection page's source |
| `card_meta_season` | season × mode group × card × form | battles, wins, losses, distinct players | form **−1 = all forms merged**; mode `all` too |
| `card_meta_season_band` | the same × trophy band | + `level_gap_sum`, `level_gap_battles` | the meta at a level |

Card ids carry the type in their range (`26000xxx` troops, `27000xxx`
buildings, `28000xxx` spells, `159000xxx` tower troops —
`cr-agent-api-docs/cards.md`), but no table or tool spells it out.

## 2. How cards surface over MCP today

| tool | what it answers about a card | shape of the card in the answer |
| --- | --- | --- |
| `cards_catalog` | id ↔ name, rarity, elixir, icons, forms available; `query` substring, `ids` | `maxLevel` 16 for all + `maxLevelRarityScale`; `forms_available: ["evolution"]` |
| `battles_meta_cards` | usage share, W/L, players, raw and shrunk win rate, `mean_level_gap`, by mode / band / season, for a segment | **one row per form**: `evolution: 1|2` integer key, absent on base; **no per-card filter** |
| `cards_synergy` | partners ranked by lift for an anchor card; the anchor block carries decks, players, win rate, usage share (forms merged) | anchor by id or exact name; partners carry **both** `evolution` (int) and `form` (string) |
| `battles_cards` | one player's cards that carry / enemy cards that beat them | per player only |
| `battles_query` | one player's battles `with_card` / `with_cards` / `against_card` | per player only |
| `players_collection` | one player's collection: levels, counts, `forms_available` / `forms_unlocked`, star levels | per player only |
| `battles_meta_decks`, `players_summary`, `battles_decks` | deck rows list their cards `{id, name, evolution?}` | **no "decks containing card X"** |
| docs | deck identity and forms (`battles.md`), what is counted (`methodology.md`) | **no `/docs/cards` page**; `choosing-a-tool` has two card rows |

The per-player half of a card conversation is complete: my battles with
it, my win rate with it, whether I hold it and at what level. The
**corpus and clan half is the gap.**

## 3. The conversation, as run

"Tell me all about Skeleton Army", 2026-09-19 12:20Z, current season,
corpus, ladder.

| question | tool | cost | answer |
| --- | --- | --- | --- |
| What is it? | `cards_catalog({query:"skeleton"})` | 1 call, 6 cards back | epic, 3 elixir, Evolution available, icon. No type, description, arena |
| How much is it played, does it win? | `battles_meta_cards({segment:"corpus", mode:"ladder", limit:130, min_battles:1})` | 1 call, **130 rows / ~25 KB**, find two rows | base: 841 battles, 13.3% usage, 423 players, 0.521; Evolution: 316, 5.0%, 154 players, 0.487, gap +0.20 |
| What is it played with? | `cards_synergy({segment:"corpus", card_id, mode:"ladder"})` | 1 call | anchor 1,157 decks / 576 players / 0.512 / 18.4% (forms merged, and 13.3 + 5.0 = 18.3 agrees); Goblin Barrel lift 2.48, Inferno Tower 2.51, Skeleton King 4.0, Ice Wizard (hero) 3.51 on 9 players |
| Which decks is it in? | `battles_meta_decks` | 40 rows max, scan card lists by hand | third-most-played ladder deck this season carries it (Mortar / Ronin / Goblin Barrel, one player, 86 battles); the rest are not findable |
| How has its usage moved over seasons? | — | — | **not answerable**, though `card_meta_season` holds every season |
| What beats it? | — | — | **not answerable** corpus-wide; `battles_cards({perspective:"opponent"})` answers it for one player only |
| Who in POAP KINGS plays it, holds it, at what level? | `players_collection` × 46 members | 46 calls | **not answerable** in one call; `battles_meta_cards({segment:"mine"})` gives the clan's usage but not who |
| At what level is it played at my trophies? | — | — | **not answerable**; `battle_participant_card.level` has it |
| When did the Evolution arrive in the record? | — | — | **not answerable**; first battle with form 1 is one query |

Three calls and ~35 KB for the answerable half; five natural follow-ups
have no tool, and all but one are a query over data already recorded.

## 4. Findings

1. **No card-shaped reader.** The rollups are keyed by card; the readers
   are keyed by population and return every card. One card's row costs
   the whole table.
2. **A card's history is recorded and unreachable.** `card_meta_season`
   holds each season's counters per mode and form; no tool serves a
   card's season-by-season series. The Pilot readers were the only
   time-series-by-entity tools, and they go.
3. **"Decks containing X" is missing** on the deck meta; `deck_card` has
   the index (`card_id, form, deck_hash`) to answer it.
4. **Clan-scoped card questions are missing**: who plays it (from
   `battle_participant_card` by member in the window), who holds it and
   at what level (from `player_card`), both cheap and indexed.
5. **Matchups are missing** — the "what beats it" question. Nothing in
   the record answers it corpus-wide; `cards_synergy` walks same-side
   pairs from `deck_card` at read time and nothing crosses sides. A
   cross-side table (season × mode × card
   A × card B → battles, wins for A) is ~15k rows per season per mode and
   the same nightly job.
6. **The form vocabulary is split.** Card rows on the meta and deck
   readers carry `evolution: 1|2` (an integer named after one of the two
   forms it encodes); `cards_synergy` partners carry that *and*
   `form: "evolution"|"hero"`; `players_collection` and the catalog use
   `forms_available` / `forms_unlocked` arrays of the same strings. Two
   spellings for one fact, and the integer is the misleading one (2 is
   not "more evolution", it is Hero). Settling on the string is a
   breaking change on card rows — which is why it belongs in 5.0.0 and
   nowhere else.
7. **The catalog's `as_of` is the last *change*, not the last fetch**
   (ingest bumps `observed_at` only when a field differs). It read
   2026-09-10 today with the fetch daily; the tool does not say which it
   means. One note.
8. **`type` is absent** though determined by the id range; agents guess
   it from names.
9. **No `/docs/cards` page.** How cards are recorded (scale, forms, deck
   identity, collections, rollups) and which tool answers which card
   question is split across `battles.md` and `methodology.md`.
10. The meta readers' first note says "read `battles_levels` for the
    level-expected rate" — goes with the removal regardless.

Out of lane, and staying out: descriptions, stats, arena unlocks,
release dates. The API does not serve them, the record does not observe
them, and an agent knows the game; `cr-agent-api-docs` is the place for
game facts we verify.

## 5. Recommendations for 5.0.0

**R1. `cards_card` — everything the record knows about one card, one
call.** Anchor by `card_id` or exact `name` (as `cards_synergy`),
`segment` required (`mine` / `corpus` / object) so the population is
named, `mode` and `season` as everywhere. Sections, each from a table
that exists:

- `card`: the catalog row plus `type` and `forms_available`, and the
  record's own dates: `first_seen_at`, first battle by form (when the
  Evolution arrived).
- `season`: this season's usage share, W/L, players, raw and shrunk win
  rate, `mean_level_gap` — merged forms and per form — by mode group
  (`card_meta_season`, form −1 and 0/1/2).
- `by_band`: the same across the five trophy bands
  (`card_meta_season_band`).
- `history`: one point per recorded season — usage share, win rate,
  players — the series finding 2 asks for; `applied.window` and the
  season vocabulary as on every windowed tool.
- `partners`: the top partners by lift (a `cards_synergy` summary; the
  full list stays there).
- `decks`: the most-played decks containing it in the window
  (`deck_meta_season` ⋈ `deck_card`), the deck rows as the meta serves
  them.
- on a clan segment, `members`: who played it in the window (battles,
  W/L, level played), and who holds it (`player_card` level, forms
  unlocked) — the roster question in one block.
- `notes`, `docs: "cards#..."`, the usual envelope. Rollup path for the
  corpus season read; raw rows for a segment or an explicit window, the
  same split the meta readers use. Compact drops `decks`, `partners`,
  `by_band`.

Additive in itself; it rides 5.0.0 because R3 changes its rows' shape and
the two should land as one vocabulary.

**R2. Two additive filters.** `battles_meta_cards.cards: [ids]` (one
card, or a handful, instead of 130 rows); `battles_meta_decks.containing:
[ids]` (decks with these cards, any form, tower troop excluded — the
`with_cards` semantics `battles_query` already has).

**R3. One form vocabulary (breaking).** Every card object any tool
serves carries `form: "base" | "evolution" | "hero"` and nothing else
for the form; the integer `evolution` key is retired from
`battles_meta_cards` rows, deck card lists (`battles_meta_decks`,
`battles_decks`, `players_summary`, `battles_query`) and `cards_synergy`
partners. `forms_available` / `forms_unlocked` arrays stay (they are
sets). Output schemas, `cardForms` in contracts, the docs and the
changelog's breaking list carry it. This is the one item that must be in
a major.

**R4. `type` on the catalog** (`troop | building | spell | tower_troop`
from the id range, per `cr-agent-api-docs`), on `cards_catalog` and on
the `card` block of R1. Additive.

**R5. `/docs/cards` page.** The record's card model in one place: the
1–16 scale, forms as bit fields decoded to strings, deck identity, the
collection snapshot, what the rollups hold and how often they move, and
a "which tool for which card question" table; `choosing-a-tool` links
it; the meta readers' `docs:` pointers gain a cards anchor where the
subject is a card.

**R6. Notes.** `cards_catalog` says `as_of` is the catalog's last change
and carries `fetched_at` beside it; the meta readers' level-gap note
drops the `battles_levels` pointer and points at `mean_level_gap` and the
cards page.

**R7 (after 5.0.0, minor). Matchups.** A nightly `card_matchup_season`
(season × mode group × card A form × card B form → battles, A's wins,
players on A's side), built in the meta rollup beside the pair table;
served as `matchups` on `cards_card` and as `cards_matchups` if a
ranked list is wanted. The skill and level confounds are the same as the
meta's and get the same notes; it is a description of what was recorded,
not a counter list.

## 6. What 5.0.0 becomes

Removed: `battles_levels`, `clans_pilot_scores` (the removal plan).
Breaking: the form vocabulary (R3). Added: `cards_card` (R1), the two
filters (R2), `type` (R4), the cards page (R5), the notes (R6). One
changelog entry, one `tools/list` re-fetch for every client, one
What's-new. Effort: the removal is one session; the cards work is two
(the reader and its tests are most of it; the rollups it reads exist).

_This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy._
