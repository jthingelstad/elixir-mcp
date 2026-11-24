# Two flaky tests fixed

2026-11-23. Flaky tests are defects, fixed the day they are seen.

- **`apps/web/e2e/cheer-tap.spec.ts`, the layout-shift check.** It read
  the card's height as soon as the card appeared, while fonts and images
  could still grow it, and failed once in CI on #1232. Both reads now
  wait for `document.fonts.ready` and a height that holds across two
  frames (`settledBox`). A real shift persists, so the check still
  catches one. It passed 200 of 200 runs locally.
- **`services/web-api/test/own-refresh.test.mjs`, "older battles new to
  Elixir are new to the record".** It failed 2 of 6 runs alone, and this
  one was a product bug. The check's `since` marker is the database clock
  cut to milliseconds, while `battle.created_at` keeps microseconds. A
  battle stored before the ask in the same millisecond therefore counted
  as one the check found. The marker is now rounded up to the next
  millisecond (`profileFacts`), so a row written before the ask is always
  older. The check's own reads come far later than a millisecond after
  the ask, so none is missed. The test now asserts the marker is later
  than the row written before it.
