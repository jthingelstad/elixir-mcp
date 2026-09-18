# Brief: deep review of the Elixir MCP interface after the record redesign

Written 2026-09-18 for the Fable session that runs it. This is the prompt;
the review it produces lands beside it as `2026-09-19-INTERFACE-REVIEW.md`
and its execution plan as `2026-09-19-INTERFACE-EXECUTION-BRIEF.md`, the
same pair the schema and time-series reviews left. Opus executes the plan
one phase per session; Jamie gates each phase.

---

You are reviewing the **MCP interface** of Elixir MCP, the Clash Royale
history recorder in this repository: the 55 tools, their arguments and
response shapes, the notes and docs they carry, the errors they refuse
with, and the docs corpus an agent reads to use them. The tools ARE the
product; the only consumers are agents, and an agent cannot ask a
follow-up question. Your job is to find where the interface has fallen
behind the record, where it says one thing and means another, and where
an agent stumbles, and to turn that into a plan Opus can execute.

## Why now

In the week of 2026-09-15 the record underneath these tools was
redesigned, and the tools were only partly brought along:

- **JSON became columns.** Cards played are rows (`deck`, `deck_card`,
  `battle_participant_card`; 0091-0100), the profile and roster JSON
  became typed columns and the JSON columns were dropped (0123-0125),
  the battle row gained the facts the log carries (`arena_id`,
  `event_tag`, `tournament_tag`, `deck_selection`,
  `is_ladder_tournament`, `is_hosted_match`, the boat-battle fields; 0131).
- **Time series arrived for the core entities.** Every daily series is
  keyed by the GAME day (10:00 UTC; 0126); the roster writes a daily row
  per member and a clan row (`clan_snapshot_daily`, 0127-0128);
  `player_progress_daily` holds the side-mode seasons (0129);
  `player_pol_season` and `war_period_log` are rows (0130); every point
  carries `observed_at`, `profile_observed_at`, `roster_observed_at`,
  `source` and `kind` (0133). Readers shipped as 3.12.0:
  `players_timeline` widened, `clans_timeline` and
  `clans_members_timeline` new.
- **The payload manifest is authoritative** (`services/ingest/src/payload-keys.mjs`,
  0132): every field the API sends has a disposition, `to("table.column")`,
  `derived(...)` or `dropped(...)`, and a nightly census files a feedback
  item when the wire disagrees. This is the first time "what we collect"
  is a list you can diff against "what we serve".
- **3.13.0 (today) ratified a principle from an agent's failure corpus:**
  every aggregate ships the control next to the number, and the note
  fires on a detected confound, never as boilerplate. It was applied to
  `battles_decks`, `battles_cards`, `battles_levels`,
  `battles_performance` and `battles_query`. Nothing else has been
  checked against it.

The question is whether the interface, taken whole, still presents one
cohesive record to an agent, or a 1.0.0-era surface with 3.12/3.13
annexes bolted on.

## Start by reading, in this order

1. `AGENTS.md`, then `docs/ENGINEERING.md` in full. "Tool conventions" is
   the baseline you review AGAINST; a finding is a violation the registry
   test missed or a convention the baseline lacks, never a re-derivation.
2. `docs/NOTES.md`, the entries from 2026-09-15 onward, newest last. The
   decisions there are ratified: the cards-as-rows arc, the schema review
   phases A-F, the time-series phases 1-4 and the declined phase 5, the
   3.13.0 principle and its six "decisions taken inside the change". Do
   not re-litigate them; do build on them.
3. The prior reviews, so you review at a higher altitude than they did:
   `docs/REVIEW-2026-09-10-DOCS-TOOLS-SEAM.md` (actioned in full as
   1.0.0), `docs/DOCS-GAP-2026-09-09.md`, `docs/reviews/2026-09-16-SCHEMA-REVIEW.md`
   and `docs/reviews/2026-09-18-TIME-SERIES.md` (both executed; their
   "open" and "declined" lists are inputs), `docs/CONSUMER-SURFACES.md`,
   `docs/META-INTEL.md`.
4. The playbook: the `mcp-tool-review` skill (`~/.claude/skills/mcp-tool-review/SKILL.md`,
   its `references/checklist.md` and `assets/`). Its method, its standing
   rules and its Elixir MCP specifics (registry dump command, the migrate
   Lambda ops, the S3 capture path, the live-probe rules) apply here
   verbatim. Read `assets/report-template.md` before you write.
5. The code, in this order: `packages/contracts/src/` (the contract),
   `services/mcp/src/tools/shared.mjs` and `controls.mjs` (the shared
   vocabulary), `services/mcp/src/tools/*.mjs` (every tool), `output-schemas.mjs`,
   `protocol.mjs`, `invoker.mjs`, `resources.mjs`; then
   `services/ingest/src/payload-keys.mjs` (what is collected) and
   `db/migrations/0091_*` through `0134_*` (what it lands in).
6. The docs corpus as an agent reads it: `apps/site/src/docs/*.md` and
   the `initialize` instructions text in `services/mcp/src/identity.mjs`.
