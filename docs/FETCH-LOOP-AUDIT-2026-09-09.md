# Fetch-loop audit: player and battlelog polling (2026-09-09)

**Status: measured 13:56-14:40Z, IMPLEMENTED the same afternoon at Jamie's
ask.** The measurement ran while another session held the checkout lease;
once it freed, plan items 5.1, 5.2 and 5.3 shipped together as one
contract-free change plus additive migration 0061, with the loss bound
behind the `half` A/B arm (section 7 has the deploy record). While wiring
the bound, the audit found that the 2026-09-08 profile fix had been inert:
`activity_bph` was computed in the planner's CTE and never re-selected, so
every profile still polled on the 480-minute branch. That is fixed in the
same change and explains the unchanged 33 to 35 per hour in section 3.7.

Constraints honoured throughout: the one global rate budget is a ToS posture
and is never to be filled or exceeded; `live_reserve` stays at 0.10;
freshness advances only on admission; the retired heat scheduler is not
reintroduced.

## 1. Summary

- **Budget is not the constraint.** The fleet spends ~127 fetches/hour, 3.5%
  of the 3,600/hour budget (3.9% of the bulk share). Even the most expensive
  policy modelled below stays under 10% at today's subject count.
- **The target-batch rule clamps the median subject to the 24-hour floor.**
  At the observed activity distribution (median 3.4 battles/day) the rule
  intends a 24h cadence for half the subjects and under 8h only for the top
  10%. This is why three of Jamie's seven tracked players had battlelog data
  23 hours stale at read time today.
- **Half of battlelog fetches return nothing.** 51-58% of battlelog receipts
  on steady-state days are byte-identical to the previous payload. The other
  half average 5.7 new battles, and 2.6% of them return a full log of 30
  unseen battles, which is the overflow signature.
- **Capture loss is real, measurable, and concentrated.** Three instruments
  agree: 40 provable overflow events in 1,814 yielding fetches (2.2%), a
  capture_audit gap rate of 0.8% of all polls over 14 days rising to 6.6% of
  yielding fetches on the post-season-roll training days, and a
  battleCount-delta capture ratio of 0.845 (an upper bound on loss). Ten
  grinders carry 42% of the missing battles; they fill the 30-entry log in
  1.8-2.5 hours and are polled every 1.5-6 hours.
- **The EWMA cannot see a burst it missed.** A poll that returns 30 unseen
  battles after a 6h gap teaches the EWMA 5 battles/hour, when the player
  actually played 60. The rule then relaxes as zero-yield polls decay the
  estimate, and the next burst overflows again. Extra polls (war caps, live
  fetches) make this worse because every zero-yield poll decays the EWMA by
  0.7 regardless of how short the interval was.
- **Lockstep is gone.** After the 2026-09-08 21:15Z jitter deploy the
  1-minute QueuedJobs metric reads p50 9, p90 17, max 28, against 234-270
  spikes every 8 hours before it. Hourly fetch standard deviation fell from
  80 to 26.
- **The profile fix changed the shape but not the volume.** Profile fetches
  ran at 33/hour before the 2026-09-08 activity_bph fix and 35/hour after,
  because the 120-minute "hot" branch now fires for ~15% of subjects at 12
  polls/day, which is most of the profile spend.
- **Recommendation, ranked:** (1) a loss-aware cadence bound derived from each
  player's fastest observed log-fill, which cuts modelled loss from 3.7% to
  1.0% for +50% battlelog fetches (still under 5% of budget); (2) a
  reader-priority cap of 60 minutes for subjects queried in the last 24
  hours, which takes reader-facing staleness from p90 17h to under 1h for a
  few hundred fetches/day; (3) the profile hot branch from 120m to 480m,
  halving profile spend. War-day caps and time-of-day priors were modelled
  and are NOT recommended: the first raises loss under the current EWMA, the
  second buys nothing the EWMA does not already provide and re-creates
  lockstep.

## 2. Method and instruments

**Window.** The brief asked for 14 days. Live receipts begin 2026-09-03, so
the record is six days, segmented by scheduler regime instead:

| regime | window (UTC) | what ran |
|---|---|---|
| heat | 09-03 15:00 to 09-04 14:45 | legacy heat model |
| replay | 09-04 01:00 to 07:00 | elixir-bot history replay, excluded from every fetch-level number |
| yield | 09-04 14:45 to 09-08 21:15 | yield scheduler, no jitter, profile cadence borrowing NULL |
| jitter | 09-08 21:15 onward | jitter plus profile borrowing the battlelog row's yield_bph |

Enrollment sweeps contaminate battle counts on 09-03 (240 first polls) and
09-06 (200 first polls, the clan batch that produced the 8-hour cohort). Every
first poll of a subject is excluded from yield statistics.

**Data paths.** Production RDS has no psql path (private subnet, no NAT, no
bastion), so the instruments were:

