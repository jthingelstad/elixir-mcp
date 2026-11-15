# 2026-11-14 — Backlog close-out: stale issue references in the docs

Docs only. No MCP tool, `/api/v1` operation, contract version, migration
or stored data changes.

A pass over the open issues closed the ones later work overtook or
finished. This change fixes the doc lines that still named them as open:

- **#528, the per-subject trim.** Overtaken by flat one-year retention
  (DECISIONS "Elixir keeps a year; operational logs 28 days", run by
  `packages/record/src/retention.mjs`). "History is kept for what
  someone follows, and a year after" now points there instead of a trim
  a year after the last follower leaves. The record brief's Open item
  "The trim is decided, not built" goes, its leaving section names the
  retention trim, and the product README's example of an open-issue
  ledger tag names #768.
- **#536, the timeline as the spine of mail.** Done: the digest is
  composed from the reader's own timeline (`buildTimeline` in
  `services/jobs/src/email/build-digest.mjs`), and the answer to feedback
  from its item. "The timeline is the spine of delivery" and "Mail is
  composed by calling the tools" say so. Mail to a role (collector,
  leaders' Actions) stays outside it; a `ranked_demotion` item is #474.
- **#752, the social layer tracker.** Its slices are built. The
  thirteen DECISIONS lines tagged "open #752" now cite #752 as where they
  were built; Location names #768 for what is left: Near you and the
  player map.
- **#658, the card catalog for poapkings.com.** poapkings.com reads no
  Elixir data since 2026-11-13, so "Everyone signs in; shared posts stay
  public" no longer names its roster import as a reader of
  `/api/public/cards`; the site build still reads it.

Also closed, with no doc line naming them: #424 (the rate budget, settled
by "One global rate budget" and follow slots), #445 (each documentation
finding overtaken), #449 (the archive backfill retired with migration
0256), #648 (`elixir_identify` retired in MCP 12.0.0), #754 (the local
test database slots, `2026-11-13-test-db-slots.md`) and #767 (the digest
and highlights in a clan's Discord, both built).
