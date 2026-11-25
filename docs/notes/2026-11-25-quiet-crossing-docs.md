# 2026-11-25 — A friend's quiet crossing, as the docs tell it

The tool page said a member's `quiet_crossed` item is made at 5, 10 or 20
quiet days. For a clan's timeline that is true. For a followed player it
has not been the whole story since the look-back became one week
(`docs/notes/2026-11-23-timeline-one-week.md`).

`buildTimeline` lists a player under `quiet`, and drops what their entry
built, when the entry says nothing else in the window (the `said` gate;
`saidStories` applies the same gate to stored rows,
`docs/notes/2026-11-24-timeline-story-read.md`). A quiet crossing says
nothing by itself. At the 5-day rung the last battle is still inside the
week, so the crossing is told. At 10 and 20 days it is not, unless the
player's week holds something else (a clan move, a war week).

Jamie agreed on 2026-11-25 to keep that behaviour and correct the docs: a
one-week timeline should not reach past the week to tell a longer
silence, and `quiet` already carries `days_quiet`.

## What changed

- `apps/site/src/docs/timeline-tool.md`: one paragraph after the `quiet`
  list's description, saying when a followed player's crossing is told and
  that a clan's timeline tells every rung.
- `docs/DECISIONS.md`: the line.

No code, tool or schema change.
