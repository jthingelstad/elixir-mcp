# players_summary leaves out boat defenses (MCP 11.18.5)

**What.** `players_summary` reads its 30-day record through `dailySql`
without `excludeBoatDefenses`, so `last_30_days.battles`, `wins`,
`losses` and `modes` counted boat defenses, and its two deck queries
counted them in `top_deck` and `best_deck`. `battles_performance` drops
them (`ownBattlesClause`), as does every other surface. It now passes
`excludeBoatDefenses: true` and filters defenses from the deck queries;
`last_30_days.boat_defenses` and its note stay, now saying the defenses
were left out.

**Why.** DECISIONS: "A boat defense is not the member's battle - it
leaves every count of a member's own battles" [Jamie, 2026-09-24,
2026-09-25]. 7.2.5 (#330) had documented the summary's counts as
including defenses, the same day the rule was set, and the summary was
never brought under it. The acceptance control Gym #262.1
(`players_summary` against `battles_performance {days: 30}`) went red at
the 2026-11-09 deploy: 50 against 48, the two boat defenses of the war
week in the window. It passes whenever the window holds no defense, so
the deploy exposed it rather than caused it.

**Test.** `packages/tools/test/war-tools.test.mjs`, "players_summary
leaves out boat defenses": one battle played and two defenses (one in a
rollup day, one on the window's raw first day); it failed at 3 against 1
before the change.

**Not changed.** `services/web-api/src/first-answer.mjs` counts
`battles_30d`, `battles_7d` and `battles_previous_7d` through the same
`dailySql` without the flag; left for its own change.
