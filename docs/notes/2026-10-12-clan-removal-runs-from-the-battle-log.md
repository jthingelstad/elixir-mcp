# 2026-10-12 — Elixir Clan: removal runs from the battle log again

Removal Actions are raised again, on the policy's removal day, from the
days since a member's last recorded battle. This reverses the removal
hold added on 2026-10-04 (6901617c, ba4ed6d9, 4baefc84) and the
"not enforceable" switch shipped this morning (#519,
`2026-10-12-clan-removal-not-enforceable.md`). MCP and JSON API
unchanged; no migration.

## Why

The 10-04 commits required proof of no battle "in every mode" before a
removal could be raised, from profile counters read on both sides of the
quiet window. No record could supply that, so no removal (and no away
question) was ever raised, and #426 then labelled removal "not
enforceable". The DECISIONS line behind it was written by an agent and
tagged as Jamie's (commit 4baefc84). Jamie, on 2026-10-12:

- "You have the entire battle log inside of Elixir MCP."
- "Gaps in a battle log are very uncommon. … they are only happening if a
  player plays a ton, which would never trigger an idle kick action."
- "In the game, you get a idle warning when you hit seven, and seven is
  when you should be at risk of being removed from the clan."
- On the at-risk 7 and removal 10: "then 10, not adding to the 7, just 10 being
  the absolute number."
- Approved: remove the removal hold so removal Actions raise at the
  clan's threshold, make "Removal action after" an absolute day, replace
  DECISIONS line 156 with Jamie's definition and delete line 157.
- The away question follows the same clock and is asked at at-risk
  (Jamie's answer to the question, the same day).

## What changed

- **The clock** (`clan-engine/src/inactivity.mjs`): days since the latest
  of the last recorded battle, the join, or the read that saw the
  profile's battle count rise. It is held only when the player has left,
  the evidence read failed (the next run reads it again), or there is no
  battle or join to start from. Missing profile days and flat counters no
  longer hold it. `ALL_MODE_COVERAGE_CONTRACT`, `REMOVAL_ENFORCEABLE`,
  `REMOVAL_NOT_ENFORCEABLE` and `unenforceableRemovals` are gone, and
  `CARD_TYPES` has removal again.
- **The removal day is absolute.** `confirm_days` keeps its saved name and
  now means the day itself: `removalDay(policy, grace) =
  max(confirm_days, at_risk_days) + grace`. The field reads "Removal action
  at"; a save refuses a removal day before at risk; the starting value is
  14 (presets: relaxed 21, standard 14, strict 7). A saved 10 is day 10,
  where it used to be at risk plus 10. POAP KINGS is the one clan with
  removal on, so its saved 10 now raises on day 10; Ship It! and Elixir
  Kings have removal off.
- **Away** asks a member who reaches at risk whenever the clock can be read
  (`actions.mjs`), no longer only after a measured counter window.
- **Rechecks.** `removalSafety` still re-reads a removal's member when it is
  listed, opened, drafted, completed or reopened. Drafting, completing and
  reopening also re-read participation for the full judgment (409
  `removal_evidence_held` when it no longer qualifies). A view passes the
  evaluation it just used when that is under `EVALUATION_TTL_MS` old, so
  opening Manage or Actions stays one participation read. The verdict
  cache schema is 4, so cached verdicts are recomputed.
- **Words.** The headline reads "N days without a battle: at risk at A, an
  action at R." A removal that no longer qualifies says so in the list and
  on the Action. The Policy page drops the "Not yet enforceable" label and
  the can-do status of that name. The clan-chat copy for a removal stays
  as written on 10-04 (no day count).
- **`reconcile_removal`** (migrate `clan_maintenance`) withdraws a pending
  removal that the record no longer supports (the clock cannot be read, or
  the member is not past the removal day) and refuses one that still
  qualifies.
- **DECISIONS:** the two lines are now one, in Jamie's words.
- Docs: `clan-policy.md`, `clan-actions.md`, `standing.md`; the clan-engine
  guide.

## After deploy

The next evaluation of a clan with removal on can raise removal Actions
for members past its removal day (plus grace), leaving out leaders,
co-leaders, Elders unless the policy includes them, and anyone on a hold
or away. They go to the clan's Discord when its Actions are connected
there, as other Actions do.
