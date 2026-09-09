# Statistical alignment: verification receipts

Jamie selected the statistical/documentation alignment group. Contract 0.36.0
corrects the descriptive readers and publishes their limitations; it does not
implement the deferred within-player estimators. No migration is required.

## Reproductions and checks

- Scratch PostgreSQL reproduced three failures before the fixes: a 1-win,
  1-loss, 1-draw, 1-unresolved sample reported 4 decided observations; card meta
  accepted a reversed window; personal scoring read zero qualifying records
  where clan scoring read 55 from the ingest-stamped level column.
- Both Pilot readers now call the same population query. Additional regressions
  reject partial multiplayer/same-side observations and check equal personal
  and clan n, raw rate, expected rate, score and legacy standard-error values.
- Tests cover empty samples, empty card arrays, denominator and shrinkage
  arithmetic, a counterexample to guaranteed shrinkage rankings, even-sized
  cohort medians, and the previously undeclared include_curve option.
- `npm run verify`: 524 tests passed (463 Node, 61 UI); formatting, lint and Knip
  passed. Both site builds and the merged tree passed as part of that gate.
  Lambda bundles also built successfully.
- Built-document tests compare the published floor table to the reader's
  method declarations and check uncertainty/baseline disclosures.
- Inspected the rendered methodology in the in-app browser at
  http://127.0.0.1:4330/docs/methodology/: formula, generated 200/30/20 table,
  NIST link, uncertainty explanation and rolling-baseline limitations rendered
  correctly. Local preview stripped scripts, so this check sent no analytics
  or session requests. No application UI behavior was changed.

## Acceptance and remaining work

Production checks use the existing service principal and read/refusal paths
only. They are verification calls, not evidence of member adoption or answer
usefulness. The standard_error field remains a compatibility approximation;
calibrated uncertainty and within-player lift still require separate estimator
design and validation. Current product semantics live in the public methodology.

## Production verification and precision follow-up

- Runtime commit `9ee4a61` deployed with all 33 smoke checks passing and green
  CI run `34293821252`.
- Existing service-principal reads verified 110 decided observations and a
  reported .527 segment rate for a closed player window, across eight deck
  rows and 30 returned card rows. Empty future samples returned null; reversed
  windows returned bad_request. Clan scoring returned 45 members; the compared
  member had n=112 and score=.194 in both personal and clan responses.
- Receipts: deck `ec08b4a5-cf68-49c7-9716-b701d8e93e5e`, card
  `8cc2febd-0158-4b02-ba77-39e27de9a81e`, clan
  `b9a6ba0d-c151-42d8-8753-42d9010b816d`, personal
  `a42f6e7e-68ec-4385-abb5-89d303d74edc`.
- A strict probe recomputing shrinkage from the displayed .527 mean differed
  by .001 from the correctly computed result: calculations use full precision,
  then round output fields independently. The probe now uses the mathematically
  bounded output-rounding tolerance (not a wider estimator tolerance). Contract
  0.36.1 clarifies this in both tool notes and the methodology without changing
  arithmetic. A regression pins 0/6 shrunk toward 58/110 as .406, not .405.
