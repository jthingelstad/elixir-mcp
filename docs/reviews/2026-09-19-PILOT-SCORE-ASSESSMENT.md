# Pilot Score, assessed against a year of the record — 2026-09-19

**Status:** assessment only; nothing in the readers changed. Jamie asked
whether the premise of Pilot Score is holding up now that the corpus is
large, and for recommendations with data-science rigor. The one code change
this review made is the read-only migrate op `pilot_pairs` (019d9dc), which
exports the exact scored population so the deeper checks below can be run
off-line; its deploy was blocked in this session (production deploy denied
by the session's permission mode), so everything here was measured through
the public tools and the read-only ops that already exist.

**The premise under test.** `pilot_score = actual win rate − mean(level-bin
win rate)`: a player's win rate minus what the corpus Level Curve says a
player with their deck-level gaps would win, over a rolling window. The
methodology page already calls it a descriptive in-sample residual and
warns that it adjusts for opponent card levels and nothing else. The
question here is narrower and empirical: **does the level adjustment add
information, is the number reliable, and is the reference population the
right one?**

**Sources.** `battles_levels` (365-day and 90-day windows; by mode; by
trophy band; per member with `monthly_trend`), `clans_pilot_scores` (365
days), `clans_roster` for lifetime and standing fields, the migrate
Lambda's `stats` op, and `services/mcp/src/level-curve.mjs`. All numbers
below are as read 2026-09-19 10:34–10:50Z; the window ends at read time.
Corpus at read time: 289,109 battles, 316,307 players. Per-member calls
were made **sequentially** after six simultaneous 365-day calls timed out
five of six (finding 7).

---

## 0. The findings that change the picture

1. **70–76% of scored observations have a level gap of exactly zero.**
   365-day all-mode curve: 320,380 of 458,064 observations sit in the
   `[0, 0]` bin; 90-day: 299,834 of 394,360 (76%). For those observations
   the "level-expected" win rate is 0.500 by construction and the
   adjustment is identically nothing: **pilot_score = win rate − 0.5**.
2. **The zero comes from level-equalized modes.** Ranked (`pathOfLegend`)
   is 59% of the population and 84% zero-gap; casual is 19% and 86%
   zero-gap. Ladder is 16% of the population (11% zero-gap) and war 5%
   (21%). The corpus curve is therefore a Ranked curve with a ladder tail.
3. **Where a gap exists, its effect differs by mode by 2–3×.** Weighted
   logit slope per deck level: ladder 0.50, war 0.50, Ranked 1.15, casual
   1.54. In a capped mode a residual gap identifies an under-developed
   account, not a card-power edge, so pooling the modes misstates the
   level effect for everyone.
4. **At the player level the level adjustment is nearly orthogonal to
   outcomes.** Across the 45 scored POAP KINGS members, the correlation
   between actual win rate and mean level gap is **r = 0.09**;
   `expected_from_levels` tracks mean gap at r = 0.996. Pilot Score is
   therefore ≈ 57% raw win-rate deviation and ≈ 43% *negative* mean gap
   (SD actual 0.052, SD expected 0.045, SD pilot 0.066; corr(pilot, gap)
   = −0.61). The three most out-leveled members (mean gap +1.03, +0.96,
   +0.81) are three of the five lowest scores.
5. **Zero is not "average".** The experience-cohort medians, computed over
   every corpus player with ≥ 30 scored battles, are **+0.059 (1–2 yrs),
   +0.067 (3–5 yrs), +0.068 (6+ yrs)**. A member at 0.000 reads as
   average and sits at the ~20th percentile of recorded peers (Sandeep
   −0.003 → 21st percentile). The residual sums to zero over *all* sides
   of *all* matches, and the opponents seen once are systematically
   weaker than the recorded players.
6. **The score is reliable, but so is the number it is supposed to
   improve on.** Month-to-month (lag-1) correlation of monthly
   `pilot_score` across 10 members / 34 consecutive pairs: **0.83**;
   ICC(1) 0.77. For raw monthly win rate: **0.79**; ICC 0.76. The
   adjustment adds no stability. Within-player month-to-month SD is
   0.053 against a binomial SD of 0.024 at the median monthly n (427):
   the published `standard_error` understates realistic variability by
   2.2×.
7. **The refit per request does not scale.** Six 365-day calls fired
   together: five returned `query_timeout`. Sequential calls succeed, but
   each rebuilds a ~458k-row temp table. The curve is a nightly-rollup
   shape (like the meta rollup), not a per-request one.

---

## 1. What the corpus Level Curve is made of

`battles_levels({days: 365})`, observations per bin (both sides counted):

| gap bin | all modes | ladder | Ranked | war | casual |
| --- | --- | --- | --- | --- | --- |
| total | 458,064 | 71,722 | 272,194 | 22,150 | 85,112 |
| exactly 0 | 320,380 (69.9%) | 7,744 (10.8%) | 228,240 (83.9%) | 4,718 (21.3%) | 72,884 (85.6%) |
| \|gap\| ≥ 0.37 | 15.5% | 61.4% | 3.4% | 57.5% | 5.4% |
| win rate at gap +0.62..0.88 | 0.614 | 0.600 | 0.681 | 0.565 | 0.739 |
| win rate at gap +1..1.38 | 0.657 | 0.647 | 0.781 | 0.649 | (n=160) |
| logit slope / level | 0.56 | 0.50 | 1.15 | 0.50 | 1.54 |
| P(win \| gap = +1) from slope | 0.637 | 0.622 | 0.760 | 0.623 | 0.823 |

Challenge/tournament returned an empty curve (~6.9k observations of the
458k are in no mode group the filter exposes).

Two readings. First, the honest **card-level effect in the modes where
levels are free** is about half a logit per deck level: a full level of
average advantage is worth roughly 62/38 in ladder and in war, and the
two agree. That part of the premise holds up well. Second, in Ranked and
casual the game equalizes levels (the exact rule is not in
`cr-agent-api-docs` yet; the record shows opponent mean levels of ≈ 12.0
in the Competitive arena and ≈ 11–13 in casual months, with 84–86% of
pairs exactly equal), so a gap there is an account still below the cap.
Those bins are steep because they are measuring *experience*, not cards.

**Trophy-band heterogeneity inside ladder** (365 days, `mode: ladder`):

| band | +0.62..0.88 | +1..1.38 | −0.62..−1 |
| --- | --- | --- | --- |
| 5,000–8,000 | 0.613 | 0.655 | 0.384 |
| 11,000–13,000 | 0.567 | 0.609 | 0.425 |
| 13,000+ | 0.673 (n=658) | (n=78) | 0.336 |

The level effect at 11–13k is ~40% weaker than at 5–8k. For one member
scored at 11–12.5k with mean gap +0.75, "expected" is 0.614 on the
pooled all-mode curve the clan tool uses, 0.600 on the ladder curve and
0.567 on the ladder 11–13k curve: a 4.7-point swing in the reference
from population choice alone, comparable to the score itself (−0.058
ladder, −0.074 pooled).

**A construction defect in the bins.** `LEVEL_EDGES_SQL` puts edges at
±1.0, ±1.5 and ±2.5, which are attainable gap values (deck averages are
multiples of 0.125, stamped to two decimals). `width_bucket` is
lower-inclusive, so gap = +1.00 lands in `[1.0, 1.5)` while its mirror
−1.00 lands in `[−1.0, −0.6)`. The bins are not mirror images: ladder
`[−1, −0.62]` holds 9,020 observations against `[0.62, 0.88]`'s 7,521
(the 1,499 difference is every gap of exactly −1.00). Consequences: the
two sides of one match no longer get complementary expectations
(0.395 + 0.647 = 1.042 at ±1.00 in ladder), the curve is not
antisymmetric, and ~3% of ladder observations are scored against the
wrong neighbourhood. Edges at odd multiples of 1/16 (±0.0625, ±0.3125,
±0.5625, ±0.9375, ±1.4375, ±2.4375) fix it with no other change; a
parametric fit (section 4) removes the bins altogether.

---

## 2. What the score measures at the player level

`clans_pilot_scores({days: 365})`, 45 members scored.

| statistic | value |
| --- | --- |
| SD of pilot_score / actual / expected | 0.066 / 0.052 / 0.045 |
| corr(pilot, actual win rate) | r = 0.73, ρ = 0.68 |
| corr(pilot, mean gap) | r = −0.61 |
| corr(actual win rate, mean gap) | **r = 0.09** |
| corr(expected, mean gap) | r = 0.996 |
| rank displacement raw → pilot | mean 6.9 places of 45; 19 members move ≥ 5 |
| corr(pilot, trophies now − mean starting trophies) | r = −0.17 (uncapped members only: −0.16) |
| corr(pilot, lifetime win rate) | r = 0.37; raw win rate: r = 0.68 |
| corr(pilot, current trophies / best / king tower) | −0.04 / −0.04 / −0.19 |
| mean \|pilot\| by n tercile (58–537 / 575–1041 / 1047–5980) | 0.054 / 0.059 / 0.051 |

Reading. Between members, having higher-level cards than one's opponents
barely moves the actual win rate (r = 0.09) — trophy matchmaking, arena
floors and the 14,000 cap decouple win rate from card advantage at the
player level even though the within-match effect is real. The curve
nonetheless subtracts a steep function of mean gap, so the adjustment
mostly **re-ranks members by how out-leveled they are**, and it adds
variance (SD 0.066 > 0.052) that is not present in outcomes. The
dispersion does not shrink with n, so the between-member spread is
mostly real signal (whatever it is), not sampling noise.

Two members make the two ends concrete:

- **Aaqib Javed**: n = 3,089, 1 ladder battle, mean gap 0.00, score
  +0.077. The level adjustment contributed nothing; this is a Ranked win
  rate of 57.5% relabeled.
- **Vijay**: all modes n = 5,980, score −0.063, 8th percentile of the
  3–5-year cohort; **ladder only** n = 307, score **+0.067**, 50th
  percentile. The same player, the same window, opposite signs, because
  the all-mode number is his 44% Ranked win rate and the ladder number is
  his ladder play. Mode mix is inside the score.

The ladder itself does not equilibrate to 50%: Chanco climbed 10,961 →
13,410 over seven months at 48% (arena floors ratchet); sikander sidhu
rose 13,138 → 13,597 at 36–42%; Sandeep's monthly score fell from +0.08
to −0.144 while trophies rose 11,147 → 13,896. Within-player, monthly
score deviations correlate **−0.47** with monthly trophy deviations (25
month-points, 5 members): about a fifth of a player's month-to-month
movement is the population they climbed into, exactly the caveat 4.1.0
put on the trend, now with a size.

---

## 3. Reliability and uncertainty

From `monthly_trend` on ten members (full months only, 2026-03..08):

| | pilot_score | actual win rate | expected |
| --- | --- | --- | --- |
| lag-1 month-to-month r (34 pairs) | 0.83 | 0.79 | — |
| ICC(1) | 0.77 | 0.76 | 0.79 |
| within-player month SD | 0.053 | 0.051 | 0.016 |
| between-player SD | 0.097 | 0.091 | 0.031 |

The score is a stable trait-like number for a player: three quarters of
the variance in a monthly point is between players. Raw win rate is
equally stable. The binomial `standard_error` (0.024 at the median
monthly n of 427) is less than half the observed within-player SD
(0.053); the methodology already says it is not a calibrated error, and
this puts a factor on it. Small sample: ten members, one clan.

---

## 4. Recommendations

Ordered by how much of the picture each one fixes; the first three are
small and mechanical, the last two are the premise.

**R1. Stop pooling modes into one curve (contract-visible, small).**
Score ladder and war on their own curves; in Ranked and casual, publish
the number as what it is — a win rate in a level-equalized mode — with
`expected = 0.5` stated, or exclude their non-zero-gap tail (which is an
experience signal, not a level signal). The clan tool should carry a
per-member mode composition (`ladder_n`, `ranked_n`, `war_n`, `casual_n`)
so no reader mistakes Aaqib's Ranked win rate for a level-adjusted
figure. Cheap test after: corr(actual, gap) within ladder-only scores
should be well above the pooled 0.09 if the adjustment is doing work
there.

**R2. Condition the ladder curve on trophy band (small).** The level
effect at 11–13k is ~40% weaker than at 5–8k; a single ladder curve
over-adjusts the top of the ladder and under-adjusts the bottom. Bands
already exist as an argument; make them the default fit for the score
(a band × gap interaction, or one curve per band with the 200-observation
floor), and let `trophy_band` on `battles_levels` select rather than
condition.

**R3. Fix the bin edges (trivial, or moot under R5).** Edges at odd
multiples of 1/16 restore mirror symmetry and complementary expectations
across a match. Add a test that the two sides of every scored match have
expectations summing to 1.000.

**R4. Change the reference point and the uncertainty (presentation).**
Lead with the **percentile among recorded players with ≥ 30 scored
battles in the same mode/band** (the cohort machinery already computes
this) and show the signed residual second; the recorded-peer median is
+0.06 to +0.07, so the sign of the raw number misleads. Replace
`0.5/sqrt(n)` with an empirical interval: either a cluster bootstrap over
the player's battles, or the plainly-labeled observation that a monthly
point moves with SD ≈ 0.05 at n ≈ 400 for reasons that are not sampling.
Keep the legacy field for compatibility only if a client reads it.

**R5. Fit the curve parametrically and nightly (engineering + method).**
A logistic model `logit P(win) = β_mode,band · gap` (odd in gap by
construction, so symmetry is free) replaces thirteen bins with one
coefficient per stratum, extrapolates sanely into thin bins at 13,000+,
and can be fit once a night into a small table the readers join —
removing the per-request 458k-row temp table that timed out five of six
parallel calls. The `pilot_pairs` op (019d9dc) is how to validate the fit
off-line before it ships: hold out a month, compare the binned and
logistic expectations on it, and check calibration by decile.

**R6. Reconsider what "pilot" should be measured with (the premise).**
The residual is coherent and reliable, but in matchmade modes a win rate
is a thermostat reading: floors, caps and skill-matching push it toward
50% (or a floor-determined value) regardless of skill, and the year of
data shows the level adjustment neither improves reliability nor
agreement with any external criterion, while it does re-rank members by
their level gap. Two estimators would use the record's strength — that it
sees *where* players are, over time — rather than fight the
matchmaker:

- *Level-adjusted standing*: regress Trophy Road trophies (below the
  cap) and Ranked rating on deck/collection level across the corpus, and
  report a player's residual position: "you sit N trophies above where a
  player with your card levels typically sits." Position is the
  matchmaker's own accumulated verdict; it is far less noisy than a win
  rate and it does not vanish at gap zero.
- *Paired-comparison strength with a level covariate*: a Bradley–Terry /
  mixed-logit fit on the pair table, `logit P(a beats b) = θ_a − θ_b +
  β·gap`, with opponents seen once shrinking to the prior. This
  separates the card effect from player strength on the same rows the
  curve uses, and it gives an actual standard error.

Both need the pair export, so the sequencing is: deploy `pilot_pairs`
(blocked here; one `node infra/scripts/deploy.mjs --skip-web` from a
session allowed to deploy), pull the 365-day population, and run the
validation battery below before touching the contract.

**Validation battery for the export (not yet run).** (a) Out-of-sample
calibration of the binned vs. logistic curve by mode × band, held-out
month. (b) Split-half reliability per player (odd vs. even battles) for
raw win rate, binned pilot, logistic pilot, standing residual. (c)
Predictive validity: does months 1–3 predict months 4–6 win rate or
trophy gain *beyond* raw win rate? (d) Selection check on finding 5:
mean residual of players with ≥ 30 battles vs. their opponents with < 5,
by mode. (e) Cluster-robust SE per player vs. the binomial one.

---

## 5. Follow-ups outside this repo

- `cr-agent-api-docs` does not record that Ranked and casual modes
  equalize card levels. The record's evidence (84–86% of decided 1v1
  pairs at identical deck averages; Competitive-arena opponent mean level
  ≈ 12.0) is a general finding worth writing there once the exact rule is
  checked against the wiki (`recipes/verify-a-claim.md`); do not write
  the clan's numbers.

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
