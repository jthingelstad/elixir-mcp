# 2026-11-13 — Elixir Clan's morning run acts as Elixir, not as an integration

DECISIONS "No integrations: Elixir has users and agents" [Jamie,
2026-11-13, on #861] ends integrations: "There is users and agents. The
only integration is Elixir Drop using Elixir to login." It also says
Elixir Clan's morning run "reads, writes its award standings and sends
its Actions mail inside Elixir". The run already worked in-process and
never called `/api/v1`, but it still borrowed an integration's
identity: it looked up `integration where name='elixir-clan'`, refused
to run without that row (`clan_attester_identity_missing`), and handed
an actor of `kind: "integration"` to the invoker, the attested-fact
writer and the clan mail sender.

This is step 1 of 3. Clan stops depending on any integration. Nothing
is removed.

1. **This change:** Clan's morning run is a first-party system actor.
2. **Elixir Drop's repository:** Drop stops writing (the alt claim and
   personal records) and stops reading through its integration key.
3. **This repository, a JSON API major:** the integration HTTP routes,
   the `integration` table and its kin, the `clans:read` / `mail:send` /
   `facts:write` permissions, Clan's integration row and Drop's key are
   removed, leaving `/api/v1` with sign-in only ("Keep only sign-in",
   Jamie, 2026-11-13). This waits on step 2.

## The design

**Elixir Clan is a system actor: `kind: "system"`, no account.** It is
neither a user nor an agent nor an integration. It has no account row,
no token, no tier and no quota. That is the right reading of "users
and agents": an actor with an account would be a third principal kind
by another name. Elixir acting for itself is not a principal at all.
The actor is one frozen object, `CLAN_SYSTEM_ACTOR`, in
`packages/clan/src/system-actor.mjs`. Its name is `elixir-clan`, the
same name the clan engine's action log already uses for system entries
(`SYSTEM = { system: "elixir-clan" }`, `clan-engine/src/actions.mjs`).
Only the jobs runtime imports it, and nothing at a door can construct
one: `account.kind` comes from the account row and is never `system`.

- **Reads** go through the same `makeInvoker` with the same
  `queryBudgetMs` 15 s, `deadlineMs` 75 s, `surface: "web"` and
  `clientName: "Clan morning"`. The audit row now has `account_id` null
  and `principal_kind` `system`. `firstParty` is kept, so a live read
  spends nobody's quota, as before. The fleet's global rate budget
  still governs every fetch. No read Clan makes depends on the caller's
  account: the nickname joins in `clans_roster`, `players_profile` and
  `players_names` find nothing for a null account, exactly as they found
  nothing for the integration's.
- **Award standings** are written by `writeClanFactAsClan` and
  `removeClanFactAsClan` in `@elixir-mcp/record/attested-facts`. They
  take no actor: the function is the authority, and the source key is
  the constant `ELIXIR_CLAN_SOURCE` (`elixir-clan`). They share one body
  with `writeClanFactAsApp` / `removeClanFactAsApp`, which remain only for
  the `facts:write` HTTP route until step 3.
- **Actions mail** is sent by `sendClanMailAsClan` in
  `@elixir-mcp/mail/clan-mail`. It is the same sender under the same
  advisory lock and the same issue key (`clan_actions_waiting/<day>/<clan>`),
  so the cap of one per clan per account per UTC day holds. The record
  holds too: the issue, the archive and the send id. The issue's
  `facts.source` stays `elixir-clan`. The app label handed to the
  renderer (`facts.app`, which no template shows today) is read from
  `FAMILY_APP_NAMES` rather than a comparison with `"elixir-clan"`. It
  is still "Elixir Clan". An integration on the key path now gets its
  family name too ("Elixir Drop", not `elixir-drop`), though no such
  integration sends mail.

