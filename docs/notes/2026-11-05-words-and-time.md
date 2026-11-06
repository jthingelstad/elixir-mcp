# 2026-11-05 — Words and time, step 1 part a

Step 1 of the redesign changes words and time and nothing else: no route,
nav, tab or layout moved. Mail, MCP tool output, timeline lines, clan-engine
rank strings and battle counting are not in this change; the last three are
the next part.

**One time format.** `packages/ui/src/time.ts` holds it: `whenAt`, `dayAt`,
`calendarDay`, `clockAt`, `monthDayAt`, `zoneShort`, `seasonWeek`. Components
take them bound to the reader's zone from `useClock` (`when`, `whenDay`,
`calendar`, `clock`). Choices the ruling did not name:

- A reader with no zone reads UTC, and the time says "UTC", because it is not
  their clock.
- Another year adds the year: "Fri Oct 23 2025, 5:07 pm".
- A hold's last day is a calendar date and no zone moves it.
- A week's and a race's bounds are UTC days, so Clan's Week, Season and You
  here pages read them in UTC, without the weekday.
- The share picture has no reader and outlives the week: the whole date with
  its year, in UTC. `services/web-api` takes the pure functions from the new
  `@elixir-mcp/ui/time` export, so it loads no React.
- Admin keeps its wall clock.

`apps/web/test/one-time-format.test.js` keeps the old ways out of member pages.

**Words.** The banned list is in `docs/product/structure.md`. Display words sit
over API values that stay as they are: `activity` and `comprehensive` read "The
clan only" and "The clan and every member" (`apps/web/src/lib/words.js`).

**Corrections found on the way.**

- The Standing doc said the record keeps no trophy history. Daily readings
  exist from the day recording began; Standing does not compare them.
- `limits.md` said recorded history is kept indefinitely. It stays while someone
  tracks it, and for at least a year after the last person stops.
- Clan's Week calls the sum of its members' war points "war points", and that is
  what it is. It is not the clan's race fame, so it did not become "fame".
