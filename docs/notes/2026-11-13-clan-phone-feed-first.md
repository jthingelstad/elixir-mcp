# 2026-11-13 — Clan on a phone: the timeline first

Reviewed on a phone after #955 and #956, the Clan Feed's timeline started
about four screens down, under the head's chips (wrapped to four rows),
the race bar, a large centred "Nothing waiting for you" box, This week
and You in the clan. Layout and styling only: nothing a member, Elder or
leader sees or can do changed.

- **The Feed on a phone is one column in DOM order:** head, tabs, race
  bar, what waits for you (when something does), the timeline, then This
  week and You in the clan. The `.clan-today` phone rules that opened the
  main column (`display: contents`) and ordered the side cards before the
  timeline are deleted, and so is the `.clan-today__timeline` wrapper.
  Desktop keeps its two columns.
- **Nothing waiting is one quiet line** (`page-head__note`), on the Feed
  and on Run's Waiting, which share it: "Nothing waiting for you: an
  action appears here when the clan's policy suggests something you can
  do." with Refresh suggestions beside it. It drops the sentence on when
  Elixir reads the clan; `/docs/clan-actions` still says it. Who sees
  actions, and the actions themselves, are unchanged.
- **The head's chips on a phone are one row that scrolls sideways**
  inside the head (`overflow-x: auto`, no scrollbar), with the kit's fade
  on the edge that has more. The kit's `useScrollHint` is now exported
  and takes `{ focusable }`: a row of facts that overflows is a tab stop
  (so a keyboard can scroll it, with a focus ring) and stops being one
  when it fits. The chips are their own component, keyed by their
  content, so the hint measures the row when it first draws. Same chips,
  text and order; on a wider screen they wrap as before.
- **The clan directory on a phone folds its filters** behind a Filters
  button (`aria-expanded`, `aria-controls`), closed at first, saying
  "Filters · N set" when any are set. Search stays in view and is not
  counted. Wider, the button is never drawn and the filters sit in the
  form's row as before (`.clan-dir__more` is `display: contents`).
  Filters still only hide tiles.
- **What's new numbers:** two entries had taken 2026-11-13-227. The later
  one to land (`event-duels-count-their-decks`) is now 230.
  `apps/site/test/updates.test.mjs` now refuses two entries sharing a
  day's number; the nine pairs that already did (2026-10-10 to
  2026-11-13-218) are a frozen list that can only shrink, since
  renumbering one would move it within its day.

MCP and JSON API unchanged. No migration.
