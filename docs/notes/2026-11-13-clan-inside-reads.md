# 2026-11-13 — Clan reads the record as part of Elixir, not as a client

Jamie, 2026-11-12: "Clan is just a set of features INSIDE of Elixir. If
there is any remnant of Clan being separate and an 'integration' that
should be changed." Step 3 of that: Clan's reads stop being a client's
tool calls.

**What went.**

- The recorded client (`packages/clan/src/recorded-client.mjs`).
- The credential threaded through every Clan service, from the request
  down to each read.
- `firstParty` and the client names `Clan` and `Clan morning`.
- The morning run's integration principal for reads.

**What replaced it.**

- `makeRecordReader` in `@elixir-mcp/tools/invoker` runs a tool the way
  the audited invoker does: the same registry, budget race, statement and
  lock timeouts, and work_mem for analytical tools, and the same error
  body.
- It writes no `mcp_call_audit` row, no call capture and no pending
  hints, and it carries no request id or client name.
- `packages/clan/src/record.mjs` closes it to Clan's reads: `elixir_my_players`, `clans_participation`, `clans_roster`, `players_names`, `players_profile`, `battles_query`, `elixir_coverage`, `war_history`, and `live_fetch` of a clan path only.
- The web path reads as the signed-in person.
- The morning run reads as `SYSTEM_READER`, Elixir with no account. That is what the `elixir-clan` integration could see: no claims, nicknames or follows of anyone's.
- The race card's `war_current` reads through the same reader.

**Proof.**

- `services/web-api/test/clan-record-reads.test.mjs` compares every read Clan makes on one seeded record: the old audited invoker as it was called (person or integration, first party, with the client name) against the new reader (person or system). The answers are equal for both paths, a refusal included. Only the request id and pending hints differ.
- `clan-record-access.test.mjs` asks every Clan route that reads the record three times:
  - as a leader, who is answered;
  - as a member, who is refused the leaders' and elders' reads;
  - as a verified player of another clan, who is refused everything with `not_your_clan`.
- The rule is unchanged: the gate, `RUN_READS`, the elder and leader checks, and the role's freshness.

**What moved, for whoever reads the numbers.**

- Clan leaves no call rows. Usage was never showing them: `WEB_READS`
  counts only rows with no client name, and `CHARGED` leaves out the web
  surface. Its daily charge is therefore unchanged.
- `ops-analysis`' per-client breakdown no longer lists `Clan` or `Clan morning`.
- The `elixir-clan` integration's last call in Admin stops at this deploy.
- An unexpected tool failure still logs `tool_failed_unexpectedly`, so the web API's handled-failure metric still counts Clan's.
- No metric filter or alarm named the Clan clients.

**Live lane.**

- Clan's live reads (Scout, Recruit, a leader's role confirmation) were unmetered as a first-party client. They stay unmetered: the request's live lane is passed without the per-account quota charge.
- Whether they should spend the member's 20 a day, as a person's other live reads do, is Jamie's call.

**Dead branches removed.**

- A read can no longer answer 401, so the `session_expired` branches on reads are gone.
- Signing out is still the gate's: identity answers 401 with no person.

**Cost.**

On a seeded clan of twelve, a page load's queries fell by 2 to 6:
- the Clan home's `me` from 51 to 47;
- `week` from 69 to 63;
- `season` from 55 to 51;
- `policy` from 24 to 22;
- `history` from 26 to 24.

The other pages are unchanged. The medians are the same or a little lower.

No MCP contract or JSON API change.