- Migrate Lambda census ops, read-only: `{probe}` (48h hourly fetch vs
  harvest), `{capture_audit:{days:14}}`, `{ab_yield}` in daily windows for
  receipt counts, `{audit_census:{days:14}}`, `{stats}`.
- The S3 payload archive (`elixir-mcp-archive-999153317627`), all 9,486
  battlelog and 8,770 profile objects synced locally and parsed. The archive
  holds only content-changed payloads, so a battlelog object is exactly a
  fetch that admitted at least one new battle, and receipts minus objects is
  the zero-yield count.
- CloudWatch `ElixirMCP/Ledger QueuedJobs` at 5-minute and 1-minute
  resolution for lockstep, and `/api/public/status` for the 24h capture
  series and budget row.
- `elixir_coverage` over MCP for the seven players on this account, as the
  reader-facing freshness sample.

**What could not be measured and why.** Per-subject poll intervals including
zero-yield polls, and reader freshness joined against `mcp_call_audit`
subjects, both need per-row access to `api_receipt` and `poll_state`. No
existing census op exposes them and adding one is a deploy. Section 6
proposes the op. Per-subject achieved intervals below are therefore intervals
between content-changing fetches (an upper bound on the true poll interval)
plus exact poll counts for the 26 subjects capture_audit names.

**Battlelog capacity.** The brief said 25-30. Measured over 2,000 payloads
since 09-05: 1,578 have exactly 30 entries, 353 have 31-39, 167 have 40, a
handful more. Overflow math below uses 30.

## 3. Measurements

### 3.1 Budget utilisation

Last 48 full hours (probe op, live gateways only):

| lane | mean/h | sd/h | min | max | share of 3600/h | share of bulk 3240/h |
|---|---|---|---|---|---|---|
| all | 127 | 66 | 77 | 346 | 0.035 | 0.039 |
| player_battlelog | 37 | 10 | 20 | 64 | 0.010 | 0.011 |
| player (profile) | 33 | 65 | 1 | 247 | 0.009 | 0.010 |
| clan + currentriverrace + riverracelog | 58 | 5 | 51 | 67 | 0.016 | 0.018 |

Variance before and after the jitter deploy: pre-jitter hours (31) mean 127,
sd 80, max 346; post-jitter hours (16) mean 128, sd 26, max 186. The
remaining post-jitter variance is the profile cohort still de-phasing (see
3.6). Daily receipt totals from `ab_yield` (00Z windows): 09-05 1,671; 09-06
3,807 (enrollment batch + zero-trust cutover); 09-07 3,526; 09-08 2,860.

### 3.2 Cadence intended vs achieved, battlelog

What the target-batch rule (TARGET_BATCH 5, clamp 15-1440 min) intends at
the observed live-era activity percentiles (543 subjects, 6.0 days):

| percentile | battles/day | bph | intended cadence (h) |
|---|---|---|---|
| p25 | 1.01 | 0.042 | 24.0 |
| p50 | 3.36 | 0.140 | 24.0 |
| p75 | 7.22 | 0.301 | 16.6 |
| p90 | 15.10 | 0.629 | 7.9 |
| p95 | 20.98 | 0.874 | 5.7 |
| p99 | 32.06 | 1.336 | 3.7 |

Achieved intervals between content-changing battlelog fetches, non-first
polls (upper bound on the poll interval):

| regime | yielding fetches | subjects | interval p50 h | interval p90 h |
|---|---|---|---|---|
| heat | 310 | 131 | 2.0 | 15.3 |
| yield | 1,573 | 353 | 5.8 | 20.2 |
| jitter | 241 | 134 | 7.2 | 24.1 |

Exact poll counts for the subjects capture_audit names (14-day op, rates over
the 3-day settled window since 09-06 15Z):

| subject | polls | gaps | polls/day | live battles/day | max battles in a day | h30 (h) |
|---|---|---|---|---|---|---|
| #98U8LCUR | 32 | 3 | 10.8 | 37.4 | 86 | 1.8 |
| #2Y08U8L28 | 47 | 2 | 15.9 | 49.5 | 108 | 1.8 |
| #JPGCQYJR | 23 | 2 | 7.8 | 18.3 | 40 | 2.5 |
| #2QP0P8R28 | 21 | 2 | 7.1 | 21.0 | 53 | 1.9 |
| #GU2YR209R | 12 | 2 | 4.1 | 16.1 | 43 | 2.3 |
| #9U9QY99RY | 25 | 2 | 8.5 | 24.2 | 61 | 1.8 |
| #VLRUJJ82L | 28 | 2 | 9.5 | 26.9 | 53 | 2.5 |
| #R09228V | 11 | 2 | 3.7 | 18.5 | 61 | 1.9 |
| #JQ02Q0PY | 16 | 1 | 5.4 | 7.2 | 19 | 14.5 |
| #RJ88Y8U08 | 11 | 1 | 3.7 | 13.1 | 30 | 2.0 |
| #GPPYR9JYR | 12 | 1 | 4.1 | 22.3 | 42 | 2.0 |
| #Y022GRCJQ | 9 | 1 | 3.0 | 15.6 | 41 | 2.0 |

