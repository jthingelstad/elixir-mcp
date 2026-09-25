# Tool change checklist

The working list for `/tool-change`, with one line per item. Each line
says what enforces it: a test (by file), the acceptance suite, or review.
Where only review enforces an item, you are that review. Skip a line
only when it does not apply, and say why in the commit message.

## Before code

- [ ] The kind of change is named (SKILL.md, section 1), and the stop
      list is checked. A new tool, a change of meaning, a breaking
      refusal, a DECISIONS or declined-idea conflict, or a non-additive
      `/api/v1` change goes to Jamie first. Review.
- [ ] The family's DECISIONS lines are read in full and the binding
      ones are named in the plan. Review.
- [ ] For a new tool, the measured walk comes from the call audit, and
      Jamie's answer is recorded as a DECISIONS line and a NOTES entry.
      DECISIONS "New indexes or tools must collapse a measured walk".
- [ ] The lease is claimed before the first edit.

## The code map

- `services/mcp/src/tools.mjs`, the registry. It assembles the family
  modules, and `declarations(kind)` filters by `toolsHiddenFrom(kind)`
  and sorts by `GROUP_ORDER`, then by title. It publishes `verbosity` on
  one-size tools and validates arguments against the published schema.
  It validates every result against `OUTPUT_SCHEMAS[name]`, which throws
  under `node --test` and logs `output_schema_mismatch` in production.
- `services/mcp/src/tools/<family>.mjs`, the declaration and handler. A
  split family (`battles/`, `elixir/`, `rankings/`, `war/`) keeps one
  file per tool and a `common.mjs`. For example, `battles/common.mjs`
  has `ownBattlesClause`, `modeClause`, `COMPACT_DESC` and the family's
  `*_DOCS` pointers.
- `services/mcp/src/tools/shared.mjs`:
  - schemas: `TAG_SCHEMA`, `ON_BEHALF_OF_SCHEMA`, `WINDOW_ARGS`,
    `SEASON_ARG_SCHEMA`, `TIMEZONE_SCHEMA`, `MODE_SCHEMA`,
    `SEGMENT_SCHEMA`, `VERBOSITY(compactDesc)`, `ARCHETYPE_ARG`, and the
    window descriptions `WINDOW_FROM_DESC`, `WINDOW_TO_DESC` and
    `WINDOW_DATE_ONLY_DESC`;
  - resolvers: `resolveSeasonWindow()` (the exported entry point, while
    `resolveWindow()` is internal), `withWindowSugar()`,
    `resolveSegment()`, `segmentFilter()`, `populationBlock()`,
    `subject()`, `entitledClan()` and `zoneFor()`;
  - prose and shape: `appliedBlock()`, `notes()`, `docsRef()`,
    `ToolFailure`, `SEGMENT_NOTES` and `SEGMENT_DOCS`;
  - SQL: `RECORDED_PLAYERS_SQL`.
- `services/mcp/src/controls.mjs`: `modeSplit()`, `pooledModesNote()`,
  `trophyFloor()`, `markPartialWeeks()` and the other controls.
- The SQL seams are `boat-defense-sql.mjs` (`notBoatDefense`),
  `mode-filter.mjs` (`participantModeClause`, `metaPopulationClause`),
  `participation-sql.mjs`, `standings-sql.mjs` and `daily-sql.mjs`
  (`war-battles-sql.mjs`, which placed war battles on a policy day, went
  in 9.1.2 with the last per-day reader).
- `services/mcp/src/output-schemas.mjs`: the shared blocks are
  `WINDOW_ECHO`, `NOTES`, `DOCS`, `META`, `MODE_SPLIT`, `NAME`, `RATE`
  and `COUNT`.
- `packages/contracts/src/tool-groups.ts` holds `TOOL_GROUPS` and
  `GROUP_ORDER`. `principals.ts` holds `PERSON_ONLY_TOOLS`,
  `AGENT_ONLY_TOOLS` and `NOT_FOR_PERSONS`. `errors.ts` holds
  `ERROR_CODES` and their classes.
