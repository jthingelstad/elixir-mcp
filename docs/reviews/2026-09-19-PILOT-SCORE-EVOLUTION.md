# What Pilot Score should become — 2026-09-19

**Status:** proposal, nothing shipped. Follows the same-day
[assessment](2026-09-19-PILOT-SCORE-ASSESSMENT.md), which found that the
level adjustment in Pilot Score is nearly orthogonal to outcomes between
players and that 70–76% of scored observations carry no adjustment at
all. Jamie's brief: is there an existing model (Elo or similar) to adopt
rather than invent, and can Elixir have one branded metric that is
actually meaningful.

**Data.** The `pilot_pairs` migrate op (019d9dc, deployed this session)
exported the exact population both Pilot readers score, 365 days ending
2026-09-19 11:32Z: **459,358 sides of 229,679 matches, 128,502 players**,
with each side's deck level, outcome, crowns, mode, starting trophies /
Ranked rating and arena. Every number below is computed from that export
by `scripts/pilot-evolution-2026-09-19.py`; the script reproduces them
from the two CSVs and touches nothing else.

---

## 0. The answer in four lines

1. **Outcome-based ratings cannot work on this record — not Elo, Glicko,
   TrueSkill, Bradley–Terry, nor Pilot Score.** The matchmaker pairs
   players within ±7 trophies (ladder median) and ±16 rating (Ranked
   median). On the densest graph we have — 63,838 Ranked matches between
   1,369 recorded players — a fitted Bradley–Terry model beats a coin
   flip by 0.4% in log-loss (53% accuracy), and the game's own rating
   difference by 0.1%. There is no skill information left in *who won*;
   the matchmaker already spent it.
2. **The information is in *where the matchmaker put you*, given what
   you brought.** Across 71,736 ladder observations from 35,495 players,
   deck level alone explains **93%** of the variance in trophies. The
   residual — trophies above or below what your card levels earn on
   their own — has test-retest reliability **0.92** (win rate: 0.66),
   is uncorrelated with how much you play (r = −0.08), and needs no
   win/loss at all.
3. **That residual is what Pilot Score was accidentally half-measuring.**
   The sign-flipped mean opponent level gap correlates **0.91** with it
   (both are "how out-leveled are you at your position"). The other half
   of Pilot Score, the win-rate residual, is noise plus mode mix.
4. **The model to adopt is not a rating system; it is the standard
   "performance versus expectation given resources" residual** used
   everywhere in sports and economics analytics (points above what the
   wage bill predicts, wins above payroll, xG over-performance). Elixir
   is uniquely placed to compute it because it sees levels *and*
   position for hundreds of thousands of players. For Ranked, the game
   already publishes a level-neutral rating; Elixir should show it, not
   rebuild it.

---

## 1. The population, and why it rules out an Elo

| players by battles in window | count | share of sides |
| --- | --- | --- |
| seen once | 116,965 | 25% |
| 2–4 | 6,711 | |
| 5–29 | 2,777 | |
| ≥ 30 ("recorded") | 2,049 | 64% |

Recorded players win **54.7%** of their sides; everyone else wins 41.7%.
That asymmetry is the assessment's finding 5 in raw form: the zero of any
residual over *all* sides is not the average recorded player.

