# 2026-11-13 — Design pass three: the shell on a phone

Third design pass, part 1. At 390px with a touch pointer, every control
in the shell and on the signed-in pages, the front page, sign-in and
sign-up takes a tap 44px across. Style only, beyond one class name on a
handful of links; no words, reads or behaviour changed.

- **How** (`packages/design/src/components.css`, the `pointer: coarse`
  block, as #888 did): a control keeps its drawn size and a centred
  `::after`, at least 44px each way, takes the tap. The top bar's help
  and account buttons, the signed-out bar's links, panel-head links,
  Home's feed names, a battle's names and cards, the clan Feed's "Open
  the battle", the front page's row links, and anything marked `.hit`
  (member names in Clan, people's names on Home and Find, Settings'
  standalone links, sign-up's checkbox and age choices). The brand,
  "Sign in" and selects grow to 44px by `min-height`; the footer's links
  by padding, its rows now 44px apart instead of 28.
- **Clan's tabs** under 480px are each at least 44px wide (War and Run
  were 38), the padding taken from the wider ones.
- **A roster card** on a phone already gives its whole row to the name
  (a stretched link); `.hit` stands aside there so the row keeps it.
- **A battle's decks:** the cards as drawn, 10px apart instead of 6, so
  each tap box reaches 44px without crossing a neighbour.
- **Side by side** on a battle's page scrolled sideways at 390px; under
  480px its cells take 6px padding and it fits.
- **Pinned** by `apps/web/e2e/touch-targets.spec.ts`: Home, Clan's
  Feed, Members, War and Standings, a battle, the front page and sign-up
  at 390px with touch, each control hit-tested 20px out from its centre.

Exempt, by WCAG 2.5.8's inline exception: links inside a running
sentence (the disclaimer's link, "send it as feedback", "How limits
work", "See a recorded battle", sign-up's "Create an account" and its
Privacy, Emails and Terms). Left: the tab rows on You and Stats and
Stats' mode chips still scroll sideways at 390px, as the kit's tab rule
says they do.