7. The first-party consumers, for their workarounds (a workaround in a
   consumer is a finding about the server): `../elixir-mcp-discord/src/`
   (prompt, mcp, events, feedback), `../elixir-bot/elixir_mcp.py` and
   `capabilities/mcp_stats.py`, `../clan.poapkings.com/services/engine/`
   (one `clans_participation` call per evaluation),
   `../drop.poapkings.com/services/api/src/` (`war_current`, `live_fetch`).
8. `../cr-agent-api-docs` where a game fact is in question. Verify a
   game claim there or with `npm run cr` before you write it down.

## The live database is not reachable; the door and the ops are

Use, read-only, exactly as the skill describes:

- The registry dump per principal kind (`declarations(null | "agent" | "integration")`)
  and `assets/tool-surface-census.mjs` over it.
- `{"audit_census":{"days":14}}` and `{"args_census":{"days":14}}` on the
  migrate Lambda: calls, errors by code, p95, bytes, truncation, never-
  called tools, argument KEYS per tool per outcome, `live_fetch` by path.
  Fourteen days now spans the redesign; say which side of it a number is
  from.
- Captured calls in S3 for the interesting ones (slowest, errors, the
  catch-all, and every call to the 3.12/3.13 tools since they shipped).
- The connected `elixir-mcp` server (you are King Thing) for tool reads;
  the Discord principal via curl for `initialize`, `resources/*`,
  `prompts/*`. Never a tool with a side effect; `elixir_my_feedback`
  marks responses seen, so do not call it.
- `elixir_changelog` for what shipped since the last review, and the
  `feedback` ledger (`{"feedback_pending":true}` plus the responded items
  visible in the recent NOTES) for what agents have already told us.

## The five investigations

Do them in this order; each feeds the next.

### 1. Collected but not served: the manifest-to-reader census

The manifest names every landing column. For each `to("table.column")`
in `payload-keys.mjs`, find the reader in `services/mcp/src/` (a SQL
reference or a projection it feeds) and classify: **served** (which
tool, which field), **served only in aggregate** (a rollup reads it, no
tool exposes the row), **unserved**. Produce the table. Then, for every
unserved column and every new table of the redesign (`clan_snapshot_daily`,
`player_progress_daily`, `player_pol_season`, `war_period_log`,
`game_event` / `game_event_day`, `arena`, the 0131 battle facts, the
0127 lifetime and roster columns, `player_badge`, `player_card`), answer:
is there a question an agent would ask that this answers, which existing
tool is its natural home (a field, a metric name, a filter) or does it
want a tool of its own, and what is the cost of not serving it. "Unserved
by decision" is a valid answer when NOTES says so; cite the entry.

### 2. Semantic mismatch: does the word mean the thing

Read every tool description, argument description, response field name,
note and docs page for the vocabulary, and check each against the code
and the record:

- **Pre-redesign residue.** Descriptions, notes and docs written when
  decks were JSON, snapshots were UTC-calendar days, arena was a name
  only, the war day was stamped at ingest. Find text that still
  describes the old model (the memory
  `elixir-code-comments-describe-past-architecture` names the failure).
- **One word, several meanings.** `mode` (group) vs `type` (API) vs
  `game_mode` (name/id); `day` vs `date` vs `week_of`; `n`; `points` vs
  `fame` vs `period_points`; `trophies` (which of the four kinds);
  `observed_at` vs `profile_observed_at` vs `roster_observed_at`;
  `season` (month, war season number, Pass season, PoL season);
  `deck_hash` vs `deck` vs `cards`; `level` (in-game vs rarity-relative);
  `arena` (name on the battle row, id on the snapshot). For each, is the
  meaning stated where the agent meets it, and is it the same in every
  tool?
- **Grain and window.** The series tools are date-only, game-day keyed;
  the battle tools are instant windows; the meta tools default to the
  season; the Pilot tools take `days` only; `war_history` takes
  `seasons`. Is every grain declared, is `applied.window` honest about it
  (the 3.12 season fields, `crosses[]`), and where a window spans a
  grain boundary does the response say so?
- **Point shape.** `players_timeline`, `clans_timeline`,
  `clans_members_timeline`, `rankings_timeline`, `battles_trends`,
  `battles_performance group_by:week`, `battles_levels.monthly_trend`,
  `elixir_timeline`: eight series shapes. Which differences are the
  entity's and which are accidents? Propose the one point vocabulary
  (key field, stamps, `kind`, `partial`/`covers`, `source`) and the
  additive path to it.
- **Nullability.** Every `null` a tool can serve should have one meaning
  the docs state (3.13.0 fixed `trophy_change`; audit the rest, including
  every 0127 column that is null for an unrecorded profile).
- **Denominators and units.** Every rate names its denominator on the
  battles page; check the series aggregates (`avg_member_trophies`,
  `members_seen`, `donations_per_week`) and the war fields (`decks_used`,
  `points`) meet the same bar.

### 3. Agent usability: walk the journeys

