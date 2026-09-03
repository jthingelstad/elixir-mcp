# Elixir MCP

Purpose: _One-line purpose statement TBD — rethinking elixir-bot as an MCP offering._

## Context: current Elixir

- Elixir is the clan agent for the POAP KINGS Clash Royale clan: a deterministic data engine (Clash Royale API → receipts → event streams → projections) with an hourly LLM awareness loop that is the sole proactive poster.
- It speaks through destination-specific Discord lanes (#elixir, #announcements, #actions, #ask-elixir, #leaders, etc.) with scoped memory, plus `/elixir` member commands and `/clanops` leadership operations.
- Clan management is deterministic (state + leader action cards, no model-decided promotions/kicks); runs on Python 3.14 / uv / SQLite, operated via launchd and `scripts/admin.sh`.

## Brainstorm

**Core idea:** Decompose the Elixir agent and simultaneously create a new offering: give Clash Royale players an MCP interface to explore their Clash data.

**Two components:**

1. **Elixir MCP** — the service/website.
   - Player registers with email via magic link (same pattern as other projects).
   - Registers their Clash Royale tag.
   - Possibly sets up billing/payment.
   - Possibly provisions their own Elixir MCP Gateway.
   - Service then collects data for that user and provides an MCP interface they can bring to Claude or any agent.
   - Can be focused on a player OR a clan.
2. **Elixir MCP Gateway** — solves the IP restriction issue of the Clash Royale API. Could be a multitude of gateways distributing load to the CR API across dozens of egress points.

**Future direction:** The Elixir agent sheds most of its data-collecting capabilities, relies on Elixir MCP for data, and becomes a lightweight layer on top providing clan agent services and clan management functions.

**Precedent:** This split already exists with Elixir Drop / Elixir Drop Gateway — the difference is many Elixir MCP Gateways instead of one.

**Scope clarifications:**

- Brand-new project. Does NOT reuse anything from elixir-bot. (May at some point backfill historical data for Jamie personally or for POAP KINGS.)
- Multiplayer and multi-clan from day one.
- The service stands alone without the Elixir agent — you could use Elixir MCP and never attach the agent. The agent is a V2 consideration, one possible consumer later.

**Core problem/value:** The Clash Royale API only provides current state, no history. Elixir MCP's job is to record history and expose a really robust MCP interface over Clash Royale data. A player says "record all my games"; a clan setup says "record all battles for all clan members." Substantial data collection; hundreds of players could attach, each making MCP requests via their favorite agent.

**Patterns already proven in-house:**

- MCP side (auth'd): very similar to the thingy MCP just built — auth patterns all exist.
- Gateway: looks a lot like the Clash Royale Drop bridge running on Jamie's home machine (queue-connected). Queue is the right model because there are two constraints: IP restriction AND rate limiting.

**Web interface scope:** Deliberately small. Register (magic link), identify your player tag, opt in to recording, and maybe a small dashboard showing what data is being collected for you. No chat interface — the agent experience lives entirely in the user's own MCP client.

**Monetization (later, not launch):** Launch is free, just player registration. But the shape of future monetization is clear: a player might pay a couple bucks ($20/year range) to have their data recorded; a clan could pay for collection across all members as a provisioned service for the clan.

**Key data-model insight:** Recording is shared, not per-user. If a clan is recording all members' battles and a member also signs up for their own data, that's the same data — record once, both parties get access. So the data model separates the recorded facts (battles/observations, stored once, keyed by player) from access entitlements (who subscribed to what). "A pretty robust data model backs the MCP."

## Open Questions

- Supercell CR API terms — commercial use, key ownership. Does a user-provisioned gateway mean the user brings their own API key?
- Multi-tenancy: what does per-user/per-clan data look like? (Greenfield — no elixir-bot code reuse.)
- MCP auth model — magic link to token for remote MCP connection (OAuth?).
- Data retention/collection start point for new users.
- Polling cadence vs CR battle-log window — the battle log endpoint only returns recent battles, so recorder scheduling determines whether games get missed.
- Queue/scheduler design for fan-out across many gateways with per-gateway rate budgets.
- MCP tool surface — raw queries vs aggregates (deck stats, win rates, trophy history, clan war history)?
- Canonical battle identity/dedup — the same battle appears in both participants' battle logs (and via clan recording), so battles need a canonical ID (player pair + battle time?) to store once regardless of how many recording paths observe it.

### Resolved / deferred

- ~~Migration path for elixir-bot to consume Elixir MCP~~ — agent is V2, one possible consumer later; no code reuse.

## Decisions

From the CR API terms review (full doc: [elixir-mcp-terms-review.md](../elixir-mcp-terms-review.md)):

- Launch free; any paid tier requires express Supercell approval per Fan Content Policy (fees prohibited; donations can't gate benefits).
- Gateway fleet is for redundancy/egress resilience, NOT quota multiplication; conservative global rate budget (~one key's limit) to avoid circumvention reading.
- No blockchain/POAP/ENS anything in this product (prohibited fan content).
- No Supercell marks in domain/branding; include unofficiality disclaimer.
- Non-subscriber data exposed only within a subscriber's own context; no arbitrary-tag historical lookup.

Jamie, 2026-09-03 (design session inputs):

- **Gated access:** account creation is "request access" with owner approval, not open signup. Expecting demand; approval queue in the web UI.
- **User-attached gateways:** gateway instances (elixir-mcp-gw) belong to users. Launch with Jamie's only, but the website must let a user raise their hand to run a gateway and walk them through setup. (Implies per-user gateway enrollment, key/IP registration, and a trust/ops story — still one global rate budget.)
- **Domains (revised same session):** web UI at `elixir.poapkings.com`, MCP/OAuth door at `mcp.poapkings.com` (two-hostname cookie separation, librarian pattern).
- **Stack:** TypeScript/Node 24 everywhere; repo `elixir-mcp`, monorepo in Drop's workspace shape.
- **Database:** RDS Postgres, single-AZ db.t4g.micro (24/7 recorder keeps serverless engines awake — fixed small instance wins).
- **Recorder compute:** fully serverless — EventBridge scheduler Lambda + SQS request/results queues + ingest Lambda; NAT-free VPC, email via queue-fed non-VPC relay Lambda.
- **Email:** Fastmail JMAP from `elixir@poapkings.com` (already configured for elixir-bot). Re-evaluated vs SES 2026-09-03 and kept: the relay-queue weight is a VPC/RDS consequence (librarian's non-VPC Lambdas send JMAP directly), SES's VPC endpoint costs more than the relay, and warm sender reputation matters most on the magic-link path. Relay transport is swappable to SES later behind the same queue.
- **Local time (2026-09-03):** `account.timezone` (IANA, migration 0002) — tools render timestamps in the player's local zone alongside UTC and resolve relative windows locally; storage stays UTC; UTC-day rollups labeled honestly. Set in web UI.
- **DNS workflow (2026-09-03):** poapkings.com DNS stays at Namecheap, Jamie applies records by hand. When infra reaches the front-door step, relay the exact records (CNAMEs for `elixir.` + `mcp.`, ACM validation records) to Jamie — never assume programmatic DNS.
- **Identity discipline:** CR tags (player + clan) are the primary keys for all game entities, one canonical normalized form, no surrogate IDs; game-data tables never reference accounts (`claim` is the sole join). Battles write participant rows symmetrically for claimed and unclaimed tags; a new user's claim *unlocks* pre-existing history recorded about them as opponents — entitlement change, never data migration. DESIGN.md §4.1.
- **Approvals:** owner-scoped admin page on the site (request queue, approve/deny).
- **Gateway phasing:** self-serve enrollment ships V2; V1 schema models gateways first-class and Jamie's gateway enrolls through the real path. Keys issued from Jamie's Supercell account (`key_source` column keeps operator-BYO open).
- **Visual design:** web UI follows the Elixir Drop / poapkings.com conventions — Clash Royale-themed look, dark background; a sibling of drop.poapkings.com, not a new brand.
- **Infrastructure:** design must include a mapped-out AWS architecture. Data volume exceeds prior projects (DynamoDB/SQLite territory ends here); a real SQL server — managed Postgres — is the working assumption. Engine/sizing choice (RDS vs Aurora Serverless vs external managed Postgres) to be decided in the design pass.

## Next Steps

- [x] Review Clash Royale API terms of service for compliance with the design (recording/retention, multi-key gateways, commercial use, other-players' data) — done; see Decisions and [elixir-mcp-terms-review.md](../elixir-mcp-terms-review.md).
- [x] Deep design work — elixir-bot data model study, CR API surface analysis, #ask-elixir question mining — producing [DESIGN.md](DESIGN.md).
- [x] Design v2 (2026-09-03): prior-art surveys (librarian auth/OAuth/MCP, Drop bridge, elixir-bot recorder), Jamie's decisions folded in, AWS infrastructure map (§7), prior-art map (§10).
- [ ] Create the `elixir-mcp` repo (monorepo skeleton, Drop workspace shape) and move these docs into it.
- [ ] Verify Fastmail JMAP send-as for `elixir@poapkings.com` works from a non-elixir-bot credential, or mint a dedicated API token for the relay Lambda.
- [x] CR token landed in `elixir-mcp/.env` (2026-09-03, mode 0600, canonical var name **`CR_API_TOKEN`** — note: Drop uses `CR_API_KEY`; our gateway config uses ours). If this is the borrowed Drop key, still swap in the dedicated key tonight; either way, delete the Fastmail draft that temporarily held a token. Do NOT borrow Drop's production key — decided against 2026-09-03 (shared 403 blast radius, and nothing needs a key before the gateway code exists).
- [ ] Confirm poapkings.com DNS/ACM path for `elixir.` + `mcp.` CNAMEs (Namecheap; certs in us-east-1).
- [ ] Privacy policy page for the site (we store emails + behavioral history incl. non-registered players; GDPR/deletion path per terms review §2/§4) — plain-language, one page.
- [ ] Apply to Supercell for the `verifytoken` scope (parallel track; swap into the claim ladder if granted).
- [ ] Postgres schema draft (DDL for §4) — first build artifact.

## V1 build order (the standing work order — check off as chunks land green)

- [x] Repo, gitignore-first, AGENTS.md/CLAUDE.md, workspace root
- [x] packages/contracts core (tags, errors, deck_hash, meta, version)
- [x] Migration runner + fingerprint + 0001 recorder core + 0002 timezone
- [x] Fixtures (12 real payloads + cross-observer pair) + admission + battle/roster ingest
- [x] Pipeline glue: results-message → txn(payload/receipt → admission → projections); poll_state freshness advance; ingest Lambda handler shape (queue contract v1 in packages/contracts; receipt redelivery dedup = 0003)
- [x] Scheduler: heat model, fairness floors, budget settle, job planning; EventBridge handler shape (0004: epoch-anchored decay + last_known_clan_tag auto-follow stamp; bulk share only, live reserve untouched)
- [x] Snapshots + events + rollups projectors (profile → snapshot + donation_reset; roster → clan events w/ evidence, first-sight silent; battles → daily rollups; completeness = day-level estimate from bracketing snapshots — refine if live gaps show)
- [x] Gateway (services/gateway): lease loop (live-first), gzip results + loud overflow, 403 breaker w/ half-open probe, split heartbeats, queue-name indirection, launchd installer, .env.example
- [x] Auth core: 0005 auth tables + magic-link/code + sessions (gate enforced in resolveSession) + rate limit (services/auth)
- [ ] OAuth 2.1 routes on the auth core: DCR, /authorize (magic-code shell), /token (PKCE, rotation, family revocation), RFC 8414/9728 discovery
- [ ] MCP server: protocol layer + first tools (list_my_players, get_coverage, get_player, query_battles) + quota + audit rows
- [ ] Remaining V1 tools (get_player_timeline, get_performance, get_card_performance, get_deck_performance, get_collection, get_card_catalog, cr_api_live)
- [ ] Web UI (request access, magic link, claim, dashboard, admin, connect page — dark CR theme)
- [ ] infra/: CloudFormation stack + bootstrap/deploy/parameters/smoke — **GATE: first deploy needs Jamie's explicit go (billable resources)**
- [ ] End-to-end on real recording (Jamie's tag via his gateway) — **GATE: dedicated CR key + DNS records from Jamie**

2026-09-03 audit outcomes (DESIGN.md §11–§12 added): versioning designed (migration ladder + fingerprint test; contracts package + serverInfo cache-buster + deprecation rules; audit-row tuning loop). Build-blockers closed: DB access path (migrate Lambda + break-glass), SQS 256KB (gateway gzip, alarm on overflow), live request lane (second queue, gateways drain first), budget state in Postgres. Scope changes ratified: `get_player_timeline` into V1 (11 tools), season-roll watcher into V1, **repo public from day one** (fixture discipline from first commit).