**Matchmaking tightness** (both sides' starting trophies / rating known):

| mode | matches | \|difference\| median / p99 | logit slope per 100 | per deck level |
| --- | --- | --- | --- | --- |
| ladder (`PvP`) | 35,869 | 7 / 41 trophies | −0.09 (n.s.) | **+0.50** |
| Ranked (`pathOfLegend`) | 96,587 | 16 / 129 rating | +0.24 | +1.34 |
| war (`riverRacePvP`) | 11,095 | 639 / 6,373 trophies | −0.00 (n.s.) | **+0.49** |

Ladder opponents are within a few dozen trophies, so trophies carry no
information about the opponent; war opponents differ by thousands of
trophies and it still predicts nothing (war matchmaking is by clan, and
the outcome is levels and deck). Only Ranked's rating difference has a
slope, and it is small.

**The graph test.** 65,385 Ranked matches have *both* sides recorded
(mostly top-ladder players the rankings recordings follow, who meet each
other constantly). That is the best case for a paired-comparison model:
a dense, connected graph. Chronological 70/30 split, ridge-penalized
Bradley–Terry (equivalently a batch Elo):

| model | test log-loss | accuracy |
| --- | --- | --- |
| constant 0.5 | 0.6931 | 0.500 |
| game rating difference | 0.6925 | 0.510 |
| Bradley–Terry, strong shrinkage (C = 0.05) | **0.6903** | 0.530 |
| Bradley–Terry, C = 0.2 | 0.6925 | 0.535 |
| Bradley–Terry, C = 1.0 | 0.7024 | 0.536 |

The fitted strengths have SD 0.13 logits: every player is within a few
points of every other. Weaker shrinkage overfits immediately. This is
not a sample-size problem (63,838 matches); it is what a working
matchmaker does to outcomes. Elo, Glicko-2, TrueSkill, WHR and OpenSkill
all estimate the same latent quantity from the same outcomes and would
land in the same place. Margin of victory (crown differential), the
other classic rescue (Massey, SRS), adds almost nothing here: split-half
reliability 0.83 vs 0.81 for win/loss, correlation 0.91 between the two.

**Why the win-rate half of Pilot Score is noise.** Ladder does not even
equilibrate to 50%: arena floors ratchet, so Chanco climbed 10,961 →
13,410 at 48% and sikander sidhu 13,138 → 13,597 at 36–42%. A win rate
is a thermostat reading — it tells you the mode's rules, not the
player.

---

## 2. Position given levels: the curve Elixir can see

Ladder observations below the 14,000 cap, own deck level against
starting trophies at battle time (35,495 players; singletons included,
which is the corpus's strength — the curve is the whole neighbourhood,
not the recorded few):

| deck level | n | median trophies | SD |
| --- | --- | --- | --- |
| 10.0 | 1,221 | 4,790 | 747 |
| 11.0 | 1,369 | 5,753 | 749 |
| 12.0 | 1,242 | 6,980 | 806 |
| 13.0 | 1,504 | 8,565 | 923 |
| 14.0 | 2,064 | 9,560 | 1,209 |
| 15.0 | 3,941 | 11,500 | 855 |
| 15.5 | 5,192 | 12,272 | 876 |
| 16.0 | 13,157 | 13,175 | 663 |

Roughly **800–1,300 trophies per deck level**, compressing at the top. A
quadratic in level explains **R² = 0.932** per observation; residual SD
867 trophies. Between recorded players (≥ 20 ladder battles) the
residual's SD is ~940 trophies — a wide, real spread of "how far above
or below your cards you sit".

**Properties of the residual ("lift" below, a working name only):**

| property | value | compare |
| --- | --- | --- |
| first-half vs second-half correlation (same player) | **0.920** | win rate 0.657 |
| corr with sign-flipped mean opponent gap | **0.909** | — |
| corr with ladder win rate | −0.196 | (matchmaking) |
| corr with log battles in window | −0.077 | not an activity artifact |
| corr(first-half lift, later trophy change) | −0.30 | win rate: +0.09 |

The last row matters for what the number *means*: a player above their
curve tends to gain less afterwards (they are ahead of their cards; the
next upgrades bring the curve up to them), while win rate predicts
nothing about the future. Lift is a **state** — where your piloting has
put you relative to your resources — not a form indicator, and it
should be presented as one.

**The curve moves.** Median trophies at deck level 16.0: 12,783
(March) → 13,549 (September); at 15.0: 10,861 → 12,060. Trophies inflate
through the year (floors ratchet, the seasonal reset is partial), so the
curve must be fit **per season** and a player read against the
contemporaneous one; a pooled-year curve biases lift by when the battles
happened.

---

## 3. The proposal

### 3.1 One metric, two regimes

**Definition.** *Lift* = a player's Trophy Road position minus the
corpus-median position of players with the same deck level, this season,
in trophies. Equivalent level-scale reading: how many deck levels above
or below your opponents you play while holding that position (= −mean
gap; the two agree at r = 0.91, and showing both makes the number
self-explaining: "+620 trophies above your cards / you play 0.5 levels
under your opponents and hold").

**Regime 1 — below the level ceiling and the trophy cap.** Lift as
defined, from the season's curve. This covers most of the corpus and
almost every non-maxed clan member.

**Regime 2 — maxed decks (≈ 16.0) and/or the 14,000 cap.** Level no
longer varies, so the curve cannot separate players. For these players
the game's Ranked rating **is** the level-neutral skill measure (Ranked
equalizes levels: 84% of its pairs have identical deck averages), and
Elixir's contribution is the percentile of that rating among recorded
players plus the record's history of it. Do not rebuild it; the graph
test above shows there is nothing to add.

Both regimes read as one card: "Lift +620 (top 30% of recorded players
at your level) · Ranked 1,842 (top 25%)". A player still in regime 1
sees the Ranked line if they play Ranked; a maxed player sees Lift
saturate and the Ranked line lead.

