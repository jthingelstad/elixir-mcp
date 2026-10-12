# 2026-10-11 — The sitting-close timer is kept

#491 added `elixir-mcp-discord-sittings`, a five-minute scheduled rule. It
closes a battle sitting that the timeline cross-post posted while the
sitting was still going: it wakes only accounts whose open sitting has had
no battle for 31 minutes, and it only edits that message to its final
count. New lines still come only from admissions.

The cross-post's DECISIONS line said "event driven", so the timer was put
to Jamie. He approved it on 2026-10-11: "Approved: keep the 5-minute
session-close timer from elixir-mcp PR #491". The line now names it as the
cross-post's one timer, which only edits and never posts.

Docs only. MCP and JSON API unchanged, no migration.
