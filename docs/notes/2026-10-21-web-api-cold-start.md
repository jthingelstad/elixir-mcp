# 2026-10-21 — The doors' cold start parses less

The platform review of 2026-10-21 (`plans/elixir-platform-review-2026-10-21.md`
in the domain repo, §2 and the bundle items of §5) found web-api's cold
start at 673 ms p50 (838 ms p95, 461 ms CPU) over the week to 2026-10-21,
against 460 ms for MCP and 409 ms for the collector. Lambda init ran at
about 300 ms plus 2.4 times a local import of the same bundle, so what the
bundle parses and evaluates before it listens is the lever. Build only:
no MCP or JSON API version moves (MCP 11.13.3, JSON API 3.2.0 at
writing); the deploy runs the whole acceptance suite because every
bundle is built by this code.

- **Server rendering is a chunk.** `services/web-api/src/app-pages.mjs`
  imports `@elixir-mcp/web/server` on the first page instead of at module
  load, and `infra/scripts/build.mjs` splits the web-api and MCP bundles
  (`split: true`): a dynamic import becomes a content-named
  `chunk-<hash>.mjs` beside `index.mjs`. Chunks sit in the same directory,
  so every `import.meta.url` path (`app.html`, `share/`, `geo/`) still
  resolves. React, the router, the console's pages, the Ladder and marked
  are no longer parsed by a cold start that answers JSON.
- **lucide-react resolves its ES modules.** It has no `exports`, so
  esbuild took its CommonJS `main`, one 1.1 MB file defining every icon.
  An alias (`MODULE_ALIAS`) points it at its `module` build, per-icon
  modules marked free of side effects, so only the icons the kit names
  are bundled. A global `mainFields: ["module", "main"]` was tried and
  rejected: it also moves the AWS SDK (client-s3, the credential
  providers, smithy) from `dist-cjs` to `dist-es` and bowser to its
  source, a resolution no test runs.
- **The docs corpus rides only the doors that answer the docs tools.**
  web-api (through `/api/explore`) and MCP keep it, as a lazy chunk. jobs
  and migrate imported it through the tool registry but never call a docs
  tool; their bundles now carry a stub, and a docs read there fails with
  `docs_corpus_not_bundled` rather than a wrong answer. A docs page
  change is still a platform deploy, now for two bundles instead of four.
- **Not minified.** Whitespace, syntax, full with `keepNames`, and full
  minification measured no init gain over the split bundle (CPU medians
  217 to 235 ms against 236 ms, inside the machine's noise), so the
  bundles stay readable and a stack trace names real lines.
- **Still deterministic.** Two builds give identical bytes for all eight
  Lambdas, and the server-rendered HTML of `/console/signin`, `/clan`,
  `/ladder` and `/console` is byte-identical to the old bundle's.
  `services/mcp/test/lambda-bundles.test.mjs` holds what a cold start
  parses, where the corpus rides, the repeat build and the refusal;
  `apps/web/e2e/native-ssr.spec.ts` now builds with `esbuildOptions`, the
  production options, so it hydrates what ships.
- **Two test budgets.** `apps/web/test/app-pages.test.jsx` loads
  `entry-server.jsx` before its tests, since the first render now pays
  vitest's transform of the whole app and missed five seconds on a
  loaded host. The account journeys' scratch-database hook gets 60 s
  instead of 15 s: it runs every migration, and CREATE DATABASE queues
  behind the other sessions' on one host.

| Bundle | `index.mjs` before | after | zip before | after |
| --- | --- | --- | --- | --- |
| web-api | 9.3 MB | 2.8 MB (init set 3.95 MB) | 4.41 MB | 4.20 MB |
| mcp | 4.2 MB | 2.5 MB | 1.05 MB | 1.05 MB |
| jobs | 3.5 MB | 2.1 MB | 925 KB | 550 KB |
| migrate | 3.5 MB | 2.1 MB | 1.14 MB | 0.76 MB |

The scheduler, email relay, collector and timeline sync build the same
bytes as before, so their revisions do not change.

Local imports under Node 24, medians on a loaded machine (other sessions
running): web-api about 150 ms to 80 ms on a quiet run (231 to 122 ms
under load; CPU 399 to 236 ms), MCP 65 to 59 ms, jobs 59 to 57 ms and
migrate 56 to 51 ms. By the model above, web-api's init should land near
490 ms p50.

The next lever is the S3 client: about 1.2 MB of web-api's init set and
17 ms of evaluation, built at module load by seven packages. Loading it
lazily changes those call sites and their test fakes, so it waits for
this deploy's measured init.