### 3.2 Computation

- **Position curve, nightly, per season and per level bin (0.25 deck
  level), from ladder observations below the cap** — median and IQR of
  starting trophies, plus a smooth fit (quadratic or isotonic) for
  read-out between bins. The unfiltered corpus is the population by
  design; singletons are what make the curve representative. Store it
  like the meta rollup; the readers join it, they never refit it (the
  assessment's finding 7: refitting per request timed out five of six
  parallel calls).
- **Player lift** from the latest snapshot's trophies and the player's
  current deck level (mean over recent ladder battles, or the collection
  once the reader has it), against the current season's curve. A daily
  series comes for free from `player_snapshot_daily`; a trend is
  "climbing faster than your upgrades", which is a sentence a player
  can act on.
- **Covariates to add when available.** King Tower level (in snapshots
  since 2026-09-02; not in the pair export), tower-troop level, evolution and
  hero forms. Each should raise R² above 0.93; test on the export
  before adopting.
- **Season handling.** One curve per season month; a player's lift is
  always against the season they are read in. Report the season in the
  envelope like every other windowed tool.

### 3.3 Presentation

- Lead with the **percentile among recorded players in the same level
  band**; the signed trophy figure second. The assessment showed that
  the sign of a corpus-zeroed residual misleads (recorded players sit
  ~+0.065 above the corpus mean); a percentile among peers does not.
- Carry the curve row the player was read against (`level_bin`,
  `median`, `iqr`, `n`) so an agent can explain the number.
- Uncertainty: the curve's IQR at the level (a population spread, not a
  standard error) and the snapshot's age. No `0.5/sqrt(n)`.
- Caveats that stay: a new or returning account still climbing toward
  its equilibrium reads low until it gets there (flag with the trophy
  trend); deck-average level ignores *which* cards (rarity-relative
  normalization already handles the scale, not the composition); Lift
  is a state, not proof of skill or spending independence.

### 3.4 What to retire and what to fix regardless

- **Retire the win-rate residual as the headline.** Whatever name Jamie
  chooses, "actual minus level-expected win rate" should stop being the
  definition; keep `battles_levels`'s curve as the transparency view of
  the level effect in ladder and war (+0.50 logit per deck level, the
  two modes agree — that part was right), and drop the score from it.
- **Friendly and clan-mate battles are in the Pilot population.**
  12,812 sides (2.8%) are `friendly` and `clanMate`, all at gap zero;
  practice games should not score anything. Exclude them in
  `levelPairsSql` now, independently of this proposal.
- The bin-edge asymmetry (assessment §1) becomes moot if the score
  goes; fix it anyway if `battles_levels` keeps serving the curve.

---

## 4. What it says about POAP KINGS (illustration, not a reading)

Lift computed against the **pooled-year** curve from each member's mean
starting trophies over the window — fine for a rank order, wrong in
level for anyone who climbed during the year (the curve inflated ~800
trophies over it). 44 members with ≥ 20 uncapped ladder battles.

