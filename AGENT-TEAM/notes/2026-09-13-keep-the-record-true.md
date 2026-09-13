# Keep the Record True — 2026-09-13

Preflight at 22:32Z was observation-available and mutation-eligible. Public
status reported five active collectors, 210-second fetch/admission freshness,
zero DLQ, and 96 capture gaps in 6,909 trailing-day battle-log polls.

The migrate Lambda's read-only capture census measured 96/6,909 gaps (1.39%)
across 89 subjects for one day and 206/16,771 (1.23%) across 159 subjects for
three days. The latest gap was `#VGY28ULUG` at 22:27:47Z; gaps are distributed,
not a single stalled subject. A matched 23-hour read before/after the 22:40Z
battle-log roster-gate removal measured all-arm gaps 81/3,891 (2.08%) then
88/6,644 (1.32%). Treated improved 29/2,293 (1.26%) to 20/4,145 (0.48%);
control improved 52/1,598 (3.25%) to 68/2,499 (2.72%). Post-fix battle-log
spend rose 1.72x while captured battles rose 1.37x (4.032 to 3.193 battles per
fetch): residual loss is cadence pressure, not the retired gate. Keep the
loss-bound arm at `half`; the 72-hour promotion criterion remains unmet.

Read-only clock evidence remains consistent with the policy grid: 94 anchors
across 19 clans, median observed offset +8 minutes. Direct CR reads on
`#VGY28ULUG` returned a complete 30-entry battle log with compact UTC
`battleTime`, all five card rarities, and separate evolution fields; the
current POAP KINGS river race had five standings and distinct fame (10,134)
and period points (0). No projector or war-clock defect was found.

One API-reference contradiction was real: the direct profile returned top-level
`collectionLevel: 2036`, exactly matching its `CollectionLevel` badge, while
the standalone reference still called that field a zero-valued stub. Elixir's
snapshot projector already persists the top-level field, so no service fix or
backfill is needed. `cr-agent-api-docs` commit `49ff185` corrects the player
and model references; its full docs build passed and the commit was pushed.
