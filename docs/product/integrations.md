# JSON API and integrations

*Rewritten 2026-11-13 to the social layer, from the brief Jamie ratified
on 2026-10-12, under [`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. It waits on
Jamie's read; where it and DECISIONS disagree, DECISIONS wins.*

## What it is for

`/api/v1` is Elixir's door for programs: a public, versioned product
beside MCP, mirroring the tools' shapes without the agent response cap.
It is how the family's own apps (Drop, poapkings.com, Elixir Clan's
mail) and a clan's own tooling read the record, and how a person signs
in to a family app with Elixir. [Jamie, 2026-09-23, 2026-09-25]

## Who it serves

- **A person, by OAuth**, with audience `/api/v1`: the signed-in person
  as a family app sees them, their players, and (family only) their
  email; and the social reads a person's own agent has (follows,
  highlights, cheers, the clan directory). [Jamie, 2026-09-25,
  2026-11-12]
- **An integration, by key**: a platform with no player and no human
  powers, provisioned by an admin, with its own budgets; `clans:read`
  reads any recorded clan so an app works with nobody signed in. An
  integration never reads the social layer. [Jamie, 2026-09-25,
  2026-11-12]
- **The family's apps are first-party**: provisioned, confidential
  clients on family origins, unmetered. [Jamie, 2026-09-27]

## Principles that decide the details

1. **Two doors, two credentials.** A token for MCP is refused at the API
   and the reverse; cookies, agent keys and REST keys never cross.
   [Jamie, 2026-09-23]
2. **Ordinary semver, one path.** A removed or renamed field is a major
   of `info.version`; the path stays `/api/v1` because it is the OAuth
   audience. [Jamie, 2026-09-25]
3. **Programs read JSON; agents read MCP.** [Jamie, 2026-09-25]
4. **Attested facts are kept apart.** A family app granted `facts:write`
   by name, or acting for a verified person with `clans:attest`, records
   what that person did in their clan (Elixir Clan's awards and a
   leader's classifications), labelled and apart from the game record.
   [Jamie, 2026-09-25]
5. **No OIDC layer.** Family apps sign in with Elixir's OAuth; no
   separate issuer or SSO. [Jamie, 2026-09-28]
6. **Drop only signs in and reads.** Drop is a different app on the same
   account: its scores and rules are its own. You can play Drop without
   an account, but an account in Drop is an Elixir account, and Drop's
   email-only route goes. Drop uses Elixir to sign a person in and get
   their verified Clash Royale player, and writes nothing to Elixir: no
   follows or player claims, no attested facts. "Drop can stop writing
   now." [Jamie, 2026-10-02, 2026-10-12, 2026-11-13]
7. **Sign in with Elixir signs in or creates an account.** The page a
   family app sends a person to admits someone new, because "Elixir Drop
   gets new users into Elixir", with the same 13 or older question as
   signup; a family app signing a person in as themselves gets no
   consent page ("Consent to what? I think no."). [Jamie, 2026-10-12,
   2026-11-11]

## What it never does

Accept the other door's token; store a person's token for an
integration; meter a first-party client; let an integration act as a
person or read the social layer.

## Keys are provisioned

An integration is platform access an admin issues, never a tier
entitlement or a self-serve mint. A clan that wants a key for its own
website asks; Partner stays Jamie's gate. [Jamie, 2026-09-25, 2026-10-12]

## Open

- **Removing Drop's writes.** Ruled, not yet built: Drop still asks for
  `follows:write` (as `recordings:write`) and adds a person's tag as an
  alt (`POST /api/v1/me/players`), and writes personal records as
  attested facts (`POST /api/v1/players/{tag}/facts`, `facts:write`).
  Drop stops calling them first; then Elixir withdraws Drop's grant and
  key permission and the `personal_record` fact type.
