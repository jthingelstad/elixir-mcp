# 2026-11-13 — Clan news off still tells a followed clanmate's role change

Codex on #919: with the digest's Clan news switch off, a role change
reached no one. Joins and departures fall back to the person's own items
(`clan_joined`, `clan_left`), but a role change exists only as the clan's
`member_role_changed` item, which `DIGEST_KINDS` leaves out. So
`/docs/email`'s promise, that a followed clanmate's role change is told
under them, did not hold.

`buildDigest` now keeps `member_role_changed` when the clan part is off,
and only when the item is about a player the reader follows. That item
then lands under that person through `itemsFor`. With Clan news on,
nothing changes: the role change is the clan part's news and is never
told twice. Pinned in `services/jobs/test/digest-mail.test.mjs`, both
ways. MCP and the JSON API unchanged.
