---
slug: operators
title: "Running a collector"
description: "A collector fetches Clash Royale data for Elixir MCP with your own API key and posts it back over HTTPS. No AWS access, no queues, two secrets. What you need, how to enroll, and what it earns you."
section: record
order: 23
navTitle: "Run a collector"
icon: server
lede: "Volunteer a machine that fetches for the corpus, and what it earns you."
console: ["Your collector", "/status/collectors", "Console ▸ Collectors"]
---

# Running a collector

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

1. **Raise your hand** at Status > Collectors > Run a collector on
   https://elixir.poapkings.com — pick a machine name and the Clash
   Royale card your collector will wear. The card is its public name,
   so pick a favourite; a card belongs to one collector, and one that
   is already taken is shown dimmed. You can change it later from the
   collector's own page. This is the only way a collector comes to
   exist: every one is bound to the account that raised it, and you can
   raise as many machines as you run — each gets its own name, card and
   token.

   **What is public and what is not.** The card name, the collector's
   status, and its fetch counts are public. Your **machine name is
   private** — it is visible to you and the maintainer, and to nobody
   else, which is why you can safely call it whatever your box is
   actually called. Your **primary claimed player name and tag are
   public** on the fleet status page: collectors are credited to the
   player who runs them, so running one attaches your CR identity to
   it. If you would rather not be named there, say so before you
   enroll. Your email address and IP are never published.
2. When the maintainer approves, the same page offers your collector
   **token as a one-time reveal** — copy it, because it disappears
   from the server the moment you claim it. The offer is good for
   **72 hours**: after that the staged token is discarded unclaimed
   and the maintainer mints you a fresh one. Claiming is a deliberate
   click, so nothing you paste into a chat window or a link preview
   can spend it for you. Put it in a `.env` (mode 0600)
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
There is no pin and no opt-out; the fleet shares one rate budget and one
contract, so a stale client is everyone's problem.

### How updates reach you

Your collector updates itself. Every candidate build waits until this server
names it as the fleet's current version, so what you run is always a version
somebody chose deliberately rather than the newest thing that compiled.

## What your collector can and cannot do

It leases fetch jobs, calls the CR API with your key, and posts the
results. It never chooses targets, never sees user data, and holds
nothing that touches our infrastructure — the token only works against
three API routes, and revoking it is instant. Fetches earn credits:
every 10 fetches adds +1 to your daily tool-call quota (capped at 4x
your tier base).

## The door, precisely

Three routes, all `Authorization: Bearer emcg_…`:

| Route | Allowed while | Limit |
|---|---|---|
| `GET /api/collector/config` | pending, probation, active, draining | 120 per hour |
| `POST /api/collector/lease` | probation, active | 10,000 per hour shared with submit; at most 2 unsubmitted leases |
| `POST /api/collector/submit` | probation, active, draining | same |

Config hands out pacing (1,500 ms between fetches), the 403 breaker (5 in
a row, 300 s cooldown), the payload ceiling (5,000,000 bytes compressed and
base64-encoded), poll waits (live 8 s, bulk 2 s, idle backoff 20 s), your
channel, your status, the address your requests arrive from (`observed_ip`
— the one to allowlist on your CR key), the one Clash Royale path
`collector doctor` may read to prove your key works from there, and the
one release version and SHA-256 you may run. A `pending` token can read
config and nothing else, so `doctor` can tell you "installed, not yet
promoted" instead of an error; a revoked token is told so (403 `revoked`)
on config alone. A lease expires after 90 seconds
unsubmitted; ten expired leases in a row quarantine the collector (it moves
to `draining`, you are notified, and lease answers 409 `quarantined`).

A lease may carry a **filter**. On a battlelog job it is
`filter.battles_after`, the newest battle the service already holds for
that player, spelled the way the API spells `battleTime`
(`20260911T123456.000Z`). A collector that honours it drops every entry at
or before that value before submitting — the body stays the API's own
array, just shorter — and reports `observed` (entries before the filter)
and `filtered` (entries dropped) beside `fetched_at`. Duplicates never cross
the wire, and `filtered: 0` on a full log tells the service the log rolled
past what it had. Ignoring the filter is still correct, only wasteful.
Live reads never carry one: the agent waiting on that fetch gets the whole
log.
Submit answers only after the payload is admitted and committed; a rejected
payload is still a receipt, so never fake an `ok`. Lifecycle:
`pending → probation → active → draining → revoked`, forward only, set by
the maintainer.

## Fair-use expectations

Your collector shares ONE global rate budget with the fleet (that is
Supercell ToS posture, not a suggestion). The pacing the server hands
out is load-bearing; a client that ignores it or goes quiet holding
leases is quarantined automatically and the maintainer notified.

---

*This material is unofficial and is not endorsed by Supercell. For
more information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
