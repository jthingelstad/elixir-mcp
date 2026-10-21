# 2026-10-20 — A draft's Path of Legends best reads every recorded season

Codex on #616: the dossier's `pol_best` read its seasons from
`readRecordedProfile`, which carries a player's newest 12 recorded Path of
Legends seasons. With more than 12 on record, an older Ultimate Champion
finish dropped out of `ultimate_seasons`. If every such finish was older,
the rated profile best stood in, labelled as a season outside Elixir's
record, although its row was still in `player_pol_season`. The best
league below Ultimate Champion had the same cap.

The dossier now reads every recorded season of its own
(`player_pol_season`, newest first). `readRecordedProfile`, and
`players_profile` with it, keeps its 12. The record's finals begin with the
season that ended in March 2026 (0130), so no player has 12 yet and
nothing a draft says today changes.
No contract version moves: the dossier is Clan's, not MCP's.