`h30` is the shortest span in which the player has ever produced 30
consecutive recorded battles. Every gap subject but one fills the log in
under 2.5 hours and is polled every 1.5-8 hours.

### 3.3 Yield distribution

Zero-yield share per day: battlelog receipts (live gateways) against
content-changed archive objects.

| day (00Z-24Z) | battlelog receipts | changed, non-first | first polls | zero-change fetches | zero share | battles first-observed | battles per receipt |
|---|---|---|---|---|---|---|---|
| 2026-09-05 | 491 | 195 | 12 | 284 | 0.58 | 1,537 | 3.13 |
| 2026-09-06 | 2,075 | 367 | 200 | 1,508 | 0.73 | 7,662 | 3.69 |
| 2026-09-07 | 1,385 | 596 | 25 | 764 | 0.55 | 3,767 | 2.72 |
| 2026-09-08 | 879 | 402 | 29 | 448 | 0.51 | 4,164 | 4.74 |

"Battles per receipt" is the ab_yield figure and includes first-poll
harvests (29 x 30 on 09-08), so it overstates steady-state yield.

New battles per yielding fetch, non-first polls, yield + jitter regimes
(1,814 fetches):

| new battles | fetches | share |
|---|---|---|
| 0 (content changed, no new identity) | 143 | 0.079 |
| 1 | 284 | 0.157 |
| 2 | 236 | 0.130 |
| 3 | 198 | 0.109 |
| 4 | 163 | 0.090 |
| 5 | 135 | 0.074 |
| 6-10 | 332 | 0.183 |
| 11-20 | 233 | 0.128 |
| 21-29 | 43 | 0.024 |
| 30 (full log, all unseen) | 47 | 0.026 |

By regime: heat mean 3.55 (p50 2, p90 7); yield mean 5.70 (p50 3, p90 14);
jitter mean 8.33 (p50 5, p90 20). The rule targets 5 and the yielding mean is
near 5, but the distribution is bimodal: when it is not zero it is usually 1-3
or 10+.

### 3.4 Capture loss

Three instruments, weakest to strongest claim.

**(a) Provable overflow from the archive:** a full (30-entry) payload whose
oldest battle was never seen. Something was pushed off the log unless the
player played exactly 30.

| regime | day kind | yielding fetches | overflow events | rate |
|---|---|---|---|---|
| heat | war | 310 | 0 | 0.000 |
| yield | war | 857 | 7 | 0.008 |
| yield | training | 716 | 17 | 0.024 |
| jitter | training | 241 | 16 | 0.066 |

**(b) capture_audit op (same definition, all polls, 14 days):** 35 gaps in
4,499 audited polls (0.78%), 26 subjects; the last 24h read 18 in 756 (2.4%).
The two instruments agree once the zero-yield polls in the denominator are
accounted for.

**(c) Lifetime battleCount deltas between profile fetches vs battles
captured** (the elixir_coverage instrument, applied to every subject from
the archive, intervals ending between 09-04 15Z and 09-08 14Z so every
pending poll has since happened): 1,596 intervals over 435 subjects,
expected 8,484, captured 7,167, ratio **0.845**. 194 intervals under-captured
(1,483 battles), of which 20 with expected > 30 are unambiguous overflow
(494 battles). 74 intervals over-captured (+166).

