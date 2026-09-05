# Claude Design handoff — Elixir MCP

The prompt below is self-contained; relay it verbatim (it duplicates
what a designer needs from SITE-IA.md, the token file, and the brand
lineage on purpose).

---

## The brief

You are designing the web presence for **Elixir MCP**
(elixir.poapkings.com) — a Clash Royale **history recorder and remote
MCP server**. The official CR API only knows the present; this service
records battles, progression, and clan life continuously and serves the
history to each user's own AI agent over MCP. The website is three
things at once: a **public transparency surface** (live corpus stats,
full-history charts, contract changelog), a **data application** for
signed-in players (explore your recorded history, meta intelligence,
Pilot Scores), and a **management console** (players/clans you record,
agents, quotas, collectors, admin). It is live with real data: ~38K
battles, ~40K players observed, 3 collectors, growing continuously.

### Brand lineage — where to pull from

This is the third product in the POAP KINGS family and must read as
kin while standing on its own:

1. **POAP KINGS** (the Clash Royale clan brand): royalty — gold, crowns,
   "kings" energy. The wordmark tradition is a gold-gradient headline.
2. **Elixir Drop** (drop.poapkings.com, the family's first product):
   the token family this site already inherits — deep purple-black
   stage (#070610/#0b0920), panel surfaces (#120f2a) with indigo edges
   (#2a2450), lavender ink (#f7f4ff/#c8c1e6), royal purple accent
   (#6d28d9 with glow), gold headline metal (#f5c84c/#ffe99a), Inter +
   system mono. Dark-first, single-theme, arena-night atmosphere.
3. **Elixir MCP must land squarely as a DATA APPLICATION / TOOL.** The
   game supplies the palette and the warmth; the product is precision.
   Think: an observatory built inside the arena, not a fan site. Tables,
   time series, monospace tags, sample sizes, honest footnotes are the
   product's voice — design should make density legible and numbers
   beautiful, not hide them behind hero art.

### Product personality (already in the copy — protect it)

- Radically honest about data: every number ships its sample size;
  notes say "recorded battles only", "estimate", "schema, not news".
  Design should give this honesty a *form* (footnote styles, caveat
  chips, freshness indicators) rather than tucking it away.
- No editorializing: "observation, never opinion" — no tier-list
  visual language, no rank badges implying judgment.
- Playful in the right places: collectors are named after CR cards and
  climb arena tiers on a ladder; the wordmark is gold. Whimsy lives in
  the operator/collector corner and the brand shell, not in the data.
- The unofficiality disclaimer (Supercell fan content policy) appears
  on every surface — design it a dignified home.

### Information architecture (ratified — do not restructure)

Two-tier nav. Tier 1: **Home · Data · Explore · Account · Docs ·
Admin**; tier 2 is a page row under the active section.

- **Home** (public, crawlable): hero + live corpus counters, What's
  New, request-access flow (approval-gated alpha), sign in.
- **Data** (public, crawlable): *Dashboard* — full-history daily series
  (battles recorded/day, players observed/day, collector fetches/day)
  currently inline-SVG bar sparklines, plus corpus totals; *Changelog*
  — the rendered tool-contract history.
- **Explore** (signed in): *Player* (tabbed: summary, battles, trend,
  decks, collection, war, coverage — Pilot Score joins soon), *Clan &
  War*, *Meta* (observed deck/card meta + segment trends — corpus, a
  clan, or a curated collection like the pros), *Collections*,
  *Collectors* (the ladder: CR-card avatars, arena tiers, points).
- **Account** (signed in): *Overview* (tier/entitlements + upgrade
  request, your players with notify bells, your clans with scope,
  connect-your-agent instructions, timezone), *Agents* (connected OAuth
  clients), *Activity* (three tabs: MCP requests my agents made ·
  account events · notifications), *Usage* (quota + daily calls),
  *Collector* (run one; per-collector detail), *Feedback* (filed items
  + maintainer responses with shipped-in versions).
- **Docs** (public): About, Privacy, Terms, Tools, Roles, Architecture.
- **Admin** (role-gated): Requests, Accounts (role ladder:
  member/leader/family/partner/admin/owner), Collections, Feedback,
  Usage; Collectors + Tokens owner-only.

### Constraints

- React SPA (Vite), one styles.css of custom-property tokens — deliver
  the design as an evolved token system + component styles, not a
  framework migration. No external chart libraries (inline SVG); no
  external asset hosts. Dark-first; a single committed theme is
  acceptable (current site is single-theme dark).
- Public pages (Home, Data) are crawlable: real text is baked into the
  served HTML — design must tolerate a no-JS first paint of the hero
  content.
- Data density is a feature: tables with monospace CR tags (#20JJJ2CCRU),
  win rates to 3 decimals, ISO week labels. Design for scanning.
- Mobile matters (players live on phones) but the console pages may be
  desktop-first.

### What to deliver

1. An evolved visual identity: token palette (may refine the Drop
   family, must stay kin), type scale, spacing, surface/elevation
   system.
2. Component language: panels, tables, tabs/pills (two nav tiers +
   in-page tabs currently all look alike — differentiate them), status
   chips, caveat/footnote treatment, freshness indicators, empty
   states, form controls.
3. A chart language for the time series and future sparklines (axis,
   grid, hover, small-multiples) buildable in inline SVG.
4. Page layouts for: Home (public proof), Data dashboard, Explore
   Player, Account Overview, and the Collector ladder (the one page
   that earns maximum whimsy).
5. The gold/purple balance: gold is the brand metal (wordmark,
   achievement moments), purple is the working accent — confirm or
   evolve that split.

### What NOT to change

Navigation structure and page inventory (ratified); tool names and
in-product vocabulary (added/recorded/notify, Pilot Score, Scouting
Report, collector ladder); the honesty notes; the disclaimer's
presence.
