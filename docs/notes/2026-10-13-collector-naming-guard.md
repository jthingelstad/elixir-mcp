# 2026-10-13 — Naming a collector release checks the deployed minimum

The review of #582 found that a maintainer could name a signed release
below the new enforced minimum. The fleet would install it, then lose
work at lease and submit. #583 follows up before #418 is closed.

`name-collector-release.mjs` now checks the stable deployed collector
revision, its immutable S3 source version and the minimum in that code,
not the local checkout. A below-minimum candidate is refused before the
first release-ledger write while enforcement is on. Both dry runs and
real namings make this read. A real naming holds the production lock
through the guard, all platform writes and GitHub promotion. It verifies
the cloud-engineer identity and makes each AWS call without retries.
Partial platform failures keep their existing reporting and suppress
promotion; Lambda FunctionError also counts as failure.

Ten focused tests cover the script repository's lock regardless of the
caller's directory, no effects before a successful guard, numeric
minimum acceptance, dry runs, disabled enforcement's existing behavior,
wrong identity, held locks, failure cleanup, an unstable stack, a changed
serving revision or an endpoint update in progress, missing or mismatched immutable source versions, and
missing, malformed or ambiguous minimum literals. Read-only dry runs
against production refuse v3.0.5 and accept v3.0.6; they name no release.

No new product default: the guard enforces DECISIONS, "The collector
minimum is 3.0.6", and the existing enforcement switch. MCP 11.13.0,
JSON API 3.2.0 and the collector contract are unchanged. This is host
operator tooling, not a runtime or tool change; MCP acceptance is not
requested for its deploy.
