# Brief: deep review of the Elixir MCP PostgreSQL schema

Written 2026-09-15 for the session that runs it. This is the prompt; the
review it produces should land beside it as `2026-09-16-SCHEMA-REVIEW.md`.

---

You are reviewing the PostgreSQL schema of Elixir MCP, the Clash Royale
history recorder in this repository. This is the most foundational piece
of the product: everything an agent can ever be told about a player, a
clan, a deck or a card is what this schema can hold and answer. Get the
model right and the tools write themselves; get it wrong and every tool
compensates with scans, JSON parsing and caveats.

## Start by reading, in this order

1. `AGENTS.md` and `docs/ENGINEERING.md` (the invariants: CR tags are the
   only ids, canonical tables are lossless, projections are rebuildable,
   a migration never rewrites a large table).
2. `docs/NOTES.md`, the 2026-09-15 entries: the schema audit, the
   cards-as-rows arc (0091-0100), the I/O findings from `explain_meta`,
   and the incident. Do not re-litigate decisions ratified there.
3. `db/migrations/0001_recorder_core.sql` through `0100_*`, in order.
   The ladder is the schema; there is no separate DDL. Build it in a
   scratch database (`createdb`, apply each file; the ingest test helper
   `services/ingest/test/helpers.mjs` shows how) and read the result
   from `information_schema` and `pg_constraint`, not from memory.
4. The readers: `services/mcp/src/tools/*.mjs` (what questions are
   asked and what SQL answers them), `services/ingest/src/*.mjs` (what
   is written and when), `services/jobs/src/*.mjs` (what is rolled up).
5. `../cr-agent-api-docs` for the game's own model: seasons, war weeks
   and periods, Path of Legends, card forms, balance changes.

## The live database is not reachable from the session

`elixir-mcp-enc` is in a VPC, not publicly accessible. Use the migrate
Lambda's read-only ops for live evidence (`AWS_PROFILE=jamie aws lambda
invoke --function-name elixir-mcp-migrate --payload '{...}'`):
`{tables:true}` for sizes, rows, dead tuples and index bytes;
`{explain_meta:{clan_tag}}` for EXPLAIN ANALYZE BUFFERS of the meta
path; `{deck_census:true}`; `{stats:true}`; `{audit_census:{days:7}}`
for which tools are actually called and how long they take. The box is
a db.t4g.micro: 1 GB RAM, 88 MB shared_buffers, 4.5 GB of data. Every
recommendation has to respect that a working set larger than the cache
is a disk read.

## What to find

Work through these five lenses. For each, name the specific table and
column, show the evidence (DDL, a query, a plan, a count), and say what
the fix is and what it costs.

**1. Missing foreign keys and constraints.** Which columns name another
table's key without a constraint? Three are known and deliberately
pending (`battle_participant.deck_hash → deck`, `player_card.card_id →
card`, `battle_participant.clan_tag → clan`); find the rest. Which text
columns are enums in the code but open in the schema? Distinguish
enums the API owns (`battle.type`, `clan_membership.role` - ingest must
never fail on a value the game adds) from ours. Which NOT NULLs are
missing where the code assumes presence?

**2. Normalization and denormalization, judged against reads.** Where is
the same fact stored twice without a reason? Where is a JSON column
still carrying structured data a tool interprets (`tower_hp`,
`modifiers`, `icon_urls`, `metrics`, `payload` columns)? Conversely, the
participant deliberately carries `battle_time`, `clan_tag`,
`type_class` and `type` copied from `battle` so no read joins for a
filter - is that the right set, and are there other hot filters that
still join? Judge every duplication by the queries that read it, not by
the normal form.

**3. Data structures that do not match the domain's events.** The game
has a calendar: seasons (first Monday to first Monday), war weeks with
training and war days, Colosseum, Path of Legends seasons, balance
changes on a patch cadence, card releases and evolutions. Which of
these have a first-class row and which are only implied by timestamps
or by columns like `season_id`/`section_index`/`war_day` stamped onto
battles? Where does the schema force a reader to reconstruct an event
the game actually emitted? Look especially at: membership joins and
leaves, promotions, trophy and league changes, war day open/close,
season rollover, card unlocks and level-ups, deck changes.

**4. The season-bounded meta.** This is the big one. Card meta changes
every season: balance changes buff and nerf cards, new cards and
evolutions land, and a card's battle value in August says nothing about
September. Today `battles_meta_cards`, `battles_meta_decks` and
`cards_synergy` take an arbitrary `from`/`to` window that defaults to
28 days and can straddle a balance change without saying so. Propose
how the schema should make season (and balance-change) boundaries
first-class: a `season` table with the game's real boundaries and the
Path of Legends season month; a `balance_change`/`patch` table (source:
`cr-agent-api-docs`, and what the API itself exposes); a season key on
the battle or participant so a window cannot silently cross one; and
what the tools' `applied.window` should say when a caller asks across a
boundary. Recommend the default: should meta be bounded to the current
season by default rather than to 28 days?

**5. Rollups and aggregates for summarized reads.** Which questions are
asked repeatedly at whole-window scale and computed from raw rows every
time? Use `{audit_census}` for the real call mix and `{explain_meta}`
for the cost. Candidates you should evaluate, not assume: a per-season
per-card and per-deck meta table (battles, wins, distinct players -
note distinct players do not sum across days, so decide the grain
honestly), a per-clan per-week war summary, per-player per-season
summaries, the corpus shrinkage prior per (season, mode). For each:
what grain, what refresh (ingest-time increment, hourly job, or
nightly), what it makes cheap, what it makes stale, and whether the
existing `player_daily_battle_rollup` should be extended instead of
adding tables. Say which of today's slow reads (corpus card meta 13 s,
synergy 9 s, corpus deck meta 5 s) each one fixes.

## What to produce

A single document `docs/reviews/2026-09-16-SCHEMA-REVIEW.md`, in three
tiers, each item with: the finding, the evidence, the fix as concrete
DDL or a described migration shape, the cost (rows rewritten, index
bytes, ingest write amplification, staleness), and the risk.

- **Tier 1 - do next:** correctness and domain fit. Missing
  constraints, the season model, anything where the schema can hold a
  wrong answer.
- **Tier 2 - do soon:** rollups and aggregates that change what the
  product can answer at scale, with the grain decided.
- **Tier 3 - consider:** normalization cleanups and denormalizations
  with a real read behind them.

End with a sequenced plan: which migrations, in what order, which are
instant (add nullable column, create table), which need a batched op
(anything that rewrites more than a few thousand rows - see the
2026-09-15 incident), and which change the tool contract (semver).

## Rules for the review

- Evidence over opinion. Every finding cites DDL, a query, a plan, a
  count or a doc. A "should" with no reader behind it is Tier 3 at best.
- Assess, do not apply. Write the document; land nothing. The owner
  reads it and picks.
- Respect the invariants. Tags are ids; no surrogate keys for game
  entities; canonical tables never need a rebuild; the API's shape unless
  a documented trap says otherwise; ingest never pauses on eventual
  integrity; migrations never rewrite a large table; the deck identity
  (`deck_hash`) is on the public contract and stays.
- The API reference is standalone. Anything you learn about the game or
  its API that holds for any caller goes to `../cr-agent-api-docs`,
  never into this repo's prose.
- The database is small and the box is small. A recommendation that
  needs a bigger instance says so as a separate line item with a
  monthly cost, never as an assumption.
