# 2026-10-10 — battles_query's cursor ends on a full last page

`battles_query` set `next_cursor` whenever a page was full
(`rows.length === limit`), so a player whose matching battles were an
exact multiple of the page size got a cursor on the last page, and
following it (Explore's "Older battles" since #464, or an agent's next
call) read an empty page. Its schema says null means the end. The query
now reads one row past the page and sets the cursor only when that row
exists (Codex on #464, comment 4238873749). The fix is at the producer, so
Explore, Ladder's battle sweep and agents all stop on the true last page.
`packages/tools/test/tools2.test.mjs` pins an exactly full last page and a
one-battle page after it. MCP 11.7.3 (a correction); JSON API 3.1.0
unchanged, since no field or shape moved.
