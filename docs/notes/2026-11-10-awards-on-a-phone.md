# 2026-11-10 — Clan Awards read on a phone

Feedback #386 (a leader, on Clan ▸ Awards): "This page doesn't display
well on mobile."

What was wrong: nothing overflowed, but every award race used the kit
`Table`'s default phone mode, `cards`. A race table has no header, so on a
phone each member became a block of three lines: the place alone on the
first (as the card's title), then the name and tag, then the figure, with
the secondary figure ("1,820 donated") indented under it. Six members took
a screen; a full clan's Perfect Attendance list took several.

What changed:

- **Races keep their columns** (`phone="fit"`, class `awards-race`):
  place, member and figure on one row at every width, nothing wider than
  the screen at 320 px.
- **The figure is one short phrase**, and what qualified it moved to a
  second, muted line under it: donations for a points tie, weeks seen for
  a donations total that is missing weeks, as Perfect Attendance already
  did. The words are unchanged apart from the brackets and the middle dot
  that joined them.
- **No double inset on a phone**: inside the award's panel the race's
  first and last cells drop their own padding, and the second line never
  breaks mid-phrase (`packages/design` components.css).
- `apps/web/e2e/clan/awards-phone.spec.ts` pins it at 320 and 375 px, for
  an open and a closed season: no element past the screen's edge and every
  race row on one line.

MCP 11.18.6 and JSON API 3.4.0 unchanged.
