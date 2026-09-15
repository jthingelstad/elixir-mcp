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
