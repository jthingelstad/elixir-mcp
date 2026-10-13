---
slug: sign-in-with-elixir
title: "Sign in with Elixir"
description: "How Elixir Drop signs you in with your Elixir account, or creates one: what it asks for, why a family app shows no consent page, how to end a grant, and what an app outside the family can and cannot get, with the endpoints, doors and scopes."
section: build
order: 2
navTitle: "Sign in with Elixir"
icon: log-in
lede: "Elixir's family apps sign you in with your Elixir account, and create one if you are new: no consent page, and one grant you can see and end in the console. Other apps can ask too, for less, and you approve each one."
console: ["Your connected apps", "/console/account/connections", "Console ▸ Connections"]
reviewed: "2026-10-12 against contract 11.11.3"
---

# Sign in with Elixir

Elixir is the account for the whole family. A family app has no sign-up of
its own: it sends you to Elixir, you sign in or create your account there,
and it knows who you are and which players are yours. Under the hood it is OAuth 2.1, the same sign-in
an MCP client uses to connect. Elixir Clan needs none of this: it is part
of Elixir and uses your Elixir session directly.

## The apps that use it

| App | Where | Asks for |
|---|---|---|
| Elixir Drop | [drop.poapkings.com](https://drop.poapkings.com) | `cr:read`, `recordings:write` and `account:email` |

Drop is a **family app**: a client Elixir provisioned itself, with a
secret it sends at `/oauth/token` (`client_secret_post`), and every return
address on a family origin. A family app reads the
[JSON API](/docs/json-api) as you without an hourly limit, and only a
family app can be given `account:email` or `clans:attest`, and only when
it asks. Drop learns who you are, and the players you track, from
`GET /api/v1/me`, your address from `/oauth/userinfo`, and adds your Drop player to your Elixir account with
`POST /api/v1/me/players` when it is not there yet.

## What you see

**A family app (Elixir Drop).** Signed in at elixir.poapkings.com
already, you see no page at all: Elixir sends you straight back to the
app, signed in. There is no consent page, because a family app is
Elixir's own and gets only what it asked for, never more. Not signed
in, the page reads **Sign in to** and the app's name: enter your email,
then the six-digit code it sends (15 minutes, five tries), and press
**Sign in**. The page says the app is one of Elixir's own, names the
address it sends you back to, and lists what the app will be able to
do, with no boxes to tick. Signing in that way signs the browser in to
Elixir too.

**New to Elixir?** The same page creates your account. Enter your email
and the code, and your free Elixir account opens once the code is
proved, never before, exactly as signing up on the website does: an
ordinary member account, with the **Send me Elixir product news** box
checked unless you untick it, and the welcome email. The page asks for
no player tag; add yours in Console ▸ Tracking. An address whose account
was denied or disabled does not reopen here either.

**Any other app.** Signed in already, the page reads **Connect** and the
app's name, says which address you are signed in as, and has one
**Authorize** button, with a link to sign in with a code instead when
the browser is not yours. Not signed in, it is the same email and code,
and the code page carries the consent. The page says the app "named
itself; Elixir has not checked it", and asks you to continue only if you
started the connection and trust the address the code goes to. Then
come the capabilities the app asked for; other ordinary capabilities are
offered as boxes, unticked. `account:email` and `clans:attest` are never
offered unasked, and only a family app may ask for them.

`switch=1` on the authorize address always shows the email step, for a
shared browser signed in as somebody else.

## Ending a grant

**Console ▸ Connections ▸ Clients** lists every app connected to your
account; **Disconnect** ends one at once, and its capabilities can be
narrowed there. A grant lasts 90 days at most; within it, the app holds
an access token for an hour at a time and renews it with a refresh token that changes on every
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

| Scope | What the page says | Who can ask |
|---|---|---|
| `cr:read` | Read recorded game data | any app; always included |
| `recordings:write` | Change what you track | any app |
| `account:write` | Update account preferences | any app |
| `feedback:write` | Send feedback | any app |
| `account:email` | Know your email address | family apps only |
| `clans:attest` | Record what you do in your clan | family apps only |

The endpoints are `/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource`, `/oauth/register`,
`/oauth/authorize`, `/oauth/token`, `/oauth/revoke` and, for a family
app holding `account:email`, `/oauth/userinfo`. Every parameter, error
and token lifetime is on [Protocol: OAuth 2.1](/docs/protocol#oauth-2-1).
