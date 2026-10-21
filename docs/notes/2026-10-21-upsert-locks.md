# 2026-10-21 — Submits stop queueing on arena and player rows they do not change

The platform review (2026-10-21, §2) counted 85 `ShareLock` waits in the
Postgres log. The week to 10-21 had 83, each over a second (1.0 to 1.6 s):
60 on the two busiest `arena` rows and the rest on `player` rows, all in
two ingest upserts. `ON CONFLICT DO UPDATE` locks the conflicting row even
when its WHERE says there is nothing to change, and holds the lock to
commit. So a submit that named the same arena or player as another
waited for that one to finish, though neither changed the row.

The arena-name upsert (roster, profile progress and profile) and the
battle log's player upsert are now `upsertArenaNames` and
`upsertPlayersSeen` in `packages/ingest/src/catalog-upserts.mjs`. Each
leaves out, before the insert, the rows its WHERE would not change: an
arena already known under that name; a player with a name, seen within
the day. That read takes no lock. A row the statement changes is locked
as before, and so is a row another submit has inserted but not
committed. What is written is unchanged.

`packages/ingest/test/catalog-upserts.test.mjs` shows the old statements
waiting behind a held transaction and the new ones not, and that a new
name, a first name, a stale sighting and a new row are still written.

No migration, no contract or JSON API change (MCP 11.13.3, JSON API
3.2.1). Ingest is shared code, so the deploy runs the whole acceptance
suite.
