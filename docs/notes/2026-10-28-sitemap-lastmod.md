# 2026-10-28 — Every sitemap URL says when its page last changed

**What.** `/sitemap.xml` gives each of its URLs a `<lastmod>`. Before this, each URL had only a `<loc>`. A page's date is when its content last really changed (`apps/site/src/_lib/lastmod.mjs`), never the build's clock:

- **Docs, examples, family, support and the data pages:** the last commit to the page's template and the data modules behind it. The layouts and shared chrome are not counted. A doc that prints registry figures (`{{ tools.* }}`) and the generated tool reference also take the contract's newest change, because every registry change is a contract change.
- **Updates:** each entry is dated by the last commit to its own file (a product update, or `packages/contracts/src/changes/<version>.ts`). The exception is an entry whose file was created more than two days after its own date. These are the files from the 2026-10-10 split into one file per entry, and they keep their own day until a later commit edits them. `/updates` takes its newest entry, and `/docs` its newest doc.
- **Cards:** the newer of the card templates and the catalog's last change (`as_of` from `/api/public/cards`). The fetch is shared through `_lib/catalog.mjs`, so the build reads it once. The public catalog has no per-card change date, so a change to one card redates every card page.
- **Pages that bake the stats snapshot** (home, `/support`, `/data`, `/data/growth`, `/data/now`, `/data/collect`): the snapshot's time, because their figures do change with each publish.

A publishing build (one with live stats) refuses a shallow clone. In a shallow clone every file would carry its one commit's date.

`site.test.mjs` checks that every URL has a W3C `lastmod` that is not in the future, with no `priority` or `changefreq`, and that the list pages are no older than what they list.

MCP and JSON API unchanged.
