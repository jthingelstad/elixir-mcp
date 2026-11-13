# 2026-11-13 — Clan news off: a promotion alone still makes the digest

Codex on #922: the role change that #922 keeps when Clan news is off is
the clan's item, so its `subject_tag` is the clan's. A followed player
whose only news was that promotion had no `player_activity` entry, and
the fallback that stands up a bare entry for an item-only subject read
`subject_tag` alone. As a result the promotion was dropped, or the
digest came back null.

The fallback now counts a kept `member_role_changed` item as telling its
member, the player in its `subjects`. Other items still count by
`subject_tag`. Pinned by a test: a reader who follows only a quiet
member promoted that week gets a digest with the promotion under them.
MCP and the JSON API unchanged.
