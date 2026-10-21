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
- **What a season result can name** (`seasonResultLeague`). A survey of
  249 players in five clans on 2026-10-20 (cr-agent-api-docs #13): only
  Ultimate Champion is rated, on either league scale. Current and last
  results in leagues 1 to 6 read 0 trophies and league 7 is always
  rated; a best of 10 is always rated and 8 or 9 never is. And a player
  who did not play a season reads league 1 with 0, the same as a Master
  I finish. So a rated result is Ultimate Champion whatever its number,
  a recorded final names 2 to 6 when unrated, and 1 is never named
  (#616 first named it Master I, which would have told a draft that a
  member who never played Ranked reached Master I).
- **The draft dossier's `pol_best`.** The best league a recorded season
  (`player_pol_season`, the last 12) ended in, the newest of equals,
  with its season and name; for Ultimate Champion, `ultimate_seasons`
  counts the recorded seasons that ended there. With none there, a rated
  profile best is Ultimate Champion with `season` null: it is from a
  season the record does not hold, and the profile's other bests stay
  unnamed (a best can be on the earlier ten-league scale, where a 7 was
  Champion). It replaces `pol_best_league`, a max across the two mixed
  scales. Within Jamie's call 2 of the Draft in our voice redesign
  (members may see their Path of Legends league).
- **Ultimate Champion leads.** Jamie: "Getting to ultimate champ is a
  big deal." Its story angle scores 97, above every other angle; it
  says the top league and, when more than one recorded season ended
  there, how many. Only a welcome and a promotion are told the profile,
  so only they get it; a demotion, a removal or a departure never names
  a league. Clan's
  Discord editor tells a promotion to it as "made it all the way to
  Ultimate Champion" (every season starts at Master I); every other
  league is still "was promoted to". The timeline's own line is the
  hub's and stays plain.
- Pinned by `packages/record/test/ranked-leagues.test.mjs`, the dossier
  tests in syndication (a profile best of 9 ignored; two seasons tied at
  Royal Champion, the newer named; two rated finals, a rated best of 10
  and a member who never played), clan-engine (Ultimate Champion leads
  a welcome and a promotion) and clan, the Clan stories test and the
  timeline tool test.
- The milestone mail takes its league from the timeline item, so it
  says "up from Master III" too (its golden in
  `services/jobs/test/digest.test.mjs`). Other mail fixtures that say
  "Master 3" are inputs, not built from the map.
- No acceptance family: the timeline's names change, no field.