Take eight questions a member's agent actually asks (the elixir-mcp-discord
prompt and the recent feedback corpus are the source; include at least:
"how am I doing this season", "which deck should I play on ladder", "who
in the clan is slipping", "did we win the war and who carried", "what
changed for me since last month", "is this clan worth joining", "what is
the meta right now at my level", "what happened today") and, for each,
using only `tools/list`, the `initialize` instructions and `elixir_docs`,
write down the call sequence a competent agent would make, then make it
(read-only) and record: calls needed vs calls a one-shot design would
need, every place the agent had to guess (an argument, a unit, a default,
which of two tools), every note it needed and whether it was there, every
number it could misread without a control beside it (the 3.13.0 test),
result sizes against the 48,000 cap, and latency from the audit. Score
each journey. The journeys, not the tool list, are the spine of the
usability section.

Then the seam: `initialize` instructions (are they still true after
3.12/3.13, are they the right length), tool descriptions (the average
must stay under 600 characters; which are load-bearing and which are
padding), `choosing-a-tool`, `elixir_examples`, the error hints (does
every code name one executable next step; is `internal` doing its job),
`outputSchema` coverage (ten tools declare one; which others are called
enough to deserve one), the resources and prompts nobody calls.

### 4. The 3.13.0 principle, applied everywhere it has not been

For every tool that serves a rate, a trend, a rank or a sum
(`battles_trends`, `battles_meta_decks`, `battles_meta_cards`,
`cards_synergy`, `clans_standings`, `clans_pilot_scores`,
`clans_participation`, `players_summary`, `rankings_*`, `war_rivals`,
`clans_timeline` aggregates, `badges_*`): what is the control an agent
needs beside the number (mode split, level gap, population, floor,
sample size, partial bucket, coverage), is it there, and if not, what is
the cheapest carrier (a field, a `comparable` flag, a conditional note)
and the confound that should trigger it? Reuse `controls.mjs`; propose
additions to it, not per-tool copies. Coverage is a control too: where
`elixir_coverage` says the record is thin, which tools say so on the
number itself?

### 5. Cohesion: one product or annexes

Step back. Given 1-4, describe the interface an agent meets today as a
map: groups, entry points, the path from "who am I" to any answer, where
the seams show (naming, window grain, point shape, the docs pages that
predate the redesign). Then describe the interface it should be after
the plan, in one page, and the additive path between them. Anything
breaking is batched and labelled for a major with a deprecation window
(the contract has clients that never update; `elixir-bot` pins the major).

## Standing rules

- **Read-only, no changes.** You recommend; Opus executes. Do not edit a
  tool, a doc, a test or a consumer. Verified defects are still listed,
  not fixed.
- **Every claim carries evidence:** a `file:line`, a live `request_id`, a
  census number with its window, or a NOTES entry. Every number was
  measured in this session, not recalled.
- **Defects, product calls, and open questions are three lists.** A
  statement the code contradicts is a defect. "This should work
  differently" is a product call with its trade-off stated. Something
  you could not measure is an observability item with the op that would
  measure it.
- **Respect the ratified.** A design Jamie chose is context. Propose
  compressing or aligning, never removing, a design position; the
  memory `review-bullets-are-not-product-decisions` is the rule.
- **Additive by default.** The contract is semver over the tool surface;
  a field added is a minor, a field renamed is a major. Prefer the field
  beside the old one and the note that says which to read.
- **Do not touch the collector, ingest correctness, or the schema** except
  where a tool cannot be honest without a projection that does not exist;
  then name the migration as an additive, non-rewriting one (the 0099
  lesson in ENGINEERING.md) and put it in the plan as its own item.

## Deliverables

**A. The review**, `docs/reviews/2026-09-19-INTERFACE-REVIEW.md`, on the
skill's report template: the one-paragraph verdict; verified defects
first; then the five investigations as parts with their tables (the
manifest-to-reader census in full, the vocabulary table, the eight
journey scorecards, the control matrix, the map); then the ordered list
and the three lists (product calls for Jamie, open questions,
observability items). Every table's numbers dated and windowed.

**B. The execution plan**, `docs/reviews/2026-09-19-INTERFACE-EXECUTION-BRIEF.md`,
written for Opus sessions that have not read the review. Phases, one per
session, each with: the goal in one sentence; the product calls it
depends on (asked of Jamie up front, in one message, never mid-flight);
the commit-sized items with files, the contract bump class (none / minor
/ major-batched), the docs pages and What's-new entry that ship with it,
the tests that fail without it (name the test file), and the read-only
acceptance predicate against the live door (a tool, its arguments, the
field or note to look for); the consumers to update and restart after
the deploy; and what the phase deliberately leaves for the next one.
Order by leverage per session, defects first. Size each phase so
verify -> deploy -> acceptance fits one session; the time-series brief
beside it is the size reference.

**C. Product calls for Jamie**, as the review's own short list and
repeated at the top of the plan: every decision that changes what Opus
builds, with the recommendation first and the trade-off in a sentence.
Expect a handful, not dozens; fold the rest into recommendations.

**D. A trail:** a project memory naming the review, the plan, the
verified defects and the headline recommendations, and that nothing was
applied; and an entry queued for `docs/NOTES.md` that the first Opus
phase transcribes.

Summarise in chat with the verdict, the defect count, the top five
recommendations and the product calls. Do not paste the review.