- `services/mcp/src/protocol.mjs` holds `instructionsFor` (the brief),
  `MCP_RESULT_MAX_CHARS` and `renderToolResultText()`. `invoker.mjs`
  holds `BUDGETED_TOOLS`, the deadline race, the event-pool note and the
  audit row.

## The declaration

- [ ] The name is `<domain>_<noun>` for a read and
      `<domain>_<verb>_<noun>` for a write. `*_tag` is one tag, `*_tags`
      an array, and `collection` a slug. ENGINEERING "Names"; review.
- [ ] The description is 41 to 600 characters. Its first sentence says
      which default applies, in the family's fixed phrase, and the rest
      goes to the docs page. Test: `tool-conventions`.
- [ ] Shared schemas are used by reference, never retyped. Review.
- [ ] `inputSchema.additionalProperties` is `false`. Test:
      `tool-conventions`.
- [ ] A windowed tool takes `from`, `to`, `timezone` and `season`, with
      `days` and `weeks` as sugar, and its window arguments use the
      shared descriptions. Tests: `tool-conventions`,
      `tool-schema-lint`.
- [ ] `limit` declares a `minimum` and a `maximum`. Test:
      `tool-conventions`.
- [ ] `verbosity` is the only size control, with no `summary`,
      `include_*`, `detail`, `brief` or `compact` argument. A two-size
      tool declares `VERBOSITY("...")`; a one-size tool leaves it out,
      and the registry publishes the accepted-and-ignored form. Test:
      `tool-conventions`; DECISIONS "Stated conventions are schema".
- [ ] A segment tool requires `segment: SEGMENT_SCHEMA`, has no flat
      `player_tag`, `clan_tag` or `collection`, and carries
      `population` on a corpus read. Add it to `SEGMENT_TOOLS` in
      `tool-conventions.test.mjs` and to the brief's list in
      `protocol.mjs`. Test: `tool-conventions`.
- [ ] The tool has a `TOOL_GROUPS` entry: a group in `GROUP_ORDER`, a
      title, `readOnly`, `destructive` (true when an `action` enum holds
      remove, set, delete or clear), `openWorld` (true exactly when the
      tool takes `live`), and `oauthScope` on a write. Test:
      `tool-conventions`; `declarations()` throws on a tool without a
      class.
- [ ] If the tool takes `live`, the brief's hand-written list in
      `protocol.mjs` names it. The `limits.md` row and the
      `choosing-a-tool.md` count render from the registry. Test:
      `docs-tools` (the rendered pages); the brief is review.
- [ ] Visibility by principal is set in `principals.ts` and its counts
      in `principal-surface.test.mjs`.
- [ ] `OUTPUT_SCHEMAS[name]` exists, with required keys at the top level
      (`notes` and `docs` among them) and every leaf nullable. Tests:
      `tool-conventions`, plus the registry's runtime validation.
- [ ] A corpus-scale aggregation joins `BUDGETED_TOOLS` in
      `invoker.mjs`. Review, with `{profile_tool}` through `/ops` for
      the evidence.

## The handler

- [ ] An omitted tag defaults through `subject()` or `entitledClan()`.
      With nothing to default to, the answer is `no_subject`, never a
      guess. DECISIONS "Refuse rather than choose".
- [ ] The window resolves once, through `resolveSeasonWindow()`, and is
      echoed in `applied.window`. There is one `applied` block
      (`appliedBlock()`) and never `filters_applied`, `limit_applied` or
      `window_*`. Test: `tool-conventions`.
- [ ] The tool sends one database query at a time, never a `Promise.all`
      over `db.query`. Test: `pg-usage`.
- [ ] A caller's zone is applied in SQL with `at time zone`, and daily
      series sit on the 10:00Z game-day grid. DECISIONS "Store UTC" and
      "The game day is the 10:00Z grid".
- [ ] The tool never reads `api_payload`. ENGINEERING "Tools never read
      `api_payload`".
