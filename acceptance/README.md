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

## The layers (2026-09-21, second build)

| layer | what it is | where |
|---|---|---|
| **catalogue** | what agents actually called this week: the top argument sets per read-only tool from the audit, plus hand-picked seeds with reasons. Derived by `catalogue.mjs --refresh`, committed, reviewed as a diff. Sets the current contract refuses are listed and dropped at refresh. | `catalogue.json`, `catalogue-seed.json` |
| **generic rules** | over every catalogue set: answers · published `outputSchema` holds (else the recorded shape baseline, one-directional) · under a ceiling from the tool's own p95 · a two-size tool's compact is a subset · every field its notes name is on some response of the tool · every field its docs section names is on some response this run | `checks/catalogue.mjs` |
| **allowances** | tokens a note or doc uses as prose or as a conditional field, each with a written reason | `catalogue-allow.json` |
| **bites** | captured answers from a day the product was wrong, and the case or rule that must FAIL on each; runs under `npm test` with no network. A rule that passes on known-bad history is decoration. | `bites/`, `bites.test.mjs` |
| **known** | failures filed for a decision rather than a fix: a reason and an expiry; reported as KNOWN and not counted until the date passes | `known.json` |
| **shapes** | recorded key-path baselines for tools with no `outputSchema`, provenance printed by every run; the stopgap that shrinks as schemas are written. Empty since 6.14.0: every tool publishes an outputSchema. | `shapes/`, `--update-shapes --reason` |
| **dsl** | a cross-tool invariant as one declaration: `same()` over keyed rows or scalars, `ordered()` chains, `sums()`, `implies()`, `bounded()`, `sumAtMost()`, `check()`. A field a rule names must exist - undefined fails, null skips. `identities.mjs` is 25 one-liners and two code cases. | `dsl.mjs`, `checks/identities.mjs` |
| **ground** | the record against the game: two live CR API reads from this machine (the operator key; never through the door) compared with `players_profile` and `war_current` - identity facts equal, polled counters never ahead of the game, equal when fresh. SKIP, said aloud, where no key answers. | `checks/ground.mjs` |

### Why a recorded baseline cannot ossify an error

1. **Derive, record only as a stopgap.** Expectations come from artifacts of intent - the output schema, the docs section the response points at, a second tool computing the same fact. A recorded shape exists only where none of those does, carries `provenance: "recorded"`, and the run prints how many tools rest on one: a to-do list, not coverage.
2. **One-directional.** A baseline path must be present now; a new path is information; an absence is never in the set, so it cannot be baselined.
3. **Prove it bites.** Every rule is shown to fail on a capture from a version that had the defect (`bites/manifest.json`), under `verify`, forever - the archive bucket expires captures after 90 days, the proof must not. `bites/fetch.mjs <date> <request-id prefix> <name> [feedback id]` pulls one.
4. **Updating a baseline is a reviewed change.** `--update-shapes` refuses without `--reason`; the reason is written beside the baseline; the diff lands with the behaviour change and its changelog entry.
5. **Sources the gate cannot own.** The Gym (an adversarial reader with no stake in the baseline) keeps its weekly hour for what the gate cannot imagine; when it files a finding, its capture becomes a bite the same day.

### Its own budget

The `acceptance` key carries its own hourly ceiling (`{service_token_limits}`, 2,400/hour - a build day runs the suite several times an hour), so it spends from its own bucket: a run is ~170 calls, and before this a run took 40% of the owner's hour, which the Discord agent shares.

### What the Gym should file

A finding ends with a block the suite can take as written:

```json
{ "tool": "war_history", "args": { "season_id": 135, "section_index": 3 },
  "request_id": "6d84426c-...", "assert": [
    { "every_row_has": ["weeks", "finished_early"] },
    { "eq": ["weeks[0].finished_early", true] } ] }
```

`request_id` is what `bites/fetch.mjs` needs; the asserts map onto `lib.mjs` one to one.

## What it asserts

Invariants, never a value that changes daily:

| suite        | the invariant                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts`  | every `snake_case` field a `notes[]` sentence names exists on the response it rides (or is an argument, a tool name, or vocabulary); the fields the docs promise per row are on every row                                                                                                                                                                                                                   |
| `identities` | one number two tools serve agrees (`war_current.participants[].decks_used` ⟷ `clans_participation`, `war_rivals.mean_fame` ⟷ the standings); a count's denominator is on the row (`zero_fame_races ≤ finished_races ≤ races_observed`, `scoring_decks ≤ decks_used`); a flag and its detail agree (`finished_early` ⟷ `finish_war_day`, `full` ⟷ `truncated`); `excluded.considered` = exclusions + decided |
| `budgets`    | the known-heavy calls answer inside a ceiling well under the 18 s budget (corpus meta on a week: decks 9 s, cards 15 s), so creep is caught before it is a timeout; every duration is printed                                                                                                                                                                                                               |
| `gym`        | the Gym's filed repros (#70–#82) with the acceptance criteria it wrote — its regression pass, automated                                                                                                                                                                                                                                                                                                     |

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

~215 cases, ~180 distinct calls (a read one case makes is reused by the
next), four to five minutes, one call at a time so the budget rule's
timings are honest; the corpus meta reads are most of it.

## Adding a case

A case is `{ id, run(ctx) }`; `run` throws on failure (the message is the
whole report a reader gets) and may return `{ ms }` to be listed among
the slowest. `ctx.read(tool, args)` is a cached call; `ctx.tools` the
published schemas. When the Gym files a finding, its acceptance
criterion goes in `checks/gym.mjs` under the feedback id, and the
invariant behind it in `identities` or `contracts` — the criterion pins
the fix, the invariant pins the class.
