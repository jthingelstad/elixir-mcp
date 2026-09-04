# Corpus meta intelligence — statistical design for review

Jamie's charge (2026-09-04): elixir-bot's deck/battle intelligence is
starved on player diversity, which is precisely what this corpus has.
Design `battles_meta_decks` and `battles_meta_cards` so they are
statistically sound, adapt as the game's card meta changes, and stay
STRICTLY descriptive — "I have NO INTEREST in attempting to editorialize
on meta, I just want to look at data and keep it grounded in that."

**STATUS: DESIGN FOR REVIEW. NOTHING HERE IS BUILT.**

## 0. The grounding principle

These tools report **counts, rates, and uncertainty — never verdicts**.
No tiers, no "best deck", no curated lists, no model-in-the-loop. Every
number carries its sample size, its distinct-player count, and an
interval; anything below its floor is served as counts-only, never as a
rate. Sort order is the caller's choice among plain fields. If a
consumer wants an opinion, the consumer editorializes — the tool never
does.

## 1. The data and its honest shape

Substrate: `battle_participant` (both sides of every recorded battle —
deck jsonb, deck_hash, outcome, starting_trophies, battle_time) joined
to `battle` (type, time). Today: ~36k battles / ~77k participant rows /
~600k card observations, growing ~1,800 battles/day across 6
comprehensively recorded clans (239 members) plus every opponent they
face.

Three biases we disclose rather than hide:

- **Ecosystem, not global ladder.** The corpus is "the matchmaking
  neighborhood of our recorded clans" — dense around their trophy bands,
  sparse elsewhere. Responses echo the band composition of the sample so
  a reader knows what population a number describes.
- **Two player classes.** Recorded members have deep history (median
  ~250 battles); most opponents appear once or twice. The estimator in
  §2 is built so both contribute at exactly the strength their history
  supports — no opponent is discarded, none is over-trusted.
- **Mode mixture.** War decks and ladder decks are different metas.
  Mode is a first-class filter (the existing MODE_GROUPS vocabulary),
  and the default response says which modes it pooled.

## 2. Deck estimator: wins above expectation (skill-adjusted lift)

The one-clan lesson (measured in elixir-bot at 12,687 battles): raw
deck win rate ≡ who plays the deck. Skill spans 36–70% among just 75
players; a deck's pooled rate is a biography, not a property of the
deck. The fix is to score each battle against the *player's own*
expected win probability and let the deviations accumulate.

**Per-player baseline (empirical-Bayes shrunk).** For every player p
in the window, with w_p wins in n_p decided battles:

    p̂_p = (w_p + α) / (n_p + α + β)

where (α, β) are fit once per response on the window's qualifying
players (n ≥ 30) — with the moment fit done RIGHT: the observed
variance of player rates mixes true skill spread with per-player
binomial noise, and at n = 30 the noise sd (~9 pts) is comparable to
the real skill spread, so naive moments would roughly double the
variance estimate and under-shrink. Subtract the sampling component:

    τ² = max( s²_rates − mean_j( p̄(1−p̄)/n_j ),  τ²_min )
    α + β = p̄(1−p̄)/τ² − 1,   α = p̄·(α+β)

with a small τ²_min floor so a fluke window can't produce infinite
shrinkage. Behavior
at the extremes is exactly what we want: a recorded member's p̂ is
essentially their true rate; a one-battle opponent's p̂ collapses to the
population mean. Skill cancels where skill is known; unknowns contribute
against the population baseline instead of polluting the estimate.

**Deck lift — with leave-deck-out baselines (Jamie's loyalty
challenge, 2026-09-04).** Measured in the live corpus, deck loyalty is
mostly a myth for this population: the median member's top deck is only
27.8% of their battles (p75 44.3%), 54/70 members run 2+ decks at 10+
battles, and the game itself manufactures crossover (war demands four
distinct decks weekly; duels more). But a loyal tail exists (one member
at 100%), and for a loyal player a naive own-baseline IS the deck —
their lift would be zero by construction. So the baseline for judging
deck d EXCLUDES the player's battles with d:

    p̂_p^(−d) = (w_p − w_{p,d} + α) / (n_p − n_{p,d} + α + β)