- [ ] Mode: filter with `modeClause` or `participantModeClause`. A
      pooled rate carries `modes` and a note. `event` stays apart from
      every permanent group. DECISIONS "Mode discipline" and
      "`event_tag` is the discriminator".
- [ ] Populations: a member's own battles use `ownBattlesClause` or
      `notBoatDefense`. Metrics count recorded players
      (`RECORDED_PLAYERS_SQL`). War facts stay weekly. DECISIONS.
- [ ] Errors are `ToolFailure(code, message, hint, data)` with a code
      from `ERROR_CODES`. The hint names one executable next step (a
      tool and its arguments), and retry data rides in `data`
      (`retry_after_s`). A `tool({` mention names a real tool. Test:
      `tool-conventions` (the mention); the hint is review.
- [ ] The prose uses `notes()` and `docs: docsRef("page", "section")`
      as string literals. The pointer test reads literals, so a pointer
      assembled at runtime is invisible to it. There is no bespoke
      `*_note` key. Tests: `docs-pointers`, `tool-conventions`.

## The response

- [ ] Booleans are always emitted; the only exception is `partial` on a
      clipped bucket. DECISIONS; review.
- [ ] Labels sit beside identifiers: a name beside a tag,
      `displayLevel`, and `form`. DECISIONS; review.
- [ ] Caveats ride on the value as an enum, explained once in a note.
      DECISIONS "Meaning rides on the value"; review.
