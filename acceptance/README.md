# Acceptance suite

The deployed product against the real record, read-only, as a release
gate. `npm run acceptance` on demand; the deploy runs it after the smoke
gate and fails on a red case.

## Why this exists beside the unit tests

The unit tests (333 in `services/mcp` alone) pin logic over fixture
databases. The smoke gate pins the door at the HTTP level. The Elixir
Gym explores weekly. None of them pin **the live data shape at the live
scale**, and that is where the last two days' defects lived:

- `finished_early` was computed as `fame === 10000` and passed its
  fixture test for a fortnight (the July fixture caps fame at the line)
  while no live-polled week ever equalled it: documented, named in every
  note, served on no row (feedback #81).
- A 7-day corpus meta read timed out at the 18 s query budget only past
  800k participant rows (feedback #77–#79).

## What it asserts

Invariants, never a value that changes daily:

| suite | the invariant |
|---|---|
| `contracts` | every `snake_case` field a `notes[]` sentence names exists on the response it rides (or is an argument, a tool name, or vocabulary); the fields the docs promise per row are on every row |
| `identities` | one number two tools serve agrees (`war_current.participants[].decks_used` ⟷ `clans_participation`, `war_rivals.mean_fame` ⟷ the standings); a count's denominator is on the row (`zero_fame_races ≤ finished_races ≤ races_observed`, `scoring_decks ≤ decks_used`); a flag and its detail agree (`finished_early` ⟷ `finish_war_day`, `full` ⟷ `truncated`); `excluded.considered` = exclusions + decided |
| `budgets` | the known-heavy calls answer inside a ceiling well under the 18 s budget (corpus meta on a week: decks 9 s, cards 15 s), so creep is caught before it is a timeout; every duration is printed |
| `gym` | the Gym's filed repros (#70–#82) with the acceptance criteria it wrote — its regression pass, automated |

It never writes, never passes `live: true` (CR budget), and its token
cannot: `cr:read` only. A test pins that no case names a write tool.

## The credential

An **agent principal** named `acceptance`, clan `#J2RGCRVG`, scope
`cr:read`, at its own door `/a/<public_id>/mcp`. Minted locally; only
the sha256 goes to the cloud; the raw value is written to
`acceptance/.env` (mode 0600, ignored by git) and never printed:

```sh
node --input-type=module -e '
  import { mintServiceTokenValue } from "./services/auth/src/oauth.mjs";
  import { writeFileSync } from "node:fs";
  const { raw, hash } = mintServiceTokenValue();
  writeFileSync("/tmp/acc-hash.txt", hash);
  writeFileSync("acceptance/.env.pending", `ELIXIR_MCP_TOKEN=${raw}\n`, { mode: 0o600 });'
# {principal: {kind: "agent", name: "acceptance", clan_tag: "#J2RGCRVG",
#              token_hash: <the hash>, scope: "cr:read"}} on elixir-mcp-migrate
# answers {public_id}; then:
(echo "ELIXIR_MCP_URL=https://elixir.poapkings.com/a/<public_id>/mcp"; cat acceptance/.env.pending) > acceptance/.env
chmod 600 acceptance/.env; rm acceptance/.env.pending /tmp/acc-hash.txt
```

Without the file the deploy prints a warning and skips the gate; it
never skips silently.

## Running

```sh
npm run acceptance                       # every case, durations printed
node acceptance/run.mjs --only budgets   # one suite or one case by substring
node acceptance/run.mjs --json           # the report as JSON
```

~40 cases, ~26 distinct calls (a read one case makes is reused by the
next), two to three minutes; the corpus meta reads are most of it.

## Adding a case

A case is `{ id, run(ctx) }`; `run` throws on failure (the message is the
whole report a reader gets) and may return `{ ms }` to be listed among
the slowest. `ctx.read(tool, args)` is a cached call; `ctx.tools` the
published schemas. When the Gym files a finding, its acceptance
criterion goes in `checks/gym.mjs` under the feedback id, and the
invariant behind it in `identities` or `contracts` — the criterion pins
the fix, the invariant pins the class.
