# 2026-11-13 — Polish round two: the Clan head and Stats' scope bar

Round two of the polish pass, from the design lead's review of round
one's captures. Layout, styling and label wording only: the same reads
and the same rules.

- **The Clan head at Home's density.** On a phone the crest sits beside
  the role line and the name only; the clan's line, its chips and the
  actions start on the page's gutter. The line is one span per part
  (`lineParts`), each `white-space: nowrap`, so it wraps only between
  parts ("invite / only" can no longer split). Each part carries its "·"
  in front; the line starts one separator to the left and clips it
  (`clip-path`), so no line, first or wrapped, starts with a dot.
  **Roster read** left the side column and is the line's quiet last part
  (no pill fill; its 44px target overlaps the line's own space). Follow
  and the clan picker share one row. `clanLine` still joins the parts
  with " · " for the tests and any text reader.
- **Clan's six tabs scroll.** The ≤480px rule that squeezed six tabs and
  the Feed's count into 390px (shared slack, 13.5px labels, no gap) is
  gone: the row scrolls under the kit's fade like every other tab bar,
  each tab still at least 44px wide.
- **Stats' scope bar on a phone** is one quiet line of chrome. With one
  player there is no picker, and the player's name already leads the
  head's sub line, so the bar's own name tag is hidden at ≤900px
  (`.ladder-scope--frame`; `Pending.jsx`'s bar keeps its picker). The
  season select sits at its own width with the freshness line beside it
  as plain text (no pill), and the mode chips follow.
- **"since Mon Sep 7, 5:00 am"** on the Battles tile parts only at its
  comma (`SinceWhen`), so "since" never sits alone on a line and the time
  never splits from "am".

Tests: `apps/web/test/clan/clan-card.test.jsx` (the line's parts, Roster
read last, the actions in their own cell), `apps/web/test/ladder-since.test.jsx`.
