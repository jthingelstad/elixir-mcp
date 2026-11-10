# Boat defenses: the Home counters and two acceptance cases (follow-up to 11.18.5)

**What.** Home's first-use counters (`/api/me/first-answer`:
`battles_30d`, `battles_7d`, `battles_previous_7d`, read by
`services/web-api/src/first-answer.mjs`) now pass `excludeBoatDefenses`
to `dailySql`, as `players_summary` does since 11.18.5. The test seeds two
defenses and failed at 5 against 3 before the change. `last_battle_at`
and `distinct_decks_7d` are unchanged.

Two Gym cases are amended for the same decision (DECISIONS: a boat defense
is not the member's battle, Jamie 2026-09-24 and 2026-09-25):

- **135.1** held `players_summary.last_30_days.battles` equal to
  `battles_query`'s `total_count`. `battles_query` is a list and still
  returns a defense row (`boat.role: "defender"`, docs
  `battles#duels-and-boat-battles`), so its total is the summary's battles
  plus its `boat_defenses`. The case asserts that sum, and a new bite
  (`acceptance/bites/135-1-*`) shows it failing on the 11.18.4 summary,
  which counted the two defenses in both fields (52 against 50).
- **330.3** asserted `clans_standings` battles plus `boat_defenses` equal
  to the summary's battles: the 7.2.5 reading. Both counts now leave
  defenses out, so it asserts they are equal.

`acceptance/checks/identities.mjs` ("a player's 30-day battles",
summary against `battles_performance`) already agrees with 11.18.5.

No contract change: MCP 11.18.5 and JSON API 3.4.0 unchanged.