This ratio is an **upper bound on loss**, not a measurement of it:
`battleCount` counts modes that never appear in the battlelog. Example:
#PVLU2GQQ0 advanced +30 between 09-06 14:43 and 22:48 with zero battlelog
entries that day (its log was polled at 14:48 and again 09-07 08:12 with no
battle dated 09-06), and +25 on 09-09 06:32 the same way. That is a CR API
observation worth recording in `cr-agent-api-docs` once the mode is
identified (the archive has the payloads; likely a side mode such as Merge
Tactics, which the profile's `progress` map tracks separately).

Loss is concentrated. Top subjects by missing battles in (c):

| subject | missing | live battles/day | h30 (h) |
|---|---|---|---|
| #9U9QY99RY | 140 | 24.2 | 1.8 |
| #R09228V | 117 | 18.5 | 1.9 |
| #RQJ98J2LQ | 95 | 6.0 | 5.0 |
| #28YGGRR2P | 52 | 3.2 | 21.3 |
| #VLRUJJ82L | 44 | 26.9 | 2.5 |
| #PVLU2GQQ0 | 42 | 2.7 | 97.5 (mode mismatch, see above) |
| #UGUUQGV2 | 39 | 3.0 | 118.5 (same) |
| #CJGGUPVJY | 36 | 12.3 | 32.3 |
| #2YUL9P90C | 29 | 5.2 | 10.3 |
| #8J8VPG8VQ | 28 | 1.5 | 172.0 (same) |

The ten carry 42% of the missing count. #9U9QY99RY in one 8.1h interval
(09-08 15:38 to 23:12) advanced 81 while its log was polled once in that
window and returned 30.

### 3.5 Freshness

**Capture lag** (fetch time minus battle time, first-seen battles, non-first
polls):

| regime | day kind | battles | p50 min | p90 min | p99 min | mean min |
|---|---|---|---|---|---|---|
| heat | war | 1,101 | 39 | 284 | 351 | 95 |
| yield | war | 4,298 | 73 | 423 | 1,330 | 170 |
| yield | training | 4,666 | 109 | 379 | 817 | 161 |
| jitter | training | 2,007 | 141 | 441 | 828 | 198 |

**Reader-facing sample**, `elixir_coverage` for this account's seven players
at 14:07-14:11Z on 2026-09-09:

| player | relationship | battlelog age at read | profile age at read | note |
|---|---|---|---|---|
| King Thing #20JJJ2CCRU | primary | 10.6 h | 1.5 h | |
| King Levy #U8RYG9Y2U | friend | 23.2 h | 1.6 h | last interval: 3 expected, 0 captured (deferred, not lost) |
| raquaza #UL2V9QRG0 | friend | 23.2 h | 4.9 h | last interval: 3 expected, 0 captured (deferred) |
| thingles #VJQV8G8RL | alt | 8.5 h | 2.4 h | |
| Lucky Red Panda #200UL8LYUJ | watching | 0.6 h | 4.4 h | zero battles in 7 days; still polled hourly on the discovery default |
| Chanco #20R8QRLYLP | watching | 2.3 h | 0.6 h | 25 vs 21 expected: battleCount excludes some log modes |
| JaxikoLane #VPY0Y2209 | watching | 23.2 h | 6.2 h | dormant since 07-20 |

Three of seven sit on the 24-hour clamp; all three were last polled in the
15Z cohort spike of 09-08. The two friends with 3 battles pending are exactly
the low-activity, high-interest case the target-batch rule serves worst.
`mcp_call_audit` shows the same account pattern fleet-wide: `war_current`,
`battles_performance`, `players_summary` and `elixir_coverage` are the
reader tools, 14-day total 1,937 calls, and their subjects are the accounts'
own players, not the grinders.

### 3.6 Cohort lockstep after the jitter change

QueuedJobs (EMF, ledger namespace), 5-minute maxima above 100 since 09-05:

| UTC | queued | UTC | queued |
|---|---|---|---|
| 09-06 14:40 | 270 | 09-07 07:15 | 264 |
| 09-06 15:05 | 146 | 09-07 15:20 | 248 |
| 09-06 22:45 | 202 | 09-07 23:25 | 246 |
| 09-06 23:10 | 270 | 09-08 07:30 | 237 |
| | | 09-08 15:35 | 234 |

No 5-minute maximum above 28 after 09-08 15:35Z. At 1-minute resolution
since the deploy (266 points): p50 9, p90 17, p99 23, max 28. The 270 ceiling
is the bulk share of the 300-token bucket cap, which is what bounded each
spike.

The profile cohort, content-changed profile fetches by UTC hour:

| hour | pre-jitter (09-06 15Z to 09-08 21Z) | post-jitter (09-08 21Z to 09-09 14Z) |
|---|---|---|
| 05, 06, 08, 09 | 12 | 119 |
| 07 alone | 391 | 22 |
| 15 alone | 419 | 0 (hour not yet reached) |
| 22-00 | 424 | 173 |

The 8-hour cohort has become a 3-5 hour smear and is still widening, as the
multiplicative jitter predicts (fully de-phased after about four cycles).
The probe's hourly profile counts post-jitter (57, 86, 87 at 22-00Z; 36-55
at 05-09Z) show the same. Verdict: lockstep no longer shows up.

### 3.7 The profile endpoint on its own

| regime | changed profile fetches | subjects | interval p50 h | interval p90 h |
|---|---|---|---|---|
| heat | 177 | 137 | 14.6 | 17.9 |
| yield (borrowed NULL, 480m for all) | 1,756 | 435 | 8.1 | 16.2 |
| jitter (borrows battlelog bph) | 360 | 221 | 8.6 | 22.2 |

Volume did not fall after the fix: 33/hour before, 35/hour after. The model
explains it: with the borrowed signal, ~15% of subjects sit at or above 0.5
bph and take the 120-minute branch (12 polls/day), ~68% take 1440 and ~17%
take 4320. That is 0.15 x 12 + 0.68 x 1 + 0.17 x 0.33 = 2.5 polls per
subject per day, 325 subjects, 34/hour: the measured figure. The hot branch
is 70% of profile spend, and a 2-hourly profile of an active player buys
little: the projection is a daily snapshot, and the only time-critical
profile read is the pre-reset watcher, which is forced separately.

### 3.8 Activity distribution (the input to any policy)

Battles per player-day, live era, 543 archive subjects (325 polled since
09-06):

