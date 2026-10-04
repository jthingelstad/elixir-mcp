# Issue 283: core policy context draft

Status: implementation draft, not deployed. [Canonical issue](https://github.com/jthingelstad/elixir-mcp/issues/283).
Priority remains season readiness, policy connection, then Ladder/invitation.

## This slice

Add `war_intent` to the versioned policy: unknown, participating, or
not_participating. Missing legacy values default to unknown without rewriting
records. Leaders/co-leaders use the existing optimistic-version save; scoring,
minimums, awards, management activation and presets cannot infer intent. The
About control is available even when war scoring is off, and presets preserve
an explicit draft value. Private JSON storage needs no database migration.

`GET /api/clan/clans/<tag>/policy/context` uses the existing Elixir cookie
session and current request-scoped Clan gate. It additionally requires verified
membership. Its allowlist is schema_version, clan_tag, status, reason,
war_intent, policy_version, policy_saved_at and read_at. There are no names,
notes, history, judgments, roles, keys or other policy values. No policy yields
unknown/no_policy; unspecified intent yields unknown/war_intent_unspecified.
A successful current read is timed separately from the policy's save provenance.
No guessed freshness limit or model gate is implied. Reads do not evaluate,
fetch a roster, mint game requests, save policy, grant awards or create Actions.

## Exact access changes

This draft introduces no new principal, credential, scope, grant, audience or
policy reader. The new read admits only verified people already allowed to read
that clan's policy; unverified member reads of existing policy remain unchanged.
Cross-clan and revoked membership fail the request's existing gate. Agent and
integration principals remain refused by `runGate`; MCP/public tools still
cannot import private Clan state.

Agent use would be a separate access change. Before implementing it, agree on
an agent-only minimal-context door, bound to the registered agent's assigned
clan and owner's current verified membership, and decide who can grant that
authority. Existing game `cr:read` must not implicitly grant policy access.
Reassignment, revocation and freshness must be checked on every read. Any new
scope/discovery/MCP or JSON API change needs a contract and privacy review; do
not expose the full private policy or relax the public-tool import boundary.
No security grants are written in this slice.

## Next slice, pending coordination

Settle the agent transport, assignment/owner authorization, minimal discovery
contract, freshness bounds and affected routine list. Then implement the
consumer's startup/pre-plan/pre-fire refresh with a deterministic gate before
LLM calls and run/cursor/delivery consumption. Unknown/stale/error context defers
only the affected routine; non-war routines continue. Preserve deferred-run
idempotency and reader semantics. Ship the reviewed hub contract before the
consumer under each repo's release rules. No clan intent values are selected
for a person and no live routine/message is QA.

## Verification

Synthetic core tests cover legacy/new defaults, both scoring/intent combinations,
invalid intent, preset preservation, narrow fields, fresh policy revisions,
read timestamps and no-policy status. Route tests cover verified member access,
cross-clan, unverified, revoked and agent refusal before reading policy. UI tests
exercise the independent setting and preservation through a scoring preset.
Required full verification and CI evidence belong in the draft PR. This draft
is held for coordinated contract review before merge/deploy.
