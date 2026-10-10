# 2026-10-10 — Catalogue ceilings for seeded sets and thin samples

The full acceptance run after the 2026-10-10 deploy failed three catalogue
cases. The shipped code did not cause them; this morning's catalogue refresh
(86806590) did:

- `cards_card#1` is the seeded clan-segment read. Nobody made it this week, so
  it was held to the tool's p95 from one light player read (171 ms, a 4 s
  ceiling) and took 6 to 10 s, as it always has. A seeded set now gets the
  unmeasured 15 s ceiling.
- `elixir_data_insights` had one call this week, so its "p95" was a single
  sample (2.3 s, where the week before had 3.7 s). With one or two calls the
  ceiling now has twice the margin (3x instead of 1.5x).
- `cards_catalog#notes`: this week's reads asked only for standard cards, so no
  response carried the `tower_troop` its notes name. A seed now reads tower troops.

The timeline docs audit (#469) was settled the same day: three refusal
reasons an MCP caller can meet are allowed and pinned by a unit test.
`invalid_page` was not among them. An out-of-range `evidence_offset` or
`evidence_limit` is refused by the tool's argument validation, so
`docs/timeline` no longer names it.
