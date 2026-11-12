# 2026-11-12 — Home's clan card is stored per account (#649)

`GET /api/me/home/clan` built the card on every read: `war_history`,
`war_current`, then Clan's "You here" (`homeView`: eight weeks of
`clans_participation`, the roster, every member's activity and the
policy's evaluation). Over the three days to 2026-11-12 the `clan` panel
logged p50 4,161 ms, p95 9,816 ms (n 42) and `web-latency` counted three
timeouts. The database part of `clans_participation` profiled warm at
136 ms of 1,732 ms: the time is cold reads on a micro instance, not one
query plan.

Migration 0248 adds `home_clan_card`, one row per account: the clan it
was built for, a `basis`, when it was built and how long it took, and the
card without its live fields.

- Every read asks Clan's needs door with `?basis=1` (Clan handler and
  `cardBasis` in the manage service). It answers what the panel always
  read live (needs, needs_total, unlock) plus the reader's role,
  verification and a sha256 of player, role, verification, the policy's
  set and version and the clan's holds. A refused gate (a departure) has
  no basis, so the card is built for the tracked view.
- A stored card is served when its clan and basis match and it is under
  three hours old. Needs, needs_total, unlock, role and verified are
  never stored; they are overlaid from the live gate on every answer.
- Past fifteen minutes the answer carries `clan.refresh: true`; the app
  (`useHomeClan`) then asks `?rebuild=1` once and swaps the new card in.
  The log names those reads `clan_rebuild`, and every `clan` line carries
  `stored` and `age_ms`.
- `{account_remove}` deletes the row.

The rebuild is triggered by the viewer's own app, not a server job:
building a member card needs Clan's request context (the gate and the
closed recorded reader), which the jobs runtime does not have per
account. `clans_participation` itself is unchanged for every other
caller.

Public docs: `timeline.md` (Home's feed) says the card can trail by up to
about twenty minutes and what is read live. What's new 110.

Migration 0248. MCP and JSON API unchanged.