- [ ] Every `snake_case` field a note names is on that response, or is
      an argument, a tool or vocabulary. Acceptance `notesNameFields`
      (`contracts`, and the catalogue's `notes` rule).
- [ ] Every field the docs section names in backticks is on some
      response of the tool. Acceptance catalogue `docs` rule; a token
      that is prose goes in `catalogue-allow.json` with a reason.
- [ ] Every aggregate carries its control, and the note fires only on a
      detected confound. DECISIONS; review.
- [ ] A full page at the maximum `limit` and `verbosity: full` fits in
      48,000 characters. If it may not, `applied.limit` is echoed so the
      refusal prices a limit that fits, and the tool has a narrowing
      argument. Test: `answer-integrity` covers the mechanism; the fit
      is review.
- [ ] A removed or renamed name joins a retired-names regex in
      `tool-conventions.test.mjs`. In the docs, it may appear only as
      history. Test: `tool-conventions`.

## Surfaces that move with it

- [ ] The second derivations in `../consistency/facets.md` section 3 are
      grepped and changed: timeline entries, mail builders and
      fixtures, rollups, the console and web-api routes. Review; run
      `/consistency <decision>` when a DECISIONS line is involved.
- [ ] A mirrored tool is checked against its `/api/v1` operation (both
      the schema and the served body). If the pin moved,
      `info.version`, `integration-api.pin.json` and the Versions list
      in `integrations.md` all move. Test: `integration-pin`.
- [ ] On a removal, the unpinned MCP readers (elixir-bot and the
      Discord preview) are grepped for the field.

## Tests

- [ ] The behaviour is tested in the concern's file on a scratch
      database. Battles are seeded through `deck-rows.mjs`, and rollups
      are built when the tool reads them.
- [ ] `npm run build && node --test services/mcp/test/<file>.test.mjs`
      passes. The full `npm run verify` belongs to `/ship`.

## Docs

- [ ] The docs section exists before the pointer that names it.
- [ ] A new tool has a row in `choosing-a-tool.md`.
- [ ] `examples.js` still uses real names and required arguments. No
      test reads it.
- [ ] `updates.js` has an entry if a user can see the change.
- [ ] The generated tool reference is untouched. A new group gets its
      page in `apps/site/src/docs/tools/<group>.njk`. Test: `site`
      (skipped unless the site is built).

## Acceptance

- [ ] A Gym finding's block is in `gym.json` unchanged, its bite is
      fetched, and any new verb is in `gym-interp.mjs`.
- [ ] Cases that the change makes wrong are `amended` with a reason, and
      refuted cases whose subject left the contract are pruned. Every
      finding keeps a control.
- [ ] A new cross-tool invariant is in `checks/identities.mjs`, and a
      field promise is in `checks/contracts.mjs`.
- [ ] A new tool or argument shape has a seed in `catalogue-seed.json`,
      and the catalogue is refreshed and committed.

## Version and hand-off

- [ ] `CONTRACT_VERSION` and a new head entry in `CHANGELOG` are set,
      with `tools_added` or `breaking` where they apply. There is one
      bump for the round. Test: `packages/contracts/test/changelog`.
- [ ] Jamie's decisions are in `docs/DECISIONS.md` and `docs/NOTES.md`.
- [ ] Hand off to `/ship`, naming the family (the tool-name prefix) for
      its deploy's `--acceptance=<family>`, or the whole suite for
      shared code.

## What each test asserts

`services/mcp/test/tool-conventions.test.mjs`:
- Every windowed tool takes `from` and `to` and a timezone. Only
  `clans_participation` (ISO-week unit) is exempt, and
  `players_timeline` is exempt from the timezone alone.
- Every `limit` has a numeric `minimum` and `maximum`.
- No retired size argument (`summary`, `include_curve`, `compact`,
  `brief`) appears, and `verbosity` is always `["full", "compact"]`
  with default `full`.
- Every published schema declares `verbosity`. At least eleven
  two-size tools, seven of them named in the test, begin their
  description with "compact:", and the rest use the one-size wording.
  Every schema has `additionalProperties: false`.
- The tools that require `segment` are exactly the seven in the test's
  list, with the exact `anyOf` shape, "never a default" in the
  description, and no flat subject arguments.
- Each description is 41 to 600 characters, and the mean is at most
  600.
- Every tool sits in a `GROUP_ORDER` group, and every group is used.
- `destructiveHint` is true when an `action` enum removes, and
  `openWorldHint` is true exactly when the tool takes `live` (or is
  `live_fetch`).
- The tool sources have no bespoke `*_note` key, and none of
  `filters_applied`, `limit_applied`, `window_from` or `window_days`.
- No retired tool name appears in a source, and every `tool({` mention
  names a real tool.
- The 4.0.0 retired names appear nowhere in `tools/list`, the sources or
  the docs pages, except inside a history aside.
- Every tool publishes an `outputSchema`, and every one requires `notes`
  and `docs`.
- The brief names every segment tool, and every tool with `from` takes
  `season`.
- The 9.x retired war-day fields, the war `clan_score` alias and Pilot
  Score appear in no declaration, and in the docs only in a history
  paragraph.

`services/mcp/test/tool-schema-lint.test.mjs`:
- Every window argument has a description.
- Each description uses one of the shared descriptions.
- The exclusive end and the whole-day rule are stated.

`services/mcp/test/docs-pointers.test.mjs`:
- The source has at least 30 pointers, and every tool module emits one
  (a split family counts as one module).
- Every `docsRef("page", "section")` and `const X_DOCS = "page#section"`
  resolves to a page and an H2 section in the built corpus.
- `SEGMENT_DOCS` resolves.

`services/mcp/test/docs-tools.test.mjs`:
- The `limits` live-quota row names every live-flag tool.
- The `choosing-a-tool` live count equals the registry's.

`services/mcp/test/principal-surface.test.mjs`:
- Each kind sees the surface `principals.ts` says it does.
- A hidden tool is refused on call.

`services/web-api/test/integration-pin.test.mjs`:
- `info.version` and the fingerprint of the mirrored tools' schemas and
  the API's paths match `integration-api.pin.json`.

`packages/contracts/test/changelog.test.mjs`:
- The newest entry is `CONTRACT_VERSION`.
- Versions are unique and run newest first.
- Every entry has a version, a date and a summary.

`apps/site/test/site.test.mjs` (only when the site is built):
- The tools pages and `tools.json` cover the live registry.
- Every write tool publishes its capability.
