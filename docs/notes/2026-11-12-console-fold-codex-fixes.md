# 2026-11-12 — The Console fold's Codex findings

Two findings from Codex on the fold's pull requests, both valid, both fixed
here before either reached members.

- **Admin in search is staff's** (#819). Settings' rail offers its Admin
  row to staff only (`adminOnly`, `me.is_admin`), but the search sheet
  built its Settings group from every rail row, so a member typing "admin"
  was offered a page that only says it is for staff. The sheet now carries
  `staff` from the session and drops `adminOnly` rows for anyone else. The
  server still gates every Admin read. Pinned in
  `apps/web/test/search.test.jsx`.
- **A failed read on the Record tab is an error, not an empty record**
  (#822). `/api/explore` answers a tool's failure as HTTP 200 with
  `is_error`, and the tab read every one as an absent half, so a timeout
  said "No battles recorded" and cached it. Only `not_recorded` and
  `not_found` are absent now; any other code is the tab's error state, with
  Try again. Pinned in `apps/web/test/player-page.test.jsx`.

Neither had reached production when fixed, so no What's new entry.

MCP and the JSON API unchanged.
