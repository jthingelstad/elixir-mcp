# Sign in with Elixir

*Rewritten 2026-11-13 to the social layer, from the JSON API and
integrations brief Jamie ratified on 2026-10-12, under
[`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 to 2026-11-13. Ratified by Jamie, 2026-11-13
("I think the rest is good to go").*

## What it is for

Elixir has users and agents, and no integrations. "The only integration
is Elixir Drop using Elixir to login. I don't think that needs a product
feature." [Jamie, 2026-11-13] This page is that one seam: how a family
app signs a person in with their Elixir account and learns who they are,
with their verified Clash Royale player. It is plumbing, not a product
surface.

## Who it serves

- **A person playing Drop**, who signs in with Elixir or creates an
  Elixir account on the way. You can play Drop without an account, but an
  account in Drop is an Elixir account, and Drop's email-only route goes.
  [Jamie, 2026-10-02, 2026-10-12]
- **Drop**, a provisioned, confidential family client on a family origin.
  Its scores and rules are its own. [Jamie, 2026-09-27, 2026-10-12]

## Principles that decide the details

1. **Drop only signs in and reads who you are.** Drop uses Elixir to
   sign a person in and get their verified Clash Royale player, and
   writes nothing to Elixir: no follows or player claims, no attested
   facts. "Drop can stop writing now." [Jamie, 2026-11-13]
2. **`/api/v1` is sign-in only.** It keeps OAuth and who the signed-in
   person is; there are no keys, tool mirrors or social reads. Agents
   read MCP. A token for one door is never accepted at the other.
   [Jamie, 2026-09-23, 2026-11-13]
3. **Sign in with Elixir signs in or creates an account.** The page Drop
   sends a person to admits someone new, because "Elixir Drop gets new
   users into Elixir", with the same 13 or older question as signup.
   [Jamie, 2026-10-12, 2026-11-11]
4. **No consent page for the family.** A family app signing a person in
   as themselves gets exactly the scope it asked for: "Consent to what?
   I think no." [Jamie, 2026-10-12]
5. **The address goes only to the family.** A family app may read the
   person's email; nothing else may. [Jamie, 2026-09-25]
6. **No OIDC layer.** Family apps sign in with Elixir's OAuth; no
   separate issuer or SSO. [Jamie, 2026-09-28]

## What it never does

Issue a key; let a program read the record or the social layer; let
Drop write to Elixir; accept an MCP token at `/api/v1`.

## Open

- **The build.** Ruled 2026-11-13, not yet built. Today Drop holds an
  integration key (the game clock, recorded profiles, a profile refresh)
  and an OAuth grant that adds alt claims and writes personal records;
  `/api/v1` serves the tool mirrors and social reads. Clan's morning run
  already moved inside Elixir (2026-11-13): it reads the record, writes
  its award standings and sends the Actions mail in process, and its fact
  and mail doors went in JSON API 4.0.0. Order for the rest: Drop stops
  calling them, then the keys, scopes and mirrors go in a JSON API major.
