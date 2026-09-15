# Keep the Record True — 2026-09-15 morning

Preflight at 10:32Z was observation-available and mutation-eligible on clean
`0feb314`. The public reader reported five collectors, 2-second fetch and
admission freshness, an empty DLQ, 2,948 battles in the prior hour, and 97 /
7,087 capture-audit gaps. The first private one-day census agreed at 98 /
7,088; gaps remain distributed rather than concentrated in one stalled subject.

The fixed-start 72-hour comparison is not complete until 22:40:27Z. In the
partial read, the post-fix treated arm was 41 / 11,447 (0.36%) versus control
197 / 5,652 (3.49%); the pre-fix arms were 63 / 11,493 (0.55%) and 207 /
6,433 (3.22%). The post-fix window has 32,037 total fetches over roughly 72
observed hours, about 534/hour, still above the ratified 200/hour guardrail.
Keep `ELIXIR_LOSS_BOUND=half`; no cadence promotion or deploy is justified
before the complete window and both policy checks pass.

Direct, read-only CR API samples remain compatible with the standalone
reference: `#VGY28ULUG` returned a 30-entry battle log with compact UTC times
and played evolution values 1 and 2; its `collectionLevel` and CollectionLevel
badge progress both read 2041. `#J2RGCRVG` returned a five-clan training race
(section 1, period 8) with distinct fame and period-points fields. The private
war reader measured 119 anchors across 27 clans with the existing
latency-inclusive +8 minute median offset from the 10:00Z policy grid. No live
API drift, clock contradiction, or source-level record defect was found.

Additional private projection/capture readers were not retried after the
migrate Lambda returned `ReservedFunctionConcurrentInvocationLimitExceeded`.
This was a read-path capacity limit, not evidence of a data mismatch; preserve
the prior zero deck census and re-read it on the next eligible run rather than
competing with active invocations. Reviewed source through `0feb314`, including
contract 3.2.0–3.3.0 and the recent record decisions. No migration, backfill,
runtime change, deploy, or CR-reference update is due.

## 2026-09-15 22:41Z — Complete loss-bound comparison retains `half`

Preflight remained observation-available and mutation-eligible on clean
`5b74ccf`. The public status reader was healthy (five collectors, 2-second
fetch/admission freshness, zero DLQ, 1,068 battles in the prior hour) and the
private one-day capture census measured 106 gaps in 7,100 polls, distributed
across subjects rather than a stalled poll state. The read-only deck census was
all zero for participants without a deck or played rows, collection rows without
a catalog card, and stub cards (163,728 decks and 4,468,978 played rows).

The fixed 72-hour `{ab_yield}` comparison, starting at
2026-09-11T22:40:27Z and 2026-09-12T22:40:27Z, now completes. The treated
arm's capture-gap rate improved from 63/11,493 (0.55%) to 45/14,078 (0.32%),
while control moved from 207/6,433 (3.22%) to 242/6,823 (3.55%). That satisfies
the balanced-arm loss signal, but the post-fix window spent 38,644 fetches in
72 hours (about 537/hour), above the ratified 200/hour guardrail. Keep
`ELIXIR_LOSS_BOUND=half`; a cadence promotion would spend too much budget.

The calendar and live API continue to agree: the canonical clock and a direct
current-race read both reported season 136, section 1, training, period 8.
The war-drift census remains latency-inclusive (129 anchors across 27 clans;
median +18 minutes), so it is not a claim of game-clock drift. A direct 30-entry
battle-log sample retained compact UTC timestamps and played evolution values;
the profile's `collectionLevel` matched its CollectionLevel badge at 2,042.
No projection defect, migration, backfill, deploy, or CR API-reference update
was due. Read-only evidence only; no runtime source changed.
