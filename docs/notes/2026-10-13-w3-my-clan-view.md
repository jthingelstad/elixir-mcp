# 2026-10-13 — Agents: `clans_my_view`, a person's own view of their clan (#535)

Builds sections 3 and 4 of `docs/notes/2026-10-12-w2-agent-clan-seam.md`
under Jamie's two rulings on #535. MCP 11.12.0 (a minor: one new tool).
JSON API 3.2.0 unchanged; no `/api/v1` route (agents read MCP). No
migration.

## What changed

- **`clans_my_view`**, a person-only tool (`PERSON_ONLY_TOOLS`), in
  `packages/tools/src/tools/clan-context.mjs` beside `clans_context`.
  For the person's verified player in one tracked clan: the policy
  summary, their own standing line, and the Actions waiting for them as
  summary lines with a `url`. Optional `clan_tag`; with none, the
  primary's clan through the shared resolver (`entitledClan`).
- **The reader** is `readOwnClanView` in `packages/auth/src/clan-context.mjs`,
  beside `readAgentPolicyContext`. One SQL statement authorizes and
  reads: the person's verified self claims with open membership in the
  clan, then (only when one exists) the policy pointer and version, the
  clan size, the verdict snapshot and the clan's open Actions from
  `clan_state`. No file under `packages/tools/src` or `services/mcp/src`
  names `clan_state` or imports a Clan package.
- **One shaping, two callers.** `packages/clan-engine/src/own-view.mjs`
  holds `effectivePolicyValues`, `policySummaryOf`, `ownStandingLine` and
  `actionsWaitingFor`. Clan's `policyFor`, `policySummary` and
  `memberView` call the first three, so the agent's standing line is the
  code that draws Clan's own "You here" line. `packages/auth` gains the
  pure `@elixir-mcp/clan-engine` dependency.
- **Boundary proof.** `clan-boundary.test.mjs` also asserts the one file
  allowed to import the seam exports exactly `clans_context` and
  `clans_my_view`; `principal-surface.test.mjs` asserts an agent and an
  integration neither list nor call it.

## Product questions and the answers taken

1. **Which principal reads?** [Jamie, 2026-10-12, #535] The person's own
   `/mcp` connection, always on: no per-connection switch, no scope,
   never an owned agent. So the note's grant (section 2's table, console
   switch and migration) is not built. An agent or an integration is
   refused by the door (the tool is hidden from both) and again by the
   handler, `not_entitled`, saying the view is a person's own.
2. **An unverified claim?** [Jamie, 2026-10-12, #535] A verified claim is
   required; an unverified claimant's connection gets nothing from the
   read for that player. A tag has one verified claim
   (`claim_one_verified_per_tag`), and since #556 it is exclusive, so in
   the three pre-existing collisions the verifier reads its view and
   every unverified claimant is refused.
3. **Removal Actions.** [engineering, the note's default] Never shown,
   to anyone, including a leader who would decide one, and including one
   whose subject is the person; no `removal_safety`; the Actions `count`
   is the length of the list shown. A leader's or co-leader's answer
   always carries the note that some Actions are shown only in Clan, so
   the note says nothing about whether one exists. Whether a leader's own
   connection should see the removal Actions waiting for them is still
   open with Jamie on #535.
4. **What an Action carries.** [engineering] The summary line Clan's list
   shows: `number`, `type`, `label`, `subject_name`, `raised_at`, `url`.
   No evidence, log, comments, words, drafts or deciding.
5. **Only the three things.** [engineering] No hold, away or awards; no
   `you` week-by-week block (those are record facts the agent reads with
   `clans_participation`); no other member's line, row, clock or note.
6. **Snapshot, never live.** [engineering] The standing line and the
   Actions come from Clan's saved verdict snapshot, only when its
   `policy_version` is the current policy's and it holds the acting
   player's verdict; otherwise both are null with `reason:
   "not_evaluated"`. Below ten members `too_few_members`; no saved policy
   `no_policy`; the policy summary is always given. The read never
   evaluates, numbers an Action or writes: an unnumbered Action carries
   `number: null` and a `url` to Clan's Actions list.
7. **Two verified players in one clan.** [engineering] The read acts as
   the one with the higher in-game role (Clan's `clansOf` order among
   verified claims), then the primary, then the tag.
8. **A clan named but not tracked.** [engineering] `not_recorded`, the
   shared resolver's refusal; a clan the person has no verified player in
   is `not_entitled`.

## Where the build differs from the design note, and why

- **No grant, no migration.** Ruling 1 removed it.
- **One statement, not a repeatable-read transaction.** The note asked
  that authorization and projection share one snapshot, by one statement
  or by a read-only repeatable-read transaction. The reader is one
  statement (as `readAgentPolicyContext` is), so a membership or claim
  change between check and read cannot mix two states, and there is no
  transaction whose revocation a test could interleave. The test instead
  asserts the private rows are not read at all for a refused caller.
- **`clan_tag` resolution** uses the tools' shared `entitledClan` (the
  primary's clan; a named clan must be actively recorded), so the
  refusals are the ones every clan tool gives.

## Tests

- `packages/clan-engine/test/own-view.test.mjs`: the shaping. A member
  sees only their own Action; a removal's subject never sees it; a leader
  and a co-leader see no removal; an unnumbered Action has `number: null`;
  the standing line carries no other member.
- `services/migrate/test/clan-my-view.test.mjs` (scratch Postgres, through
  the registry so the output schema validates): a fixture clan with a
  removal Action, a hold, a note and private canaries. A member's and a
  leader's views carry none of them and no other member's tag or name,
  `count` is the list's length, `clan_state` is byte-identical after the
  read, and no Action is numbered. Refusals: agent, integration,
  unverified claimant, no claim in the clan, another clan, a former
  member, a watched claim, a disabled account, an untracked clan. The
  three reasons, a verified player missing from the snapshot, and two
  verified players acting as the higher role.

## Acceptance

The acceptance principal is an agent, which never sees this tool. The
`contracts` suite gains `clans-my-view-agent-refused` (an agent's call is
refused and carries no `view`), with a bite: a constructed capture of the
tool answering an agent with a view, which the case must fail. The
catalogue never derives sets for it (`PRIVATE_TO_THE_CALLER`). The output
schema is the shape check.
