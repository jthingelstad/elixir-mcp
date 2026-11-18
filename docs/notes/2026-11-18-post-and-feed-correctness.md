# 2026-11-18 — Post deletion, battle posts and Timeline pagination

An author’s post deletion, comment removal and cheer cleanup now commit in
one SQL statement. A scratch database test forces the deletion to fail and
checks all three records before and after a retry.

The Timeline distinguishes a filter with no match on the loaded pages from
an empty week. Its pagination count describes how many items are loaded.
The battle page now uses the shared post refresh after a write so a visit to
a previously opened player page immediately reads the updated posts.

MCP 14.1.0 · JSON API 6.0.0. The changes affect the signed-in app. The
release checks are scratch database tests, web tests and browser journeys.