| member | deck level | mean trophies | lift | mean gap | ladder win | Pilot (365d) |
| --- | --- | --- | --- | --- | --- | --- |
| Gabriel | 12.98 | 9,541 | **+1,130** | −0.58 | 0.484 | +0.058 |
| AHMO | 14.88 | 12,245 | +950 | −0.38 | 0.534 | +0.077 |
| I Hate Witch | 14.20 | 11,017 | +804 | −0.43 | 0.500 | +0.014 |
| Sandeep | 14.91 | 12,069 | +719 | −0.42 | 0.518 | −0.003 |
| Mega Goblin | 12.32 | 8,212 | +682 | −0.40 | 0.634 | +0.168 |
| … | | | | | | |
| sniperhendo | 15.89 | 13,017 | +44 | +0.26 | 0.788 | **+0.194** |
| Vijay | 15.99 | 13,231 | +85 | +0.18 | 0.590 | −0.063 |
| … | | | | | | |
| King Levy | 15.91 | 12,627 | −376 | +0.40 | 0.573 | −0.020 |
| Chanco | 15.57 | 11,827 | −596 | +0.30 | 0.515 | −0.058 |
| Andy | 14.74 | 9,888 | −1,174 | +0.86 | 0.768 | +0.036 |
| nyje47 | 13.66 | 8,199 | −1,190 | +0.96 | 0.537 | −0.103 |
| King Thing | 15.74 | 11,450 | **−1,270** | +0.75 | 0.539 | −0.074 |
| shimmeringhost | 13.61 | 8,144 | −1,360 | +1.10 | 0.596 | −0.062 |
| 1spaceO2 | 10.92 | 4,366 | −1,421 | +1.07 | 0.659 | −0.007 |

corr(lift, Pilot 365d) = 0.54; corr(lift, −mean gap) = 0.94; corr(lift,
ladder win rate) = −0.13. The rank order is the mean-gap order; Pilot
Score's disagreements with it (sniperhendo top, Sandeep zero, Andy
positive) are its win-rate half — Ranked win rates and floor-ratcheted
ladder win rates, not piloting. Note the maxed members (deck ≈ 16.0,
lift within ±100) — regime 2 applies; their Ranked rating is the
reading. Note also that a member who climbed 2,000 trophies during the
year is under-read here because the pooled curve lags: this table is
why the curve is per season.

---

## 5. Decisions for Jamie

1. **Adopt position-given-levels as the metric; retire the win-rate
   residual.** The evidence is one-sided; the open choice is the
   name (keep "Pilot Score" and redefine, or a new word — "Lift" is a
   placeholder, and a redefinition under an old name has bitten this
   repo before).
2. **Regime 2 = the game's Ranked rating with a corpus percentile**, not
   an Elixir-built rating. Confirm you are comfortable with the metric
   deferring to Supercell's number for maxed players.
3. **Sequencing.** (a) Exclude friendly/clanMate from the Pilot
   population now. (b) Nightly per-season position curve as a rollup.
   (c) Lift reader + snapshot series + clan roll-up, contract-versioned
   as the replacement of `pilot_score`; keep `battles_levels`'s curve.
   (d) Add King Tower / tower troop covariates when the reader has them,
   gated on R² on the export.
4. **What to validate before shipping**, all on the export plus
   snapshots: per-season curve vs pooled (does lift's test-retest hold
   at 0.9 within a season?); the effect of King Tower level on R²; how
   new accounts converge to the curve (weeks? months?) to set the
   "still climbing" flag; lift's percentile stability month to month.

---

## Appendix: models considered and why

| model | what it needs | what the record has | verdict |
| --- | --- | --- | --- |
| Elo / Glicko-2 / TrueSkill / OpenSkill / WHR | outcomes between opponents of *varied* strength | opponents within ±7 trophies; graph test 53% accuracy | no signal to estimate |
| Bradley–Terry with level covariate | same, batch | tested above | same |
| Performance rating (FIDE) | opponents' ratings spread around yours | ladder ±7, Ranked ±16 | ≈ your own trophies |
| Margin ratings (Massey, SRS) | margin carries extra information | crown split-half 0.83 vs 0.81 | marginal |
| Pilot Score (win rate − level-expected) | win rate informative about the player | thermostat under floors/caps; 70–76% at gap 0 | retire |
| Game's Ranked rating | level-equalized mode | 84% zero-gap, rating slope +0.24/100 | adopt for maxed players |
| **Position given resources (residual standing)** | position + resources corpus-wide | R² 0.93, retest 0.92, activity-free | **adopt** |

_This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy._
