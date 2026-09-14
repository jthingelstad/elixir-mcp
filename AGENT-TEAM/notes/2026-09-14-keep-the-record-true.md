# Keep the Record True — 2026-09-14

Preflight at 10:32Z was observation-available and mutation-eligible. The
public reader was healthy: five collectors, 165-second fetch/admission
freshness, zero DLQ messages, 3,253 battles in the prior hour, and 106 gaps in
7,203 trailing-day capture-audit polls.

The private, read-only capture census measured 106/7,203 gaps (1.47%) across
one day and 249/16,386 (1.52%) across three days. The gaps are distributed
across 184 subjects, so this remains cadence pressure rather than one stalled
subject. The 35-hour same-clock comparison retained the prior fixed starts:
treated gaps improved from 37/4,153 (0.89%) before the roster-gate removal to
28/6,269 (0.45%) after it; control moved from 83/2,537 (3.27%) to
104/3,492 (2.98%). The post-fix window is only 35 of the required 72 hours,
and its total fetch spend is 18,125/35 hours, above the ratified 200/hour
guardrail. Keep `ELIXIR_LOSS_BOUND=half`; no cadence or deployment change is
justified before the 72-hour, balanced-arm decision.

The live record remains semantically consistent. The 7-day projection census
has populated season 136 war days 1–4 plus honestly null training rows; the
war-anchor reader reported 112 anchors across 23 clans, median +8 minutes from
the 10:00Z policy grid (an upper bound because it includes polling latency).
Direct, read-only API reads for `#VGY28ULUG` returned a 30-entry log with
compact UTC battle stamps, all five rarities, and separate evolution fields;
its top-level `collectionLevel: 2036` still matches the `CollectionLevel`
badge's `progress`. POAP KINGS' current river race returned five standings,
period index 7, and distinct clan fame/period-points fields. No new API drift,
projection defect, migration, backfill, or cr-agent-api-docs change was found.

Next check: after 2026-09-15T22:40:27Z, repeat the same `ab_yield` comparison
with the fixed starts over a complete 72-hour post-fix window; evaluate both
the treated-arm loss criterion and the 200/hour guardrail before any promotion.
