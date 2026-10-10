# 2026-10-10 — Explore pages on battles_query's cursor

The Console's Explore battle list (`apps/web/src/views/Explore.jsx`)
offered "Older battles" only when the response carried `has_more` and a
`next_cursor`. `battles_query` returns `next_cursor` alone (null on the
last page; its output schema has no `has_more`), so the link never showed
and a player's history past the first page could not be browsed (Codex on
#335, comment 4201740952). The link is now gated on `next_cursor`; the
contract is unchanged. The unit test and the onboarding journey's fixtures
dropped the non-contract `has_more` that hid the defect, and the unit test
now also pins that a null cursor offers no older page.
