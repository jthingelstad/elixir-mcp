# 2026-10-13 — battles_query: the duel note only on a page with a duel

MCP 11.12.1 (a correction). JSON API 3.2.0 unchanged; no migration.

The deploy of #567 ran the whole acceptance suite on a Tuesday, a training
day with no river race duels in the catalogue's `battles_query` reads, and
`catalogue/battles_query#notes` failed: the duel note names
`rounds_played` and `rounds[]`, and no row served carried them. The note
was unconditional, so the case passed only on days a catalogued read
happened to hold a duel. A flaky check is a defect; the defect was the
product's, a note naming fields the answer does not serve.

The note now rides only a page with a duel row (`isDuel`), as the tower,
leak and floor notes already ride only the rows they describe.
`packages/tools/test/controls.test.mjs` pins it both ways (it fails
without the change).

The other failure in that run, `catalogue/elixir_timeline#1` at 15,241 ms
against the 15,000 ms cap, is a real latency problem in the timeline's
month-long roster read, not this change's; it is #568.
