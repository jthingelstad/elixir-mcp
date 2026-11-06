# 2026-11-06 — Step 7 of the redesign: public site and docs

The public home, Cards, Support, Updates and `/data` take the boards' words, and
the docs take the three groups and step 1's words.

- **Docs.** Three groups in `_data/docGroups.js`; eighteen new pages hold what
  long pages split into. `_data/docForwards.js` is the one map from an old
  `page#section` to its new home; `site-rail.js` follows it in the browser, and
  `movedSection` in `packages/docs` follows it for `elixir_docs` and
  `elixir://docs/`. Every page stays at its address.
- **`/data` is one page.** `/data/growth`, `/collect`, `/now` and `/machines`
  answer 301 at the edge (SpaRouter, no new behaviour) to their sections.
  `/console/data` and `/console/data/dashboard` go to `/data` through the app's
  map, and the app's charts view is gone.
- **Updates.** A page per month (`/updates/YYYY-MM`) and the front page holds the
  newest months until there are ten product entries. Old `/updates#YYYY-MM` links
  forward in the browser. Contract entries are in the HTML but hidden until the
  switch; with JavaScript off the feed still carries both kinds.
- **Static pages.** Search goes to `/home?search`, which opens the sheet. Help is
  a `<dialog>` in `base.njk` that posts to `/api/feedback` with the page attached,
  the same route as the app's drawer. Signed out neither shows.
- **Old root paths stay dead.** `/account/*`, `/explore/*` and `/admin` at the
  root are plain 404s, deliberately. Jamie ruled on 2026-09-28: "No subdomains,
  no redirects" for that move.
- **Fixtures.** Real names in `apps/web/e2e`, `apps/web/test` and
  `packages/ingest/test` are made up now.
- **`apps/site/test/public-site.test.mjs`** walks every built page's internal links and
  fragments, checks every forward lands, and pins the disclaimer on every page.

Words kept on purpose [engineering, 2026-11-06]: `observed` where it names a
`basis` value; `poll` and `ledger` on reference pages only, where they name real
fields and jobs; the code value `comprehensive` on Limits.

Ships in MCP 11.18.0; JSON API 3.3.0 unchanged. No migration.

## Follow-up, same day (MCP 11.18.1)

- **Moved sections answer to their old title too.** `movedSection` tries the slug
  of what it was asked, so `recording` + "Daily series" forwards as
  `recording#daily-series` does, in `elixir_docs` and `elixir://docs/`. Codex
  found it on #695.
- **The static Help drawer's Send stayed on screen after a send**: a `.btn`'s
  `display` beat `[hidden]`. Found by the new browser test.
- **Names.** Players in `fixtures/` and `packages/mail/` fixtures, and those named
  in source comments, tool descriptions and tests, are made-up stand-ins, the same
  stand-in for the same player. `db/migrations/`, `acceptance/`, dated notes,
  old Updates and old contract entries keep theirs, as history or because they
  run against live data. King Thing and POAP KINGS stay: `_data/examples.js`
  names them as the example player and clan.
