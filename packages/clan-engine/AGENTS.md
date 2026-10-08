# clan-engine

Elixir Clan's management engine: a pure function of Elixir's record and a
clan's policy. Read `packages/clan/AGENTS.md` first.

- **No I/O and no clock of its own.** Every input, the time included, is an
  argument; the same inputs give the same verdicts, Actions and words.
- **Nothing clan-specific.** No POAP KINGS names, tags, thresholds or
  defaults; `test/no-clan-specifics.test.mjs` fails on them.
- **Absence needs proof.** Inactivity means no battle activity in any mode,
  and a flat counter cannot admit a removal while all-mode absence is
  unproven (`src/inactivity.mjs`). War judgments read the race's weekly
  `decksUsed`, never a per-day split.
- Tests: `test/*.test.mjs` over the shared fixture (`test/fixture.mjs`,
  exported as `@elixir-mcp/clan-engine/fixtures`).
