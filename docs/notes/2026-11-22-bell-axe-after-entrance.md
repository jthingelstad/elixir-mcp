# 2026-11-22 — The bell's accessibility check waits for the sheet

Two Playwright journeys failed on a busy machine and passed alone, twice
in one evening: `bell.spec.ts` ("a claimed follower is named...") and
`new-home.spec.ts` ("the bell: lit while something needs you..."). Both
reported `color-contrast` on nearly every line of the bell's sheet at
once.

The sheet fades in (`kit-bell-in`, from opacity 0). axe reads colour
through opacity, so a check that starts mid-fade sees every line as too
faint. Some bell tests waited for the entrance (`settled`) before checking
and some did not; which ones lost the race depended on load.

`accessible` in both specs now waits for every open dialog's animations to
finish before axe runs, so no test has to remember. No product change: the
sheet's colours were never wrong.

Tests only. MCP and JSON API unchanged.
