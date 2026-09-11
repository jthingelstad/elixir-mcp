# Close the Loop — 2026-09-10

## Preflight and evidence

- Preflight passed on clean, synchronized `main` at `b93d1ef`; the loop lease
  was free and was acquired only before the first edit.
- Public health was current: the DLQ and job queue were empty, three collectors
  were active, no scheduler work was starved, and the last admission was under
  four minutes old throughout measurement.
- The one-day audit contained 793 calls across Discord, MCP, elixir-bot, web
  and REST, with no truncated results. Refusals were bounded input and
  availability paths, not internal failures.
- The Friday weekly synthesis was not due on Wednesday.

## Feedback triage

- **29, data quality:** reproduced against the live Clash Royale API. A clan's
  `fame` can be zero while its members have points because the API's
  `periodPoints` is the current day's score and `fame` is banked at the day
  close. The canonical API reference already documented the distinction; this
  service had discarded `periodPoints` and its answer did not explain it.
- **30, feature plus praise:** the requested per-day indices had already
  shipped as `war_days` in 1.0.0. The remaining gap was real: an exact closed
  week required one `war_history` call per member.
- **31, data quality:** the reported 13.2-hour profile age was allowed by the
  yield schedule, and the coverage answer described but did not quantify the
  unmeasured tail. Directly tracked players are a small, explicit cohort and
  warrant an eight-hour profile cap; incidental clan-wide members retain the
  cheaper yield cadence.

## Change

Contract 1.2.0 keeps current-day `period_points` separately from banked fame,
adds exact `season_id` plus `section_index` all-member reads to `war_history`,
adds `unmeasured_tail_hours` to coverage, caps directly tracked profiles at
eight hours, and includes `request_id` in the operator feedback queue. The
contract changelog, product update and public methodology pages move with it.

## Verification and closure

- `npm run verify` passed, including the clean static-site merge, all workspace
  tests, the migration ladder and a freshly regenerated schema fingerprint.
- Commit `5340006` was pushed to `origin/main`. The production deploy reached
  `UPDATE_COMPLETE`, migration 0067 reported `applied: 66, ran: 1`, the
  CloudFront invalidation completed, and all 40 deploy smoke checks passed.
- Live contract 1.2.0 acceptance returned one exact closed week with 57
  identified member rows, and coverage returned both `measured_hours` and a
  numeric `unmeasured_tail_hours`.
- A fresh live race read at 00:07:23Z returned POAP KINGS with `fame: 0` and
  `period_points: 5875`, proving the reported distinction on the shipped code.
- Feedback 29, 30 and 31 were each answered as `done`, linked to 1.2.0 and the
  affected tools. A final queue read returned zero pending items.
