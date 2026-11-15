# 2026-11-15 — Journeys that word the clock run on a pinned one

No MCP tool, `/api/v1` operation, contract version, migration, stored data
or product behaviour changes. Three Playwright specs and the testing
guidance only.

**What happened.** main's `validate` on 10d2fd5cf (06:18Z, 00:18
Central, 2026-11-15) failed `e2e (3/3)`: the three viewport cases of
`apps/web/e2e/home-starter.spec.ts` "the first screen holds Follow these
and three rows with their reasons" expected "In your clan, played today"
and read "In your clan, played yesterday", on the retry too. The commit
under test did not touch Home.

**The cause: the test, not the product.** The fixture put the clanmates'
last battle 30 to 34 minutes before the real clock. Home words it with
`useClock().feedDayHeading`, in the reader's zone: the fixture account's
`timezone`, America/Chicago (`ME` in `e2e/fixtures.ts`). The journey ran at
00:21 Central, so a battle at 23:51 Central was yesterday, and the app said
so correctly. The test held only outside the first 30 minutes or so after
Central midnight (06:00Z in winter, 05:00Z in summer).

**The fix.** The spec pins the page's clock with
`page.clock.setFixedTime` in a `beforeEach`, at Wednesday 2026-11-11 noon
Central, and every fixture time in it (`AGO`, `starter_hidden_until`) is
counted from that same instant. ENGINEERING.md ("Verification follows the
boundaries") now says a journey asserting a calendar word pins the clock
and seeds from it.

**The sweep.** Every spec seeding from `Date.now()` or `new Date()` was
read (`bell-fixture`, `home-fixture`, `home-layout`, `home-new-pill`,
`home-profile-list`, `new-home`, `own-refresh`, `phone-friction`, `app`,
`bell`, `static-help-search`, `clan/season`, `clan/awards-readiness`,
`clan/browse-context`), and each calendar-word assertion in the journeys:
the rest assert durations, polling, or words that come from a fixture
field (`days: 7` gives "this week"), not from the clock. The journeys
already pinning a clock (`stats`, `capture-truthfulness`,
`player-battle-share`) were already right. Then the whole suite (600
tests) ran at each instant below. Every hour and week instant in 2026
passed, which leaves home-starter the only journey that flipped with the
hour or the weekday. A summer instant in 2027 found a second class, the
year: five journeys break from 06:00Z on 2027-01-01 (midnight Central),
because the app prints a date outside the current year with its year:

- three in `stats.spec.ts` (the season home, the decks' evolution swap,
  the seasons picker) assert 2026 dates with no year ("The season ends
  Mon Oct 5, 5:00 am"); they now pin 2026-09-29 21:00Z, the clock the
  rest of that file uses;
- `page-frame.spec.ts`'s roster rows (390px, both font cases): the first
  member's "Battle Sat Sep 12 2026, 11:40 am" wraps the row to 93px
  against its 90px bound; it now pins 2026-11-15 18:00Z. That a member
  row grows a third line on a phone once its last battle is in an
  earlier year is the product's, and is left as it is here.

With those pinned, the full suite passed at 2027-01-01 00:30 Central and
2027-07-12 00:20 Central daylight time too.

**Running the journeys at any instant.** Playwright has no global clock
option, so the proof used a throwaway harness (not committed, since every
spec imports `@playwright/test` directly):

- a Node preload (`NODE_OPTIONS=--import node-clock.mjs`) replaces `Date`
  in the test processes with one shifted by `ELIXIR_E2E_NOW - now`, so a
  spec's seeds start at that instant and keep running;
- the specs' `@playwright/test` import is rewritten for the run to a
  stand-in that re-exports it with `context` extended by an init script
  shifting the page's `Date` by the same amount (the two clocks agree to
  about a millisecond; timers stay real; a spec's own `page.clock` pin
  still wins). An earlier try with `context.clock.setSystemTime` left the
  page a few hundred milliseconds behind Node, which made a first-read
  journey see a `tracked_since` in its future and poll slowly: a harness
  artifact, not a defect;
- `TZ=UTC`, as on CI's runners, and the imports restored on exit.

With it, the unfixed spec failed at 00:21 Central exactly as CI did, and
the fixed one passed.

Instants, all passing after the fix (Central): Saturday 23:40, Sunday 00:21 (the CI failure), Sunday
03:00, Sunday 18:10 (Home's "Tonight" boundary, just past UTC midnight),
Sunday 23:45 and Monday 00:15 (the calendar week), Monday 03:55 and 04:05
(the game week, Monday 10:00Z), Tuesday 00:10 on December 1 (a month), and
Tuesday noon as the control (all 2026-11-15 to 12-01); 2027-01-01 00:30
(the year); Monday 2027-07-12 00:20 daylight time (05:20Z).
