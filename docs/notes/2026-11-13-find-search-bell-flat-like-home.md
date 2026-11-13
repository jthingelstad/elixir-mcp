# 2026-11-13 — Find, search and the bell, like Home

Part 2 of the sweep that brings every signed-in page to Home's bar (part 1:
You and the player page). Layout, styling and time format only; the same
reads, rows and words.

- **Find's tabs scroll in one row** (the kit's `Tabs` without `wrap`), as
  the player page's six tabs do, with the kit's scroll hint. Wrapped, the
  five tabs took two rows on a phone and pushed every section below the
  first screen. The `wrap` option stays in the kit; nothing uses it now.
- **The bell's sheet:** a section's rows (`.kit-bell__sec .kit-row`) lose
  the 16px inset a panel row carries, so they line up with the section
  heading and the sheet's own lines.
- **The search sheet:** each result is at least `--hit-touch` (44px) tall,
  not 39px.

Left as designed: Find's own-clan panel keeps its gold top
(`--edge-mine`, the token for your own clan); the bell's "Departed Fri
6:13 am" line comes from Home's own needs rows (`home/logic.js`), which
Home shows the same way; From your battles keeps `when` ("last Tue
4:53 am"), because Home's `feedWhen` would read "last Today, 3:52 pm".