For the median member this rests on their ~72% other play (strong); for
a pure loyalist it collapses to the population prior (weak — and the
interval widens to say so). Each deck also reports
`crossover_players`: contributors with ≥ 20 decided battles on OTHER
decks — the count of players for whom skill and deck are actually
separable. The de-confounding claim is only as strong as this number,
so it ships on every row.

    lift_d = (1/n_d) · Σ ( win_i − p̂_p(i)^(−d) )    [percentage points]

    se_d   = sqrt( Σ_players ( Σ_{i∈p} (win_i − p̂_p^(−d)) )² ) / n_d
    interval = lift_d ± 1.96 · se_d

The se is CLUSTERED BY PLAYER, not per-battle binomial: one player's
baseline error is shared across all their battles with the deck, so
battles are not independent draws — a 60-battle deck carried by two
players has an effective sample nearer 2 than 60, and the naive
binomial se would claim confidence the data does not hold. (The card
estimator in §3 doesn't need this correction — its unit of analysis is
already the player.)

Reported per deck: `battles`, `decided`, `distinct_players`,
`raw_win_rate`, `expected_win_rate` (mean p̂ — the "who plays this"
number, surfaced so the confound is visible instead of silently
removed), `lift`, `lift_interval`, `usage_share`.

**Floors (from the bot's proven values, adapted):**

| Field | Served when | Otherwise |
| --- | --- | --- |
| `raw_win_rate`, `lift` | decided ≥ 30 AND distinct_players ≥ 5 AND crossover_players ≥ 3 | null + `insufficient_sample: true` with the real counts |
| `usage_share`, counts | always (usage is meaningful at any n) | — |

The distinct-player floor is the de-confounder's teeth: a deck one
grinder spams 300 times still reads `insufficient_sample` on lift,
because n_d ≥ 30 with 1 player measures the player. This is the field
elixir-bot structurally cannot compute (90.3% of its deck pool is
n = 1, and shared-deck observations across its 75 players: two).

Definitions and residual confounds, stated rather than hidden:

- `usage_share` denominator = participant rows with a known deck in the
  window/filters (each battle contributes two sides). Mirror matches
  add one win and one loss to the same deck — self-canceling on lift,
  counted in n.
- The expectation ignores OPPONENT strength: fine while most opponents
  sit at the prior mean, imperfect for member-vs-member war battles. A
  v2 refinement is a two-sided expectation (0.5 + (p̂_p − p̂_q)); v1
  disclosure suffices at current corpus shape.
- Within-player deck choice is not random (context confound): mode is
  the big one and is a first-class filter; what remains (tilt, pushing,
  time-of-season) is disclosed, not modeled.

## 3. Card estimator: within-player lift, corpus-wide

The bot's `player_adjusted_lift` design is correct; it is starved (52
of 180 card-forms fail its ≥4-qualifying-players floor with 75 players).
We compute the same estimator at the source, over every player with
enough history, with two fixes:

1. **Same window** for baseline and with-card rate (the bot's baseline
   is accidentally all-time).
