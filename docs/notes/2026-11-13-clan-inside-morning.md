# Clan's morning run writes as Elixir

Jamie, 2026-11-12: Clan is a set of features inside Elixir, never an
integration. The morning run used to write Clan's award standings and send
its Actions mail by acting as the `elixir-clan` integration
(`kind: "integration"`, `firstParty`) through the same functions the
`/api/v1` doors use. Now it calls Elixir's own writers:

- `writeClanFactBySystem` and `removeClanFactBySystem`
  (`packages/record/src/attested-facts.mjs`) write a fact Clan computed
  under `CLAN_FACT_SOURCE` (`elixir-clan`), attested by the account of the
  old integration row. The doors' `writeClanFactAsApp` and
  `removeClanFactAsApp` share the same body, so the checks, the upsert and
  the refusals are one code path.
- `sendActionsMail` (`packages/mail/src/clan-mail.mjs`) sends the morning
  mail as Clan. The door's `sendClanMail` is the same function under the
  calling app's name, with every check and escape unchanged.

Nothing stored or sent changes. `services/jobs/test/clan-inside-elixir.test.mjs`
runs the old and new paths on the same input. It compares every stored
fact column, the answered fact, every email issue and send row, and every
enqueued mail (send ids and the clock pinned), including a hostile clan
name and hostile lines. No migration: the `source` values and the
integration's account row stay as provenance.

## Left

- The record reads still run under the old integration's principal
  (`kind: "integration"` in `makeInvoker`). They go through the closed
  reader, `recorded-client.mjs`, which retires in its own round, and the
  principal decides what those reads see. Changing it is that round's.
- The `/api/v1` facts and mail doors stay for family apps.
