# Site information architecture (ratified 2026-09-05)

The navigation spec of record for the web app, agreed with Jamie ahead of
the Claude Design session. Principles: web/MCP parity (anything an agent
can see, a person can see); the public boundary follows universal reads
(aggregates and recorded game data public-postured, account data
private); the front page's job is proof (live corpus scale); Home and
Data are CRAWLABLE (content baked into served HTML at deploy, SPA
mounts over it; robots.txt + sitemap.xml exist). Not a BI platform:
surfaces exist to serve players and operators, never dashboards for
their own sake.

## Tier 1: Home · Data · Explore · Account · Docs · Admin

- **Home** (public, crawlable) — hero + live corpus counters (battles,
  players, clans, collectors, oldest battle), What's New, request
  access / sign in.
- **Data** (public, crawlable) — pages: **Dashboard** (full-history
  daily series: battles collected, players/clans observed, collector
  fetches, active collectors; corpus transparency block) and
  **Changelog** (the contract CHANGELOG rendered). Full history is
  deliberate; retention policy comes later.
- **Explore** (authed) — Player (+ Pilot Score tab, name search),
  Clan & War (+ Standings, Clan Pilot Scores, Scouting Report),
  **Meta** (meta decks/cards + segment trends, segment picker incl.
  collections), Collections, Collectors (ladder). CR live leaderboards
  stay agent-only (live_fetch) by decision.
- **Account** (authed) — Overview (tier, players, clans, connect,
  timezone), Agents, **Activity** (three tabs: MCP requests · account
  events · notifications), Usage (aggregates + quota), **Collector**
  (raise hand + per-collector detail: fetch series, endpoint mix,
  points, credits, errors, version), Feedback.
- **Docs** (public, URL-addressable pages) — unchanged.
- **Admin** (role-gated) — Requests, Accounts, Collections, Feedback,
  Usage; Collectors + Tokens owner-only.

## New surfaces and their APIs

| Surface | API | Notes |
|---|---|---|
| Home counters / Data dashboard | GET /api/public/stats | public, CloudFront-cached; daily series full-history |
| Data changelog | none | CHANGELOG ships in the bundle |
| Activity: MCP requests | GET /api/me/requests | mcp_call_audit, paged |
| Activity: notifications | GET /api/me/events | event_feed, cursor |
| Collector detail | GET /api/me/gateways/:id/detail | api_receipt daily buckets |
| Crawlability | deploy-time bake | stats + updates injected into index.html; refreshed each deploy (scheduled refresh is a follow-up if deploy cadence slows) |
