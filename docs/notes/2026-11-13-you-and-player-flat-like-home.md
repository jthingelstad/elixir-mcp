# 2026-11-13 — You and the player page flat, like Home

Part 1 of the sweep that brings every signed-in page to Home's bar after
Clan (#955, #956, #958). Layout, styling and naming only: the same reads,
the same words for the same facts, the same buttons, nothing anyone can
see or do changed.

- **The player head (`.kit-phead`)**, on You and every player page, loses
  its card and violet wash, as Clan's head did in #955: avatar, name,
  line, badges and counts sit on the page. On a phone the avatar is 56px
  beside the name (not 84px above it) and the actions take their own row,
  so the timeline starts on the first screen. The page and You no longer
  add 16px (32px on You) above the head that Home's title does not have.
- **Times:** the timeline, Highlights and Moments say when as Home's feed
  does (`feedWhen`, `feedDayHeading`: "Today, 3:37 pm", "Today"), with the
  exact time as the `<time>` title, instead of `when`/`dayHeading`
  ("Fri 3:37 pm", "Friday, November 13").
- **One name for one button:** a sitting's toggle is Home's "Open session"
  / "Close session" (a crossing's "Open crossing") as a `btn btn--sm`, not
  a 20px "View games" link. `evidenceWord` in `Session.jsx` is now the one
  definition; Feed's private `openWord` is deleted. The agent Timeline page
  in Settings keeps its own words (part 3).
- **Moments** drop the panel round them; each tile is Home's card surface.
  **Highlights' card** keeps its gold crown line and display title on
  Home's card surface, without the gradient. **Empty tabs** are one quiet
  line (`kit-week__quiet`, as Home's chips say theirs), not a panel.
- **You's account panels** keep the page's 820px reading column on a wide
  screen instead of running the full width under it.
- **Stats:** the Form tables (This week vs your last 4, This season vs
  last, Before and since) and Week by week's lines drop the global `th`
  monospace for the kit's face with tabular numbers, as `kit-stat` does.
  "Send feedback about Ladder" and the About text say Stats, You's tab's
  name since 2026-11-12.

Left, with why: the kit's `Empty` and `ErrorState` box (part 3, a kit
change that touches Home and Clan too); the battle page's layout (a
standing ruling); Clan's Member activity still says "Ladder" (Clan was
not in this sweep's scope).
