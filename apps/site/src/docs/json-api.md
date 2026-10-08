---
slug: json-api
title: "The JSON API"
description: "Elixir's versioned JSON API at /api/v1: who can call it (a person through an OAuth app, or an integration with a key), every operation and the tool it mirrors, the answer and error shapes, how it is versioned, and how it is metered."
section: build
order: 3
navTitle: "JSON API"
icon: braces
lede: "Programs read Elixir over plain HTTPS and JSON at /api/v1: the same record your agent reads, as a person through an OAuth app or as a platform with a key."
reviewed: "2026-10-08 against contract 11.3.0"
---

# The JSON API

Agents use MCP. Programs use the **JSON API** at
`https://elixir.poapkings.com/api/v1`, Elixir's other public door: plain
HTTPS requests answered in JSON, described by an
[OpenAPI document](/docs/integration-api.json) that names every
operation, its arguments and its answer.

## Who can call it

**A person, through an app.** An app the person signed in to with
Elixir sends their access token, from a grant whose resource is
`https://elixir.poapkings.com/api/v1`
([Sign in with Elixir](/docs/sign-in-with-elixir)). It reads as that
person, with what their grant allows. Elixir Drop signs people in this
way.

**An integration, with a key.** A platform Elixir has provisioned sends
its key and acts as itself, never as a person, with the permissions it
was granted. Integrations are set up by Elixir's admin; there is no
self-serve key. [Integrations](/docs/integrations) is the whole guide.

A token for MCP is refused here, and a token for this door is refused at
MCP.

## Operations

Each operation in the OpenAPI document says which callers it admits
(`x-principals`). A person's reads run the same Elixir tool an agent
calls, and answer with that tool's result.

| Operation | Callers | Mirrors |
|---|---|---|
| `GET /me` | person | who you are to Elixir and the players you track |
| `POST /me/players` | person (`recordings:write`) | `elixir_track_player` |
| `GET /players/{tag}/profile` | person | `players_profile` |
| `GET /players/{tag}/battles` | person | `battles_query`, compact, up to 50; each battle's `url` is [its public page](/docs/battles#a-battles-page) |
| `POST /players/names` | person | `players_names`, up to 100 tags |
| `GET /clans/{tag}/roster` | person, integration | `clans_roster` |
| `GET /clans/{tag}/participation` | person, integration | `clans_participation`, 1 to 8 weeks |
| `GET /clans/{tag}/war-history` | person, integration | `war_history`, 1 to 12 seasons |
| `GET /clans/{tag}/live` | person | a live clan read |
| `POST /clans/{tag}/facts`, `DELETE /clans/{tag}/facts/{ref}` | family app (`clans:attest`), integration | attested facts |
| `GET /game/clock` | integration | the game clock |
| `GET /players/{tag}` | integration | a slim recorded profile |
| `POST /profile-refreshes`, `GET /profile-refreshes/{id}` | integration | a profile refresh, asynchronous |
| `POST /players/{tag}/facts` | integration | a fact about a player |
| `POST /clans/{tag}/mail` | integration | a family app's mail to a clan |
| `POST /feedback`, `GET /feedback` | person (`feedback:write`), integration | `elixir_send_feedback` and `elixir_my_feedback`: feedback to the maintainer and its answers (3.1.0) |

`?fresh=1` on a player's profile or battles asks for a live read, which
spends the person's live quota unless the app is a family app.

## Answers and errors

A success is `{ "data": ..., "request_id": "..." }`, with the same id in
an `x-request-id` header. A person's read puts the tool's structured
result in `data`, without the size cap an agent's answer has.

An error is `application/problem+json`: `type`, `title`, `status`, a
`code` to branch on, a `detail` to show, the `request_id`, and, when
they apply, a `hint` and `retry_after_s` with a `Retry-After` header.
The codes and statuses are listed under
[Limits and errors](/docs/integrations#limits-and-errors). Honor
`Retry-After`, and quote the `request_id` when you
[report a problem](/console/account/feedback).

## Versions

The JSON API has its own version, separate from the MCP contract, in the
OpenAPI document's `info.version`. Adding an operation or a field is a
minor version. Removing or renaming a field is a major version, and the
path stays `/api/v1` whatever the version, because the path is what a
person's grant is for. The current version is 3.1.0; what changed in each
version is in the OpenAPI document and on [Updates](/updates).

## Limits

- **A person through an outside app**: 600 calls an hour, counted for
  the person across every outside app.
- **A person through a family app** (Elixir Drop): no hourly limit.
- **An integration**: its own hourly and daily allowances, and a daily
  allowance of profile refreshes, set when it is provisioned.

A person's reads do not spend the daily tool-call quota of their MCP
connection. [Limits](/docs/limits) has every number in one place.
