# 2026-11-17 — The Timeline's freshness note no longer covers its title at 320px

On a phone, Home's head puts the battle log's freshness note (`FreshChip`)
on the title's row, out of flow (absolute, right), with
`max-width: calc(100% - 120px)`. "Timeline" in the display face at 32px is
about 152px wide, so at 320px the note (about 168px) started at x=136 and
covered the title's last letters.

- Beside the title, the note now leaves the title's width
  (`calc(100% - 166px)`) and its words are one line, cut with an ellipsis
  if they ever run long (`.kit-fresh__text`, a span `FreshChip` now wraps
  its words in, for every page; no other page styles it).
- Under 375px the note is static, ordered first in the head's side, on its
  own line under the title and above the chips.
- The width decides which, never the note's words, so "Checking for new
  battles…" and back, or an aging read, moves nothing.

Checked the other heads with a freshness note at 320 and 390: Clan
(`ClanHead`, the note is a line of its own under the clan's facts), Stats
(`ScopeBar`, its own row under the season list) and the player page (no
note, a button) do not overlap. Profile (`/home/you`) has none.

`apps/web/e2e/home-head.spec.ts` checks at 320, 360, 374, 375, 390 and
420 that the title's words and the note's chip do not intersect, that the
note is one line, that nothing scrolls sideways, and that changing the
note's words leaves the chips where they were. Without the CSS change it
fails at 320 (intersection) and at 360 and 374 (not on its own line).

MCP and JSON API unchanged; no migration.
