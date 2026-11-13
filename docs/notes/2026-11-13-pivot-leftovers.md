# 2026-11-13 — Retired-purpose leftovers of the social-layer pivot

Jamie approved removing what the pivot to the social layer (VISION.md)
left behind with no purpose. This is the code half; the schema half is
migration 0257, in a later pull request, so no deployed build reads a
dropped object.

## What changed

- **The Settings year graph is gone.** A followed player's page in
  Settings › Players & following no longer draws the year of battle
  activity. Gone with it: `ActivityGraph.jsx` and its styles, the
  `GET /api/me/battle-activity/*` route, the jobs Lambda's
  `{activity_histogram}` payload (the nightly rebuild of
  `player_activity`) and the `/docs/activity` page. DECISIONS' "Activity
  year reads log coverage" is marked retired. `player_activity` loses its
  last reader and writer here and is dropped in 0257.
- **The nightly archetype stamp keeps its time.** It rode the histogram's
  05:30Z rule; it now has its own payload, `{archetype_stamp: true}`, and
  rule (`ArchetypeStampRule`, `elixir-mcp-archetype-stamp`). The old
  payload is an unknown op (`services/jobs/test/archetype-stamp.test.mjs`).
- **Capture efficiency is staff only.** `GET /api/public/efficiency`
  answered anyone; the same figures are now `GET /api/admin/efficiency`,
  behind the Admin gate every `/api/admin/*` route uses (a session whose
  account `isAdmin`, else 403 `not_entitled`). Settings › Admin ›
  Efficiency, where the page already lived, reads it. The public path is
  the web API's 404. CloudFront's `/api/public/*` behaviour named no
  route, so only its comment changed.
- **Clan: deciding an Action you may not see is not found.** A decide
  request for a card the person may not read (`mayRead`: an Elder
  holding a promotion's, demotion's or removal's id, or anyone but the
  Leader and Co-Leaders on a closed one) answers 404 `no_action`, exactly
  as a card that does not exist. It answered 403 `leaders_only`, which
  told an Elder the card existed.

Guards: `services/web-api/test/web-api.test.mjs` pins the retired paths
to 404 signed in and out, and the admin read to staff;
`public-boundary.test.mjs` no longer lists the public efficiency route;
`packages/clan/test/manage.test.mjs` pins the Elder's decide to the
missing card's answer.

MCP and JSON API unchanged.