2. **Leave-card-out baseline** (found by Jamie's loyalty challenge): a
   baseline that INCLUDES the with-card battles attenuates lift toward
   zero in proportion to the player's usage of the card — at 100%
   usage the delta is identically 0 however good the card is. Judging
   against rate-WITHOUT-the-card removes the attenuation; the
   without-side floor (≥ 30) keeps the contrast honest. This latent
   attenuation exists in elixir-bot's shipped estimator today
   (strongest on exactly the signature cards members ask about) and is
   worth patching upstream regardless of this build.

For card-form c (form-aware: (card_id, evolutionLevel) — Evo Knight and
Knight are different cards, per house rule):

    contributor j: ≥ 30 decided battles WITH c in-window,
                   and ≥ 30 decided battles WITHOUT c in-window
    delta_j = rate_j(with c) − rate_j(WITHOUT c)     [leave-card-out]
    lift_c  = mean(delta_j),  se via the sample sd of delta_j
    served when contributors ≥ 4 (below: counts only)

Contributors are equal-weighted (robust to one heavy grinder
dominating the mean; the between-contributor sd is then the honest se).
A card's lift measures the card IN THE COMPANY IT KEEPS — cards travel
in decks of eight, so deckmate effects are partially attributed to each
other. That is a property of the game, not a fixable bias; the response
says so.

Reported: `usage_share`, `battles`, `contributors`, `pooled_win_rate`
(labeled as confounded — served for transparency, never for ranking),
`player_adjusted_lift`, `lift_interval`. Consumers are told to quote
lift, not the pooled rate — same instruction the bot already ships.

## 4. Adapting to meta change (non-stationarity)

Balance changes ship at season boundaries (first Monday, our war-clock
calendar knows them exactly) and occasionally mid-season; evolutions and
new cards land unpredictably. Three mechanisms, all descriptive:

1. **Hard windows are the primary control.** Default `days = 28`,
   caller-set 7–90. No estimate ever pools across more history than the
   caller asked for. Short windows widen intervals honestly rather than
   letting stale battles masquerade as current evidence.
2. **Balance-boundary disclosure, not smoothing.** When the window
   crosses a season boundary, the response carries
   `window_spans_season_boundary: {season_id, date}` — the reader
   decides whether pre-patch battles belong in their question. We never
   silently down-weight or splice.
3. **Drift made visible.** Each row carries `usage_share_prev` (the
   identical metric over the preceding window of the same length) so
   rising/falling adoption is a first-class observable — the data shows
   the meta moving; nobody narrates it.

New cards and evolutions need no allowlist: they enter the corpus the
day they appear in battles, serve counts immediately, and cross the
floors when the evidence exists. A card nerfed into oblivion decays out
of usage_share on the same schedule. The system has no opinion to
update — that is the adaptation mechanism.

Explicitly rejected: exponential decay weighting (invisible smoothing
that manufactures an editorial "recency" stance) and any LLM/web-search
meta source (`meta_decks` in elixir-bot — hand-run Opus web search, 10+
days stale — is the counterexample this design retires).

## 5. Scope filters

- `mode` — MODE_GROUPS (war and ladder are different metas).
- `days` — 7–90, default 28.
- `trophy_band` — on starting_trophies: `<5000`, `5000-8000`,
  `8000-11000`, `11000+` (cuts chosen from the corpus distribution at
  build time and NAMED in the response), or none (default) with the
  sample's band composition echoed.
- `min_usage` / `sort` (usage_share | lift | battles) / `limit` —
  caller-owned presentation, no default that implies ranking authority.
- `battles_meta_decks` additionally: `containing_card` (deck-space
  drill-down); decks return their card lists so elixir-bot's archetype
  classifier keeps working client-side — archetype LABELS stay out of
  this service (they are analysis; we serve observations).

## 6. Validation before serving (build-gate, in order)

1. **Split-half reliability**: split each contributor's battles
   odd/even (contributor set held fixed — this isolates sampling noise
   from population change); require rank correlation on served cards
   ρ ≥ 0.6, tightening floors if missed.
2. **Cross-engine sanity with a falsifiable prediction**: corpus card
   lift vs elixir-bot's local lift on the card-forms both serve. The
   two estimators differ exactly where the bot's attenuation bug bites,
   so agreement should be strong at LOW usage share and the divergence
   should GROW with usage share (bot pulled toward zero). If divergence
   does not track usage share, our §3 attenuation theory is wrong and
   we stop and re-derive rather than ship.
3. **Confound kill-check**: verify expected_win_rate spread across decks
   is wide (it will be — that's the bias existing) and that lift's
   correlation with mean-player-skill is ~0, while raw_win_rate's is
   materially positive. This is the direct test that the estimator does
   what it claims.
4. **Boundary behavior**: S134→S135 windows produce sensible
   usage_share_prev deltas and the boundary flag fires correctly.

Validation runs read-only (Athena/DuckDB over exported projections or a
fixed probe op) and its numbers go in this doc before the tools deploy.

## 7. Serving shape and cost

On-demand SQL over `battle_participant`/`battle` (~77k rows) with the
existing (player_tag, battle_time) index; the per-response EB fit is one
aggregate over player rates. Estimated well under the 25-page result
budget and comparable to `battles_performance` cost today. If corpus
growth (10×+) makes this slow, the lever is a daily
`deck_daily_rollup` materialization — a performance change, not a
methods change. Quota-wise these are ordinary read tools (Battles
domain, read-only annotations).

## 8. What elixir-bot does with it (phase 2, after review)

- `_meta_overlay` reads `battles_meta_decks` (usage-sorted, floors
  intact) instead of the hand-run web-search snapshot;
  `refresh_meta_snapshot.py` retires when the overlay is proven.
- `_card_view` blends corpus lift when local lift is `None`, with an
  explicit `basis: "corpus"` label so a reader knows which population
  the number describes.
- Deck recommendations may ATTACH `distinct_players`/`lift` as evidence
  fields on candidates it already ranks structurally — ranking stays
  levels-first (the 22-points-of-win-rate finding is bedrock and this
  design does not fight it).