**One migration pair, because the audit constrains its principal kind.**
0094 limited `mcp_call_audit.principal_kind` to person, agent and
integration. 0255 drops that CHECK and re-adds it NOT VALID with
`system`. 0256 validates it in its own file (DECISIONS, Schema and
migrations: lock shapes take separate migrations). Old code never
writes `system`, so the flip is safe in both directions. `integration`
stays allowed until step 3, which also has to decide what happens to
historical audit rows.

**No contract change.** No MCP tool, output schema or `/api/v1`
operation moves. `PrincipalKind` in `packages/contracts` is the kinds a
connection can have, and a system actor is never a connection, so it
stays person, agent and integration until step 3 removes the last.

## Product questions this raises, and the defaults taken

Each one is `[engineering]`, under VISION and DECISIONS "No integrations"
(Jamie, 2026-11-13):

- **How does an existing award standing's provenance read after the
  switch?** Exactly as before. A fact's label is its `source`, read
  through `FAMILY_APP_NAMES`. Clan's rows were written with source
  `elixir-clan` and new ones still are, so every reader (the timeline's
  fact items, the `/api/v1` fact shape, the clan's agent) says "Elixir
  Clan" for old and new alike. A standing rewritten under its existing
  `ref` is found by `(source, ref)`, so a correction replaces it and
  never duplicates it. No row is rewritten by this change.
  *Default:* keep `elixir-clan` as Clan's source key forever. It is an
  identifier now, not an integration's name, just as
  `clan.poapkings.com` became an identifier and not an address (0195).
- **Who is the attester of record?** Nobody's account. A Clan fact
  carries `attester_account_id` null, and also null `attester_tag` /
  `attester_role` as before. Rows written under the integration keep
  its account id until they are next rewritten. Then it goes to null,
  because the upsert takes the writer's value. Nothing reads that
  column (it is written in `attested-facts.mjs` and read nowhere), and
  step 3 deleting the integration's account would null it anyway
  (`on delete set null`, 0178).
  *Default:* accept that. The source is the provenance.
- **Does the Actions mail look or count differently?** No. Same kind,
  same issue key, same once-a-day check, same words. Old issues and new
  ones share `facts.source = 'elixir-clan'`, so on the day of the deploy
  a send by the old path and one by the new path count as one.
- **Where do Clan's reads show in the call record?** Under no account,
  with principal kind `system` and client "Clan morning". A person's
  Settings call record lists only their own account's rows, so nobody
  saw these rows before and nobody sees them now. The operator census
  (`ops-analysis`, `per_principal_kind`) shows them as `system` rather
  than `integration`. *Default:* that is the honest label.
- **Should Elixir have other system actors?** Not by this change. The
  object is Clan's alone. A second system actor would be its own
  decision.

## Checks

- `services/jobs/test/clan-system-actor.test.mjs` runs on a scratch
  database with no `integration` row and no integration account. The
  morning run starts. Its reads audit as `system` under no account and
  keep their budget. An award standing is written, corrected and removed
  as "Elixir Clan". A standing written before the switch under the
  integration's identity is found, corrected and removed by the system
  actor and still reads "Elixir Clan". The Actions mail sends once,
  says "Elixir Clan", records `facts.source = 'elixir-clan'` and refuses
  a second send that day.
- `services/web-api/test/clan-mail.test.mjs` and
  `services/web-api/test/attested-facts.test.mjs` each gain the system
  actor's case beside the integration key's, which stays until step 3.
  The mail case shows that the key path and the system path share one
  day's cap. The facts case shows that each path finds what the other
  wrote, which makes a rollback safe.
- `packages/clan/test/awards.test.mjs` hands the awards service the
  run's opaque credential instead of a stand-in integration key.
- `services/web-api/test/clan-boundary.test.mjs` and
  `packages/record/test/boundary.test.mjs` are unchanged and green.
  Nothing here reaches MCP: the system actor exists only in the jobs
  runtime.
- `grep -n "integration" services/jobs/src/clan.mjs` finds only the
  header comment that says no integration credential is used.
