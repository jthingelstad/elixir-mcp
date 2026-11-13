# 2026-11-13 — Receipt readers stay on receipts until the backfill is done

No MCP tool, `/api/v1` operation, contract version or migration changes.

Codex's review of #942 found two defects, and both were right.

- **The readers switched too early.** #942 moved role history, the reads
  around each finish, war award absence evidence, the event calendar's
  read days and `days_since_poll` onto 0259's read facts in the same
  deploy that creates them. Those facts are empty for every day before
  that deploy until `{read_facts_backfill}` runs, so for that window the
  readers would have lost their history. That breaks expand and contract.
  The four readers are back on receipts, which the held trim keeps. They
  move onto the facts in the change that lifts the hold, deployed only
  after the backfill is done and `{read_facts_check}` reads 0 missing.
  `receipt-readers.test.mjs` pins them until then. [engineering]
- **A late battle-log read could race the backfill.** The backfill read
  a player's receipts while ingest admitted an earlier read. Ingest found
  no stretch to split, and the backfill then wrote one too long, for
  good. The backfill now takes the player's `poll_state` row lock, the
  same one ingest takes, for each player's stretches, in a transaction of
  its own (`packages/record/src/read-facts.mjs`).

Ingest still writes the facts with every admitted read, and the backfill
and check ops are unchanged in how they are called.
