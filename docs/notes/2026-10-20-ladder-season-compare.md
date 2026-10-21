# 2026-10-20 — Ladder: this season beside the last, and war battles by day

Two of Jamie's rulings on Ladder, 2026-10-20. No contract change: MCP
11.13.1 and JSON API 3.2.0. The deploy runs no acceptance family: no
tool's declaration or output changed, only the web app, the shared
`@elixir-mcp/record/form` shaping and docs.

- **War battles by day, recorded (A).** Asked whether Ladder's own
  battle calendar is exempt from war being shown only by the week, Jamie
  answered: "yes, ladder is treating battles individually. War activity
  for the week is ONLY because we are using the clan wars week. It is
  about the clan wars, not the battles." No behaviour changed: Days
  played already sets each war battle on its day. New DECISIONS line
  beside "War facts are weekly aggregates" (that line is unchanged),
  principle 6 in `docs/product/ladder.md`, a sentence on Days played in
  the public docs, and one line in `Days.jsx`'s header so the listing
  is not "fixed" later. No Ladder code, test or doc applied the weekly
  rule to the listing. The public docs' "no surface splits a member's
  week by war day" (`clocks.md`, `architecture.md`, `battles.md` under
  `apps/site/src/docs/`) is about the game's war-day rollover and its
  weekly counters; Days played uses calendar days in the reader's zone,
  so those lines stay.
- **This season vs last (B).** Asked "Ladder (optional): add a 'this
  season against last season' comparison for one mode?", Jamie said
  "Sure." `SeasonForm` in `apps/web/src/ladder/Form.jsx`, on the season
  home between the week and the deck panels, in the page's one mode.
  A running season shows three columns, `<season> so far`, `<last> to
  the same point` and `All of <last>`; a past season (`?season=N`) shows
  N beside N-1, both whole. Rows: won–lost (with draws when there are
  any), win rate, net trophies (Trophy Road and Path of Legends), decks
  played (`battles_decks`' `total_decks`), each with its count. The foot
  says how the same point was cut, how long each season ran, when the
  record began partway through last season, where the arena floor
  applied, and that the numbers do not say why the seasons differ.
  Shaping: `samePointWindow` and `seasonSide` in
  `packages/record/src/form.mjs`; `previousSeason` and `seasonRows` in
  `apps/web/src/ladder/ladder.js`; `recordedSeasons` now carries each
  season's start (`startsAt`, from the window's season or the cross's
  `at`).

Reads added (each against the hourly 300, cached as every Ladder read,
5 minutes, under `["me", "ladder", tool, args]`):

| Case | Added | Keys |
| --- | --- | --- |
| Running season, both of last season's sides at the minimum | 3 | `battles_performance` {season N-1, mode, compare_from, compare_to} (new); `battles_decks` {season N-1, mode, limit 100} (the Decks page's key); `battles_decks` {mode, from, to, limit 1} (new) |
| Past season | 2 | `battles_performance` {season N-1, mode} and `battles_decks` {season N-1, mode, limit 100}: the Season and Decks pages' own keys for N-1 |
| Last season under the minimum or empty | 1 | the `battles_performance` read |
| This season under the minimum, or no season before on record | 0 | |

This season's side is the season home's own `battles_performance` read
and DeckForm's `battles_decks` read of the season (the same key).

Defaults taken [engineering]:

- **Form's minimum per side.** The comparison is a Form reading, so
  "Form is numbers only" applies: a side under `FORM_MIN_BATTLES` (10
  decided battles) is not set beside another. This season under it:
  one sentence, nothing read. Last season under it (or empty): one
  sentence. The same point under it: that column drops out with a
  sentence, and all of last season stays.
- **The same point** is last season from its start to as far in, to the
  whole hour, as the running season is when the page opens (held while
  it stays open). Under an hour into a season, or once this season has
  run as long as last season did, there is no same point: all of last
  season stands alone, and the foot says why.
- **Last season** is the next season down in the record's own list (the
  picker's), read by its number; its start is the record's, not a
  calendar's. No season before on record: a sentence, no read.
- **Partial record.** When `recorded_since` falls after last season's
  start, the foot says the record began partway through it.
- **League movement is left out**: no read Ladder makes carries it. The
  three-crown rate and the trophy range are left out to keep the table
  to the asked facts.
- **The panel draws only when this season has battles in the mode** (as
  the rest of the season home's body).

Tests: `packages/record/test/form.test.mjs` (same point, season side),
`apps/web/test/ladder.test.js` (seasons' starts, `previousSeason`,
`seasonRows`), and eight journeys in `apps/web/e2e/ladder.spec.ts`
("Ladder this season vs last", one `@narrow`), with the fixture
answering Season 135 (and an optional 134) per mode.
