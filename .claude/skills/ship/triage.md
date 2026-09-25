# Acceptance triage

Every failure from a deploy's acceptance run (or `npm run acceptance`) gets
exactly one verdict, and the ship's NOTES entry lists them. The suite is
how 9.1.0 found a note still naming a removed field (2026-09-25): a run
with a failure nobody triaged is a gate nobody kept.

| the failure                                                                         | the verdict                                                                      | where it is written                                                                              | precedent                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the product answers wrong                                                           | fix forward: a new patch through `/ship`                                         | the code, the contract version                                                                   | 9.1.0's war trophies note named a field the seasons shape does not serve; 9.1.1 fixed it the same day                                                      |
| a decision changed what a Gym case asserts                                          | amend the case; the reason names the decision and its date                       | `acceptance/gym.json`, the case's `amended` field                                                | 141.3 and 200.2 at 9.1.0                                                                                                                                   |
| a decision removed what a Gym case tests                                            | refute it with the decision; `/gym` prunes it once the field is gone             | `acceptance/gym.json`, the case's `refuted` field                                                | 15 cases on the removed war-day fields at 9.0.1                                                                                                            |
| a note or doc names a real field only some responses carry                          | allow the token, with its reason                                                 | `acceptance/catalogue-allow.json`, under the tool, `"*"` (every tool) or `"docs"`                | `account_role_changed` and `decks_observed` at 9.1.0                                                                                                       |
| a failure filed for a decision rather than a fix                                    | a known entry with a current reason and an expiry                                | `acceptance/known.json`: `case`, `reason`, `until`, `filed`                                      | 342.1 and 342.3, kept at 9.1.1 with a corrected reason                                                                                                     |
| a suspected flake (a budget read under load, a poll landing between two calls)      | re-run it alone before calling it one                                            | `node acceptance/run.mjs --only <suite/id>`                                                      | 9.0.1's `budgets/clans_participation`: 13,844 ms cold against 8,000, then 969, 778 and 768 ms alone                                                        |
| `result_too_large` on a catalogue seed                                              | re-seed it smaller, keeping its `reason`                                         | `acceptance/catalogue-seed.json`                                                                 | at 9.1.0 `form` took the ten-battle `battles_query` timezone seed past the cap; it went to `limit: 5`                                                      |
| a catalogue set the current contract refuses                                        | refresh the catalogue, and commit the diff as a reviewed change                  | `AWS_PROFILE=cloud-engineer node acceptance/catalogue.mjs --refresh` writes `catalogue.json`     | `acceptance/README.md`: "Sets the current contract refuses are listed and dropped at refresh"                                                              |

## Why each verdict is what it is

- **Fix forward.** The code is live when acceptance runs; a red case means
  "fix forward now, not walk away" (`AGENT-TEAM/WORKFLOW.md`).
- **Amend.** A case that asserts a retired rule makes the gate enforce the
  old decision. The amended case must still fail on its bite
  (`acceptance/bites.test.mjs`, under verify): "A rule that passes on
  known-bad history is decoration" (`acceptance/README.md`).
- **Allow.** The catalogue rule checks that every field a note or docs
  section names appears on some response this run; a real field that is
  rare can be absent from one run without being wrong.
- **Known.** "failures filed for a decision rather than a fix: a reason and
  an expiry; reported as KNOWN and not counted until the date passes"
  (`acceptance/README.md`). An expired entry counts again, which is the
  point. A known entry for a failure you can fix hides a regression.
- **Re-run alone.** A flake is shown, not assumed; the suite runs one call
  at a time so its timings are honest, and a failure that repeats alone is
  a regression.
- **Re-seed.** The 48,000-character cap (`MCP_RESULT_MAX_CHARS` in
  `services/mcp/src/protocol.mjs`) is priced by design: "a priced
  `result_too_large` is an answer, not a defect" (DECISIONS), and a lower
  full-verbosity page limit is a declined idea. So the seed changes, never
  the cap or the tool. Keep a seed that is the only witness of a field:
  the 9.1.0 timezone seed is the only call carrying `battle_time_local`,
  and three docs checks fell with it.

## Two rules with no exception

- **Never delete a control case.** Every finding keeps one (`control:
  true`); `acceptance/acceptance.test.mjs` rejects a finding without one at
  load.
- **Triage edits are local files.** Verify, commit, push, then re-run the
  cases with `--only` or `--family`; they need no deploy of their own. The
  next deploy refuses the worktree until they are committed.
