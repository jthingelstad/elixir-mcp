# 2026-10-20 — Path of Legends leagues by name

Jamie pointed to a source for the league names: "League names:
https://clashest.com/leagues". The Fandom Ranked page agrees on the
names and their order and dates the July 2025 update that removed
Challenger I-III. Both are recorded in `cr-agent-api-docs` (game-modes.md,
"Leagues and `leagueNumber`"), with the API evidence that agrees (7 is
the only rated league); the API itself names no league.

- **One map, in `@elixir-mcp/record/ranked-leagues`.** 1 Master I to 7
  Ultimate Champion; anything but an integer 1 to 7 is unnamed. The
  timeline had its own copy (from elixir-bot) with Master 1, 2 and 3; it
  now imports this one, so `ranked_promotion` names read Master I to III
  (MCP 11.13.2, a correction).
- **The draft dossier names the best recorded season.** `pol_best_season`
  is the highest league in a season `player_pol_season` holds (the last
  12), the newest of equals, with its season and name. It replaces
  `pol_best_league`, which took the larger of the profile's best and the
  recorded seasons: a profile's best can be on the earlier ten-league
  scale, where 8 to 10 are seen and a 7 was Champion, so a max across
  the two mixed scales and could tell the model a lower league as the
  higher one. Within Jamie's call 2 of the Draft in our voice redesign
  (members may see their Path of Legends league).
- Pinned by `packages/record/test/ranked-leagues.test.mjs`, the dossier
  tests in syndication (a profile best of 9 ignored; two seasons tied at
  Royal Champion, the newer named), clan-engine and clan, and the
  timeline tool test.
- The milestone mail takes its league from the timeline item, so it
  says "up from Master III" too (its golden in
  `services/jobs/test/digest.test.mjs`). Other mail fixtures that say
  "Master 3" are inputs, not built from the map.
- No acceptance family: the timeline's names change, no field.
