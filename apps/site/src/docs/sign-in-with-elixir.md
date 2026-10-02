---
slug: sign-in-with-elixir
title: "Sign in with Elixir"
description: "How Elixir Clan and Elixir Drop sign you in with your Elixir account: what each asks for, the consent page, when it is not asked again, how to end a grant, and what an app outside the family can and cannot get, with the endpoints, doors and scopes."
section: build
order: 2
navTitle: "Sign in with Elixir"
icon: log-in
lede: "Elixir's own apps sign you in with your Elixir account: one consent page, and one grant you can see and end in the console. Other apps can ask too, for less."
console: ["Your connected apps", "/console/account/connections", "Console ▸ Connections"]
reviewed: "2026-10-01 against contract 9.17.1"
---

# Sign in with Elixir

Elixir is the account for the whole family. Elixir Clan and Elixir Drop
have no sign-up of their own: they send you to Elixir, you say yes once,
and they know who you are and which players are yours. Under the hood it
is OAuth 2.1, the same sign-in an MCP client uses to connect.

## The apps that use it

| App | Where | Asks for |
|---|---|---|
| Elixir Clan | [elixir.poapkings.com/clan](/clan) | `cr:read` and `clans:attest` |
| Elixir Drop | [drop.poapkings.com](https://drop.poapkings.com) | `cr:read`, `recordings:write` and `account:email` |

Both are **family apps**: clients Elixir provisioned itself, each with a
secret, with every return address on a family origin. A family app
reads the [JSON API](/docs/json-api) as you without an hourly limit,
and only a family app can be given `account:email` or `clans:attest`.
They learn who you are, and the players you track, from
`GET /api/v1/me`.

## What you see

Signed in at elixir.poapkings.com already, the page reads **Connect**
and the app's name, says which address you are signed in as, and has
one **Authorize** button, with a link to sign in with a code instead
when the browser is not yours. Not signed in, you enter your email and
then the six-digit code it sends (15 minutes, five tries); approving
that way signs the browser in to Elixir too.

Above the button, the page says who is asking in words the app did not
choose. A family app "is one of Elixir's own apps", and the page names
the address approving sends you back to. Any other app "named itself;
Elixir has not checked it", and the page asks you to continue only if
you started the connection and trust that address. Then come the
capabilities the app asked for. Other ordinary capabilities are offered
as boxes, unticked; `account:email` and `clans:attest` are never offered
unasked.

## Not asked twice

Elixir Clan lives on Elixir's own address, so while you hold a live
grant to it that covers what it asks for, signing in to Clan goes
straight through with no page. Elixir Drop, on its own address, shows
the page each time. Revoking the grant, or narrowing it, brings the page
back.

## Ending a grant

**Console ▸ Connections ▸ Clients** lists every app connected to your
account; **Disconnect** ends one at once, and its capabilities can be
narrowed there. Signing out of Elixir Clan ends its grant too. A grant
lasts 90 days at most; within it, the app holds an access token for an
hour at a time and renews it with a refresh token that changes on every
use. A refresh token used twice ends the whole grant.

## For developers

Any app can register and ask a person for a grant, with no key from
anyone: registration is open (dynamic client registration), the client
is public, and PKCE with S256 is required. A registration is refused
when its name begins with Elixir's or POAP KINGS' name, or when a return
address is on a family origin. What an outside app can get:

- a grant for the **JSON API** (`resource` `https://elixir.poapkings.com/api/v1`)
  or for the person's **MCP door** (`/mcp`), never both on one token: a
  token for one door is refused at the other;
- the ordinary capabilities below, starting from `cr:read`, which every
  request includes;
- JSON API calls up to 600 an hour for each person, shared by every
  outside app acting for them.

It never gets the person's email address or `clans:attest`, and there
is no OpenID Connect: no ID token. Who the person is comes from
`GET /api/v1/me`, their principal and the players they track.

| Scope | On the consent page | Who can ask |
|---|---|---|
| `cr:read` | Read recorded game data | any app; always included |
| `recordings:write` | Change what you track | any app |
| `collections:write` | Edit collections | any app |
| `account:write` | Update account preferences | any app |
| `feedback:write` | Send feedback | any app |
| `account:email` | Know your email address | family apps only |
| `clans:attest` | Record what you do in your clan | family apps only |

The endpoints are `/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource`, `/oauth/register`,
`/oauth/authorize`, `/oauth/token`, `/oauth/revoke` and, for a family
app holding `account:email`, `/oauth/userinfo`. Every parameter, error
and token lifetime is on [Protocol: OAuth 2.1](/docs/protocol#oauth-2-1).
