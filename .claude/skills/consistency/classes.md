# Drift classes

Every finding gets one class. Each class names its usual fix and the guard
that stops it recurring. A class with a mechanical guard gets the guard in
the round that found it. The examples are from the 2026-09-25 sweep
(contract 9.0.1 → 9.1.0).

## unrealized

A DECISIONS line holds in some surfaces and not others. The most common
class, and the reason this skill exists.

- Example: war facts went weekly-only in the war tools while the timeline
  entries still built per-day deck counts and ingest still carried decks
  back a day. Boat defenses were excluded from `clans_standings` only.
- Fix: realize it on every surface in the decision's `facets.md` row.
- Guard: a test that asserts the decision on the second derivation (mail
  builder, timeline entry, console) as well as the tool; an acceptance
  case comparing two tools that compute the same fact.

## contradicted

Two surfaces, or two ledger lines, say opposite things.

- Example: DECISIONS said "RDS stays db.t4g.micro (settled)" and, lower
  down, "the database is db.t4g.small"; the ledger said acceptance was the
  release gate while ENGINEERING said opt-in per deploy.
- Fix: a surface contradicting the ledger is a defect; two ledger lines
  contradicting each other is a product call for Jamie.
- Guard: usually none mechanical; the ledger line gets rewritten so one
  statement stands.

## unenforced

A rule is stated and nothing carries it out.

- Example: "deploy from a clean worktree" while `deploy.mjs` built
  whatever was on disk; the migration lock rules with no lint (0152 and
  0169 broke them); "the full audit gates a release" with nothing running
  the audit.
- Fix: make something carry it out, or rewrite the rule to what is true.
- Guard: this class IS the guard's absence. It closes with a test, a
  script check or a runbook step that a person or agent actually runs.
  Examples: `deploy.mjs` refuses a dirty tree;
  `services/migrate/test/migration-rules.test.mjs`.

## schema-drift

A response carries a field its outputSchema, docs or notes do not declare,
or they declare one it does not serve.

- Example: `battles_query` deck cards served `evolutionLevel` while the
  docs and the tool's own note promised `form`; notes still naming
  `clan_score` after the alias went; `current_streak` declared a scalar
  while an object was served.
- Fix: the code and the declaration agree; notes name only fields served.
- Guard: the registry validates outputs in tests; acceptance
  `notesNameFields` and the catalogue docs check run live.

## api-parity

A JSON API operation and the MCP tool it mirrors disagree, or an MCP
patch is a JSON API major.

- Example: OpenAPI `weeks` max 12 while the tool refused past 8; a
  duplicated `operationId`; a person route that did not enforce its
  tool's scope (a read grant could add players).
- Fix: the operation follows ordinary semver; `info.version` moves.
- Guard: `services/web-api/test/integration-pin.test.mjs` (structural
  fingerprint against the version); a test per scope-bearing route.

## brief-drift

The initialize brief or the conventions it states disagree with the
registry.

- Example: the brief listed six segment tools while `cards_card` was a
  seventh; "season on every windowed tool" while `elixir_timeline`
  refused it.
- Fix: correct the brief, or the tool, to the stated convention.
- Guard: `services/mcp/test/tool-conventions.test.mjs` (the brief names
  every segment tool derived from the registry; `season` wherever `from`).

## stale-pointer

A file, runbook, skill or comment points at something moved, renamed or
superseded.

- Example: ENGINEERING and the objective files sent agents to NOTES.md
  for ratified decisions; a runtime string sent operators to a deleted
  OPERATORS.md; comments citing `docs/REVIEW-*.md` after the move to
  `docs/reviews/`.
- Fix: repoint; when the pointer is in a checksum-immutable migration,
  add the old-to-new row to `docs/archive/README.md` instead.
- Guard: `services/mcp/test/docs-pointers.test.mjs` for `docsRef()`; a
  grep for the old path in the round that moves a file.

## retired-plumbing

A runbook, doc or skill describes machinery that is gone.

- Example: "all four DLQs" and "redrive the receipts" after the outbox
  moved to S3 notifications; "email-relay is the only egress" after the
  editor also egressed; a skill using the `jamie` profile.
- Fix: rewrite to the current plumbing in `infra/template.yaml`.
- Guard: none mechanical; the runbook row in `facets.md` is walked on
  every sweep.

## dead-artifact

A script, migrate op, test, fixture, doc or schema object that no longer
serves anything, or still runs a retired design.

- Example: `provision-gateway.mjs` and the `gateway_provision` op minting
  IAM keys after zero-trust; `{training_backfill}` writing the per-day
  rows the weekly decision retired; the `staging` schema from a finished
  import; untracked elixir-family files.
- Fix: grep for pointers, repoint, then remove (tracked) or commit then
  prune (untracked). Schema objects go through expand-and-contract, and
  deleting production rows is Jamie's call.
- Guard: knip for code; a migrate op not named by a runbook, skill,
  script or CI is a removal candidate on the next sweep.

## deferred-promise

"Removed in the next major", "until X", "queued": a promise with no
trigger that will never fire.

- Example: the `clan_score` aliases promised for 7.0.0 and still served
  at 9.0.1, because majors became rare once removals were patches.
- Fix: do it now under the current rule, or rewrite the promise with a
  date.
- Guard: `known.json` entries carry an expiry; a retired-names test bans
  the name once removed.

## consumer-drift

A connected repo reads a field, door or behavior the hub no longer has,
or describes the hub wrongly.

- Example: Drop signing in on the MCP door while being a program; the
  Discord preview never reading `timeline_more`, so busy windows lost
  items; elixir-bot pinning contract 6.
- Fix: in that repo, under its rules and lease, after the hub change it
  needs is live.
- Guard: that repo's own tests against a fixture of the hub's current
  shape.

## privacy-promise

What privacy.md, connections.md or email.md promise differs from what the
code sends, keeps or deletes.

- Example: the email address released to any OAuth client with consent
  while the docs said "never shown to an MCP client"; session IPs kept
  past the stated 30 days; analytics paths carrying record ids.
- Fix: the code meets the promise, or Jamie changes the promise.
- Guard: a test on the route or job that enforces the promise
  (`apps/web/test/analytics.test.js` for path masking).
