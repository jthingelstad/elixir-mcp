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

### Contract handoff

The canonical machine-readable shape is
`packages/contracts/clan-policy-context.schema.json`; synthetic examples are
`packages/contracts/test/fixtures/clan-policy-context.json`. Service tests compare
the actual core read against these examples. The context schema version is
independent of the saved policy schema and the MCP/JSON API versions. A consumer
must reject an unsupported context schema, a different clan, a malformed result,
or an unsuccessful read. An unknown result never means not participating.

`policy_version` identifies the saved revision within one clan; it is null only
when no policy exists. It does not prove permission or current membership.
`policy_saved_at` describes that revision's save, and an old saved revision may
still be current. `read_at` is generated after the current policy read completes.
The existing HTTP envelope is `Cache-Control: no-store`. There is no cached or
last-known policy fallback on read failure, and reading creates no policy.

For the pending Discord consumer, obtain a successful new authorized read at
startup, before planning and immediately before firing an affected routine.
Only a known result for the assigned clan from that successful refresh can be
used for that phase. Defer the affected routine on unknown, error or failed
refresh; do not infer a value from scoring, preset, clan assignment or policy age.
The maximum permitted read-to-fire age and clock-skew treatment still need
coordination with the consumer; this core schema does not invent a TTL or grant.

### Read-only agent verification basis

The existing IAM account inventory was read on 2026-10-04. It exposes active
service-token names, account status and role, but no agent public identity,
ownership link or verified current clan membership. The read-only profiler can
resolve a service-token name and enforce a tool's principal boundary; its result
contains timing/query summaries, not the owner or verified claims. Those reads
cannot establish the three Discord agents' actual owner/membership authorization.
The authenticated person's existing `/api/me` can show their owned agents and
claims, but no authorized person-session read was available in this review.

The before/after audience of this draft is therefore unchanged: current verified
people who already pass Clan's person/session membership gate. Agents and
integrations remain refused. Allowing an assigned agent to read even this narrow
context would add an agent reader to private Clan policy. Any proposed door must
separately approve that access and enforce the actual owner, current verified
membership, current assignment and revocation on each read. No inference or
production grant was used to fill the missing ownership evidence.

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
