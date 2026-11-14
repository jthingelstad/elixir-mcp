# 2026-11-14 — Whole-App tests compile the route chunks before they start

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes. Web tests only (#995).

Two server-rendering tests timed out at vitest's 20 s test timeout in a
`npm run verify` on a host at load 35. The issue guessed that
`app-pages.mjs`, which loads `@elixir-mcp/web/server`, got a second copy
of the app graph beside the test's own `../src/entry-server.jsx`
preload. Measured, it does not: both names resolve to one module
instance, and the second import costs nothing.

The cold cost was the route's lazy chunk. `renderApp` awaits
`router.load`, which imports the matched route's component chunk
(`lazyRouteComponent`), and vitest transforms that chunk on first
import, inside the first rendering test. A probe at load 47: entry
import 1.5 to 3.1 s (file load, no timeout), first render 3.4 to 4.9 s,
the next new routes 0.3 to 1.6 s each, a repeat render 3 to 12 ms. With
`test/warm-routes.js` imported first, the first render took 50 to 97 ms.
In a full verify every worker's transforms queue on the one vite server,
so that in-test compile is what outran 20 s.

## What changed

- `ssr.test.jsx` and `app-pages.test.jsx` import `./warm-routes.js`, as
  the jsdom whole-App tests already did; the chunks compile while the
  file loads, where vitest bounds nothing.
- The sweep found twelve more files that render `<App />` without it:
  `discord`, `email-page`, `find-bring-clanmates`, `profile`, `rail`,
  `seen`, `shell`, `signed-in-routes`, `signin-review`,
  `timeline-discord`, `verify` and `you-stats`. Each imports it now.
- `warm-routes.test.js` gains a guard: every test file that renders the
  whole App (`render(<App`, `renderApp(`, the server entry or
  `app-pages.mjs`) imports `warm-routes.js`.

No timeout was raised.
