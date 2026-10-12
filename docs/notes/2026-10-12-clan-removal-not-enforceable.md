# 2026-10-12 — Elixir Clan: removal is not enforceable, and says so (#426)

MCP and JSON API unchanged (nothing in `packages/contracts` moves). No
migration.

## Why

The removal clock could never fire, and the screens did not say so.
`inactivityEvidence` (`clan-engine/src/inactivity.mjs`) returns status
`held` on every path, because no recorded source proves that a member
played no battle in every mode: the battle log does not carry every mode,
and a flat profile counter is not proof of absence. So `removalJudgment`
in `evaluate.mjs` is never `ready`, `actionable.removal` is never true,
and the service's `removalSafety` refuses every removal copy, draft and
completion as `removal_evidence_held`. A clan could still switch on
**Suggest removals**, set its days, and wait for an Action that would
never come, and a removal card raised before the evidence rule (#426)
sat open as "held" with nothing that would ever close it.

## What changed

- **One switch for enforceability.** `ALL_MODE_COVERAGE_CONTRACT` in
  `inactivity.mjs` is `null`: no named contract proves all-mode absence.
  `REMOVAL_ENFORCEABLE` follows it and `actionable.removal` requires it,
  so naming a contract is the one-line change that turns removal back on
  (it still has to pass `inactivityEvidence`). Building that contract is
  Jamie's product call, asked on #426.
- **No removal card is raised.** `CARD_TYPES` is promotion and demotion;
  the clock stays a Standing fact (Board's inactivity triage).
- **Open removal cards are withdrawn with an audit row.** Jamie chose
  this up front (2026-10-12, over leaving them open or closing them
  silently). `unenforceableRemovals` names every proposed removal card;
  `evaluateClan` withdraws each through `withdrawAction` with reason
  `REMOVAL_NOT_ENFORCEABLE` and rule `removal_not_enforceable`, before
  the cached check, so it runs on the next leader read, the morning run
  and clans below ten members alike. Number, evidence, log and earlier
  decisions stay; none vanishes. One-line reversible: return `[]` from
  `unenforceableRemovals`.
- **Policy page.** The Inactivity tab carries the notice **Not yet
  enforceable** with why, on or off; its switch and numbers stay
  editable. A saved policy shows **What this policy can do today**
  (`policyCapabilities`, new in `clan-engine/src/capabilities.mjs`, served
  as `can_do` on the policy view): each judgment as live, needs more
  evidence (and what), not enforceable, or off. The preview names a
  member past the threshold "removal not enforceable".
- **Removal cards still open until the next evaluation** read "Removal is
  not enforceable" (Actions list and detail); `requireRemovalSafety` is
  unchanged, so nothing about them can be completed, copied or drafted.
- Docs: `clan-policy.md` (new sections on the label and the box),
  `clan-actions.md` (the clock), `standing.md`. DECISIONS Clan line.

## Tests

- Engine: `#426: removal is never actionable until a named all-mode
  coverage contract exists`; reconcile no longer raises or withdraws
  removals; `capabilities.test.mjs`.
- Clan service: an open removal is withdrawn with its log line and not
  raised again; a member over every threshold raises no removal Action,
  fresh or cached. `removal-safety.test.mjs` "fresh evaluation withdraws
  unsafe pending removal" now expects the not-enforceable reason in place
  of the counter-bracket one: the card is withdrawn earlier, by the new
  rule.
- clan-web: the Inactivity label, editable numbers and the can-do box.
- Playwright `clan/removal-safety.spec.ts`: the Policy page label and box
  at each size, with axe.
