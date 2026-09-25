---
name: tool-change
description: The procedure for adding or changing an Elixir MCP tool, from start to finish. It covers the DECISIONS check and the stop list, where the code lives, the conventions the registry tests and DECISIONS enforce, the second derivations and `/api/v1` operations that must move with the tool, tests on a scratch database, docs, acceptance, and the version bump, then hands off to `/ship`. `/tool-change <tool> <what changes>` walks a change to an existing tool (a field, an argument, a note, a correction, a removal); `/tool-change new <domain>_<noun>` starts a proposed tool, which is Jamie's call before any code. Use it whenever a tool's declaration, handler, output schema, notes or SQL changes, or when a tool is added or removed.
---

# Changing an MCP tool

Adding or changing a tool is the most common development task here, and
most steps below exist because a change once skipped them. Clients cache
`tools/list` forever, agents reason from the declaration and its notes,
and several other surfaces compute the same facts with their own SQL. A
change is finished when every one of them agrees.

`checklist.md` beside this file is the working list, the code map and
what each registry test asserts. Related skills: `/ship` deploys,
`/migration` covers a schema change, `/ops` live diagnostics,
`/consistency` a DECISIONS line across surfaces, `/gym` adversarial runs.

## 1. Classify the change before any code

The kind of change decides the version, the JSON API check and who
decides:

| kind | example | MCP version | who decides |
|---|---|---|---|
| wording | a description, note or hint; a docs section | patch; none for a docs page alone | you |
| correction | the tool served something wrong; the fix makes it right | patch | you |
| addition | a new field or argument | minor | you |
| removal or rename | a field that made an unreliable claim | patch | you, unless `/api/v1` mirrors the tool (section 5) |
| meaning | what a number counts, a new refusal, a new tool | minor or major | **Jamie** |

**Stop and ask Jamie before writing code** for any of these. It is the
Gym's stop list, and it applies to every tool change, not only a sweep:

- **A new tool.** DECISIONS "New indexes or tools must collapse a
  measured walk": bring the call-audit evidence (the calls an agent
  makes today to answer the question). "The consumer taxonomy never
  shapes the domain", so one surface's wish is not evidence.
