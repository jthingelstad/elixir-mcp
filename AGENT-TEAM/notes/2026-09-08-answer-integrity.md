# Answer integrity shipped

Jamie requested the answer-correctness fixes from the interactive review.
Runtime commit: `a017abf`. Contract: `0.35.0`. Migration: `0057`.

## Verification

- Four regressions failed on the original implementation before fixes.
- Final `npm run verify`: 505 tests passed (452 Node, 53 UI), format,
  lint and Knip passed. Lambda bundles and merged site build passed.
- GitHub validate passed for `a017abf` (run `34288312773`). Issue #38
  was closed after its source-freshness behavior was verified live.
- Deployment completed with all 33 smoke checks passing; migrate reported
  56 previously applied migrations and one applied in this release.
- Authenticated live reads through the existing Discord principal:
  - A closed window for `#20JJJ2CCRU` returned the same 243 battles in ordinary,
    weekly and mode summaries, win rate 0.541. Request
    `27bd88bf-ca0e-4d01-98b0-afbf37e4387f`.
  - The profile source was observed at 22:37:40Z and battlelog source at
    15:32:38Z on September 8. The mixed response exposes both, with aggregate
    freshness following the older source. Request
    `8f2b7279-b00c-4232-ad6e-567055e10e91`.
  - Coverage reported two measured observation intervals (1/1 and 3/3
    captured), decimal-text average `1.000`, and unknown daily attribution.
    Request `d58b9779-1b8e-456f-87f0-a11d39f8ac1c`.
  - `war_current` for `#J2RGCRVG` returned period 1, a current-race observation
    at 21:37:38Z, and `nominal_period_elapsed: false`. Request
    `3819f83f-882e-45bb-bf20-3c6280f7dd1e`.
  - A full 25-battle request exceeded the delivery limit and returned valid
    JSON, `isError: true`, `bad_request`, and request ID
    `79b5169f-0d7e-4bf6-a5e9-38b23ba7faa7`.
- Public tools.json reports 0.35.0; response and methodology docs are live.
- Post-deploy public status was healthy with no DLQ messages. Ten possible
  capture-gap flags remained across 847 audited polls; this release corrects
  answer representation and does not claim to resolve those capture flags.

The >2,000-battle case, multi-day profiles, late arrivals, missing timestamps,
counter incompatibility, and war-period transition were tested in scratch
PostgreSQL. Live checks used existing records and read tools only.

## Follow-on priorities

1. Make first-answer onboarding coverage-aware and validate personal-progress,
   clan-operations and Drop workflows end to end.
2. Extract web API route groups and migration operations in small,
   behavior-preserving changes; add successful UI journeys alongside existing
   crash-containment tests.
3. Evaluate the designed within-player statistical estimators as separate
   product work. Current methodology now accurately describes pooled/shrunk
   rates and Pilot Score's limits.
