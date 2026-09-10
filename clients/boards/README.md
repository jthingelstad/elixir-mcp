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
| `live_fetch` | one raw GET against the CR API through the hub's live lane, so **no CR token lives here** and this can run anywhere. Spends one fetch from the shared budget. |
| `collections_edit` with `action: "set"` | replaces the membership with exactly today's board. `add` would leave last week's players behind and the collection would slowly become "everyone who was ever up there". |

The door is stateless JSON-RPC — no `initialize` handshake, no session id, no
SDK. A `POST` with a bearer token is the whole client, which is why this is one
file with no dependencies.

## What it costs

**Collection membership is a recording reason.** Every player in one of these
boards is recorded while they stay in it, and stops when they drop out unless
something else keeps them. A top-100 board is therefore about a hundred
recorded players against one shared CR budget — roughly doubling the recorded
set as it stands today. That is why this ships with one board: measure the
fetch rate for a week before adding a second.

## Running it

```sh
export ELIXIR_TOKEN=svt_...        # see below
node boards.mjs --dry-run          # say what would change, write nothing
node boards.mjs                    # do it
node boards.mjs --board=pol-global-top-100
```

One line of JSON per board on stdout, one on stderr for a board that failed;
a failing board never stops the next one. Exit 1 if any board failed.

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
<key>EnvironmentVariables</key>
<dict><key>ELIXIR_TOKEN</key><string>svt_…</string></dict>
<key>StartCalendarInterval</key>
<dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>20</integer></dict>
```

A launchd job gets a minimal `PATH`, so name the node binary in full.

## Adding a board

A line in `BOARDS`, and another hundred players recorded. `path` must be a
`live_fetch` path — `/locations/{id}/pathoflegend/players` or
`/locations/{id}/rankings/players`, where `{id}` is `global` or a numeric
location id. The game-mode boards (Merge Tactics, Touchdown, and the rest of
`/leaderboards`) are **not** on the live lane's allowlist and cannot be reached
from here; adding them would mean widening that allowlist in the service.

## Guards

- A board that comes back under half full is not believed and nothing is
  written: the ranking is empty for the first hours of a season, and writing
  that as a `set` would empty the collection and stop a hundred recordings.
- A malformed tag is dropped rather than failing the call — one bad entry in a
  payload must not leave a collection unsynced.
- `node --test clients/**/*.test.mjs` runs the client against a fake door; it
  is part of `npm run verify`.
