# 2026-11-13 — The tap check waits for the page to settle

`apps/web/e2e/touch-targets.spec.ts` failed main once (Home, "Open in
Stats") and passed on retry. Locally it missed 5 runs in 40: "Open in Stats",
and the footer's "Terms" and "Play Drop". The check read the page's height,
made the viewport that tall and hit-tested at once. A panel that finished
loading after that first read made the page taller. Then a tap 20px below
the last footer row fell outside the viewport, and the rows above it moved.

`misses()` now settles first: fonts loaded, no `aria-busy` skeleton, and
the viewport resized until the page height holds across two frames. After
the change the Home case passed 120 runs in 120, and the whole file passed
15 times over. Nothing in the app changed.
