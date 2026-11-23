# 2026-11-23 — An op that deletes the agent accounts

Jamie, 2026-11-23: "Delete the old agent accounts." (DECISIONS, "The old
agent accounts are deleted"). Since the one MCP endpoint (#1219) nothing
mints, authenticates or serves an agent, but the rows are still there:
eight in production, all owned by one person. The next change narrows
`account.kind` to person and integration in a migration that refuses to
run while any agent row is left, so the rows go first, through
`{agent_accounts_remove}`, never by hand.

The order for the operator: deploy this change, run the op (a dry run is
the default and reads without the production lock), run it for real, then
deploy the migration.

What it does with each table that points at an account, by what the
schema allows:

- **Deleted**, the agent's own machinery: keys, OAuth grants, tokens and
  codes, sessions, claims and clan follows (the recordings only an agent
  wanted stop through the claims package's reconcile), nicknames, read
  pointers, the timeline cross-post with its sealed webhook and what it
  told, agent identities, Clan's remembered clan, rate counters, and any
  social row.
- **Kept, detached**: the call log and the refusal log keep their rows
  with account, key and grant nulled, and age out on their own 28- and
  30-day rules; an attested fact loses its attester (the foreign key's own
  `on delete set null`, uncounted); a game conversation loses a stale owner stamp.
- **Re-pointed to the owner**: `recording.requested_by`, which is not
  null and belongs to the record.
- **Kept untouched**: `discord_post`, the cross-post quality ledger, which
  names an account without a foreign key.
- **The operator's choice**: `feedback` and `account_event` are `not
  null` against the account, so they cannot outlive it. `"history":
  "owner"` re-points them to each agent's owner (the feedback, its answer
  and its thread stay and read as the owner's); `"history": "delete"`
  deletes them. A real run that would touch such rows without a choice is
  refused and writes nothing. The choice is Jamie's.

It refuses an agent that owns an account, a collector or an integration,
none of which an agent could have, and touches no person, test account or
integration (`services/migrate/test/ops-agent-accounts-remove.test.mjs`
fingerprints every row that points at one, before and after). Each owner
gets one `agent_accounts_removed` account event.
