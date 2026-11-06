# Ladder's scope bar (redesign step 5)

The rail is gone. `ScopeBar.jsx` draws Player, Season, the mode chips and the
freshness chip above four tabs; every tab is an address that keeps player, mode
and season. `/ladder/days` moved to `/ladder/battles` (in `lib/moved.js`, query
kept).

Reads, so nobody re-derives them:

- The bar's read is `battles_performance` with no mode, only to learn which
  chips to draw. It shows no rate.
- The calendar is one no-mode `battles_query` sweep for the season, shared by
  every chip, so changing chip reads nothing again. It counts other modes on a
  day apart; it never adds them to this mode's.
- Battles is a sweep of this mode only. Its cap says the newest N, since it has
  no calendar to mark.
- Decks is one `battles_decks` read for the mode and one per deck for its art, so
  a chip costs its deck count. Duel rounds are their own panel on War.
- Other is two reads, Challenge and Tournament, and two panels. Never pooled.
- The War line is `war_current` plus `war_history`. A refused read draws no line.

Choices tagged [engineering, 2026-11-05]:

- A sitting that crosses midnight splits, so a day's panel matches its day on the
  calendar.
- The default chip counts Casual now that it is a chip, so someone who mostly
  plays Casual opens there.
- "None recorded in this mode, some in others" for the key, since a partly read
  day cannot prove none.
- A season's edge always names its date. `when()` drops the date within a week,
  which read as "runs Mon Sep 7 to Mon 5:00 am".
- A friendly's row reads "Casual", per "Casual everywhere".
