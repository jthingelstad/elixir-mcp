# 2026-11-12 — Admin in search is staff's, as on Settings' rail

Codex on #819: Settings' rail offers its new Admin row to staff only
(`adminOnly`, `me.is_admin`), but the search sheet built its Settings
group from every rail row, so a member typing "admin" was offered a page
that only says it is for staff. The sheet now carries `staff` from the
session and drops `adminOnly` rows for anyone else. The server still gates
every Admin read; this only stops offering a door a member cannot use.

Pinned in `apps/web/test/search.test.jsx`. Shipped before #819 reached
production, so no member saw it; no What's new entry.

MCP and the JSON API unchanged.
