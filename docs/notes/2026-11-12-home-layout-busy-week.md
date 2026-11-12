# 2026-11-12 — Home's layout in a busy week, pinned (G3, Home half)

G3 of the side-by-side walk found Home 20,870 px tall. Two things made it
so: the feed drew a busy week's 150 items at once, and the side panels
could only be seen after it. The layout was already two columns
(`.kit-home__two`, 3fr and 2fr, with the panels beside the feed above
760 px and after it on a phone). Thirty items a page (G1, #800) makes the
difference.

A new journey, `apps/web/e2e/home-layout.spec.ts`, draws a 150-item week
at 1180 px and at 390 px. It holds that the panels sit beside the feed
with their tops level, that a phone reads the feed first, that the page
stays under 5,000 px and 6,500 px, and that More adds the next thirty.
Measured with its fixture, thirty items and the panels come to 3,471 px
wide and 4,676 px on a phone; the 150 at once came to 15,137 and
16,342.
