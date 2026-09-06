# Running a collector (zero-trust v2)

A collector is a small program that fetches Clash Royale data for
Elixir MCP with YOUR API key and posts the results back to us over
HTTPS. It has **no AWS credentials, no cloud access, no queues** — it
is a pure API client holding exactly two secrets: your Clash Royale
key and the bearer token Elixir MCP issues you.

## What you need

- A machine that is usually on, with a static public IP (only because
  Supercell binds CR API keys to an IP — we never ask for or store it).
- A Clash Royale API key from https://developer.clashroyale.com,
  allowlisted to that IP.

## Setup

1. **Raise your hand** at Account > Collector on
   https://elixir.poapkings.com — pick a machine name. Your collector
   gets a Clash Royale CARD identity from us (that card is its public
   name; your machine name stays private to you and the operator).
2. When the maintainer approves, the same page offers your collector
   **token as a one-time reveal** — copy it, because it disappears
   from the server the moment you look. Put it in a `.env` (mode 0600)
   next to the binary alongside your own CR key:

   ```
   CR_API_TOKEN=your-clash-royale-key
   ELIXIR_API_TOKEN=emcg_...
   ```
3. **Download the collector binary** for your platform from the
   repository releases
   (https://github.com/jthingelstad/elixir-mcp-collector/releases) and
   run it with the `.env` beside it (`scripts/run-forever.sh` wraps it
   for launchd/systemd/Synology Task Scheduler).

That is the whole setup. The server tells the running collector
everything else at launch — pacing, backoff, what to fetch (it even
sends the exact URL paths) — so collection changes never require you to
update anything. When a new binary IS required, the collector updates
itself: the server names the exact version and SHA-256 it may install.

## What your collector can and cannot do

It leases fetch jobs, calls the CR API with your key, and posts the
results. It never chooses targets, never sees user data, and holds
nothing that touches our infrastructure — the token only works against
three API routes, and revoking it is instant. Fetches earn credits:
every 10 fetches adds +1 to your daily tool-call quota (capped at 4x
your tier base).

## Fair-use expectations

Your collector shares ONE global rate budget with the fleet (that is
Supercell ToS posture, not a suggestion). The pacing the server hands
out is load-bearing; a client that ignores it or goes quiet holding
leases is quarantined automatically and the maintainer notified.

---

*This material is unofficial and is not endorsed by Supercell. For
more information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
