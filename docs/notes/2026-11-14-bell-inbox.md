# 2026-11-14 — The bell is a compact inbox (#1009)

No MCP tool, `/api/v1` operation, contract version, migration, route or
stored data changes. The web app's shell and kit CSS only. `GET /api/me/bell`
and `PUT /api/me/bell/seen` are read and written exactly as before, so the
route's query budget is unchanged and nothing new is scheduled.

## What was wrong

The bell was a full-height modal drawer on every width, with a sentence of
explanation per section ("What is about you, not your friends.", "Counts
only: never who cheered.") and a separate **Open** button on each line.
Escape closed it and left focus on `BODY`. The phone tab showed a dot with
no number. Coming back from a line opened a fresh bell with nothing marked.

## What it is now

- **Where:** a modal `<dialog>` either way. Wide, a popover of at most
  400 px, placed under the bar's bell from the trigger's rectangle
  (`--bell-top`, `--bell-right`), with a transparent backdrop. At 760 px and
  under, a sheet from the foot (85dvh, the scrim, safe-area padding). Reduced
  motion drops both entrances.
- **Order:** **Needs you** first on the raised panel (the needs rows from
  `/api/me/home/needs`, with "See N more in Clan"), then **New**, then
  **Earlier** (`bellGroups` in `bell-logic.js`). Each kind keeps its icon.
- **Rows:** one `Link` per line covering the whole row (`::after` inset),
  at least `--hit` (44 px) tall. Follow back is the one control left; it sits
  above the row's link. The needs `cta` labels are no longer shown.
- **Keys:** the title takes focus on open; ArrowDown, ArrowUp, Home and End
  move through the rows; Escape, **Close** and a tap on the backdrop dismiss
  and give focus back to the trigger that opened it (or the bell on screen).
- **States:** loading is three ghost rows under `aria-busy`; a failed read
  with nothing cached is the kit's `ErrorState` with Try again; a failed
  needs read is its own `ErrorState` inside Needs you; empty is "All quiet".

## Read and badge semantics

- The number counts what it always did (`bellCount`: Needs you, new since the
  marker, unread answers), and now shows on the phone tab as on the bar
  (99+ cap). The bar's name says it in words: "Notifications, 2 need you,
  4 new".
- Opening still moves `bell_seen` once; an answer is still new until it is
  read in Settings.
- New: leaving through a line keeps the keys still new (less the one opened)
  and the scroll in a module variable, so the bell reopened on return shows
  them marked where you were. Dismissing clears it. Nothing is stored or
  sent.

## Tests

`apps/web/e2e/bell.spec.ts` drives mixed, empty, loading, failed and long
states at 320, 390 and 1280 px with axe, the sheet's geometry (measured after
its entrance animation finishes; a box read mid-slide is a few pixels low),
44 px rows, no sideways scroll, the arrow keys, Escape's focus return, back
from a row, a tap outside, and reduced motion. `BELL_SHOTS=<dir>` saves a
capture of each. `test/bell.test.jsx` pins the same focus and keep rules in
jsdom; `test/bell-logic.test.js` pins `bellGroups` and `bellLabel`.
