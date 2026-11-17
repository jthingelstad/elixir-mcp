# 2026-11-17 — Independent What’s new fragments

New What’s new entries use `<YYYY-MM-DD>-t<HHMMSS>-<slug>.md`, with the
current UTC date and time. A session no longer has to reserve the next
number from a list that another pull request may change before merge.
The reader accepts same-second entries and sorts them by filename. It
still reads legacy numbered entries, in their existing relative order,
below timed entries on the same day. No existing entry is renamed.

The regression combines independently named same-day entries, including a
same-second pair and legacy entries sharing a number. It fails against the
old reader because the timestamped filenames are refused. It also pins
UTC time ordering, the midnight boundary and invalid time refusal.

Public page addresses and feed IDs continue to use the entry’s date and
title through `updatesView.js`, which is unchanged. MCP and JSON API
contracts are unchanged; no schema migration. This is build bookkeeping,
so it adds no product update and changes no public product description.
No acceptance run is needed for this piece because no tool behavior
changed. The build session deploys it with its other merged changes.


The resumed full gate exposed an independent race in the vacuum helper's
regression: it expected exactly one other snapshot while the helper was
already querying through another pooled connection. PostgreSQL may report
that active read or autovacuum as well as the fixture's held snapshot.
The test now holds two controlled snapshots and requires both known PIDs
in the result, without assuming they are the database's only blockers.
The bare-vacuum visibility check, waiting behavior, final complete map and
held-snapshot refusal are retained. Cleanup releases the snapshots and
settles the pending helper before closing the clients or dropping its pool.
The controlled second holder reproduces `2 !== 1` against the old assertion
without an unhandled rejection; the corrected assertion passes. No helper
or production behavior changed.
