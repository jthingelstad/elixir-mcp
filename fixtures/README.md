# Test fixtures

Clash Royale API response bodies, captured live by elixir-bot's
recorder and exported 2026-09-03. Used as golden inputs for admission and
ingest tests; the only database rows they create live in per-run scratch
databases. **This is not a data import** — production data arrives solely
through live recording.

Verbatim except players' names, which are made-up stand-ins since 2026-11-06:
the same player has the same stand-in in every file, and a name with
non-ASCII characters keeps some so parsers still meet them. Everything else
is publicly queryable CR API data (player tags, decks, clan names, and the
rosters of POAP KINGS `#J2RGCRVG` and opponents). Reviewed before commit, as
everything in this public repo must be. `meta.json` carries
provenance (observer entity key + fetch time per file).

Chosen for the shapes that break naive parsers:

- `player_battlelog/with_boat_and_duel.json` — boatBattle (no real
  opponent) + riverRaceDuel (one battle with rounds, not three)
- `player_battlelog/with_clanmate_2v2.json` — 4 participants; the
  self-teammate attribution trap
- `player_battlelog/with_colosseum_duel.json` — riverRaceDuelColosseum
- `player_battlelog/with_path_of_legend.json` — PoL + ladder mix
- `player_battlelog/empty.json` — `[]`, a real response
- `currentriverrace/*` — all three periodTypes (training/warDay/colosseum)
- `clan/roster.json` — 49-member roster (membership observation source)
- `player/profile.json` — includes collectionLevel (2026 progression model)
- `riverracelog/log.json`, `cards/catalog.json` — for V2 war history and
  the card catalog

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
