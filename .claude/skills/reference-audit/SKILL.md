---
name: reference-audit
description: Check that cr-agent-api-docs keeps up with what the Clash Royale API actually sends, using Elixir's S3 payload archive (every distinct payload since recording began, across every recorded clan, player and board). Builds field and enum evidence from the archive, diffs it against the reference's endpoint pages, models and enum guard, and proposes evidenced doc patches - undocumented fields, never-observed fields, new enum values, type and absent/null drift. Applies only the patches Jamie approves, under the reference's own rules. `/reference-audit` sweeps every endpoint; `/reference-audit <endpoint or topic>` narrows it ("battlelog", "enums", "since 2026-09-01").
---

# Reference audit

cr-agent-api-docs is the one book of Clash Royale API truth, and it is
meant to be written to (AGENTS.md rule 8). Elixir is its best evidence:
the archive at `s3://elixir-mcp-archive-999153317627/payloads/` holds every
distinct payload the collectors have fetched, kept forever, across every
recorded clan and player and the boards and event lists no single-clan
tool reads. This skill turns that into doc patches.

It is the hub's successor to elixir-bot's `cr-api-doc-audit`, which reads
one clan's 60-day payload buffer. The skill lives here, not in the
reference, because the reference is caller-neutral and PUBLIC: it takes no
notes about its consumers and no raw payloads with real tags, and it has
its own evidence tool (`tools/cr-probe`) for live calls.

**Three different questions, three owners.** Keep them apart:

| Question | Owner |
|---|---|
| Does Elixir's ingest know every field the API sends? | the hub's manifest (`services/ingest/src/payload-keys.mjs`), the nightly shape census and the full audit's UNCATALOGUED list; Close the Loop turns a finding into the change |
| Does the reference document what the API sends? | **this skill** |
| What is happening in the game, and what is coming? | the domain objective Understand Clash Royale (`../AGENT-TEAM/understand-clash-royale.md`), which runs this skill for its evidence step |

## Preflight

1. The AWS caller is `cloud-engineer` in account 999153317627:
   `AWS_PROFILE=cloud-engineer aws sts get-caller-identity`.
2. `../cr-agent-api-docs` is clean and synced with `origin/main`
   (`git -C ../cr-agent-api-docs status -sb`). It has no lease tooling; a
   dirty or behind checkout is read-only for this run (the domain
   `AGENT-TEAM/WORKFLOW.md` rule).
3. Read the previous report in `reports/` (ignored by git). A finding it
   carried as proposed or declined is not re-proposed without new evidence.

Evidence and the diff are reads and need no lease. Writing the reference
follows its rules; a hub change (a manifest entry) takes the hub lease.

## Step 1: evidence

```sh
AWS_PROFILE=cloud-engineer node infra/scripts/payload-field-audit.mjs all --json /tmp/reference-audit/<date>
```

- One file per endpoint: `<endpoint>.json`. A full sweep reads every
  archived object: about 240,000 on 2026-09-25, 1.7 GB, roughly ten cents
  of S3 requests, and it takes a while (player_battlelog and clan are the
  bulk). Run it in the background.
- For a quick look, name an endpoint and pass `--per-entity 3` (each
  entity's newest three objects). The evidence then says it is a sample.
  An enum hunt or a "never observed" claim needs the full sweep: rare
  battle types are exactly what a sample misses.
- The text output is the manifest gate. Its **UNCATALOGUED** list is a hub
  finding, not a doc patch: report it for the manifest (and the census
  should already have filed it as feedback).

What each file holds (`services/ingest/src/payload-evidence.mjs`):

- `api_path` (`/players/{key}/battlelog`), `objects`, `entities`,
  `archived_objects`, `dt_range`, `sample`.
- `paths[]`: every path in the manifest's grammar (dots, `[]` for array
  elements, `*` for map keys), containers included, each with `seen`
  (occurrences), `objects`, `entities`, `types` (a JSON-type histogram,
  `null` included), `empty` (empty arrays), `first_dt`, `last_dt`, the
  manifest `disposition` and `optional`.
- `enums`: the values of the game-vocabulary paths on the allowlist
  (`EVIDENCE_ENUMS`), each with count and first and last day. A test keeps
  tags and people's or clans' names off that list.
- `manifest_never_observed`: manifest paths the archive never carried.

## Step 2: map each endpoint to its pages

Match `api_path` against `path` in `../cr-agent-api-docs/data/endpoints.json`
with every `{...}` placeholder treated alike. The entry names the endpoint
page (`doc`) and the model files (`models`). Read those, plus
`data/game-modes.json` and
`tools/docs-build/scripts/validate-observed-enums.mjs` (the values the
reference already guards). Do not copy the mapping into this skill; the
reference owns it.

