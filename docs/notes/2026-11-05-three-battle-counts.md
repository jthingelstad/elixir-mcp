# 2026-11-05: Three battle counts for one clan's week

Step 1 part b of the redesign (A13). One clan's week showed three battle
numbers. The test that proves each cause and the agreement is
`packages/tools/test/clan-week-counts.test.mjs`.

## The three, and why they differed

| Surface | Reader | Before | Cause |
|---|---|---|---|
| Clan report | `clanActivityWeeks` | `battle_time` in the game week, this clan, each battle once | The reference. Nothing wrong. |
| Friends mail | `buildClanEntry` | battles learned in the window, by `created_at` | Observed basis: a late capture landed in the wrong week. |
| Clan's The week | `manage.weekView`, `clans_participation` | per-member sum over ISO weeks, Monday 00:00 UTC, any clan, today's members | Ten hours off the game week, other clans' battles counted, departed members lost, a two-member battle counted twice. |

Boat defenses were also counted by `buildClanEntry` and not by the others.

## The fix

- `clanWeekBattles` (`packages/record`) counts one clan per window, the same
  rule as `clanActivityWeeks`, and also names the people. The week's battles
  and ranked areas read it. A failed read leaves those areas out; it never
  falls back to the ISO column.
- Friends and clan mail read `buildClanEntry` with `basis: "occurred"`. On that
  basis `activity` counts battles played in `[from, to)`, including late
  captures. Boat defenses are out on both bases.
- The week's membership, its dates and `so_far` run on the reset. Member
  activity moves whole: its battles, donations, week bounds and window, so a
  battle it lists falls in a week it totals. A war week's bounds there keep the
  window's Monday, so a first read just before the reset does not make it unknown.
- The week says what it counts on the page, including that departed members
  are in battles while donations and war decks are for today's members.

## What stays different, and says so

- `clans_participation` keeps ISO weeks. Standing and policy read those
  columns and moving them changes what policy sees, which is a separate
  change. `clocks.md` says ISO. [engineering, 2026-11-05]
- An observed read of `buildClanEntry` keeps counting what was learned, for
  polling. It says `basis: recorded` and the busy-window note explains it.
- A number after the week closes can still rise when a battle log is read late.
  Each surface reads at its own time, so mail sent Monday can be a little below
  a later read of the page. No stored copy is rewritten.

## Query shape

No migration. `clanWeekBattles` is a materialized CTE over
`battle_participant_clan_time` (`clan_tag, battle_time desc`, migration 0089),
with the windows' outer edges as constants so the range holds however the
windows are joined. Checked with `explain (analyze, buffers)` on a scratch
database of 600,000 battles over 50 clans: two weeks in 3.4 ms, bitmap index
scan on that index with clan and time both in the condition. The local check
says nothing about the live table's statistics.
