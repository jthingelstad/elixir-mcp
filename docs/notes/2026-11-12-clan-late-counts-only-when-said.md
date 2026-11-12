# A clan's late counts are read only when a read says them (#649)

2026-11-12, round two of the feed-speed work.

## What `elixir_timeline#1` spent

The acceptance case `elixir_timeline#1` (a compact month of one clan,
`sections: ["roster"]`, kinds `member_joined` and `member_left`) took
7.4 s on its last run. `{explain_timeline}` of the same clan and month
(as an agent of it, 2026-11-12 about 17:50 CT):

| statement | ms |
| --- | --- |
| `clan.learned` | 3,453 (cold); 648 replayed warm |
| `clan.member_battles` | 1,912 |
| `clan.sessions` (deck names) | 899 |
| `clan.quiet_gaps` | 354 |
| `clan.learned_later` | 308 |

The warm plan of `clan.learned` puts 520 of its 648 ms, and 319,118 of
its 357,412 buffers, in the late count: it walks the 71,314 battles
learned in the month, 67,193 of them late captures (history backfills of
every recorded player), and probes each one's participants for the clan.
Cold, those probes are reads all over `battle_participant`.

## What changed

The late count (`activity.late_captures`) and the battles learned after
the window (`activity.played_here_learned_later`) are said only in a clan
entry's `activity` section: no sentence, item or note reads them once
that section is dropped. A compact read, or a `sections` filter without
`activity`, drops it. Such a read now leaves both counts out
(`lateCounts: false` through `buildTimeline` to `buildClanEntry`, and
`clanLearnedQuery({ late: false })`). The narrated count, which decides
whether member battles are read, is unchanged; an occurred read keeps
its late count, which is the clan's own range and gates its member
battles. Every other caller (Home, mail, the explain op) is unchanged.

The answer is the same: the response never carried either count when
the section was dropped. Tested: the lean entry equals the full one with
the two counts nulled, and the lean statement never walks the window's
battles.

`clan.quiet_gaps` read its members' battles with `player_tag = any($1)`;
it now reads them per member (`unnest` with a lateral per tag, the
`perTag` form of #806). Same rows.

## Not changed, and why

A full read (no `sections`, full verbosity) of a month still pays the
late count. A stored per-clan late-capture table (a trigger on
`battle_participant` insert, or a rollup by learned day) would make it
cheap for every read, but it adds a write on the ingest path and a
backfill over every battle; it was not needed for the acceptance case
and is left as the next step if full month reads matter.

`clan.member_battles` (a month of the clan's battles, 12,766 rows) reads
`battle` by a parallel sequential scan and is needed by the entry's
sentence, which compact keeps; it is the next cost in `#1`.
