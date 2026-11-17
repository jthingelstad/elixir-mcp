# 2026-11-17 — The Timeline by mode

Jamie, 2026-11-17: "I think a player should be able to filter the
timeline by these same groups: Trophy Road, Ranked, War, Casual". The
Timeline now has a **Mode** list beside its Show chips: All modes (the
default), Trophy Road, Ranked, War, Casual.

## One mapping

The four are a fold of the one mode-group vocabulary, never a second
one: `TIMELINE_MODES` and `timelineModeOf(group)` in
`packages/contracts/src/modes.ts`, beside `modeGroupOf`.

| Mode group | Filter |
| --- | --- |
| `ladder` | Trophy Road |
| `ranked` | Ranked |
| `war` | War |
| `casual`, `challenge`, `event`, `tournament` | Casual |
| anything new | Casual (as `modeGroupOf`'s own fallback) |

Home's week chips show Event as a fifth chip; the filter folds it into
Casual because Jamie named four.

## Which items sit where

`KIND_MODES` in `services/web-api/src/feed.mjs` names every kind the
timeline builds. `modesOf(item)` answers the filters an item sits under:

- `battle_session`, `session_standout`: each mode in `facts.by_mode`,
  folded and deduplicated (a session played on Trophy Road and in Ranked
  is under both).
- `battle_highlight`: its battle's mode; `post`: the attached battle's,
  else none.
- `arena_changed`, `best_trophies_band`: Trophy Road. `ranked_promotion`,
  `ranked_season_finished`: Ranked. `challenge_best_run`,
  `twelve_win_run`: Casual. `bracket_observed`, `race_finished`,
  `week_resolved`: War. `deck_switched`: its `facts.mode`.
- Everything else (badges, cards, levels, clan membership, quiet and
  return, account, attested and people kinds): no mode.

**Items with no mode** show under All modes and are hidden under a mode.
A filter that kept them would be the same "badge earned" under all four,
which is the noise the filter is asked to remove. An **unknown kind** has
no mode, so it is never lost from All modes, and
`services/web-api/test/feed-modes.test.mjs` fails until each kind in the
timeline, people and attested schemas is classified.

## Where it filters

The server filters: `GET /api/me/home/feed?mode=<ladder|ranked|war|casual>`
filters the kept week (and the live posts beside it) before the page is
cut, so every page holds thirty items of the mode and More reads the
next thirty of the same mode. The cursor carries the mode; a cursor from
another mode, or an unknown mode, is a 400. Under a mode the response
adds `mode` and `week_total` (the whole week's size, so an empty mode in
a busy week is told apart from a quiet week), the Show chips' counts are
that mode's, and the "N more this week" line is not drawn. The Show chips
stay a client filter over the loaded pages, as before.

In the app the mode is in the address (`?mode=`), so a link and Back and
Forward keep it, and it is kept per account in this browser
(`elixir.home.mode:<account>`), the same as the Show chip; a bare
`/timeline` restores it into the address. Each mode is its own query
(`["me","home","feed",<mode>]`); cheers, seen marks and own-post refreshes
reach every copy.

The list carries no counts: they would cost a second read of the week,
and a session in two modes makes them add up to more than Everyone.

## Not changed

- The **N new** button still counts the whole week, every mode.
- Clan's Feed, the player and account pages and Profile keep their lists
  unfiltered: the request named the Timeline.
- MCP (`elixir_timeline`) and `/api/v1` are unchanged; no contract bump.
  Only the web API's feed read changed.
