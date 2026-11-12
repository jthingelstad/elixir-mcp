# 2026-11-12 — Sessions look the same everywhere (G7)

Home's feed drew a sitting with its sparkline, its numbers and View games
(#788); You's Timeline and a player's page drew the same sitting as a plain
sentence. They now share one session row, `apps/web/src/home/Session.jsx`
(`Sitting`, `SITTINGS`, `evidenceWord`), with Home.

The player page's read, `GET /api/player`, already built the timeline the
sparkline comes from; its `pageItem` dropped what the row needs. A sitting
now carries `spark` (the same `sparkOf` Home's feed uses), a narrow `facts`
(battles, won, lost, trophy_net, by_mode, the top deck's label, ended_at)
and its `evidence` handle. Never the facts whole.

View games could not use Home's evidence read: `GET /api/me/timeline`
with `evidence_item_id` finds an item only in the reader's own seven-day
timeline, so a player the reader does not follow, or a sitting older than
a week, was never there. The page has its own, `GET /api/player/evidence`
(tag, evidence_item_id, expected_evidence_version, evidence_offset): it
rebuilds the page's public 30-day timeline, finds the sitting by id and
reads its games with the same `readTimelineEvidence`, one charge on the
shared hourly bucket as the page. The timeline API is unchanged.

MCP and the JSON API unchanged.
