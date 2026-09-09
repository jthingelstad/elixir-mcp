# Technical debt follow-through

Jamie selected the four technical-debt items from the review. This pass changes
maintenance boundaries and validation, without a schema change or collector
release. The current statistical model and existing account behavior remain.

## Changes

- `6165601`: contract 0.36.2 validates metadata at construction and after a tool
  returns. The existing `timezone_applied` field is declared. The public response
  example is generated from the contract and checked from the built HTML.
- `8cb2a80`: web API handler 2,244 → 171 lines, Dashboard 1,620 → 29 lines, and
  migrate Lambda 1,261 → 173 lines. Feature route factories take explicit shared
  helpers; account views and operations have focused modules. A one-off comparison
  against the starting HEAD preserved all 56 HTTP route bodies, 21 migration/ops
  functions, and 13 account functions, ignoring formatting and export modifiers.
- New successful UI journeys pass through the actual browser API client, session
  and CSRF resolution, route dispatch, JSON serialization, and scratch Postgres.
  They cover add player → first capture → question → connections, and create agent
  → detail → rotate key → suspend → resume. The transport is adapted in-process;
  these are not live-user acceptance events or a production sign-in test.
- `ce41b14`: CI uses `npm run verify`; workspace-specific Knip roots remove all
  38 configuration hints. Active maintenance pointers now use ENGINEERING/public
  docs. Historical archive/decision records are not rewritten.
- CI run `34294804871` exposed an implicit build dependency after consolidation:
  a clean checkout lacked contracts/dist before the site/UI tests ran. `9d9e982`
  makes the root test command build contracts first. Verified by moving the
  ignored local contracts/dist aside and running the complete gate from cold.

## Verification

- `npm run verify`: 530 tests (467 Node, 63 UI), formatting, lint and Knip pass.
  The full gate passed again with no pre-existing compiled contracts. No Knip
  hints remain. Both site builds and the merged-tree checks pass.
- Runtime through `ce41b14` deployed as contract 0.36.2; all 33 smoke checks pass.
  The migration Lambda ran the unchanged deploy path: 57 applied, zero new.
  The following commit only changes the root test prerequisite and its guide.
- Deployed `stats` operation returned HTTP 200: 53,481 battles and 62,636 players
  at the read. Public `/docs/responses/` returned 200 and its parsed JSON example
  passed `assertResponseMeta` at contract 0.36.2.
- Existing service-principal reads validated metadata and retained the earlier
  statistical agreement: 110 decided observations, .527 segment rate, eight deck
  rows and 30 card rows; 45 scored clan members, with the selected player's n=112
  and score=.194 matching personal/clan results. Empty/reversed-window checks
  also passed. These read probes are verification, not adoption evidence.
- Receipts: decks `e8b321fc-bcaa-4d49-8ffc-d40aa3d5ef88`, cards
  `0743b76b-731f-4fa8-9170-cbe040eaf923`, clan
  `2f12dd65-adb2-44bf-a5b0-e63ef506fca0`, personal
  `eb074eb7-839b-4b47-9b9f-9cb6588f3c56`, player summary
  `3516bc51-a3f3-4fda-b1e6-ff688667e33d`, performance
  `b4556f58-c02c-4ba1-a1ab-1ac8e08c116b`, current war
  `9f55a043-daf1-495b-a0ec-c8208655f4b3`.

## Next

Use natural first-answer usage and feedback to choose the next product workflow.
Expand tool-specific output checks alongside changes to those tools; common
metadata validation is not a full output schema for every tool. Keep any causal
Pilot Score estimator work separate from these descriptive-model assurances.

## CI timing follow-up

The prerequisite fix passed CI run `34294949700`. The receipt-only follow-up
run `34295032779` exposed timing assumptions in the new real-API UI tests: the
one-second default assertion deadline could expire during database work, and
the agent test clicked Suspend after observing the committed token rows but
before the rotation response re-enabled the button. The journey tests now
wait for enabled UI controls and allow bounded five-second database round trips
(with a 20-second whole-journey deadline). No retries or product-code changes.
