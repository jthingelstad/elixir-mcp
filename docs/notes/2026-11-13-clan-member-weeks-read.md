# 2026-11-13 — A member's weeks in the clan read the member's own range; the database stays small

## The in-clan test, everywhere a read also names the player

`2026-11-13-participation-cold-read.md` wrote the members' last battle
in the clan as `bp.clan_tag is not distinct from cm.clan_tag`, so only
the player/time cover can serve it, and left two reads with the same
`player_tag = ... and clan_tag = $n` shape:

- Clan's member drill-down, `memberActivityWeeks`
  (`packages/record/src/member-activity.mjs`, also the clan model's
  donation dossier): a member's battles and ranked battles per week.
- clans_participation's `former_battles_by_week`: a former member's
  weeks, this clan's only.

Both now write the clan test with `inClan` (participation-sql.mjs):
`bp.clan_tag is not distinct from $n::text and $n::text is not null`.
IS NOT DISTINCT FROM is not an index condition, so
`battle_participant_clan_time` cannot serve the read. The parameter can
in principle be null, where IS NOT DISTINCT FROM alone would count the
member's clanless battles and `=` counts none; the `is not null` keeps
`=`'s answer (the planner folds it, and a null clan reads nothing).
Neither caller passes a null today: the clan comes from Clan's route
or the clan's Action.

The drill-down's battle count also takes the boat predicate's side by
primary key for boat rows alone (`OWN_BATTLES`, as participation does):
the cover has no side, so `bp.side` made every count fetch each
battle's heap page.

Measured on a fixture of a clan's two months (50 members, 600 battles
each, opponents from clans of their own, one battle to a heap page),
four weeks, warm buffers:

| Read | Before | After |
| --- | --- | --- |
| drill-down, a member with battles here | 364 | 118 |
| drill-down, a member with some clanless battles | 349 | 84 |
| drill-down, a member who played for another clan | 327 | 44 |
| drill-down, a null clan | 0 | 0 |
| former members' weeks (four members) | 225 | 225 |

The fixture never planned the old statements on the clan index: unlike
the last battle (a max, which the planner can read as the clan index's
newest-first walk), a bounded week count costs the clan's window above
the player's range. The change makes that plan impossible rather than
fixing a measured one; the drill-down's saving is the index-only read.

Every answer is unchanged: `cold-read-plan.test.mjs` pins each read's
rows (a null clan's too) against the `=` statements, that each enters
the player cover index-only with no heap fetches and never the clan
index, and buffer ceilings; no milliseconds.

## The database stays on db.t4g.small

Jamie, the evening of 2026-11-13: "lets plan to leave the database on
small for a few days while we settle the pivot in Elixir... we'll
consider it an optimization when we are on the other side to bring it
back down to the size we want long term". `infra/template.yaml`,
`infra/AGENTS.md`, `docs/OPERATIONS.md` and the database line in
`docs/DECISIONS.md` said "one build session" or "the micro"; they now
say the small since that evening, the micro a later optimization, not
scheduled. OPERATIONS keeps the micro's limits and says which size they
describe, with the evening's measurements: on the micro seven gates in a
day drew the byte balance to 42% (floor 50%); on the small it read 99%
with about 858 MB freeable, and the full gate passed 131 of 131 with the
timeline's first read at 1.9 s (4.8 to 7.8 s on the micro).
`DBInstanceClass` is unchanged.

No migration, contract, tool or web change, no What's new entry.
