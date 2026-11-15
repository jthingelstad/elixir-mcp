# 2026-11-14 — Stats ▸ Cards answers one question

Jamie's feedback review (2026-11-14) asked the Cards page to decide what
question it answers and cut everything else, legible at 390px with tabular
numbers. The question: **the cards you played, and the cards you faced, in
one mode this season.**

- Two panels, "Cards you played" and "Cards you faced" ("they" on a
  followed player's page), each a kit `Rows` list instead of a `Table`. At
  390px the table stacked every row into a three-line label and value card
  (the page ran about 5,300px); a row is now one line of 40px art, the
  name with "N battles · X% won", and the record on the right in tabular
  figures. The name is the row's one link (the `kit-row--target` pattern),
  so the whole row is the tap target; a tower troop has no link.
- Each panel names its mode and count ("35 Trophy Road battles"), so no
  list reads as pooled. Other still reads Challenge and Tournament apart.
- Cut: the Opponents panel and its `battles_opponents` read, the
  Most faced / Most losses chips and `?order=losses` (`statsHref` drops an
  old `order` param), the Level gap column and the rows/cards counter.
  The tools keep `sort: "losses"` and `mean_level_gap` for agents; no
  contract change.
- Kept: the tools' order (most battles first), a form as its own row,
  the floor line, twelve rows then "Show all N", art sized by CSS alone.

DECISIONS: "Stats ▸ Cards answers one question" replaces "What you faced
is ordered by the reader" (2026-10-08); the Stats brief's principle 5
follows. MCP and JSON API unchanged.
