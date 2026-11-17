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
