---
slug: operators
title: "Running a collector"
description: "A collector fetches Clash Royale data for Elixir MCP with your own API key and posts it back over HTTPS. No AWS access, no queues, two secrets. What you need, how to enroll, and what it earns you."
section: build
order: 4
navTitle: "Run a collector"
icon: server
lede: "Volunteer a machine that fetches for the corpus, and what it earns you."
console: ["Your collector", "/console/status/collectors", "Console ▸ Collectors"]
---

# Running a collector

A collector is a small program that fetches Clash Royale data for
Elixir MCP with YOUR API key and posts the results back to us over
HTTPS. It has **no AWS credentials, no cloud access, no queues** — it
is a pure API client holding exactly two secrets: your Clash Royale
key and the bearer token Elixir MCP issues you.

## What you need

- A machine that is usually on, with a static public IP (only because
  Supercell binds CR API keys to an IP; we never ask you for it, and it
  is never published).
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
   public** in the fleet listing (`/api/public/status`, which needs no
   sign-in, and the console's Collectors page): collectors are credited
   to the player who runs them, so running one attaches your CR identity
   to it. Your email address and IP are never published.
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

Naming is not enough on its own. Every release is signed, and your
collector installs a named release only after it checks the signature
over the release's `SHA256SUMS` against the release key built into it,
and the download against the hash this server named. So neither this
server alone nor GitHub alone can put code on your machine. The release
key:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFvN1mZGTcFXSGnIXf8h33cxAhvrHPYn80BO5FkELh28 elixir-mcp-collector-release
```

Its fingerprint is `SHA256:mktajl7kjMESYLyiY34rRu9hLTL6+EJS3I6aa/sGqeU`,
the one your collector logs when it verifies an update. This page is a
second place to check it: the collector repository's
[SECURITY.md](https://github.com/jthingelstad/elixir-mcp-collector/blob/main/SECURITY.md)
publishes the same line, with how to verify a release by hand. If the
two ever disagree, do not install, and tell the maintainer.

**The signed badge.** From v3.0.4, your collector tells this server,
on every call, the SHA-256 of the binary it is running and the
fingerprint of the release key it trusts. The fleet page on
https://elixir.poapkings.com (Status > Collectors) then marks each
collector **signed** when that binary is exactly a release this server
named for its version, **dev build** for a local build, **unverified**
when the collector does not report its hash yet (an older release), and
**mismatch** when it reports a hash that is not the named one: a local
build under a release's version, or something wrong with the machine.
The badge is public; the hash itself is seen only by you and the
maintainer. It is what your collector says about itself, shown so a
fleet that runs exactly the releases it was given is visible at a
glance, not a check anything depends on. The same page draws the
release key's fingerprint as the picture `ssh-keygen -lv` prints for
it, so you can compare it with your own by eye.

## What your collector can and cannot do

It leases fetch jobs, calls the CR API with your key, and posts the
results. It never chooses targets, never sees user data, and holds
nothing that touches our infrastructure — the token only works against
three API routes, and revoking it is instant. Your collector earns
points, and points earn credits: a point is a fetch that added something
new to the record (a fetch that found nothing new earns none), and every
10 points adds +1 to your daily tool-call quota (capped at 4x your tier
base).

## The door, precisely

Three routes, all `Authorization: Bearer emcg_…`:

| Route | Allowed while | Limit |
|---|---|---|
| `GET /api/collector/config` | pending, probation, active, draining | 120 per hour |
| `POST /api/collector/lease` | probation, active | 10,000 per hour shared with submit; at most 2 unsubmitted leases |
| `POST /api/collector/submit` | probation, active, draining | same |

Config hands out pacing (1,500 ms between fetches), the 403 breaker (5 in
a row, 300 s cooldown), the payload ceiling (5,000,000 bytes compressed and
base64-encoded), the next check-in interval, your channel, your status, the address your requests arrive from (`observed_ip`
— the one to allowlist on your CR key), the one Clash Royale path
`collector doctor` may read to prove your key works from there, and the
one release version and SHA-256 you may run. A `pending` token can read
config and nothing else, so `doctor` can tell you "installed, not yet
promoted" instead of an error; a revoked token is told so (403 `revoked`)
on config alone. A lease expires after 90 seconds
unsubmitted; ten expired leases in a row quarantine the collector (it moves
to `draining`, the maintainer is told, and lease answers 409 `quarantined`).
So a submit that fails for a passing reason is retried on the same lease,
inside those 90 seconds, on the budget config's `submit_retry` names: up
to three attempts of at most 20 seconds, backing off from 500 ms, on a
network failure, a 5xx, or a status in `retry_statuses` (429 today, the
answer when the site's shared throttle is momentarily full). A 429 whose
`Retry-After` is longer than the lease can wait, your hourly budget, is
not retried. A collector release from before `retry_statuses` retries
network failures and 5xx only.
A collector that simply stops checking in is **silent**: after an hour
without a check-in, `elixir_collectors` and the fleet page say `silent`
(with `silent_since` and `last_seen`) beside the enrolment state under
`lifecycle`, and the maintainer is told once per silence. A stop on
purpose is `draining`, which is never silent; ask to be drained rather
than leaving a machine quiet under `active`.

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
`pending → probation → active → draining → revoked`. The maintainer
moves a collector along it; a quarantine drains one automatically, and a
drained collector can go back to `probation` to try again.

## Fair-use expectations

Your collector shares ONE global rate budget with the fleet (that is
Supercell ToS posture, not a suggestion). The pacing the server hands
out is load-bearing. A client that goes quiet holding leases is
quarantined automatically and the maintainer told, and one that ignores
the pacing runs into the door's hourly limits.

---

*This material is unofficial and is not endorsed by Supercell. For
more information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*

## History cleanup

The reviewed cleanup of retired recording features is complete. Personal and
clan overlap and retained replay records were verified before original archive
versions were removed. The removed versions were checked absent. This does not
change ordinary collector operation or the shared rate budget.


The retired global recorder's empty tables are removed in a separate database
migration after the runtime has stopped using them. Personal and clan facts,
immutable receipt history and the shared collector contract remain.


### Collector email

Your weekly collector email includes the security status shown in the dashboard.
Elixir also sends one notice for each collector it observes upgrade to a higher
released version, with the old and new versions and available release notes.
Both use your existing Collector activity email preference. See [email from
Elixir](/docs/email#collector-upgrade-notices).
