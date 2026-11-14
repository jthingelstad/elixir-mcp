# 2026-11-14 — Stats takes its name in code

Code only, and nothing a reader sees changes. No MCP tool, `/api/v1`
operation, contract version, migration, URL, stored value or metric
changes.

The surface a reader has called Stats since 2026-11-12 kept the name
Ladder in code. It now carries Stats there too:

- `apps/web/src/ladder/` is `apps/web/src/stats/` (`ladder*.js` are
  `stats*.js`), `pages/LadderPage.jsx` is `StatsPage.jsx`, and the
  identifiers follow (`LADDER` to `STATS`, `isLadder` to `isStats`,
  `ladderHref` to `statsHref`, `LadderFrame` to `StatsFrame` and the
  rest), with the tests (`test/stats*.test.js`, `e2e/stats.spec.ts`,
  `e2e/stats-fixture.ts`).
- The React Query keys are `["me", "stats", ...]`, the help drawer's doc
  keys `stats:<page>`, the route's section and product `stats`, and the
  family manifest's product key `stats` (label Stats, as before).
- The `.ladder-*` classes in `packages/design/src/components.css` are
  `.stats-*`. No `.stats-*` class existed before; `.st-*` (Settings) is a
  different family. The compiled sheet differs from main's only in those
  class names: the same rules, values and order.

"ladder" stays where it is the Trophy Road game mode (mode values,
`mode_group`, `.mode-chip__dot--ladder`) and where it is stored or public:
the docs slugs (`/docs/ladder*`, served by `elixir_docs`), the feedback
area value `ladder`, the mail source label "Ladder" and its icon key on
the Emails page, Admin's feedback area label, and the site's docs group
key. `apps/web/test/stats-name.test.js` keeps the surface name from coming
back in file names, identifiers, classes and keys, without reading mode
values.
