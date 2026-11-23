# 2026-11-23 — The top bar and the iOS blur

Jamie (2026-11-23), with a screenshot of the Timeline on a phone: "There
is something blurring the top part of the display in Elixir."

**The cause is the phone, not a style of ours.** An installed web app on
iOS 27 (reproduced in the simulator on 27.0 and 27.2, in the real
Home Screen container) blurs and dims whatever a page draws in roughly
its top 100 points when the page asks to draw under the clock
(`viewport-fit=cover`, added 2026-11-10 with the install tags). Elixir's
bar sits at 62 to 116 points there, so it was soft at rest and smeared
as soon as the page moved 14 points. Elixir's stylesheet has no blur
anywhere near the bar.

Nothing a page that draws under the clock does turns it off. Tried in
that container, each still blurred: a sticky bar, a fixed bar, no
clock-covering strip, a strip that takes taps, a page whose root does not
scroll, and each of the three status bar styles (iOS 27 lays all three
out the same way).

What shipped:

- **The page is laid out below the clock.** `viewport-fit=cover` is gone
  from `apps/web/index.html` and the site's `base.njk`, and a site test
  pins its absence. Every `env(safe-area-inset-*)` is zero in that
  layout, so the rules that read them are gone too: the bar's top
  padding and its clock-covering strip (`.kit-shell::before`), the tab
  bar's bottom padding, the side insets, and the full-screen search and
  help sheets' clearances.
- **The bar stays at the top of a phone** (`position: sticky` at 760px
  and under, where the tabs already stay at the foot). Both halves are
  needed: laid out below the clock but with a bar that scrolls away, iOS
  still softens it. With a solid bar at the top edge iOS drops the blur
  and fills the clock's strip with the bar's colour, and it does the same
  under the home indicator with the tab bar's.
- **`--kit-top-stuck`** is the height of a bar that stays put (54px on a
  phone, zero elsewhere). `scroll-padding-top` and the Timeline's "new"
  pill start from it, so a jump to a heading lands under the bar, not
  behind it.

Wider than a phone the bar scrolls away as before.

Checked in the simulator's Home Screen app on iOS 27.2 against this
tree's build: the signed-out bar on a docs page at rest and after a
swipe, the signed-in shell and its tabs, a jump to a heading, the bell's
list and the help sheet. Not checked: an iPad, and an installed app on
iOS 18 or older, where a page laid out under a translucent status bar
may show its content passing behind the clock above the bar.

MCP and JSON API versions unchanged.