| stat | battles/day |
|---|---|
| p10 | 0.00 |
| p25 | 1.01 |
| p50 | 3.36 |
| p75 | 7.22 |
| p90 | 15.27 |
| p95 | 22.32 |
| p99 | 35.75 |
| mean | 5.82 |

Top 10% of players produce 40% of battles; 73 subjects had no battle in six
days; 129 are under one per day.

Burstiness, max battles in one UTC day: p50 13, p75 25, p90 40, p95 58, p99
83. 86 players had a 30+ day, 158 a 20+ day.

Overflow horizon (shortest span holding 30 consecutive battles, all recorded
history, 523 players with 30+ battles): p10 3.4h, p25 20h, p50 58h, p75
131h, p90 272h. Players with h30 under 2h: 21 (4%); under 4h: 63 (12%);
under 8h: 86 (16%); under 24h: 146 (28%).

War vs training (war = Thu 10Z to Mon 10Z; this window's war days were the
season-135 Colosseum, the training days the first days of season 136):

- war: 11,325 battles over 4 days, 449 active players, 6.3 per active
  player-day; top types pathOfLegend 5,112, trail 3,268, riverRacePvP 1,419.
- training: 7,509 battles over 2.2 days, 232 active players, **14.9** per
  active player-day; trail 4,230, pathOfLegend 2,738, riverRacePvP 114.

The war-day prior was inverted this week: fewer players played, but the ones
who did played more than twice as hard on the training days, grinding the
new season. War-day awareness is therefore not a proxy for burst risk.