- **A change to what a number MEANS**, rather than to how it is
  described ("Facts, never judgments"; "No branded or derived player
  metric, ever").
- **A refusal that breaks existing callers** ("The 7.0.0 refusals are
  dropped" is the precedent).
- **Anything a DECISIONS line or a declined idea covers.** Read
  "Declined, do not propose" first.
- **A non-additive change to what an `/api/v1` operation returns.**

Then read the family's DECISIONS lines in full. Search
`docs/DECISIONS.md` for the tool name and the concepts it touches (mode,
segment, window, season, war, boat, ghost, archetype, form, timeline),
and name the lines that constrain the change in your plan. "The ledger
is the read path": the 2026-09-25 audit found decisions left unrealized
because agents had read NOTES instead. Before the first edit, claim the
lease (`node AGENT-TEAM/scripts/objective-lease.mjs claim session`, or
your objective's own; the Gym uses `loop`).

## 2. Where the code lives

- `services/mcp/src/tools/<family>.mjs` holds the declaration and the
  handler together, so they cannot drift. The large families (`battles`,
  `elixir`, `rankings`, `war`) are split into one file per tool under
  `tools/<family>/`, with a `common.mjs`.
- `services/mcp/src/tools/shared.mjs` holds the shared schemas, which
  are used by reference and never retyped, plus `notes()` and
  `docsRef()`. `output-schemas.mjs` holds `OUTPUT_SCHEMAS[name]`.
- `packages/contracts/src/tool-groups.ts` holds the group, title and
  annotations for each tool; `principals.ts` says who never sees it.
- `services/mcp/src/tools.mjs` is the registry. `protocol.mjs` holds the
  brief and the result cap, and `invoker.mjs` the deadline and budget.

`checklist.md` has the full map, with each shared export. When a fact
has a shared SQL seam (`boat-defense-sql.mjs`, `participation-sql.mjs`,
`daily-sql.mjs` and the others), change it there.

## 3. The conventions

The registry tests enforce the mechanical conventions (600-character
descriptions, an `outputSchema` everywhere, segment, `season` wherever
`from` is, `verbosity`, retired names, docs pointers, annotations);
`checklist.md` lists every assertion. DECISIONS states the rest, and
most of it is checked only by review:

- **Mode discipline.** "game modes are really played as a different
  game". A rate over several modes carries its per-mode split
  (`modeSplit()` in `services/mcp/src/controls.mjs`) and a note naming
  the pooled modes. Never pool modes
  silently.
- **Booleans are always emitted**, "never only when true". The one
  exception is a clipped bucket's `partial` mark.
- **Labels go beside identifiers**, "never instead of them": a name
  beside a tag, `displayLevel` for levels, `form` never merged.
- **Meaning rides on the value**: "guards go beside the ambiguous
  field, never by renaming it".
- **Notes name only fields the response serves.** The acceptance check
  `notesNameFields` (`acceptance/lib.mjs`) failed the 9.1.0 deploy on
  this: the war trophies note named `clan_war_trophies` on `war_history`
  over seasons, which serves `our_clan_war_trophies`. 9.1.1 fixed it.
- **The 48,000-character cap.** A full page of the most detailed shape
  must fit, or the refusal must name a limit that fits.
  `renderToolResultText()` prices that limit from `applied.limit`, so a
  paged tool echoes it. "a priced `result_too_large` is an answer, not a
  defect", and a lower full-verbosity page limit is a declined idea.
- **Store UTC**: "timezone is display only". Apply a caller's zone in
  SQL (`at time zone`), never by setting the session.
- **One name, one meaning**: "`day` not `date`; `arena` is `{id, name}`;
  snake_case". A removed or renamed name joins the retired-names ban in
  `tool-conventions.test.mjs` in the same commit.
- **Every aggregate ships its control** ("the note fires on a detected
  confound, not as boilerplate"), over the right population: recorded
  players only ("ghost entries, never metrics"), no boat defenses in a
  member's own battles, war as weekly aggregates "on every surface".

## 4. Second derivations

A fact changed in the tool does not reach the surfaces that compute it
with their own SQL: on 2026-09-25 the war tools went weekly-only while
the timeline, the ingest carry-back and a docs page still split war by
day. Walk `../consistency/facets.md` section 3, and grep the field and
its column across `services/`, `apps/web/src/` and `packages/mail/`:

- **Timeline entries** (`services/mcp/src/activity/entries.mjs`,
  `summary.mjs`), which the milestone, arena and clan mail import too.
- **Mail builders** (`services/jobs/src/email/build-*.mjs`). They call
  tools through `callTool` and read fields by name, so a rename breaks
  them. Some also run SQL of their own. Fixtures are in
  `packages/mail/fixtures/`.
- **Rollups** (`services/jobs/src/meta-rollup.mjs`,
  `services/ingest/src/rollups.mjs`), which must agree with the live SQL.
- **The console** (`apps/web/src/`) and **web-api routes**
  (`services/web-api/src/routes/`).

If the change realizes a DECISIONS line, run `/consistency <decision>`
before you call it done.

## 5. The JSON API

Seven `/api/v1` operations answer with a tool's structured result
(`x-tool` in `packages/contracts/integration-api.openapi.json`, wired in
`services/web-api/src/integration-api.mjs`): `clans_participation`,
`clans_roster`, `live_fetch` (the clan read), `players_names`,
`players_profile`, `battles_query` and `elixir_track_player`.

"The JSON API keeps ordinary semver". An addition to a mirrored tool is
a JSON API minor, made in the same round. A removed or renamed field is
a JSON API major and stops for Jamie. In a Gym round any change to a
mirrored response stops, because the Gym's authority excludes it.

`services/web-api/test/integration-pin.test.mjs` fingerprints each
mirrored tool's schemas and the API's paths. When it fails, bump
`info.version`, rewrite `integration-api.pin.json`, and add a line to
Versions in `apps/site/src/docs/integrations.md`. Output schemas are
permissive below the top level, so a nested field can move without
moving the pin: read the operation's response yourself. On a removal,
also grep elixir-bot and the Discord preview, which read MCP fields by
name with no pin (facets.md section 8 names the files).

## 6. Tests

- Tests are grouped by concern in `services/mcp/test/` (`tools2.test.mjs`
  holds most tools). Find a tool's with
  `grep -l '"<tool>"' services/*/test/*.test.mjs`.
- Each file makes its own scratch database on the local brew
  `postgresql@17`, migrates it, seeds it, and calls through
  `makeInvoker({ db, account, registry: makeRegistry() })`. Under
  `node --test` a result that breaks its `outputSchema` throws, so every
  call also tests the schema.
- Hand-seeded battles go through `services/mcp/test/deck-rows.mjs`,
  because "Cards are rows, not JSON".
- Run one file with
  `npm run build && node --test services/mcp/test/<file>.test.mjs`.
- **Never verify with writes on live data** (AGENTS.md rule 9). Live
  evidence comes from Jamie's `mcp__elixir-mcp__*` connection, or from
  `{profile_tool}` through `/ops`.

## 7. Docs

- The tool reference at `/docs/tools` is generated from the registry.
  Never hand-edit it; fix the declaration.
- A tool's `docsRef()` names a page and H2 section in
  `apps/site/src/docs/<page>.md`. "docs pointers must resolve before a
  tool names them", so write the section first. Formulas and anything
  past 600 characters belong there.
- A new tool gets a row in `choosing-a-tool.md` ("Question shape to
  tool"). A new `live` flag goes into the brief's hand-written list in
  `protocol.mjs`; no test checks that list.
- `apps/site/src/_data/examples.js` must use real tool names and
  required arguments. No test reads its calls, so check it by hand.
- `apps/site/src/_data/updates.js` gets an entry for anything a user
  sees, in the same commit. `elixir_docs` serves these pages to agents.

## 8. Acceptance

- **A Gym finding**: its block into `acceptance/gym.json` unchanged, its
  bite from `acceptance/bites/fetch.mjs` (see `/gym`).
- **A case your change makes wrong**: mark it `amended` with the reason,
  prune a refuted case whose subject left the contract, and never delete
  a control.
- **A new invariant**: two tools, one number, in
  `acceptance/checks/identities.mjs`; a field promise in `contracts.mjs`.
- **A new tool, or an argument shape no agent has called yet**: a seed
  with a reason in `acceptance/catalogue-seed.json`, then
  `AWS_PROFILE=cloud-engineer node acceptance/catalogue.mjs --refresh`.
  Seeds merge only at a refresh, which also drops the sets the contract
  now refuses. Review the diff and commit it.
- **Shapes** have been empty since 6.14.0: write the `outputSchema`,
  never a recorded baseline.
- **The gate's family is the tool-name prefix**, not the group:
  `badges_rarity` is `badges`, `game_clock` is `game`. Shared code
  (protocol, `tools.mjs`, `shared.mjs`, ingest) runs the whole suite.

## 9. Version, then ship

- **MCP semver** (DECISIONS "MCP majors track domain shifts, not
  agent-visible wire cleanup"): "additive changes are a minor", and "A
  correction that removes an unreliable field is a patch". A major is "a
  domain-model change that requires the agent to change what its task
  means", which is Jamie's call.
- **One bump per round**, not one per fix. Set `CONTRACT_VERSION` in
  `packages/contracts/src/version.ts` and add an entry at the head of
  `CHANGELOG` in `changelog.ts` (`tools_added` for a new tool, `breaking`
  for a removal). "every contract bump updates the changelog".
- **A decision Jamie made** becomes a DECISIONS line and a dated NOTES
  entry in the same round.
- **Hand off to `/ship`** and name the family (or families) you
  changed, so its deploy runs `--acceptance=<family>`.

## Standing rules

- The repo is public. Never read `.env` files or secret values.
- Do not re-litigate a DECISIONS line. A tool that disagrees with one is
  the defect.
- Never hand-mirror the tool list into another doc or repo: "It rots"
  (ENGINEERING).
