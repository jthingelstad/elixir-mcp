# JSON API and integrations

*Ratified by Jamie, 2026-10-12, in the sitting that drafted it.*

## What it is for

`/api/v1` is Elixir's door for programs: a public, versioned product
beside MCP, mirroring the tools' shapes without the agent response cap.
It is how the family's own apps (Drop, poapkings.com) and any clan's
tooling read the record, and how a person signs in to a family app with
Elixir. [Jamie, 2026-09-23, 2026-09-25]

## Who it serves

- **A person, by OAuth**, with audience `/api/v1`: the signed-in person
  as a family app sees them, their players, and (family only) their
  email. Sign in with Elixir for Drop stays. [Jamie, 2026-09-25, 2026-10-02]
- **An integration, by key**: a platform with no player, no human
  powers, provisioned by an admin, with its own budgets; `clans:read`
  reads any recorded clan so an app works with nobody signed in. [Jamie,
  2026-09-25]
- **The family's apps are first-party**: provisioned, confidential
  clients on family origins, unmetered. [Jamie, 2026-09-27]

## Principles that decide the details

1. **Two doors, two credentials.** A token for MCP is refused at the API
   and the reverse; cookies, agent keys and REST keys never cross.
   [Jamie, 2026-09-23]
2. **Ordinary semver, one path.** A removed or renamed field is a major
   of `info.version`; the path stays `/api/v1` because it is the OAuth
   audience. [Jamie, 2026-09-25]
3. **Programs read JSON; agents read MCP.** The Discord agent stays on
   MCP, unpinned, and reads a missing field as unavailable, never zero.
   [Jamie, 2026-09-25]
4. **Attested facts come in through the API.** A family app with
   `clans:attest` records what a verified person did in their clan, kept
   apart from the game record and labelled. [Jamie, 2026-09-25]
5. **No OIDC layer.** Family apps sign in with Elixir's OAuth; no
   separate issuer or SSO. [Jamie, 2026-09-28]
6. **Drop is a different thing.** Its accounts, scores and rules are its
   own; it consumes the clock, recorded profiles and Sign in with Elixir.
   [Jamie, 2026-09-28, 2026-10-02]

## What it never does

Accept the other door's token; store a person's token for an
integration; meter a first-party client; let an integration act as a
person.

## Keys are provisioned

An integration is platform access an admin issues, never a tier
entitlement or a self-serve mint. A clan that wants a key for its own
website asks; Partner stays Jamie's gate. [Jamie, 2026-09-25, 2026-10-12]

## Open

Nothing at the level of this page.
