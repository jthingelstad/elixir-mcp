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
- [x] OAuth 2.1 logic (services/auth/oauth.mjs): DCR, PKCE, single-use codes, rotation + family replay revocation, 90d absolute lifetime, gate-enforcing validateAccessToken. HTTP shell (routes/HTML/discovery docs) rides the MCP-server chunk; /authorize state = magic_login purpose='oauth'.
- [x] MCP server: protocol layer (compact-JSON results, version cache-buster) + first tools (list_my_players, get_coverage, get_player, query_battles w/ local-time windows) + fail-open quota + audited invoker + bearer handler
- [x] Remaining V1 tools — all 11 declared and tested. Open threads: live lane wiring (returns live_unavailable until infra), upgrade-gap fields need packages/game-data reference table (no invented constants), timeline granularity 'season' deferred to V2 war work.
- [x] OAuth 2.1 HTTP shell + discovery on the MCP door (two-step authorize over the magic core; consent = entering the code; oracle-resistant; RFC 9207/8414/9728)
- [x] Web-api service: full journey tested (request → approve → sign in → claim → record); CSRF contract header; neutral gate responses everywhere
- [x] Web UI (apps/web): landing/sign-in/dashboard/admin/connect in Drop's token palette; 4 RTL tests; 49KB gzipped
- [x] Email relay (JMAP sender + templates + SQS consumer; EmailMessage contract) — transport swappable behind the queue
- [x] Season-roll watcher (shared pre-reset window fn; scheduler forces in-window profile polls; projector pins season_roll rows)
- [x] infra/ DEPLOYED 2026-09-03 (Jamie's go): stack live, migrations 5/5, smoke 7/7. Fixed en route: RDS force-SSL (sslmode=no-verify) and gateway .env→process.env export for launchd. Owner account + jamie-mac gateway seeded via the migrate Lambda's explicit seed payload; gateway running under launchd (com.poapkings.elixir-mcp-gw).
- **Hostname consolidation (Jamie, 2026-09-03 post-launch):** connect URL is `https://elixir.poapkings.com/mcp` — ONE hostname, path-split CloudFront behaviors (/mcp, /oauth/*, /.well-known/* forward no cookies). The mcp. distribution deleted before DNS existed; its issued cert sits unused (free). OAuth issuer = https://elixir.poapkings.com.
- **Owner identity fixed (2026-09-03):** owner login is jamie@thingelstad.com; the AWS-only address was purged from prod DB, local dev, repo, and git history (filter-repo + force push).
- [ ] DNS at Namecheap (Jamie): ONE record once I confirm aliases live — elixir → d3nauaye5ioxmf.cloudfront.net.
- [ ] Jamie: sign in at https://d3nauaye5ioxmf.cloudfront.net, claim #20JJJ2CCRU, opt into recording (the real product flow — also live-tests the JMAP relay).
- [ ] projects-sysadmin: subscribe elixir-mcp-alarms to projects-ops-alerts; add the gateway launchd service + backup verification to the rotations.

**Launch-day incidents (2026-09-03, all resolved same hour):** (1) RDS force-SSL → sslmode=no-verify; (2) gateway .env not exported to process.env under launchd; (3) stale CloudFront cache after web sync → deploys now invalidate; (4) API GW v2 base64 form bodies → 'unknown client_id' on first OAuth connect → rawBody() decode everywhere; (5) gateway had no instantaneous pacing → 1.5s fetch floor added; (6) first CR token was endpoint-limited (clans 200, players 403 accessDenied — the 'insufficient token scope' 403 flavor is REAL, watch for it) → replaced with a correct key. **STEADY STATE reached 18:30Z:** 92-job clan fan-out drained to 0, 177 fetches/6min, breaker silent, ingest clean; ~46 POAP KINGS members + Jamie recording.
- [ ] End-to-end on real recording (Jamie's tag via his gateway) — **GATE: dedicated CR key + DNS records from Jamie**

## V2 build order (the standing work order — check off as chunks land green)

Start every iteration with a recorder health glance (gateway FetchSucceeded/BreakerOpen, DLQs, a get_coverage call) — we babysit while we build. Deploys are routine (`deploy.mjs --skip-web` unless web changed); no billable gates in V2. Jamie-manual steps get queued in NOTES, never blocked on.

**Multi-tenant discipline (Jamie, 2026-09-03): elixir-bot's war/clan code was single-tenant — the pattern, never the assumption, transfers.** Every clan-scoped table leads its PK with the observing clan_tag; the war clock/season inference is per-clan; standings are view-scoped per observer (duplication across recorded clans in one race is by design); entitlements scope clan reads to the member's OWN clan. Any new clan-activity feature gets this checked explicitly.

- [x] War clock (services/ingest/war-clock.mjs): period grid + season inference + observed-anchor-with-fallback + resolveWarKeys from battle time (cross-section = honest nulls); verified against the three real captured riverrace payloads
- [x] Migration 0006 (deployed): war_period_anchor / war_week / war_week_clan / war_participation (**points**) / war_attendance_day + claim.share_battles_with_clan
- [x] War projector (deployed): anchors first-observation-wins; honest anchor_only genesis pending backfill; MAX-merge throughout; war keys stamped from battle time via per-clan clock; stale-payload-at-roll edge documented
- [x] riverracelog backfill (deployed): the log is a daily recorded endpoint; enrollment backfill = first poll; items carry seasonId (genesis unlock); 0007 adds rank/trophy_change; participation clan-scoped to own members
- [x] Entitlements module (deployed): rules 2-4; INTERIM soft claims count for clan scope until liveness ships (CLAN_SCOPE_REQUIRES flips then); owner administers all recorded clans, member consent still applies to owner
- [x] Clan enrollment UI (Jamie's ask, deployed): owner-only /api/admin/clans + Recorded Clans admin panel; leader self-serve stays a later item
- [x] Tools (deployed): get_war, get_war_history, get_clan, compare_players; all 15 tools entitlement-aware (clanmate=summary, war-only battles without consent + scope_note); timeline 'season' granularity deferred to a contract-minor later. Ops stats read added to the migrate Lambda ({stats:true}).
- **OPS GAP found live: the gateway runs launchd-from-source and does NOT pick up deploys — a gateway-code change needs `launchctl kickstart -k gui/$UID/com.poapkings.elixir-mcp-gw` (bit us: riverracelog jobs unleasable by the old process, 1 DLQ'd). Queue a proper fix (gateway self-update or a deploy-script reminder). Session MCP tool rosters are also start-frozen — new tools appear on reconnect (the serverInfo.version story working as designed).**
- Prod observation 20:40Z: 7 active recordings (Jamie appears to be enrolling clans via the new panel), 1,572 players, 1,533 battles.
- [x] Live lane (deployed + verified with a REAL end-to-end fetch from Claude Code: live colosseum data through the gateway in one tool call): enqueue → receipt poll; opportunistic recording confirmed; 50/day per-account live cap (owner exempt)
- [x] ~~Liveness-proof verification~~ RETIRED same day (Jamie, 2026-09-03): currentFavouriteCard is not reliably player-settable in-game, so the challenge could never be completed (cr-agent-api-docs patched). **Claims are trust-based**: owner approval is the gate, a claim is taken at its word. claim.status + verification_challenge (0008) stay in the ladder unused; never rebuild verification on favourite-card.
- [x] Web clan page (deployed): /clan — war standings (final rank order, our row highlighted), roster with trophies/donations/last-battle recency, share_battles toggle per claim. Recency policy mirrors get_clan: activity recency is roster-level; consent gates battle DETAIL only. Members reach it via open membership of a claimed tag in a recorded clan; owner falls back to first recorded clan. Leader self-serve clan-enroll folds into the gateway self-serve item below (same raise-hand pattern).
- [x] Gateway self-serve enrollment (deployed): POST /api/gateways raise-hand (name+static IP, owner notified) + Dashboard panel; owner lifecycle actions (pending→probation→activate→drain→revoke, forward-only) in the Admin gateways panel; ingest now ENFORCES the lifecycle (refuses revoked/unknown gateway_ids, cleanly — no FK-throw retry loop) and stamps last_heartbeat_at on any valid message / last_success_at on admission, so the health panel is real; docs/OPERATORS.md is the public guided install (linked from README). **Jamie-manual per operator: create the IP-allowlisted Supercell key + a per-gateway IAM user (recv/delete on request queues, send on results, PutMetricData) and hand both over out of band; then click "Begin probation".**
- [x] V2 smoke on live data (2026-09-03 21:16Z): smoke.mjs all green; ops stats 8,008 players / 7,442 battles / 64 war weeks / 2,975 participation rows / 5 war anchors across 12 recordings; live MCP get_coverage answered with 31s freshness and pre-claim battle capture. DESIGN/NOTES/AGENTS + memory updated.

**CI note (2026-09-03):** validate had NEVER passed — `node --test test/` needs the directory-positional support local Node 26 has and CI/Lambda Node 24 lacks, so every workspace failed on every run. Fixed with no-arg `node --test` (9a298ee); first green run confirmed. Lesson: dev machine runs Node 26, prod runs Node 24 — CI is the version referee, so check it after the first push, not days later.

**MCP agent-in-the-loop testing phase (Jamie, 2026-09-04, replaces the manual Claude<->Claude Code markdown relay):** fresh-context subagents ARE the naive users — they inherit the session's authed MCP connection but none of the implementation knowledge. Each round: spawn 4-5 persona agents (casual "how am I doing", deck tinkerer, clan leader, data-honesty nerd, adversarial edge-poker), each with a bounded mission (max ~12 tool calls, cr_api_live at most once) returning STRUCTURED feedback (task outcome / friction with exact tool+field names / delights / wishlist). Triage into three lanes: (1) fix now — descriptions, error messages, response shapes (contract-versioned); (2) feature wishlist -> this file for Jamie; (3) rejected with reason. Deploy fixes, spawn a FRESH round (never reuse a contaminated agent), repeat until a round is dry. Measure rounds objectively from mcp_call_audit error/truncation rates during test windows. Runs after the archive import + R1 land. **Jamie-manual: reconnect /mcp in the session when convenient — the session tool roster is start-frozen at the 11 V1 tools, so war tools (get_war, get_clan, get_war_history, compare_players) are invisible to testers until reconnect.**

**Archive import COMPLETE (2026-09-04 06:40Z):** all 13,809 elixir-bot raw payloads replayed through the real pipeline — final state 37,725 players / 35,120 battles / 2,730 snapshots / 134 war weeks / 5,109 participation rows; Jamie's own record now May 14 -> present (235 appearances). Verified via MCP door post-import: played-time ordering correct with interleaved inserts, display-scale levels, coverage honest. One mid-run FK crash (war projector vs never-seen clan) fixed forward. Perf census final in docs/DB-AUDIT.md: projector = 93-94% of cost, career-length scaling confirmed -> R1 next (batch projector writes + player/time index).

**MCP tester wishlist (pilot round 1, for Jamie's triage):** per-week win-rate series on get_performance (group_by: week — the tester approximated trend with one before/after split); mode filter or PoL-medal series on get_player_timeline; gap disclosure on timeline (gaps array or per-point flag); get_deck_performance sort/min_battles/share_of_battles; a single headline summary call (current trophies + 30d W/L + top deck). Pilot verdict: harness works — 6 tool calls, task answered, feedback citable; six friction fixes shipped same night (contract 0.2.1).

**PHANTOM-SEASON INCIDENT (found + fixed 2026-09-04, round-2 agent playtest):** the war-nerd tester cross-checked member_weeks against the battle log and caught colosseum rows frozen at day-1. Root cause: inferSeasonId's stateful roll (+1 when live section < logged section) ran away during the archive replay — logged state was FUTURE relative to replayed payloads, scattering 9 real weeks (true S134-135) across phantom seasons 136-144, then hijacking live polls into "145". Fix: seasons derive STATELESSLY from the CR calendar (first Monday -> first Monday, ~09:30Z; war-clock seasonFromDate, anchored + verified against riverracelog createdDate). 0021 purged season>135 rows; 132-135 history pristine; current week self-heals via MAX-merge. CLASS LESSON: time-derived identity must come from the calendar, never from a state machine that assumes in-order processing — same family as the insert-order/battle-time cursor bug. Round-2 honesty batch SHIPPED 2026-09-04 (contract 0.6.0, verified live): war_days_battled null-when-no-attendance-coverage (unknown never zero), seasons arg scopes member_weeks, get_war participants carry in_clan, standings payload-mirror note (zero-fame opponents can be real), member_since_observed -> first_observed_in_clan, compare_players recorded-window note. Still parked for later: periodLogs harvest (the proper fix for null week ranks/fame — daily endOfDayRank/pointsEarned).

**S3 payload archive BUILT 2026-09-04** (DATA-TOOLS.md has status + crib sheet): archive-at-admission live-verified (first live object 16:05Z), history export run via cursor loop, weekly sweep scheduled (MON 08:15Z). Free S3 gateway endpoint added (new private route table — the VPC lambdas had NO S3 route before this).

**Collector repo split DONE 2026-09-04:** github jthingelstad/elixir-mcp-collector (public); services/gateway removed from this repo; both local instances migrated in place (installer re-run from the new checkout, same labels/env files) and verified up; self-update now tracks the collector repo's main — deploying collector code = push THERE. Queue contract canonical here; the collector test pins the produced shape so drift fails collector-side first.

**Yield scheduler measurement (in flight, 2026-09-04):** probe op added to the migrate lambda ({probe: true}) — hourly battlelog/player/war fetch counts (live gateways only) vs battles harvested, 48h window. First reading right after the 14:45Z deploy shows the expected first-sweep burst (256 battlelog fetches/239 subjects in the deploy hour — every subject had null yield_bph) moderating within the next hour. Honest before/after needs the EWMAs settled; re-probe after several hours. NOTE the archive-import hours dominate any 48h battle counts until Sep 6 — compare fetch volume and battles-per-fetch on LIVE hours only.

**MCP testing round 1 COMPLETE (2026-09-04):** 3 personas, 10 fixes shipped (contract 0.3.0) — see commit 19e1e70. Wishlist added for Jamie's triage (beyond pilot round's): evolution facet on get_card_performance / with_evolution filter; per-card win_rate_delta vs baseline; slim get_collection (drop iconUrls) + owned_evolutions_only; suggested one-card-swap deck comparisons; query_battles total_count; per-era completeness gap map in get_coverage (auditor found a day where snapshot delta 10 vs 3 recorded battles — backfill-era days under-captured, only visible per-day); clarify lifetime battleCount vs recorded-battle mode sets; warnings array for future-window empties. BOTH testers hit the frozen-roster cursor-schema mismatch — reconnect /mcp (also unlocks war tools for round 2). Perf: R1 battlelog projector 408->274ms; riverrace still ~3.1s post-0015 — race/stamp timing split deployed to attribute it (in flight).

**Product direction (Jamie, 2026-09-04): Elixir MCP is a DATA PRODUCT.** Primary interfaces: account management, data exploration, product updates, activity logs + quota, data collection. Self-improvement loop is first-class: agent/user feedback via web AND an MCP write tool (agent feedback = that user's feedback); MCP activity logs are product signal; changes must reach users simply. Approved queue additions (all with Jamie's picks): (a) feedback loop + product-updates surface; (b) collector credits -> owner quota at 10:1, capped 4x base (500->2000); (c) collectors split to their own repo elixir-mcp-collector (small clone for operators; contracts stay canonical here); (d) service-token lane for elixir-bot NOW (Admin-issued long-lived tokens, per-token call visibility) + a note in elixir-bot's tooling that Elixir MCP exists — no functionality moves yet; (e) S3 payload archive per DATA-TOOLS.md: BUILD APPROVED; (f) fun: gateways named after CR cards with the card as profile picture. The scheduler yield redesign IS his priority-queue point (server orders one queue; collectors drain it). (g) WEB DATA EXPLORER (Jamie, 2026-09-04): a browser way to explore what the MCP serves. V1 interpretation (Jamie: open to interpretation): /explore page + ONE bridge endpoint POST /api/explore {tool, args} invoking the SAME tool registry (entitlements/honesty/shapes identical; session-authed; audited surface='web' — explorer usage is its own product signal). Views: subject picker, Summary, Battles table, weekly Trend charts (hand-rolled SVG), Decks, Collection grid, War (when entitled), Coverage. Every future tool becomes explorable for free; users see exactly what their agents see. (h) SITE DOCUMENTATION SECTION (Jamie, 2026-09-04): /docs on the web UI — index/ToC + About, Privacy, Terms, and Architecture (technical docs users can read and admins can reason from; distilled from DESIGN.md). Markdown in-repo, rendered at build time, ships with web deploys. MAINTENANCE RULE goes in AGENTS.md: any change altering architecture or user-facing behavior updates site docs in the same commit. Batched with the explorer (same surface). Work order after self-update gap fix: scheduler redesign -> data explorer + feedback loop -> credits->quota -> S3 archive -> collector repo split -> card avatars -> service tokens.

**Self-update gap (found live 2026-09-04):** comparing checkout vs origin never fires on a machine where the checkout advances by development (HEAD==origin always; running process stays old). Fix: restart whenever checkout HEAD differs from the SHA the process STARTED on — one rule covers dev and operator machines.

**Decision pass (Jamie, 2026-09-04 morning):** (1) scheduler yield-per-call redesign: GO, direct build (not shadow), heat path kept one release as fallback. (2) api_payload retention REFRAMED: payloads move to S3 tiering (Postgres keeps latest-per-entity hot set; every admitted payload archives to S3 content-addressed, lifecycle to IA) — design doc docs/DATA-TOOLS.md first, covering Athena/S3 Tables/DuckDB query tooling and what data tools Elixir MCP should use broadly; REVIEW BEFORE BUILD. (3) Wishlist: build weekly win-rate series + headline summary call + deck sort/share/total_count; per-era completeness map and evolution facet parked. (4) elixir-mcp-alarms -> projects-ops-alerts WIRED (raw delivery, queue policy updated, handoff note in sysadmin notes/). (5) Gateway self-update from green main: GO (hourly fetch/pull/exit + SHA in heartbeats, Admin shows fleet versions). Work order: gateway self-update -> wishlist batch -> DATA-TOOLS design doc -> scheduler redesign. Jamie still to reconnect /mcp for round-2 war-persona testing.

**Budget-efficiency redesign — DRAFT for Jamie's review (2026-09-04):** replace heat (immediacy) with EXPECTED YIELD per call. Every endpoint's value is measurable from our own receipts: battlelog yield = new battles admitted per fetch (the archive census shows it directly); profile yield = snapshot deltas; riverrace yield = points/standings changes (war days >> training days). Proposal: (1) score each (subject, endpoint) with an EWMA of recent yield-per-fetch from api_receipt + projection outcomes — the data already exists; (2) scheduler ranks eligible jobs by yield x staleness instead of heat tiers, with the existing starvation floors unchanged (they are correctness, not efficiency); (3) battlelog cadence adapts per player automatically (a 20-battles/day player polls hourly; a dormant one daily) — this is what hot-player heat approximated, derived instead of asserted; (4) war-day awareness moves from fixed 30-min riverrace cadence to yield-driven (training days decay to ~2h, war days tighten); (5) fleet: keep single global budget + SQS competition (observed working with 2 gateways); per-gateway budget splits only if a gateway misbehaves — the trust model already covers that via draining. Measurable target: battles-captured-per-API-call and snapshot-completeness at HALF today's call volume. Implementation is a scheduler-only change (plan.mjs) — no schema, no gateway changes. AWAITING JAMIE's go.

**Scheduler budget-efficiency redesign (Jamie, 2026-09-04, queued after the archive import + R1):** the heat model was imported from elixir-bot's "hot player" feature — which optimized IMMEDIACY and was of questionable value even there. The real objective is efficiency of API calls across the known gateway fleet: spend the global budget where it buys the most recorded value (battles captured per call, war-window coverage, snapshot completeness), not where activity happened most recently. Rethink CADENCE/heat from that frame; fleet-aware lease distribution belongs in the same design. A second production gateway (jamie-mac-2, second CR key, same host) is live specifically to make multi-gateway behavior observable before this design.

**V2 build order COMPLETE.** Open Jamie-manual / later items:
- ~~Flip clan scope to verified-claims-only~~ MOOT: verification retired 2026-09-03, claims are trust-based; the knob was removed with it.
- **Cards endpoint was NEVER SCHEDULED (found by post-deploy verification 2026-09-03):** ingest/tools/fixtures knew `cards`, but CADENCE, seedPollState, the eligibility SQL, and the gateway path map all missed it — prod had zero catalog, get_card_catalog 503'd, and the 0011 backfill silently stamped decks unconverted against an empty catalog. Fixed (daily cards/GLOBAL job + gateway path + GLOBAL freshness in pipeline); 0012 repaired the stamped-raw decks using the exact IngestFunction-update instant from CFN stack events as the raw/display discriminator, verified live (Jamie's maxed deck reads all 16s, norm=2). Lessons: (a) an endpoint exists only when the SCHEDULER knows it — fixtures make everything downstream pass; (b) a data backfill must fail loudly when its reference data is missing, never stamp-and-continue; (c) verify data migrations through the real door immediately after deploy.
- **Card levels normalized 2026-09-03 (Jamie's live bug report):** API levels are rarity-relative; everything we serve now uses the in-game 1-16 display scale via contracts displayLevel — THE one conversion (elixir-bot's five-call-site scar imported). Ingest stamps deck.norm=1; 0011 backfilled stored decks (norm-guarded, double-shift-proof); get_collection normalizes; cr_api_live stays RAW by design and says so; CONTRACT_VERSION 0.1.1. Any future field that carries a card level must pass displayLevel at the seam.
- **Visibility & quotas shipped 2026-09-03 (Jamie-approved plan):** 0009 account.mcp_daily_quota (default 500, row-update override) + quota headroom in every tool meta; /api/me/usage + Dashboard Usage panel; /api/admin/usage (per-account, per-tool, budget line vs 86,400/day capacity + heaviest subjects); Connected agents panel (family list + Disconnect); 0010 account_event activity log (signed_in, claim_added, recording_started/stopped, gateway_raised, connection_revoked, agent_connected) + Recent activity panel; recording cap (default 5 active player recordings/account, owner exempt); per-recording + per-gateway fetches/24h. Verification-attempt caps were dropped from the plan (verification retired). Retention note: prune mcp_call_audit.args after ~90 days when it matters.
- **Ratified 2026-09-03: being in a clan IS sharing your battles with it.** share_battles_with_clan toggle removed (UI, route, entitlement lane); rule 2 clanmate access covers full battle history of open members. The column stays in the ladder unused. Rationale: battlelogs are public in-game and via the API; the toggle gated convenience access to public data.
- Per new gateway operator: IP-allowlisted Supercell key + per-gateway IAM user (recv/delete request queues, send results, PutMetricData), handed over out of band; then "Begin probation" in Admin.
- Gateway auto-update (launchd runs from checkout; kickstart after gateway-code pulls) — a self-update or deploy reminder still wanted.
- Subscribe elixir-mcp-alarms to the sysadmin projects-ops-alerts queue.
- Delete the Fastmail draft that carried the JMAP token (Jamie).
- Capacity: ~30 clans saturates one gateway's practical throughput; volunteer fleet is the lever.
- Timeline 'season' granularity — contract-minor, when wanted.

2026-09-03 audit outcomes (DESIGN.md §11–§12 added): versioning designed (migration ladder + fingerprint test; contracts package + serverInfo cache-buster + deprecation rules; audit-row tuning loop). Build-blockers closed: DB access path (migrate Lambda + break-glass), SQS 256KB (gateway gzip, alarm on overflow), live request lane (second queue, gateways drain first), budget state in Postgres. Scope changes ratified: `get_player_timeline` into V1 (11 tools), season-roll watcher into V1, **repo public from day one** (fixture discipline from first commit).