Time of day: globally flat (every UTC hour carries 3.0-5.9% of battles). Per
clan it is not: peak 6-hour windows hold 28-50% of a clan's battles and sit
anywhere from 08-14Z (#J2RGCRVG, #2GYC9PL) to 20-02Z (#Q9QYCRJ9), so any
time-of-day prior must be per clan or per player.

## 4. Model

### 4.1 Simulator

A discrete-event replay over the ground-truth battle series reconstructed
from the archive (every distinct battle each subject's log ever showed).
Population: the 325 subjects with a battlelog object since 09-06. Log model:
at poll time t the API returns the last 30 battles with battle_time <= t;
anything older and unseen is lost. Ticks every minute; a subject is due when
now minus last poll >= cadence(state), exactly as `selectEligible` does.
The EWMA update is the ingest rule verbatim (obs = new / max(hours since last
poll, 0.25); 0.7/0.3), and the riverrace deck-delta raise runs every 30
minutes on war days. Warm-up 09-03 15Z to 09-05 00Z; measured 09-05 00Z to
09-09 10Z (4.42 days, 2.4 war + 2 training).

**Calibration.** Policy A (the production rule) simulates 920 battlelog
fetches/day for 325 subjects against 879 receipts on 09-08, a 0.56 zero-yield
share against the measured 0.51-0.58, and a max hour of 98 against the
probe's 64 for battlelog alone. The ground truth is itself loss-truncated
(the real bursts were larger than what was captured), so every simulated
loss rate is a lower bound on what the same policy loses in production.

### 4.2 Policies

- **A, current:** target 5, clamp 15-1440, discovery 60m, dormant 1440m.
- **A2/A3:** A with the max clamp at 720m / 480m.
- **A4:** target 3.
- **A5:** time-weighted EWMA (alpha = 0.3 x hours/6h, capped at 0.3), so a
  zero-yield poll after 15 minutes barely moves the estimate.
- **B, loss-aware:** cadence = min(A, 0.5 x horizon), horizon = 30 / burst
  bph x 60 min, burst bph = max battles in any 6h window over the trailing 14
  days / 6. B2 uses 0.75 x horizon; B3 uses a 3h window.
- **C, war-aware:** cap 120m on war days for players with a deck-delta signal
  (C), or cap 240m for everyone on war days (C2).
- **D2/D3, time-of-day:** the EWMA rate shaped by the player's trailing 14-day
  hour-of-day histogram; D2 only tightens, D3 also stretches.
- **E, reader priority:** cap 60m for the seven players this account queries.

### 4.3 Results

| policy | fetches/day | per subject/day | zero-yield share | lost | loss rate | lag p50 min | lag p90 min | staleness p50 h | p90 h | queried p50 h | queried p90 h | max fetches/h |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A current | 920 | 2.83 | 0.56 | 498 | 3.7% | 164 | 685 | 4.7 | 15.0 | 6.5 | 17.3 | 98 |
| A2 max 720m | 1,061 | 3.26 | 0.59 | 369 | 2.7% | 154 | 486 | 3.9 | 9.5 | 4.8 | 10.1 | 103 |
| A3 max 480m | 1,247 | 3.84 | 0.63 | 389 | 2.9% | 136 | 357 | 3.1 | 6.8 | 3.4 | 7.0 | 98 |
| A4 target 3 | 1,220 | 3.76 | 0.61 | 358 | 2.7% | 118 | 602 | 3.9 | 13.9 | 5.9 | 17.0 | 105 |
| A5 time-weighted EWMA | 1,496 | 4.60 | 0.70 | 359 | 2.7% | 123 | 606 | 3.1 | 13.0 | 3.1 | 16.0 | 151 |
| **B loss-aware, 6h window, 0.5** | **1,383** | **4.25** | 0.63 | **135** | **1.0%** | 100 | 306 | 3.0 | 10.0 | 5.4 | 15.1 | 96 |
| B2 loss-aware, 0.75 | 1,135 | 3.49 | 0.59 | 203 | 1.5% | 119 | 378 | 3.7 | 12.0 | 6.1 | 16.0 | 90 |
| B3 loss-aware, 3h window, 0.5 | 2,000 | 6.15 | 0.71 | 31 | 0.2% | 69 | 213 | 2.1 | 7.2 | 3.5 | 14.6 | 114 |
| B + A5 | 1,817 | 5.59 | 0.71 | 88 | 0.6% | 92 | 279 | 2.4 | 8.8 | 2.7 | 13.0 | 146 |
| C war cap 120m (deck delta) | 1,849 | 5.69 | 0.76 | 624 | 4.7% | 116 | 834 | 2.5 | 16.1 | 4.9 | 16.3 | 167 |
| C2 war cap 240m everyone | 1,459 | 4.49 | 0.69 | 436 | 3.3% | 128 | 517 | 2.6 | 11.5 | 2.6 | 13.3 | 139 |
| C + A5 | 2,235 | 6.88 | 0.78 | 351 | 2.6% | 92 | 559 | 1.8 | 12.3 | 2.0 | 14.0 | 196 |
| D2 diurnal, tighten only | 1,011 | 3.11 | 0.58 | 489 | 3.7% | 170 | 718 | 4.3 | 15.2 | 6.2 | 18.0 | 101 |
| D3 diurnal, tighten and stretch | 927 | 2.85 | 0.57 | 628 | 4.8% | 213 | 732 | 4.0 | 15.0 | 6.0 | 17.0 | 104 |
| E queried cap 60m | 1,051 | 3.23 | 0.61 | 498 | 3.7% | 162 | 680 | 4.5 | 14.9 | **0.8** | **0.9** | 102 |
| **B + E** | **1,511** | **4.65** | 0.66 | **135** | **1.0%** | 98 | 303 | 3.0 | 10.0 | **0.8** | **0.9** | 99 |
| B + E + max 720m | 1,562 | 4.81 | 0.67 | 151 | 1.1% | 97 | 304 | 2.8 | 8.0 | 0.8 | 0.9 | 111 |
| B + D2 + E | 1,589 | 4.89 | 0.67 | 137 | 1.0% | 89 | 295 | 2.8 | 10.0 | 0.8 | 0.9 | 112 |
| B + A5 + E | 1,922 | 5.91 | 0.73 | 88 | 0.6% | 92 | 278 | 2.3 | 8.6 | 0.4 | 1.0 | 148 |

Readings:

- **Tightening the clamp (A2/A3) or the target (A4) buys loss reduction
  linearly with spend** and does not touch the mechanism: the grinders still
  overflow because the EWMA still learns 30/interval.
- **B removes the mechanism.** The bound comes from battle timestamps, which
  the overflow cannot hide, so it is immune to EWMA decay. Loss 3.7% to 1.0%
  for +50% battlelog fetches. The 3h window (B3) reaches 0.2% at +117%. The
  safety factor is the dial: 0.5 costs +50%, 0.75 costs +23% for 1.5%.
- **War caps hurt under the current EWMA** (C: more fetches, more loss),
  because the extra zero-yield polls decay the estimate faster; only with
  the time-weighted EWMA does C become merely expensive. The deck-delta raise
  already exists; nothing more is warranted.
- **Time-of-day priors are a null result.** D2 changes nothing (489 vs 498
  lost) because the EWMA already encodes recency, and the version that
  replaced the EWMA with a diurnal rate (first run, not shown) produced a
  343-fetch hour: a shared prior re-creates lockstep. Not recommended.
- **Reader priority is nearly free and transforms the reader's experience:**
  +131 fetches/day for seven subjects; queried staleness p90 from 17.3h to
  0.9h. Combined with B it is the recommended shape.
- **The time-weighted EWMA (A5)** is the principled fix for zero-yield
  decay but it costs +63% on its own for a 1-point loss gain; B subsumes the
  benefit. Keep it as a follow-up only if live fetches or caps start driving
  EWMA decay in practice.

### 4.4 Cost at scale (fetches per day)

Per-subject battlelog cost from 4.3; profile cost from 3.7 (2.5/day today,
1.2/day with the 480m hot branch); clan lane per recorded clan 96
heartbeats + 48 riverrace on war days (12 training) + 1 riverracelog, and
96/day per auto-followed clan of a recorded player. Budget is 86,400/day,
bulk 77,760/day.

| scenario | battlelog A | battlelog B+E | profile now | profile 480m | clan lane | total A now | total B+E, 480m | share of bulk |
|---|---|---|---|---|---|---|---|---|
| today: 325 subjects, 10 riverrace clans, ~13 heartbeat clans | 920 | 1,511 | 810 | 390 | ~1,400 (measured) | ~3,100 | ~3,300 | 4.2% |
| 300 recorded players, 50 activity-scope clans | 850 | 1,400 | 750 | 360 | 50 x 145 + up to 200 auto-followed clans x 96 = 7,250 to 26,000 | 8,900 to 28,100 | 9,000 to 28,200 | 12-36% |
| 50 comprehensive clans (~2,250 members) | 6,400 | 10,500 | 5,600 | 2,700 | 7,250 | 19,300 | 20,500 | 26% |

The player loops are not the scaling problem. **The 15-minute clan heartbeat
for auto-followed clans is** (0.35% of budget each, one per recorded
player's clan) and it is outside this audit's scope; a 60-minute cadence for
auto-followed (not recorded) clans would remove three quarters of that line.
Enrollment of a 50-member clan is two first polls per member, 100 fetches,
throttled by the 270-per-tick bulk cap; it does not need a rule.

## 5. Plan, ranked

### 5.1 Loss-aware cadence bound (build first)

**Rule.** For `player_battlelog`, cadence = min(current target-batch cadence,
`LOSS_SAFETY` x horizon), horizon = 30 / burst_bph x 60 minutes, floor 15m.
`LOSS_SAFETY = 0.5`, `BURST_WINDOW_H = 6`, `BURST_TTL_DAYS = 14`.

**Signal.** `burst_bph` = max battles in any 6-hour window over the last 14
days / 6, computed at admission in the battlelog projector from the payload's
own battle times unioned with the subject's recorded battles in the trailing
14 days (one indexed read of `battle_participant` by player_tag, which the
projector already touches for rollups). Raise-only within the TTL: the new
value is max(payload-derived, stored if `burst_at` is inside the TTL). It is
derived from timestamps, so an overflowed poll still teaches it the truth
(30 battles in 1.8h reads as 5+ bph even when the EWMA reads 30/interval).

**Columns.** `poll_state.burst_bph numeric`, `poll_state.burst_at
timestamptz`, additive migration, expand-only. `selectEligible` already
selects the whole row; `yieldCadenceMinutes` gains the bound. Freshness
semantics unchanged: `last_admitted_at` still advances only on admission.

**Fallback.** The existing rule is the fallback (NULL `burst_bph` means the
bound is absent, so behaviour is byte-identical to today). No heat path.

**A/B.** By subject, not by time: apply the bound only where
`jitterFactor(subject_tag, 'player_battlelog') < 1` (a stable half of the
population) behind `LossBoundArm` = `off | half | all` (a template
parameter on the scheduler Lambda, PRESERVED in `parameters.mjs`). Extend
the `ab_yield` op with an `arm` split and three columns it can already
compute from `api_receipt` and `capture_audit`: `gaps` and `gap_rate`
(capture_audit joined on receipt_id), and `zero_yield_share` (receipts whose
payload_hash equals the previous receipt's for the same entity). The
same-clock-hour comparison then reads both arms in the same window, which
removes the war/training confound that made the September 5 A/B need a
full day. Promotion criterion: half-arm gap rate under 1.5% against the
control arm's rate over 72 hours, with total fetches/hour under 200.

**CloudWatch.** An EMF line from the ingest path (web-api stdout, the same
network-free channel the scheduler uses), namespace `ElixirMCP/Capture`,
metrics `BattlelogGap` (0/1 per audited poll) and `BattlelogNewBattles`, with
an `Arm` dimension. Alarm: gap rate over 3% for 6 hours. Also add
`PlannedJobs` and `BulkTokensSpent` to the scheduler's existing ledger EMF so
budget share and lockstep are on a chart, not in a probe.

**Cost.** +463 fetches/day today (1.7% of budget); per subject 4.25/day
against 2.83.

### 5.2 Reader-priority cap

**Rule.** `player_battlelog` cadence = min(cadence, `READ_CAP_MINUTES`) while
`poll_state.last_read_at` is within `READ_TTL_HOURS`. `READ_CAP_MINUTES =
60`, `READ_TTL_HOURS = 24`. Profile unaffected.

**Signal.** The MCP registry stamps `last_read_at` for the subject of any
successful call whose args resolve to a player tag (`players_*`,
`battles_*`, `elixir_coverage`, `war_current` for the caller's own player),
one `update poll_state` per call, best-effort and outside the answer path
(the audit write already sits there). Integration and REST reads count the
same way. This is the only new write from the read side and it never blocks
a read.

**Column.** `poll_state.last_read_at timestamptz`, additive.

**Cost.** ~20/day per queried subject; +131/day for this account's seven.
At 300 recorded players all read daily, +6,000/day (7.7% of bulk), which is
the ceiling worth pinning in a test.

**Proof.** `elixir_coverage.meta.source_polls.player_battlelog.freshness_seconds`
at read time, already exposed; the ab_yield extension above reports it per
arm as `read_freshness_p90_s` from `mcp_call_audit` joined to `poll_state`.

### 5.3 Profile hot branch 120m to 480m

`yieldCadenceMinutes` for endpoint `player`: 480 when activity >= 0.5 bph,
1440 otherwise, 4320 when <= 0.02, 480 when unknown (unchanged). The
pre-reset watcher and the season-roll forcing are untouched. Profile spend
2.5 to 1.2 polls per subject per day (34/hour to ~16/hour). Cohort
de-phasing continues to apply through the jitter factor. Proof: probe
`player` column and the profile row of the budget table.

### 5.4 Not recommended, with the evidence

- War-day caps (C, C2): raise loss under the current EWMA; the deck-delta
  raise from `projectRiverRace` is the right mechanism and already exists.
- Time-of-day priors (D2, D3): no loss gain; a shared prior re-creates
  lockstep.
- Time-weighted EWMA (A5): correct in principle, +63% cost alone, subsumed by
  5.1. Revisit only if zero-yield decay from live fetches shows up in the
  arm comparison.
- Filling idle budget generally: the bucket is a ToS posture. 5.2 spends on
  demonstrated reader interest only; nothing else in this plan spends because
  tokens are available.

### 5.5 Regression tests

The existing tests anchor `NOW` at 2026-09-03 12:00Z and probe synthetic
rows. Pin the production shapes observed here:

1. **Grinder:** yield_bph 3 (target-batch cadence 100m), burst_bph 16.7 (30
   battles in 1.8h, #9U9QY99RY) -> cadence 54m. Same row with burst_at 15
   days old -> 100m (TTL expired). NULL burst_bph -> 100m (fallback).
2. **Overflow teaches the bound:** a 30-entry payload spanning 1.8h admitted
   after a 6h gap yields EWMA obs 5 bph but burst_bph >= 16.7.
3. **Low-activity friend:** yield_bph 0.125 (3 battles/day, King Levy's
   shape) -> 1440m; with last_read_at 2h ago -> 60m; 25h ago -> 1440m.
4. **Reader stamp never blocks:** an MCP call against a subject with no
   poll_state row still answers; the stamp is a no-op.
5. **Profile branches:** activity 0.6 -> 480, 0.2 -> 1440, 0.01 -> 4320,
   NULL -> 480; the pre-reset forcing still wins.
6. **Budget ceiling:** with the observed activity table from 3.8 pinned as
   fixtures (p25 1.0, p50 3.4, p75 7.2, p90 15.1, p99 32 battles/day, h30
   p10 3.4h), the intended fetches/day for 1,000 synthetic subjects under
   5.1 + 5.2 + 5.3 is below 9,000, i.e. under 12% of the bulk share.
7. **Arm split is stable:** `LossBoundArm=half` applies to the same subjects
   on every tick (reuse the jitter distribution test's 400 tags and assert
   the half is 45-55%).
8. **Selection determinism:** the bound changes due-ness, never the sort
   key; the starved-first ordering test still passes with burst rows present.

## 6. Instrument to add regardless

A read-only census op `{fetch_census:{days}}` on the migrate Lambda: per
subject and endpoint, poll count, interval p50/p90 from `api_receipt`,
zero-yield share (consecutive equal payload_hash), gap count from
`capture_audit`, and for subjects in `mcp_call_audit` the battlelog age at
each read. Everything in section 3 that came from a local archive parse
would then be one Lambda invoke, and the A/B in 5.1 needs it anyway.

## 7. Decision record

- Measured 2026-09-09 13:56Z to 14:40Z, read-only throughout (Lambda census
  ops, S3 archive sync, CloudWatch reads, seven `elixir_coverage` calls).
- Implemented the same afternoon at Jamie's ask (commits b4bdb3a, c381c18;
  migration 0061; deployed 14:41Z, site docs 14:56Z). 5.1 behind
  `ELIXIR_LOSS_BOUND=half`, 5.2 and 5.3 for everyone, plus the inert
  activity_bph re-select fixed. Live acceptance: first new-code tick at
  14:42:36Z planned normally; one coverage read at 14:43:32Z produced
  `ReadCappedJobs:1` on the 14:47:36Z tick and took that player's battlelog
  freshness from 40,255 s to 27 s; zero errors in any log group.
- **Reading the A/B:** the hash arms are not balanced at baseline. Before
  the flip the control arm already held more of the grinders (09-08 gap
  rate 0.69% treated vs 2.17% control). Compare each arm with itself across
  the flip, not the two arms on one day. Promote to `all` when the treated
  arm's gap rate falls to under a third of its own pre-flip rate over 72
  hours while control's does not, with total fetches/hour under 200.
- Follow-ups outside this audit's scope: the auto-followed clan heartbeat at
  scale (4.4), the battleCount-vs-battlelog mode mismatch for
  `cr-agent-api-docs` (3.4c), and the `{fetch_census}` op (6).

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
