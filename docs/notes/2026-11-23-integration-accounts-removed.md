# 2026-11-23 — An op that deletes the integration accounts

Jamie, 2026-11-23: "Approved: delete the three integration accounts and
remove the integration account kind from Elixir" (DECISIONS, "An account
is a person"). The three are `elixir-clan`, `elixir-drop` and
`poapkings-com`: JSON API 5.0.0 took their door away and every key they
held was revoked by 2026-11-13. The next change, migration 0317, narrows
`account.kind` to person and drops the `integration` table, and it
refuses to run while any integration row is left, so the rows go first,
through `{integration_accounts_remove}`, never by hand.

The order for the operator: deploy this change, run the op (a dry run is
the default and reads without the production lock), run it for real with
Jamie's `history` choice, then deploy 0317.

## One removal for both kinds

`{agent_accounts_remove}` and `{integration_accounts_remove}` are one
removal (`services/migrate/src/ops-owned-accounts-remove.mjs`, renamed
from `ops-agent-accounts-remove.mjs`), told which kind it deletes. What
it does with each table that points at an account is unchanged
(`docs/notes/2026-11-23-agent-accounts-removed.md`); for an integration it
also deletes the `integration` row (its name) and lists each one's name,
status, created time, last key use and live and revoked keys. It refuses
an integration that owns an account or a collector, an owner who is not a
person, and an `integration` row on an account of another kind, and it
touches no person, test account, agent, family OAuth client or sign-in
grant (`services/migrate/test/ops-integration-accounts-remove.test.mjs`
fingerprints every row that points at one, before and after).

## What had to move first

- **Sign in with Elixir does not depend on these rows.** Drop's client
  is a `family_oauth_client` row on an `oauth_client`, with no account;
  `GET /api/v1/me` takes a person's grant at `/api/v1`
  (`oauth_family.account_id` is the person). The `integration_api`
  service-token audience has no validator: no door accepts such a key.
- **Clan's morning run did.** It read `integration where name =
  'elixir-clan'` for the account its award standings were attested by,
  and stopped with `clan_attester_identity_missing` without it. Clan
  writes as Elixir itself (2026-11-12), so its computed facts now carry
  no attester account (`writeClanFactBySystem(db, clan, body)`); readers
  name Clan from the fact's `source`, which stays `elixir-clan`, so what
  anyone sees is unchanged. Stored facts lose their attester through the
  foreign key's own `on delete set null`.
- **What 0317 drops leaves the request paths now.** A deploy migrates
  before it flips, so the code serving while 0317 commits is this
  change's. The OAuth and service-key validators lose their `not exists
  (select 1 from integration ...)` guard (the person-only kind check
  already refuses every other kind), the mail recipients' projection
  loses `public_id`, and the feedback queue loses the filer's kind and
  `public_id`, with Admin's agent label for a filer. The ops and Admin's
  account lists still read `public_id` and `owned_by_account_id`; they go
  with 0317.
