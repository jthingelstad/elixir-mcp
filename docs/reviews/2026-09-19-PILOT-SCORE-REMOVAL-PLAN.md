# Removing Pilot Score — plan, 2026-09-19

**Outcome (2026-09-25):** executed as contract 5.0.0 on 2026-09-19:
`battles_levels` and `clans_pilot_scores` removed with everything built
on them, and "no branded or derived player metric, ever" stands in
`docs/DECISIONS.md`. The docs this plan lists for edits were later
archived (`docs/archive/META-INTEL.md`, `SITE-IA.md`,
`CONSUMER-SURFACES.md`, `TOP100-SPEC.md`).

**Decision (Jamie, 2026-09-19):** Pilot Score is a mirage and comes out
entirely. Elixir will not attempt a branded metric of any kind. The lane
is recording and making the record available; derived judgments of
players are out of it. Evidence: the same-day
[assessment](2026-09-19-PILOT-SCORE-ASSESSMENT.md), the
[evolution study](2026-09-19-PILOT-SCORE-EVOLUTION.md) and the
[two-population test](2026-09-19-ELIXIR-LIFT-TWO-POPULATIONS.md). This
document is the removal plan; nothing below has been applied.

**Blast radius, measured.** No consumer depends on it: not the product
emails, not Clan, not elixir-bot, not the Discord preview, not the web
app (the Explore "Pilot Score tab" SITE-IA still names was not carried
into the React foundation). Over the last 30 days the audit shows
`battles_levels` 103 calls from 2 accounts and `clans_pilot_scores` 24
from 3; roughly 30 of those were this review's own reads. Removing two
tools is a **contract major** (`docs/ENGINEERING.md`, "clients that never
update"); the 3.0.0 and 4.0.0 precedents both cut without a deprecation
window because every client is first-party, and that applies here too.

---

## 0. The one design call: `battles_levels`

`clans_pilot_scores` goes; that is not in question. `battles_levels` has
two halves — the corpus Level Curve (win rate by deck-level gap) and the
player score bolted onto it. Two options:

- **A. Remove both tools (recommended).** The curve is a fitted model
  (bins, floors, an "expected" rate), and every keeper of an expected
  rate is one step from scoring against it again — that is exactly how
  Pilot Score came to be. The level-gap *fact* is already made available
  where it belongs: `mean_level_gap` and `level_gap_battles` on every
  `battles_meta_decks` / `battles_meta_cards` row, on `players_summary`
  decks and `clans_standings` members, plus `comparable` and its note.
  One clean cut, one major, nothing left to tempt.
- **B. Keep `battles_levels` as a curve-only reader.** Strip
  `player_tag`, `on_behalf_of`, `display_name`, `arena_id`, the `player`
  block, cohort, trend, `PILOT_METHODOLOGY` floors other than the bin
  floor; retitle "Level Curve". Still a major (the shape changes). Keeps
  a real observation about the game (+0.50 logit per deck level in ladder
  and war, the two agreeing) as a population statistic, the same class as
  the deck meta. Costs a per-request 458k-row temp table on every call
  unless it also moves to a nightly rollup, which is more work than the
  removal.

The plan below is written for **A**; the B deltas are marked.

---

## 1. Inventory: what goes, what changes, what stays

### Code — remove

| path | what |
| --- | --- |
| `services/mcp/src/level-curve.mjs` | `LEVEL_EDGES_SQL`, `levelPairsSql`, `PILOT_METHODOLOGY`, `PILOT_NOTES`, `PILOT_DOCS`, `medianSortedScores` — delete the file |
| `services/mcp/src/tools/clans.mjs` L199–~370 | the `clans_pilot_scores` tool and its imports from level-curve |
| `services/mcp/src/tools/battles.mjs` ~L2060–2440 | the `battles_levels` tool (B: keep, cut the player half), `markPartialMonths` use if it becomes unused, level-curve imports |
| `services/mcp/src/controls.mjs` | `populationChanges`, `populationChangesNote` (only `battles_levels` calls them; knip will flag them) and the header comment's "pilot-score trend" example |
| `services/mcp/src/output-schemas.mjs` | the two tools' output schemas |
| `packages/contracts/src/tool-groups.ts` | the two entries ("Level Curve & Pilot Score", "Clan Pilot Scores") |
| `services/migrate/src/ops-analysis.mjs`, `lambda.mjs` | `pilotPairs` (imports `levelPairsSql`; its purpose is gone). `polSeasons` too, unless Jamie wants a standing read-only Ranked-history export — it has no dependency on Pilot and is harmless, but the analysis it served is closed |
| `services/migrate/src/ops-captures.mjs` L180 | drop `clans_pilot_scores` and `battles_levels` from the controls-census tool list |

### Code — edit

| path | what |
| --- | --- |
| `services/mcp/src/tools/shared.mjs` L631, L1011 | comments naming the tools; `META_METHODOLOGY.segment_min_decided` comment says it "mirrors battles_levels" — reword, value unchanged |
| `apps/site/src/_data/statistics.js` | drop the `PILOT_METHODOLOGY` import and the `pilot` key (the methodology page template reads `statistics.pilot.*`) |
| `packages/docs/src/index.mjs` L41–71 | comments use "Pilot Score" as the search example; reword to another anchor |
| `db/migrations/0024_player_tenure.sql` | comment only — migrations are immutable; leave it. `player.years_played` / `account_age_days` **stay**: `clans_roster` and the profile carry tenure |

### Tests — remove or retarget

| path | what |
| --- | --- |
| `services/mcp/test/war-tools.test.mjs` L764, L882, L1273, L1300 | four Pilot tests, remove |
| `services/mcp/test/tools2.test.mjs` L543 | `battles_levels` symmetric-curve test, remove (B: keep the curve half) |
| `services/mcp/test/tool-conventions.test.mjs` L31–37 | the "two Pilot Score tools are the deliberate exception" clause to the defaulting rule — delete the exception; the count/fingerprint assertions move with the registry |
| `services/mcp/test/docs-pointers.test.mjs` L73 | drop `PILOT_DOCS` from the resolving-pointers test |
| `services/mcp/test/docs-tools.test.mjs` L95, `packages/docs/index.test.mjs` L82–91 | the docs search tests use "pilot score minimum battles" / "Pilot Score" as the query; retarget to a section that stays (e.g. the shrinkage formula) — the *behaviour* under test (tokenized search, excerpt from the matching paragraph) is unchanged |
| `apps/site/test/site.test.mjs` L645–666 | the methodology floors table and the "not a calibrated error estimate for Pilot Score" assertion; remove with the section |

### Site docs — edit (ship in the same commit as the code)

| page | what |
| --- | --- |
| `apps/site/src/docs/methodology.md` | remove "The Level Curve and Pilot Score", "What standard_error means", and "Reading changes and cohort comparisons" (three sections); the lede and description drop "Pilot Score"; the `battles_levels` floor reference inside the meta section ("the same rule battles_levels applies") reworded. Add a short paragraph under the meta section: the level-gap control fields are how the record makes card-level differences visible; Elixir does not score players against a level expectation, and why (link the assessment) |
| `apps/site/src/docs/glossary.md` L115–119 | remove the Pilot Score entry (and "Level Curve" if A) |
| `apps/site/src/docs/battles.md` L161 | the pointer to `methodology#the-level-curve-and-pilot-score` |
| `apps/site/src/docs/choosing-a-tool.md` L45 | the row "Am I winning because of levels or in spite of them?" — replace with the honest answer: `battles_meta_*`/`players_summary` `mean_level_gap` show the gap; the record does not adjudicate |
| `apps/site/src/docs/clocks.md` L179 | drop the `clans_pilot_scores` default-window row |
| `apps/site/src/_data/updates.js` | one new What's-new entry for 5.0.0 (past entries stay; they are history) |
| `/docs/tools`, `tools.json`, `llms*.txt` | generated from the registry — nothing to edit |

### Contract and record of decision

| path | what |
| --- | --- |
| `packages/contracts/src/changelog.ts` | **5.0.0**: `battles_levels` and `clans_pilot_scores` removed, no replacement, no deprecation window (first-party clients); the reason in one sentence and a pointer to the three reviews; `elixir_changelog(since)` is how agents learn it |
| `docs/NOTES.md` | a RATIFIED entry: no branded or derived player metric; the lane is recording and availability; the three reviews as the evidence; the "do not re-litigate" marker |
| `docs/META-INTEL.md` | the design doc that proposed Pilot Score (sections 9/10). Mark those sections withdrawn with a dated note pointing at the reviews; do not rewrite history |
| `docs/SITE-IA.md` L40–41, `docs/CONSUMER-SURFACES.md` L211, `docs/top100/SPEC.md` L77 | drop the Pilot mentions (SITE-IA's Explore tabs are stale anyway; Top 100's `level_gap` deep cut was never built — strike it) |
| `AGENT-TEAM/notes/*`, `docs/REVIEW-2026-09-10-*`, `docs/reviews/*` | history; untouched |

### Outside this repo

- `~/Projects/clash-royale/cr-agent-api-docs`: the one durable *game* finding
  of the review — Ranked and casual modes equalize card levels (84–86% of
  decided 1v1 pairs at identical deck averages; Competitive-arena opponent
  mean level ≈ 12.0) — belongs there once the exact rule is verified
  against the wiki. Not part of the removal; queued.
- Memory: the assessment memory gets the decision and the removal
  commit.

---

## 2. Sequence

1. **Claim the lease; branch nothing** — work lands on `main`.
2. **Commit A — contract 5.0.0 (code + schemas + docs + changelog +
   What's-new + NOTES, one commit, per "docs ship with the change").**
   Delete `level-curve.mjs`, the two tools, their schemas and group
   entries, `populationChanges*`, the controls-census entries; edit
   `shared.mjs` comments and `statistics.js`; remove/retarget the tests
   listed; edit the six docs pages; add the 5.0.0 changelog entry, the
   What's-new entry and the NOTES decision. `npm run verify` green
   (knip will confirm nothing left dangling; the registry fingerprint test
   and `tools.json` regenerate).
3. **Commit B — migrate ops and design-doc annotations.** Remove
   `pilotPairs` (and `polSeasons` unless kept) with their tests; annotate
   META-INTEL, SITE-IA, CONSUMER-SURFACES, Top 100 SPEC. Verify green.
4. **Deploy** (`node infra/scripts/deploy.mjs --skip-web` is not enough:
   the docs pages changed, so a full deploy). Smoke gate green.
5. **Verify from the outside**: `tools/list` no longer names the two
   tools and `serverInfo.version` moved; `elixir_changelog({since:
   "4.2.0"})` says why; `/docs/methodology` renders without the removed
   sections and every `docs:` pointer still resolves (the docs-pointers
   test covers the registry; check the page once by eye); the
   `battles_meta_decks` `mean_level_gap` field is still served, since that
   is where the level fact now lives.
6. **Close the loop**: the Close the Loop owner's next run should see
   any consumer that calls the retired names in the audit (`error_code`
   unknown tool) — expected none.
7. **Release the lease; update memory.**

Estimated effort: one session. Nothing in the database changes — no
migration, no rollup, no table; the tenure columns stay in use.

## 3. What is deliberately kept

- `mean_level_gap`, `level_gap_battles`, `comparable` and the pooled-modes
  notes on the meta, summary and standings readers: the record's way of
  making card-level differences visible without judging them.
- `player.years_played` / `account_age_days` (0024): tenure is a fact the
  roster and profile show.
- The three review documents and the reproduction script: the reasoning
  that closed this, for the next time someone proposes a score.
- The `pol_final` boards and `player_pol_season`: Ranked history the
  record already serves; nothing about them was Pilot's.

_This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy._
