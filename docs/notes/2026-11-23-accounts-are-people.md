# 2026-11-23 — An account is a person: migration 0317

Jamie, 2026-11-23: "Approved: delete the three integration accounts and
remove the integration account kind from Elixir" (DECISIONS, "An account
is a person"). The previous change added the op that deletes them
(`docs/notes/2026-11-23-integration-accounts-removed.md`). This one is
the contract half: migration 0317 and the code that served the agent and
integration kinds.

## The order

Deploy the op's change, run `{agent_accounts_remove}` and
`{integration_accounts_remove}` for real, then deploy this. 0317 refuses,
and changes nothing, while any of these is left: an account that is not
a person, an `agent_identity` row, an `integration` row, a key whose
audience is not `mcp`, or an OAuth grant or code for any door but `/mcp`
and `/api/v1`. Its message names both ops and that note. The ops are
gone from this change's catalogue, so they run from the previous deploy.

A deploy migrates before it flips. Between 0317 committing and the new
code serving (seconds), the old code's staff Admin account pages and a
person's Settings self-delete read `public_id`, `owned_by_account_id`
and `agent_identity`, and answer an error if used. Sign-in, MCP, the
Timeline and `/api/v1/me` read none of them.

## What 0317 does

- **Narrows** `account_kind_check` to `person` (the column stays, so
  every reader that asks for a person keeps working; a test identity is a
  person with a `test_name`), `service_token_audience_check` to `mcp`,
  and both OAuth resource CHECKs to exactly `/mcp` and `/api/v1`.
- **Drops** `agent_identity`, `integration`, `account.owned_by_account_id`
  (and `account_ownership_matches_kind`), `account.public_id`,
  `account.removed_at` and `mcp_call_audit.on_behalf_of`.
- **Keeps as history** `mcp_call_audit_principal_kind_check`, which still
  admits `agent` and `integration` for the call log's rows from before
  the removal until the 28-day rule ages them out, and `feedback.via`,
  whose old rows may name an `on_behalf_of`.

`services/migrate/test/accounts-are-people.test.mjs` runs it on the
real pre-0317 schema: it refuses with an agent and an integration left,
still refuses with only the integration left, then applies, leaves the
person and a test identity (and its key) untouched, refuses the old kinds,
audience and agent door, and keeps the call log's history.

## What left the code

- **The ops.** `{integration}`, `{agent_accounts_remove}` and
  `{integration_accounts_remove}`, their dispatch, their production-lock
  classification and their `ops.md` rows. The diagnostics, funnel and
  analysis ops lose their agent and integration columns and exclusions.
- **Account removal** (`@elixir-mcp/auth/account-remove`) removes one
  person: no owned accounts, no `agent_identity` step, no `owns_integration`
  refusal, and its event says `{via}` with no agent count.
- **Admin.** The accounts list, an account's record, usage, connections
  and sent mail read no kind, `public_id`, owner or children; the agents
  panel and the Agents and integrations column are gone. A principal is
  named by its primary player, then its address hash, then its id.
- **Roles and pools.** `tierSql` is the person's tier; the claims pool
  counts the person's own follows only.
- **Retention** loses its `agent_identity` and `integration` entries.

`packages/http/src/log-path.mjs` still masks `/a/<id>/` in logged paths:
old clients may still ask for an agent door, which answers gone, and the
id stays out of the logs.
