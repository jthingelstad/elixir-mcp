# 2026-11-13 — Empty states, state pages and Settings, like Home

Part 3 of the sweep that brings every signed-in page to Home's bar (part 1:
You and the player page; part 2: Find, search and the bell). Layout,
styling and naming only.

- **The kit's empty state (`Empty`, and `ErrorState`, which is an `Empty`)**
  is words on the page, not a centred panel: no fill, left-aligned, the
  body at most 60ch, as Home's quiet lines are. Inside a panel it keeps
  the panel's 16px inset. One rule in `packages/design`, so every page
  that uses it changes together, Clan's included (recaptured; nothing
  else on Clan moved).
- **State pages** (`MissingPage`, "Nothing at this address", and
  `StaffOnly`) use the kit's `PageHead` and one Go to Home button in
  `.kit-home`, through one `StatePage` in `App.jsx`, in place of a
  hand-built centred card (`panel mx-auto mt-12 max-w-[420px]`, a 13px
  faint line). Same words, same heading. The signed-out wall
  (`SignInWall`) is not a signed-in page and keeps its card.
- **Names:** Settings' Profile and Players & following say Stats where
  they said Ladder (the page was renamed on 2026-11-12). An agent's
  Timeline names its evidence button with Home's `evidenceWord` ("Open
  session", "Open crossing") in place of "View games" / "View crossing";
  `docs/timeline-tool.md` and the e2e say so.
- **Touch:** `.input` and the tag boxes (`input.mono`, `input[data-tag]`)
  join the coarse-pointer 44px list beside `.select` and `.btn`, so a tag
  box is as tall as the Follow beside it (Settings' was 40px).
- **State pages' button** keeps its own width (`.kit-home__go`), not the
  column's.
