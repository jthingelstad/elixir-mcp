# apps/site: the site and the public docs

The Eleventy build behind every content path on `elixir.poapkings.com`:
home, `/docs/*`, `/updates`, `/data`, `/cards`, `/examples`, `/support`,
and the machine-readable surfaces (`llms.txt`, `llms-full.txt`,
`tools.json`, `sitemap.xml`, `feed.xml`). Paths under `/console`,
`/ladder` and `/clan` are the React app (`apps/web`).

## The docs are the product description

`src/docs/` is the only description of what Elixir does, for people and,
through `packages/docs` and the `elixir_docs` tool, for agents, who read
the same corpus. Write what is true now, plainly:

- No history in product pages: no "was X, now Y", no retired features, no
  version tags in prose. `/updates` and `elixir_changelog` carry history.
- A decision in `docs/DECISIONS.md` that a page contradicts is a page bug.
- Policy pages (`privacy.md`, `terms.md`) change only with Jamie's word.
- **Anchors are API.** Tools point agents at `docsRef(page, section)`;
  `packages/tools/test/docs-pointers.test.mjs` fails when a pointed-at
  page or H2 is missing. Rename or delete a heading only after moving its
  pointers.
- The tool reference (`/docs/tools`, `src/docs/tools/<group>.njk`, one page
  per tool group) is generated from the registry. Fix a tool's
  declaration, never the generated page.
- Counts that a test cannot pin (how many examples, kinds, hidden tools)
  drift; prefer wording that needs no count, or read it from `_data`.

## Updates

Every user-visible change adds its own file to `src/_data/updates/` in the
same commit: `<YYYY-MM-DD>-<NN>-<slug>.md`, a `# Title` line, a blank
line, then the body: what a person notices, in their words, ending with
the MCP and JSON API versions. NN orders one day's entries, the higher
the newer; take the day's highest plus one (`01` on a new day). Never
edit another entry to make room. `src/_data/updates.js` reads them.

## Building and testing

`npm test -w @elixir-mcp/site` builds the merged tree
(`infra/scripts/build-site.mjs --skip-stats`) and runs `test/*.test.mjs`
over the built pages (titles, sitemap, scope copy, analytics, the product
bar, the CloudFront path split). Fonts are self-hosted; analytics comes
only from Tinylytics.
