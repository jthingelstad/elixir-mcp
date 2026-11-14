# 2026-11-14 — The browser client folds into the app

`packages/client` (the `{ ok, status, data }` envelope, `createClient()`,
the query client with its one retry rule, and `useWrite`) was written for
a family of apps that would each pin it. Only `apps/web` ever imported it:
no service, no other app, no build or deploy script. Its sources and its
test now live in the app, as `apps/web/src/client/` and
`apps/web/test/client.test.ts`, before the visual redesign takes the front
end over, so the redesign starts from the final file layout.

- The modules are moved unchanged; every import of `@elixir-mcp/client`
  is now a relative import of `src/client/index.ts`. The test keeps its
  Node environment (`@vitest-environment node`).
- The workspace, its knip entry and its `tsc -p` step are gone; the app's
  own typecheck and knip project now cover the TypeScript files under
  `src/`. The e2e path list in `services/mcp/test/ci-tooling.test.mjs`
  names the new path.
- Nothing a person sees changes: the built bundle does the same work.

No contract, API or migration change.