## Step 3: diff

Absence of a child path is its parent's `seen` minus its own: for
`[].team[].clan.tag`, the parent is `[].team[].clan`, whose parent is
`[].team[]`. An `*` segment is a map (`progress.*`); its keys are values
in `enums`.

Look for, in this order:

1. **New enum values.** Every `enums` value against the page's tables,
   `game-modes.json` and the enum guard. A new battle type, game mode id,
   `deckSelection`, `rawName`, badge, progress bucket or reward type is
   the most valuable patch: give its first day and its count.
2. **Undocumented fields.** A path in the evidence that no field table or
   model mentions. Priority by coverage: near every object is a field the
   reference missed; a small share is a conditional field, and the patch
   says when it appears (the per-type split in the text output helps for
   battlelog).
3. **Absent, null and empty.** The reference is precise that optional
   fields are usually absent, not null. Any `types.null` on a field it
   calls absent-when-missing, or absences on a field it calls always
   present, or `empty` on an array it says is omitted, is a correction.
4. **Type drift.** More than one non-null type on a path (integer and
   string). Null beside one type is nullability, item 3.
5. **Documented, never observed.** A field the reference lists that the
   whole archive never carried (`manifest_never_observed`, or absent from
   `paths`). Report it with the archive's span; recommend removal only
   when the span is long and the field is clearly gone (the way
   `expLevel` went), otherwise a note.
6. **Endpoints the reference barely covers.** Elixir reads boards the
   reference may describe from one call (the full-depth season Path of
   Legends board, the clan-war rankings, the leaderboards). Depth,
   ordering and cutoff facts are patches.

**Known noise, suppress by default** (from the bot's audit, still true):
fields the reference already marks conditional matching their coverage;
opaque identifiers (do not enumerate `progress` values beyond its keys);
per-patch churn in card catalog fields unless a new KIND of field
appears; `iconUrls` variants beyond one mention.

## Step 4: propose

Write the report to `reports/<date>.md`:

```
## Reference audit - <date>, archive <dt_range>, <full | sample>

Summary: <one sentence: "4 patches, 2 new game mode ids, no type drift">
Coverage: <endpoint objects / entities, one line each>

### Patches
1. <page>:<nearest heading> - <the change>
   Evidence: <path or value, count, first and last day, share>
   Proposed text: <one or two sentences in the page's voice>
   Enum guard: <the line for validate-observed-enums.mjs, when a value>

### For the hub (not doc patches)
- UNCATALOGUED paths, manifest paths the API seems to have retired.

### Observed, no patch
### Endpoints with thin evidence
```

**Evidence wording is by population, never by identity**, because the
reference is public: "observed September 2026 on 1,140 of 1,145 recorded
players", "first seen 2026-09-11 in 212 battle logs across 9 clans". Never
a player or clan tag or name, never a raw payload. Event tags and game
content names are fine; the reference already publishes them.

Good: "Add to Known game mode IDs: `72000464 | Ranked1v1`, first seen
2026-09-08, 38,000 battles through 2026-09-25." Bad: "consider updating
the field table", or anything without a count and a date.

Put the patches to Jamie with AskUserQuestion, grouped (up to four
questions a round, each patch or group an option set, the recommendation
first). A patch that changes what a documented field MEANS always gets its
own question.

## Step 5: apply what Jamie approved

In `../cr-agent-api-docs`, under its AGENTS.md:

- Edit only the approved patches, in the page's voice; no cosmetic
  rewrites alongside.
- Every new observed value goes into
  `tools/docs-build/scripts/validate-observed-enums.mjs` in the same
  commit, so a later rewrite cannot drop it.
- Run the gate: `cd tools/docs-build && npm run format && npm run build`.
- Commit (message-first, what was observed and where it is written),
  check HEAD moved, push.

A patch that also changes the hub (a manifest entry, a mode map, a docs
page that quotes the reference) is a hub change: take the hub lease, fix
it there with its own gates, and say so in the report.

## Close

- Finish the report: what was applied (commits), what Jamie declined (so
  the next run does not re-propose it), and what is left.
- Tell Jamie in a few lines: patches applied, hub findings, anything that
  needs him.

## Standing rules

- Read-only on AWS. The evidence script only lists and gets objects.
- Never print, copy or commit a raw payload, a tag or a person's or clan's
  name into the reference or the report. Counts and dates only.
- Findings about Elixir's own ingest go to the hub, not the reference.
- The reference records what holds for any caller; clan-specific facts
  (POAP KINGS rosters, our fame) never go in.
