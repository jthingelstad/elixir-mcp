# clan-engine

Elixir Clan's management engine: a pure function of Elixir's record and a
clan's policy. Read `packages/clan/AGENTS.md` first.

- **No I/O and no clock of its own.** Every input, the time included, is an
  argument; the same inputs give the same verdicts, Actions and words.
- **Nothing clan-specific.** No POAP KINGS names, tags, thresholds or
  defaults; `test/no-clan-specifics.test.mjs` fails on them.
- **Inactivity runs from the battle log.** The clock is the days since
  the last recorded battle, or the join; a profile battle-count rise only
  moves it forward. It waits only when it cannot be read
  (`src/inactivity.mjs`). `confirm_days` is the removal day itself, never
  added to at risk (`removalDay`). War judgments read the race's weekly
  `decksUsed`, never a per-day split.
- Tests: `test/*.test.mjs` over the shared fixture (`test/fixture.mjs`,
  exported as `@elixir-mcp/clan-engine/fixtures`).
