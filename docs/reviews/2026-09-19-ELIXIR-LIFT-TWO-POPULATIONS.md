# Elixir Lift against two populations — 2026-09-19

**Status:** results of the test Jamie asked for after the
[evolution proposal](2026-09-19-PILOT-SCORE-EVOLUTION.md): run every
candidate score through **POAP KINGS** (long record, ladder-heavy, card
levels vary) and through **the top Ranked players** (shorter record,
levels equalized, the tightest matchmaking in the game), and see what
survives. Jamie's working name for the position-given-levels metric is
**Elixir Lift**; it is used below. Nothing shipped.

**Data.** The `pilot_pairs` export (459,358 sides, 2026-01-03 →
2026-09-19) and a second read-only op added today, `pol_seasons`
(2251dcb): the top 3,000 places of every recorded season-final global
Ranked board — **47 seasons, October 2022 → August 2026** (141,000 rows).
These are the record's own `pol_final` snapshots: since 0069 the
scheduler fetches every settled season's final board from the API's
`/locations/global/pathoflegend/{season}/rankings/players`, which
Supercell serves at full depth for every past season, so the Ranked
history reaches back four years although battle recording ramped in
2026. Plus `player_pol_season`. Candidates scored per player per period exactly as
the readers define them: **Pilot** (win rate − pooled level-bin
expectation, all modes, as deployed), **win rate**, **mean opponent level
gap**, **Elixir Lift** (starting trophies − the ladder position curve
fitted **per month**, below the 14,000 cap), and the game's **Ranked
rating**. Reliability is the consecutive-period correlation and the
ICC(1) of the per-period scores; a metric that describes the player
rather than the month should score high on both.

---

## 1. POAP KINGS, monthly, March → August 2026

45 members, 207 member-months with ≥ 20 scored battles.

| metric | consecutive-month r | ICC(1) | note |
| --- | --- | --- | --- |
| Pilot (as deployed, all modes) | 0.65 | 0.50 | |
| win rate, all modes | 0.50 | 0.28 | |
| mean opponent gap | 0.84 | 0.72 | the half of Pilot that carries |
| **Elixir Lift** (ladder, monthly curve) | **0.86** | **0.76** | 42 members, 134 pairs |

Ladder only (160 member-months): Pilot 0.66 / 0.57, win rate 0.49 /
0.34, gap 0.86 / 0.68, **Lift 0.88 / 0.77**. Ranked only (16 members who
play it): Pilot 0.78 / 0.73 and win rate 0.77 / 0.71 — identical,
because in Ranked Pilot *is* the win rate (gap SD 0.18 across members,
nearly all at zero).

Two-thirds of a member's month-to-month Pilot movement is not the
member; three-quarters of their Lift is. The earlier ten-member estimate
(0.83 for Pilot) was optimistic; on all 45 it is 0.65.

**Trajectories read as the game, not as noise.** Curve fit per month,
so the year's ~800-trophy inflation is out of the number:

| member | Mar | Apr | May | Jun | Jul | Aug | Sep | mean | range |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sandeep | | +965 | +786 | +961 | +596 | +669 | +730 | +784 | 369 |
| MONICA | | +480 | +834 | +151 | +597 | +698 | +546 | +551 | 683 |
| Shafith Nihal | +211 | +291 | +364 | +384 | +711 | | | +392 | 500 |
| raquaza | −230 | −284 | +391 | +281 | +376 | +484 | | +170 | 768 |
| ryguy67 | | +243 | +9 | −193 | +143 | +168 | +120 | +82 | 436 |
| Chanco | −151 | −473 | −443 | −503 | −40 | −146 | −50 | −258 | 463 |
| King Levy | −394 | −833 | −522 | −480 | −76 | +505 | | −300 | 1,338 |
| King Thing | −1,114 | −1,466 | −1,255 | −1,216 | −895 | −832 | −982 | −1,109 | 634 |
| shimmeringhost | −1,537 | −1,338 | −1,270 | −1,670 | −1,228 | −865 | −781 | −1,241 | 889 |
| 1spaceO2 | −1,720 | −2,497 | −1,416 | −1,326 | −1,320 | −804 | −1,076 | −1,451 | 1,693 |

Sandeep upgraded 14.36 → 15.80 and climbed 11,147 → 13,896 over six
months and sat +600 to +960 the whole way: piloting above the cards,
consistently. King Thing went 15.27 → 16.00 and 10,341 → 12,536 and sat
−830 to −1,470: climbing at the pace of the upgrades plus the inflation,
never faster. Mega Goblin (three months): +708, +405, +493 while
levelling 11.2 → 13.1 and climbing 6,959 → 9,308. A monthly point moves
by a few hundred trophies (median member range ≈ 700); a change of that
size is the month, a change of 1,000+ sustained is the player. Members
whose range exceeds 1,300 (round hamster, King Levy, Tere, Waltadr,
pigsareus, 1spaceO2) are the cases to look at before shipping: a month
with few ladder battles, a fast level jump, or a floor sit.

