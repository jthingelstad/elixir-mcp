# Running an Elixir MCP gateway

Gateways are the only machines that talk to the Clash Royale API. They lease
fetch jobs from a queue, fetch with an IP-bound key, and post results back —
they never choose their own targets and hold no user data. More gateways mean
redundancy, never a bigger rate budget: the fleet shares one global 1 rps
budget by design (ToS posture, see DESIGN.md §5.2).

You need:

- a machine that stays on (macOS with launchd is the supported path; the
  worker itself is plain Node and runs anywhere),
- a **static public IP** (Supercell keys are IP-allowlisted),
- Node 24+.

## 1. Raise your hand

Sign in at <https://elixir.poapkings.com/dashboard> and use **Run a gateway**:
pick a short name and submit your static IP. Your gateway appears as
`pending`.

The owner then does two manual steps for you:

- creates a Clash Royale API key **allowlisting your IP** (the key stays in
  the owner's Supercell developer account — instant revocation, one ToS
  story for the whole fleet),
- creates a per-gateway IAM user whose only permissions are: receive/delete
  on the two request queues, send on the results queue, and PutMetricData.

You'll receive the key, the AWS credentials, and your `gateway_id` out of
band (never through this repo or the site).

## 2. Install

```sh
git clone https://github.com/jthingelstad/elixir-mcp.git
cd elixir-mcp && npm install
```

Create `elixir-mcp/.env`, mode 0600 — this file is gitignored and must never
be committed:

```sh
CR_API_TOKEN=<the key you received>
ELIXIR_MCP_GATEWAY_ID=<your gateway_id>
ELIXIR_MCP_GATEWAY_NAME=<your gateway name>
AWS_ACCESS_KEY_ID=<per-gateway IAM user>
AWS_SECRET_ACCESS_KEY=<per-gateway IAM user>
AWS_REGION=us-east-1
```

Then install the LaunchAgent (RunAtLoad + KeepAlive, logs to
`~/Library/Logs/elixir-mcp-gw.log`):

```sh
node services/gateway/scripts/install-launchd.mjs
```

Check the log for `leased` / `fetched` lines within a couple of minutes.
Note: launchd runs the worker **from your checkout** — after a `git pull`
that touches `services/gateway/`, restart it:

```sh
launchctl kickstart -k gui/$UID/com.poapkings.elixir-mcp-gw
```

## 3. Probation → active

Once your gateway heartbeats, the owner moves it to `probation`. It does
real work immediately; after a few clean days it's flipped to `active`.
`draining` means no new work (planned retirement or a tripped breaker);
`revoked` means ingest refuses its results and the key + IAM user are
deleted.

## What a gateway can and can't do

- It fetches exactly the `(endpoint, entity_key)` pairs it leases — targets
  are pinned server-side.
- Every payload is schema-validated at ingest regardless of source, and
  every fetch is attributed to your gateway_id.
- It paces itself (1.5 s floor between fetches) and opens a circuit breaker
  on consecutive 403s rather than hammering the API.
- It never sees accounts, emails, or sessions — only public CR data.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
