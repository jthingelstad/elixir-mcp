# 2026-11-13 — A duel's score counts games only when every game has a result

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes.

A follow-up to `2026-11-13-duel-page-decks.md` (#946), from Codex's
review of it. The battle page's `scoreOf` led with the games won whenever
the known winners pointed the same way as the recorded outcome, so a duel
with one game's result kept and two blank read as `1–0 games` on the page,
the shared post, the link preview and the share picture. It now counts
games only when every game has a winner; otherwise it leads with the
crowns, as it does when the games disagree with the outcome.