---

## 2. The top Ranked players

463 recorded players with ≥ 100 Ranked battles and a mean rating ≥
1,900 (348 of them are in the August 2026 season-final top 3,000; 417 in
some 2026 final top 3,000).

**Pilot Score in Ranked is the win rate, and the win rate is a weekly
coin toss.** Weekly, 885 player-weeks with ≥ 15 battles:

| metric | consecutive-week r | ICC(1) |
| --- | --- | --- |
| Pilot (Ranked only) | 0.39 | 0.28 |
| win rate (Ranked only) | 0.39 | 0.28 |
| mean opponent gap | 0.48 | 0.41 (SD 0.02 — there is no gap) |
| Pilot (all modes, as deployed) | 0.36 | 0.27 |

Cross-sectionally over the whole window the top players' Pilot has SD
0.060 against 0.037 expected if they were all identical, and it
correlates +0.54 with their rating — at the very top the pool is thin,
so the highest-rated win more than half. That is the rating telling you
something the win rate then repeats; it is not new information.

**The game's own Ranked rating, season to season.** For players in a
season's final top 3,000 who are also in the next season's:

| transition | retained | Spearman (rating) |
| --- | --- | --- |
| 2026-03 → 04 | 0.49 | 0.58 |
| 2026-04 → 05 | 0.51 | 0.58 |
| 2026-05 → 06 | 0.52 | 0.59 |
| 2026-06 → 07 | 0.54 | 0.59 |
| 2026-07 → 08 | 0.50 | 0.52 |
| median of all 46 transitions since 2022-10 | 0.50 | 0.52 |
| 2026-07 → 08 with dropouts ranked 3,001 | — | 0.48 |
| 2026-03 → 08 (five seasons) | 0.37 | 0.45 |

Half the top 3,000 turns over every season and the surviving half's
order is held at ≈ 0.5. A season-final rating is skill × how much of
the season you played; it is a good deal more stable than any weekly
outcome measure (0.39) but it is not a trait with a 0.9.

**Can the record do better than the game in Ranked? No.** Volume
explains almost none of a top player's current rating (R² 0.04 on
battles played; 0.20 with the season's starting floor), so a
"rating-given-battles" Lift has nothing to adjust for. Within the current
season, split-half reliability of win rate is 0.32 and of rating change
per battle 0.28. Prior-season final predicts this season's current rating
at Spearman 0.45 — and predicts win rate at 0.23 and rating gain per
battle at 0.20. The rating is the most persistent number available; the
outcome-derived ones are less persistent and are downstream of it.

**Data fact for Keep the Record True.** Ranked starting rating on
`pathOfLegend` rows is null for 91–99% of battles before September 2026
and 23% in September. Ingest stores `startingTrophies ?? null`, so the
gap is in the source rows — most likely the elixir-bot archive import,
which supplied the pre-September Ranked battles. Any Ranked rating series
from the battle record starts in September; season-final standings
(`pol_final` boards, `player_pol_season`) are the longer series.

---

## 3. What this settles

1. **Elixir Lift holds where levels vary.** On the clan's six months it
   is the most reliable of the candidates by a wide margin (0.86 / 0.76
   vs Pilot's 0.65 / 0.50), its trajectories read as the game
   (upgrades, climbs, sits), and the fix that made it work — a
   **per-month curve** — is confirmed necessary.
2. **Pilot Score falls apart in Ranked entirely**, as Jamie said: gap
   SD 0.02 across the top players, so it is the win rate, and the win
   rate is 0.39 week to week. No amount of level adjustment can rescue a
   mode with no levels.
3. **Regime 2 is revised down to what the data support.** For maxed
   decks and Ranked players, show the game's Ranked rating with its
   season-final history and a percentile among recorded players — and
   label it as moderately persistent (≈ 0.5 season to season for the top
   3,000), not as a trait. Elixir cannot compute anything from Ranked
   outcomes that beats it; the honest product is history and context,
   not a competing number.
4. **Elixir Lift is therefore a Trophy Road metric**, and should say so:
   "your Trophy Road position above what your cards earn". For a maxed
   player at the cap it saturates by construction, and the card should
   hand over to the Ranked line rather than print a meaningless zero.

## 4. Before shipping (additions to the evolution doc's §5)

- Investigate the six high-range members (§1) on the per-month series
  before setting the display rule for a monthly point; a floor for
  ladder battles per month (≥ 20?) and a level-jump guard may be needed.
- Confirm the pre-September Ranked rating gap's provenance; if it is the
  bot import, the fix is upstream of any reader.
- Decide the Ranked percentile's population: recorded players (biased
  toward the top) or the season-final top 9,999 (the game's own field).
  The finals boards make the second possible for every season since
  2022.

_This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy._
