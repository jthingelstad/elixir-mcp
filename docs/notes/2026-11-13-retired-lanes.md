# 2026-11-13 — Retired lanes: tournaments, series metrics, doc tombstones

Three pieces of retired code that still ran or still sat in the tree.

- **The global tournaments read.** The scheduler planned `/globaltournaments`
  once a board-day and the ingest archived it, but nothing had projected it
  since 0094 (`projectTournaments` returned `facts: 0`). Gone: its cadence,
  its anchored-daily entry and its seeded `GLOBAL` poll_state row
  (`packages/ledger/src/plan.mjs`), its bulk-wanted clause
  (`ledger.mjs`), its CR path (`packages/contracts/src/queue.ts`), its
  admission validator, payload manifest and evidence enums, its projector,
  the Glue table's `endpoint` enum value (`infra/template.yaml`) and the
  collector mail's label. `globaltournaments` joins
  `RETIRED_RECORDING_ENDPOINTS`, so a queued, leased or dead job is closed
  by `retireJobs`, a stale lease gets no path, and a submit is consumed as
  `retired` before decompression or archive; the old poll_state row stays
  and is never eligible again. No migration. The collector contract is
  unchanged: the hub computes every path. Archived payloads stay in S3 under
  `payloads/endpoint=globaltournaments/`; Athena no longer names that
  partition.
- **`{series_metrics}`.** The jobs Lambda's nightly series census, run after
  `{shape_census}` in the same invocation and on its own key, is removed
  with its test. Nothing read its log line. The jobs Lambda now has no read
  op: every jobs key takes the production lock under `npm run op`.
- **Doc tombstones.** `/docs/clan-agent-context` (a page saying
  `clans_context` retired in 12.0.0) is deleted; its one live paragraph,
  how an agent reads `policy.war_intent`, moved to the clan directory's
  Agents and apps section, where the two links that pointed at it now land.
  `docs/product/console.md`, the folded Console brief, is deleted with its
  README row. The `{archetype_census}` paragraph in
  `services/migrate/src/ops-archetypes.mjs` named an op that no longer
  exists, as did its catalogue allowance; both are gone.

No contract version moves: no tool, field or `/api/v1` operation changes.
