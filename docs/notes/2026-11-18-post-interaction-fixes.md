# 2026-11-18 — Post reads, blocks and cheers

Blocking from a post now refreshes the account’s queries through the same
hook as blocking from a player page. A transient failure on a profile or
battle post read offers an inline retry and keeps the last successful
content. A refused read closes the panel.

A cheer updates only the reaction counts and the reader’s selection in
each cached item. Confirming or rolling back a cheer preserves post edits
and comment updates received while the write was pending.

Member app only, MCP 14.1.0 and JSON API 6.0.0. Coverage comes from
component tests and browser journeys.
