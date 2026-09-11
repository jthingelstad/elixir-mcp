# Leaderboard collections

Keeps a collection equal to a Clash Royale leaderboard, once a day.

Some collections are hand-curated and always will be — Pros, Creators. Others
are a query somebody would otherwise run every morning. This is the second
kind, and it is deliberately a **client**: it uses nothing but the published
MCP surface, so the service gains no leaderboard code, no scheduler entry and
no table for it.

## What it does

Per board, two calls to `https://elixir.poapkings.com/mcp`:

| call | why |
|---|---|
| `rankings_players` / `rankings_clans` | the **recorded** board (contract 1.3.0). The hub records the global Path of Legends board hourly and every location daily, so this reads the record and spends nothing from the shared CR budget. Until 1.3.0 the client read the game through `live_fetch`, which was capped at the top 100 and threw the board away. |
| `collections_edit` with `action: "set"` | replaces the membership with exactly today's board. `add` would leave last week's players behind and the collection would slowly become "everyone who was ever up there". |

The door is stateless JSON-RPC — no `initialize` handshake, no session id, no
SDK. A `POST` with a bearer token is the whole client, which is why this is one
file with no dependencies.

## What it costs

**Collection membership is a recording reason**, so a player board records its
members while they stay in it. The reads themselves cost nothing now — they
come from the record, not the game — and the global top 200 is recorded by the
hub for the whole season regardless, so a global top-100 collection adds no
recording load at all. Regional boards do add their members; a clan board at
activity scope adds each clan's roster and war reads.

## Running it

```sh
cp .env.example .env && chmod 600 .env   # then paste the token in (see below)
node boards.mjs --dry-run                # say what would change, write nothing
node boards.mjs                          # do it
node boards.mjs --board=pol-global-top-100
```

The script loads `clients/boards/.env` itself if it exists; an exported
`ELIXIR_MCP_TOKEN` in the environment wins over the file. The `.env` is covered
by the repo's ignore rule — `git ls-files clients/boards` should never show it.

The output names **who** moved — every player added with the rank and rating
they arrived at, every player dropped — because a count says a board churned and
a name says whether that was the summit changing hands or the floor shifting.
`--json` gives one machine-readable line per board instead, for a log. A board
that fails is reported on stderr and never stops the next one; exit 1 if any
failed.

```
pol-global-top-100 · Path of Legends · global · 100 players · +25 −25 would change
  + #PCPUU8Y8Y  Jerry              (North Rebellion) · #18 · 2053
  …
  − #92L9R2JG   Surgical Goblin
```

### The token

A **service token**, issued in the console under Admin ▸ Service tokens
(owner only, shown once). It acts with the issuing account's entitlements, so
it must be an account that **owns** the collections listed in `BOARDS` —
`collections_edit` refuses somebody else's.

A connection's own credential will not work here: an agent's token is bound to
that agent's door (`/a/<id>/mcp`) and answers `wrong_resource` at `/mcp`, which
is the principal binding doing its job.

### Daily, on a Mac

```xml
<!-- ~/Library/LaunchAgents/com.poapkings.elixir-boards.plist -->
<key>ProgramArguments</key>
<array>
  <string>/opt/homebrew/bin/node</string>
  <string>/Users/otto/Projects/clash-royale/elixir-mcp/clients/boards/boards.mjs</string>
</array>
<key>StartCalendarInterval</key>
<dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>20</integer></dict>
```

A launchd job gets a minimal `PATH`, so name the node binary in full. The token
comes from the `.env` beside the script, so the plist carries no secret.

## Adding a board

A line in `BOARDS`. `location` is what `rankings_players` takes — `global`, a
numeric CR location id, or a two-letter country code — and the hub records
every location the API lists, so any of them is available. A board with
`derive: "clans"` is the clans most represented on the ranking, via
`rankings_clans`, counted over everyone above the rating floor. Regional boards
are season-shaped: `top` is the cap, not a promise, and a board will be small
early in the month and fill as players climb past the floor.

Membership still records players (a collection is a recording reason), but the
global top 200 is already recorded by the hub for the season — ranking presence
is its own reason since 0068 — so these collections add far less recording load
than they once did.

## Guards

- A board that has **collapsed** against what the collection holds — a hundred
  members yesterday, five today — is not written; the collection keeps last
  season's set until the new board fills back to half of it. That is the season
  boundary: Path of Legends lists only players above a rating floor and a
  season resets everyone below it. A *small* board is not suspicious on its
  own — on day 3 of S136 the US had 98 rated players, Japan 34, India 4 — and a
  collection that starts empty takes what is there. An empty board is never
  written.
- A malformed tag is dropped rather than failing the call — one bad entry in a
  payload must not leave a collection unsynced.
- `node --test clients/**/*.test.mjs` runs the client against a fake door; it
  is part of `npm run verify`.
