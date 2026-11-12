# 2026-11-12 — What members see takes a thumb; a highlight leads with its words

Two polish fixes from the side-by-side walk, no behaviour changed.

- **Settings › What members see (G8).** At phone width 57 controls were
  under 32 px tall. Every link, button, input and select on the page is
  now at least 44 px at 760 px and below, the lens's battle included
  (scoped to `.st-seen`, so the battle page itself is unchanged). A follow
  slot's player row is one target: the name's link covers the row
  (`.kit-row--target`, `.kit-row__link`), with Stop following above it.
  The lens's "Open your player's page" left its paragraph to be a quiet
  button of its own. Pinned by `apps/web/e2e/members-see-targets.spec.ts`,
  which measures every control at 390 px.
- **The battle page's Highlight this battle (G9).** A posted highlight
  leads with its words, then "On <player>'s timeline", then Share and Edit
  words as ordinary small buttons and Delete as a quiet link that still
  asks first. The share link block and the edit form are as they were.
- **A flaky test fixed the day it was seen.**
  `services/web-api/test/attested-facts.test.mjs` took its read window
  before writing two facts, so on a loaded machine the kick was recorded
  after the window closed and the leader seemed not to see it; the window
  is now taken after the writes, and each write is asserted.

No contract or JSON API change; no What's new entry (polish).
