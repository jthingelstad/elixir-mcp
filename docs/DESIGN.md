# Elixir MCP — Product Design

**Status:** Recommended design, v2 — 2026-09-03 (v2 folds in Jamie's design-session decisions and the prior-art surveys of librarian-thing, drop.poapkings.com, and elixir-bot)
**What it is:** A standalone, multi-player, multi-clan service that records Clash Royale history (the official API returns current state only) and exposes it through an authenticated remote MCP server that players connect to their own agent (Claude, etc.).

**Decided constraints (inputs to this design, not open questions):**

- Brand-new codebase; no elixir-bot code reuse (patterns yes, code no).
- Minimal web UI: magic-link registration, player tag claim, record opt-in, small dashboard. No chat.
- Data is recorded once and shared via entitlements. Clan recording covers members. Canonical battle IDs dedupe the same battle across observers.
- Gateway fleet exists for redundancy, NOT quota multiplication. One conservative global rate budget, ToS-compliant.
- Free at launch. No blockchain/POAP anything in-product.
- Unofficiality disclaimer required everywhere user-visible.

**Decided 2026-09-03 (Jamie, design session):**

- **Gated access.** Account creation is request-access with owner approval, not open signup. Approvals happen on an owner-scoped admin page on the site.
- **Hostnames.** Web UI at **`elixir.poapkings.com`**; the MCP/OAuth door at **`mcp.poapkings.com`** (bare protocol endpoint, mirrors librarian's two-hostname cookie separation).
- **Gateways are user-attached.** A gateway belongs to an account. Launch fleet is Jamie's single gateway; self-serve "raise your hand to run a gateway" ships in V2, but the V1 schema models gateways as first-class user-attached rows from day one.
- **Gateway keys** come from Jamie's Supercell developer account (operator submits static IP, Jamie issues a key allowlisting it), stored as a per-gateway attribute so operator-owned keys remain possible later.
- **Stack:** TypeScript/Node 24 everywhere (matches librarian + Drop; the liftable code is TS). Repo: **`elixir-mcp`**, monorepo in Drop's workspace shape.
- **Database:** RDS Postgres, smallest instance (single-AZ db.t4g.micro, gp3) — the recorder writes 24/7, so a fixed small instance beats serverless pricing.
- **Recorder compute is fully serverless:** EventBridge-scheduled scheduler Lambda + SQS queues to gateways + SQS-triggered ingest Lambda. No always-on host, no leader election.
- **Email** via Fastmail JMAP from `elixir@poapkings.com` (already configured for elixir-bot); librarian's `jmap-mail.mts` lifts nearly as-is.
- **Visual design:** the web UI follows the established poapkings.com family conventions — the Clash Royale-themed look of Elixir Drop and poapkings.com: dark background, same palette/typography direction. It should read as a sibling of drop.poapkings.com, not a new brand.

---

## 1. The gap this product fills

The CR API (`api.clashroyale.com/v1`) is architecturally a current-state service. From the codified docs (`cr-agent-api-docs`), the precise inventory of what history exists server-side:

| Surface | History available |
|---|---|
| Player profile | None. Trophies, card levels, deck, badges, donations are scalars. Season donations are **wiped at season roll**. `leagueStatistics` holds exactly 3 season data points; PoL holds 1 prior season + all-time best (undated). |
| Battle log | Rotating window of **~30–40 battles (typically 30)**, unpaginated, no date parameter. Docs record observed loss "within ~24h" for active players. |
| Clan | None. Roster is now-only; departed members vanish; `previousClanRank` is one step; no join/leave log. |
| River race | `riverracelog` is the one genuinely durable server-side history (clan-scoped, per-participant fame/decks preserved for past weeks). |
| Classic war | Dead (`currentwar` 410, `warlog` 404). |
| Events / tournaments | Active-only listings; ended events unresolvable; ended tournaments retrievable only if you captured the tag while live. |

So: **there is no per-player history endpoint of any kind.** No trophy time series, no card-upgrade timeline, no per-season donation history, no battle archive. Anyone who wants "my win rate this season vs last," "when did I hit 7000," or "did I miss a war day" needs an external recorder that was already watching. That recorder is Elixir MCP.

The #ask-elixir corpus (Phase 3, ~125 verbatim player questions, Jul–Sep 2026) confirms demand: 74% of real questions were routed as free-form analytics that fit no pre-built command. The single most product-defining question observed: *"What is my win percentage in ranked since swapping to Firecracker vs before."* That question is unanswerable without recorded history and arbitrary-window aggregation — exactly this product.

---

## 2. Product shape

Three planes, deliberately small:

1. **Recorder** — polls the CR API on an adaptive schedule, stores receipts + canonical facts, derives projections. Headless, deterministic, no LLM.
2. **MCP server** — remote MCP (streamable HTTP), OAuth 2.1-protected, exposing read tools over recorded history plus a thin live passthrough. All reasoning (deck advice, coaching, judgment) belongs to the *user's* agent; Elixir MCP serves data and computed aggregates.
3. **Web UI** (`elixir.poapkings.com`) — request access; after approval: magic-link sign-in, claim player tag(s), opt a player or clan into recording, dashboard showing recording status/freshness, and the MCP connect instructions (pointing at `mcp.poapkings.com`). Owner-scoped admin area: access-request queue (approve/deny), gateway roster + health, global budget/403 view. V2 adds the gateway enrollment flow. Nothing else.

**Positioning rule that shapes everything below:** the elixir-bot corpus shows players ask judgment questions ("fix my deck," "kick recommendations"), but in an MCP world those are the *agent's* job. Elixir MCP's contract is: *your agent brings the brain; we bring the memory.* This keeps the tool surface small, keeps us out of coaching-quality liability, and makes the product model-agnostic.

**Compliance posture:** Supercell's Fan Content Policy prohibits charging fees (ads, voluntary donations, coaching are the only permitted monetization), prohibits blockchain/NFT themes, and requires the unofficiality disclaimer. Free-at-launch and no-POAP are therefore not just product choices; they are compliance requirements. The disclaimer text ("This material is unofficial and is not endorsed by Supercell…") must appear on the web UI, in the MCP server description, and in tool responses' metadata block. If monetization is ever revisited, voluntary-donation/supporter tiers that gate *quota*, not content, are the only shape worth studying.

---

## 3. MCP tool surface (recommended)

Grounded in the Phase 3 question categories (share of ~125 real questions in parentheses). Names use `verb_noun`; all tools return a common `meta` envelope: `{as_of, recorded_since, freshness_seconds, completeness_note, disclaimer}` — because "is your data right/current" was itself a top-10 question category (5%), and users actively challenged stale answers.

All tags are CR tags (`#ABC123`); every tool validates against the CR tag alphabet and rejects malformed tags with a structured error rather than passing a 404 through.

**Contract discipline (V1-critical, lives in `packages/contracts` — §11):**

- The `meta` envelope also carries `contract_version`, so an agent (and our own debugging) can always tell which tool contract produced a response.
- **One error taxonomy**, a closed enum shared by every tool: `invalid_tag`, `not_entitled`, `not_recorded`, `not_found`, `quota_exceeded`, `live_unavailable`, `bad_request`. Structured `{code, message, hint?}` — never a raw upstream error, SQL error, or pass-through 404. (Quota exhaustion additionally maps to JSON-RPC `-32029`, librarian's convention.)
- **Deck identity is pinned once:** `deck_hash` = sha256 over the sorted `(card_id, evolution_level|0)` pairs plus the tower-troop id. Form discriminators are part of identity (`evolution_level` encodes card *form* — Evo/Hero — never merge forms); card levels and star levels are not (upgrading a card doesn't change which deck it is). This definition lives in the contracts package and nowhere else — `query_battles`, `get_performance`, and `get_deck_performance` all accept and emit the same hash.
- **Result-size discipline:** hard ~48k-char cap on any tool result with a per-tool "narrow these params" hint on truncation (librarian's pattern, shipped after real clients choked). `query_battles` at `limit: 50` with two full decks per battle sits comfortably under it; the cap is the backstop, not the norm.
- **`player_tag` defaulting:** `claim` carries `is_primary` (exactly one per account); every tool that defaults `player_tag` resolves to the primary claim, and `list_my_players` reports which claim is primary so agents don't guess.
- **Local time (Jamie, 2026-09-03):** the CR API is UTC-only and a game log in the wrong timezone is genuinely hard to read. `account.timezone` (IANA name, set in the web UI, nullable = UTC) drives rendering: every tool that returns timestamps includes the account-local rendering alongside UTC, `meta` reports the timezone applied, and relative windows ("yesterday", `from`/`to` dates without times) resolve in the account's timezone at the tool layer. **Storage stays UTC everywhere** — battle-level queries resolve local windows exactly; pre-bucketed day rollups remain UTC days and are labeled as such (the honest trade; battle-backed tools recompute exact local windows when it matters).

### Identity & coverage

**`list_my_players`** — no input → claimed tags, verification status, recording status per tag, entitlements (own / clan-derived), clan membership as recorded. The agent's session bootstrap; every other tool defaults `player_tag` to the caller's primary claim.

**`get_coverage`** — `{player_tag?}` → recording start date, last successful poll per endpoint, battle capture completeness estimate (recorded battles vs `battleCount` delta over the window), known gaps. Directly answers the trust category and lets an honest agent caveat its answers.

### Player state & history

**`get_player`** — `{player_tag?}` → latest recorded profile snapshot (trophies, PoL, league stats, lifetime counters, current deck, badges incl. the load-bearing `CollectionLevel` badge) + clan + as-of. Optional `live: true` fetches fresh from the API through the passthrough budget.

**`get_player_timeline`** — `{player_tag?, metrics: [trophies|pol_trophies|donations|collection_level|battle_count|...], from?, to?, granularity: day|week|season}` → time series from daily snapshots/rollups. Answers "trophy graph," "how many battles last season," progression questions (6%).

### Battles & performance (the core, 15% + 5% + follow-ups)

**`query_battles`** — `{player_tag?, from?, to?, mode?: ladder|ranked|war|challenge|tournament|casual, game_mode_id?, opponent_tag?, outcome?: win|loss|draw, with_card?, against_card?, deck_hash?, cursor?, limit<=50}` → canonical battle records (time, mode, outcome, crowns, trophy change, both decks, opponent, closeness fields like remaining tower HP and elixir leaked). The workhorse; nearly every analytics question decomposes into this plus aggregation.

**`get_performance`** — `{player_tag?, window: {from,to} | season | last_n_battles, compare_to?: {from,to} | before_after: date, mode?, deck_hash?}` → wins/losses/draws, win rate, crowns for/against, net trophies, streaks, 3-crown rate. `compare_to` exists specifically for the "since swapping to Firecracker vs before" class of question — server-side comparison beats making the agent page through battles.

**`get_card_performance`** — `{player_tag?, perspective: mine|opponent, window?, mode?}` → per-card win/loss attribution over the player's recorded battles. `perspective: opponent` is the "nemesis card" question verbatim; `mine` answers "which of my cards is carrying."

**`get_deck_performance`** — `{player_tag?, window?, mode?}` → battles grouped by deck hash: per-deck record, first/last used, win rate. Gives the user's agent the factual substrate for deck review without us doing deck *advice*.

**`get_collection`** — `{player_tag?}` → full card collection with levels, evolutions, star levels, stash counts, plus upgrade-gap fields (cards-to-next-level from the maintained reference table — the API doesn't expose upgrade costs). Feeds "build me a deck from what I own" and "what should I upgrade" — resolved by the agent, fed by us.

### War & clan (16% + 17%)

**`get_war`** — `{clan_tag?}` → current river race: standings across the 5 clans, per-member fame/decks-used/decks-used-today, period type (training/warDay/colosseum), recorded per-day period logs. Defaults to the caller's clan.

**`get_war_history`** — `{clan_tag?, player_tag?, seasons?: n}` → recorded seasons/weeks with per-participant fame, decks used, boat attacks; per-player attendance by war day where recorded ("did I miss a war day deck?" — the highest repeat-rate question). Backfilled from `riverracelog` at clan enrollment, enriched daily by our own recording.

**`get_clan`** — `{clan_tag?}` → roster snapshot + recorded history: join/leave events, role changes, donation rollups (weekly/season — recoverable only because we snapshot before season roll), activity recency per member (last battle seen, `lastSeen`). This is the data behind promote/kick questions; the *judgment* stays with the clan leader's agent.

**`compare_players`** — `{player_tags: [2..4], window?, metrics?}` → side-by-side stats for entitled tags (scouting/comparison, 3%).

### Reference & escape hatch

**`get_card_catalog`** — `{}` → current card/tower-troop catalog with IDs, rarities, max levels, evolution availability. Cached reference so agents stop guessing card IDs. The catalog itself refreshes from `/cards`; the **upgrade-cost table does not exist in the API** — it's a committed, versioned reference file (`packages/game-data`, Drop's `cards.json` precedent), seeded from the cr-agent-api-docs wiki crosswalk and hand-updated on balance changes. It needs a named maintenance chore, or `get_collection`'s upgrade-gap fields silently rot.

**`cr_api_live`** — `{path, params?}` → allowlisted GET passthrough to public endpoints (player, clan, battlelog, riverrace, rankings, tournaments-by-tag), served through the same global budget with tight per-user quota. Kills the long tail (leaderboards, arbitrary clan lookups) without minting a tool per endpoint. Also opportunistically ingests what it fetches — a free recording signal.

**Deliberately absent:** `suggest_deck`, `review_deck`, `kick_recommendations`, any notification/posting tool. Prior art (elixir-bot's 31 tools) shows those work, but they encode judgment and voice; in this product they belong to the connecting agent. If demand proves otherwise, a `meta_decks` reference tool is the furthest we should go.

That is 15 tools; V1 ships 11 of them (§8).

---

## 4. Data model

**API-shaped by default; deviations are named and few (Jamie, 2026-09-03).** How much application logic belongs in Elixir MCP? As little as survives scrutiny. Canonical tables mirror the CR API's current model (snake_cased names, jsonb for sub-shapes we don't interpret); when the game evolves its own model — expLevel deprecated in favor of Collection Level — we follow the API's current shape rather than inventing a progression abstraction of our own. The complete list of places we deliberately deviate is short, and each entry exists to resolve a documented trap: tag normalization, the minted canonical battle ID, outcome resolution, deck_hash, points-vs-fame naming, observed-tenure memberships, and timing honesty on events. Anything not on that list passes through as the API gives it, and adding to the list is a design decision, not a convenience. (Raw payloads stay byte-true regardless — the receipt/payload layer is the escape hatch when our model turns out wrong.)

Postgres, one schema, tenancy from day one. (SQLite served elixir-bot well but is single-writer and single-tenant by construction — its author's own assessment. Multi-account + gateway fan-in + concurrent MCP reads is Postgres's home turf. No em-dash bikeshed: managed Postgres, smallest instance, `pgcrypto` for hashes.)

### 4.1 Identity & tenancy

**Identity discipline — Clash Royale's IDs are the only IDs for game entities.** Supercell already solved global identity: player tags and clan tags are unique, permanent, and printed on every payload. We adopt them as primary keys verbatim and never mint surrogates for game entities — a synthetic `player_id` next to the real one is a bug factory (double bookkeeping, drift, and a mapping table nobody needed). One shared normalizer defines the single canonical stored form — uppercase, `#`-prefixed, `O` folded to `0` (the CR tag alphabet is `0289PYLQGRJCUV`; `O` only ever appears as a human typo) — and it is applied at every boundary: ingest admission, every MCP tool input, claim entry, URLs. The only identifier we mint ourselves is the canonical battle ID (§4.4), because CR doesn't provide one — and it is *derived* from tags plus canonical time, never issued.

**Every battle is a fact about all of its participants.** Polling one recorded player's battlelog produces data about their opponents too — deck, trophies, clan-at-battle-time. Participant rows are written symmetrically for every side, keyed by tag, regardless of whether anyone has claimed those tags. This is the record-once model taken seriously: the recorder observes *battles*, not customers.

**Data about you may predate you.** By the time a player requests access, they may already be in the corpus — as the opponent of players we record. A claim therefore changes *entitlements, never data*: the moment the tag attaches to an account, previously recorded history unlocks (rule 1, §4.2) with no migration and no re-keying, because game data never referenced accounts in the first place. Game-data tables (`player`, `battle`, `battle_participant`, `clan`, snapshots, events, rollups) reference tags only; accounts touch game data through exactly one join — `claim`. Make the unlock a product moment: the dashboard and `get_coverage` should say "you've appeared in N recorded battles since {date}." The scope stays tight, though: a claim on tag A entitles you to battles *tag A participated in* (both perspectives of those battles — it's your history too) and never to browsing tag B's other history.

**Non-registered players are data subjects** (terms review §4). Their exposure stays inside a subscriber's own context — no arbitrary-tag historical lookup — and the deletion path is tag-scoped: redact the requesting tag's participant-level details (deck, per-perspective stats) while the battle row and the counterparty's perspective survive, because the battle is equally the other player's history.

- **`account`** — `account_id`, `email_hash` (sha256 lowercased; canonical id, mirroring the thingy/librarian pattern), `created_at`, `status: requested|approved|denied|disabled`, `is_owner`. Access is gated: a visitor submits email + player tag + optional note; the account sits in `requested` until the owner approves it from the admin page (approval sends the welcome mail; magic-link sign-in and every other row below require `approved`). The request form is the rate-limited surface; approval is also the capacity valve — recorded-player count is what the global budget actually prices.
- **`player`** — `player_tag` PK, cached name, first/last seen. Exists independent of accounts (opponents, clanmates).
- **`claim`** — `account_id`, `player_tag`, `status: unverified|verified`, `verified_method`, `created_at`. One player tag may be claimed by at most one verified account; unverified claims can coexist and only lower-privilege reads apply.
- **`clan`** + **`clan_membership`** — `(clan_tag, player_tag, joined_observed_at, left_observed_at NULL=open)` with a partial unique index on open membership per player. Observed tenure, not asserted (borrow elixir-bot's invariant exactly).

**Tag verification (settled 2026-09-03): claims are TRUST-BASED.** `POST /players/{tag}/verifytoken` is scope-restricted (live-verified: normal keys get `accessDenied.invalidScope`), and the favourite-card liveness challenge was built and retired the same day — `currentFavouriteCard` is not reliably player-settable in-game (cr-agent-api-docs). Owner approval of accounts is the gate; a claim is taken at its word. `claim.status` stays in the schema unused; the verifytoken scope application remains the only credible future path.

### 4.2 Recording & entitlements

- **`recording`** — `recording_id`, `subject_type: player|clan`, `subject_tag`, `requested_by account_id`, `status: active|paused|stopped`, `created_at`. Opt-in is explicit; stopping keeps recorded data but halts polling.

**Clan auto-follow (Jamie, 2026-09-03):** recording a player implicitly *follows* their current clan — the clan tag is read from the player's own profile (never asked of the user), the clan heartbeat starts, and it retargets automatically when the player moves clans. Following is not clan *recording* (that stays an explicit V2 opt-in): it costs only the fixed per-clan heartbeat, and everything it yields about clanmates is **roster-derived only** — `player` rows seeded for every member (name, role, trophies, donations, `lastSeen` from the clan payload itself), membership tenure, join/leave events. Zero additional API calls, and no per-player endpoint (battlelog, profile) is ever polled without that player's own opt-in — that line is both the consent posture and the budget guard. The payoff is §4.1's "data about you may predate you": a clanmate who signs up later finds their identity, tenure, and roster history already seeded.
- **`entitlement`** — derived, materialized view or table: `(account_id, subject_tag, scope, source)`.

**Entitlement rules (the whole policy, keep it this small):**

1. A claim entitles the account to full history for that tag — including battles recorded before the claim (data was recorded once; the claim unlocks the view). Claims are trust-based (see §4.1 tag verification).
2. Clan recording covers members: while player P is an observed member of recorded clan C, accounts with a claim on any member tag of C may read C's clan-scoped data (war, roster, donations) and fellow members' history, battles included. **Being in a clan is sharing your battles with it** (ratified 2026-09-03; battlelogs are public in-game and via the API — the retired `share_battles_with_clan` consent flag gated public data and is no longer read). Access ends when the observed membership closes.
3. A battle is readable by anyone entitled to *either* participant — you were in it; it's your history too.
4. Leadership-sensitive derived data (activity/inactivity rankings) is scoped to accounts whose claimed tag holds elder+ role in the recorded clan, mirroring elixir-bot's public/leadership scope split.

### 4.3 Provenance layer (pattern borrowed, code not)

The receipt/payload split is elixir-bot's standout idea and transfers wholesale:

- **`api_payload`** — content-addressed: `(endpoint, entity_key, payload_hash)` unique, `payload_json` (JSONB), `first/last_fetched_at`. Identical bodies stored once (elixir-bot observed ~4:1 receipt:payload compression on battlelogs).
- **`api_receipt`** — append-only, one row per HTTP 200: endpoint, entity_key, `fetched_at`, `payload_hash`, `gateway_id`, admission status. Retention ~60 days for payload bodies; receipts kept longer (they're small).

Every derived row carries the receipt lineage (a `materialization`-style run table records which receipts fed each projector run — adopt the pattern at coarse grain, not elixir-bot's 14 KB-per-row counters blob).

### 4.4 Canonical battles

There is **no server-side battle ID**. The docs' documented dedup key, extended:

```
canonical_battle_id = sha256(
    battle_time_canonical_utc          # both players see identical battleTime (documented)
  + ":" + sorted(all participant tags) # 2 tags for 1v1, 4 for 2v2
  + ":" + type_class                   # only to separate boatBattle (no real opponent) from PvP
)
```

Rules learned the hard way upstream, adopted as invariants: the ID is derived from the *canonical stored form* of `battle_time` so key and column can never disagree (elixir-bot's v25 incident: a timestamp format change silently minted 1,348 duplicates); a river-race duel is one battle with rounds, not three; locate the subject player by tag scan, never `team[0]` (2v2 self-teammate bug).

- **`battle`** — `battle_id` PK, `battle_time`, `type`, `game_mode_id/name`, `arena`, `league_number`, war keys (`season_id, section_index, war_day` resolved from the battle's own time against the war calendar, never poll time), modifiers, tournament/event tags.
- **`battle_participant`** — `(battle_id, player_tag)` PK, one row per participant written symmetrically for claimed and unclaimed tags alike (§4.1 identity discipline), `side`, per-perspective facts: crowns, trophy change, starting trophies, deck (JSONB + `deck_hash`), support cards, elixir leaked, tower HP remaining, outcome (computed via the documented precedence: `boatBattleWon` → `trophyChange` sign → crown compare → unresolved).
- **`battle_observation`** — `(battle_id, observer_tag, receipt_id)`: which log we saw it in. Two observers, one battle, two observations.

**Merge discipline:** ingest is upsert with COALESCE-fill (enrich-on-dedup) — a battle first seen thin from one observer gets its missing per-participant fields filled when the other observer's log arrives. Derive the enrich column list from the insert column list programmatically (elixir-bot's `deck_json stayed NULL` lesson).

**Trap to encode in ingest, not in every reader:** on tournament battles, `startingTrophies` is tournament score, not ladder trophies; `trophyChange` exists only on `PvP`/`pathOfLegend`; tower HP is margin-of-victory, never progression.

### 4.5 Snapshots, events, rollups

- **`player_snapshot_daily`** — one row per recorded player per UTC day (plus forced snapshot in the hour before season roll, because season donations are irrecoverable after it): trophies, PoL result, league stats, donations, lifetime counters, collection summary hash. Full card collections stored on change only (content hash), not daily.
- **`player_event` / `clan_event`** — typed diff streams (trophy milestone, card upgraded, evo unlocked, joined/left/role change, donation reset) with elixir-bot's honest `timing: exact|estimated` + `window_start` bracketing — polling is discrete; the schema should say so.
- **Rollups** — `player_daily_battle_rollup` (per day × mode: W/L/D, crowns, trophy delta, plus a completeness ratio of captured battles vs `battleCount` delta) and `clan_daily_metrics`. These make `get_performance`/`get_player_timeline` cheap.
- **War** — `war_season` / `war_week` / `war_participation (season, week, player)` / `war_attendance_day`. Seeded from `riverracelog` backfill (paginate at enrollment; depth undocumented, take what it gives), maintained live from `currentriverrace` during war days. **Naming discipline (§13):** the per-member value is stored as `points` even though the CR payload calls it `fame` — members contribute points, fame belongs to the boat, and per-member division of clan fame is banned. Imported verbatim from an elixir-bot data-contamination incident.
- **Cursors** — `battle` and the event tables carry a monotonic insertion cursor (`bigserial`) from V1 (§13): future consumers tail the corpus incrementally; costs nothing in the DDL.

**Timezone:** store UTC everywhere; per-account display timezone is a UI/tool-parameter concern. (elixir-bot's hardcoded America/Chicago day boundary is exactly the single-clan assumption we're shedding.)

### 4.6 Gateways (user-attached, first-class from V1)

- **`gateway`** — `gateway_id`, `owner_account_id` (FK), `name`, `static_ip`, `key_source: jamie|operator` (launch: always `jamie`; the column is the BYO-key option kept open), `cr_key_ref` (reference to the key record, never the key itself — the key lives only in the operator's local `.env`), `status: pending|probation|active|draining|revoked`, `enrolled_at`, `last_heartbeat_at`, `last_success_at`.
- Every `api_receipt` already carries `gateway_id` — that's the per-gateway health/attribution signal (success rate, latency, 403 streaks) and what the admin gateway roster reads.
- **Lifecycle:** `pending` (IP submitted, key not yet issued) → `probation` (installed, heartbeating, receiving only low-stakes work until N clean days) → `active` → `draining` (no new leases; used for planned retirement and for tripped circuit breakers) → `revoked` (IAM user deleted, CR key deleted at Supercell). launch = Jamie's gateway created through exactly this path.
- **Trust model:** gateways are dumb fetchers but they *could* lie. Mitigations, cheap-first: ingest validates every payload against the admission schema regardless of source (a lying gateway can only inject well-formed data about entities it was asked to fetch); job leases pin `(endpoint, entity_key)` so a gateway can't choose targets; per-gateway attribution means anomalies (impossible payloads, drift vs other observers of the same clan) are traceable and revocation is one click. Cross-gateway consistency checks are a V3 idea, not a V1 gate — at V1/V2 fleet sizes the operators are personally known.
- **Per-gateway AWS identity** (Drop's pattern, multiplied): each gateway gets its own IAM user scoped to exactly ReceiveMessage/Delete/ChangeVisibility on the request queue, SendMessage on the results queue, and `cloudwatch:PutMetricData` condition-scoped to its own namespace. Revocation = delete the IAM user; the SQS seam means a revoked gateway can't touch Postgres because nothing ever could.

---

## 5. Recorder / scheduler design

### 5.1 Topology (serverless; Drop's seam, elixir-bot's brain)

```
EventBridge (rate 1 min)
    └─> scheduler Lambda ── plan state (heat, freshness, budget) in Postgres
              └─> SQS elixir-mcp-cr-requests (+DLQ)
                        └─> gateway workers (N, launchd on operator machines, IP-bound CR key)
                                  └─> SQS elixir-mcp-cr-results (+DLQ)
                                            └─> ingest Lambda ──> RDS Postgres
```

- **Scheduler** is an EventBridge-scheduled Lambda tick (every 1–2 min), not a resident process — EventBridge provides the "exactly one planner" property that DESIGN v1 wanted leader election for. Each tick: decay heat (before planning — elixir-bot's ordering lesson), select due/starved work under the *global* token bucket, enqueue jobs. Plan state (`poll_state`: heat, per-endpoint freshness, floors) lives in Postgres; the cloud↔gateway seam is SQS because gateways must never hold DB credentials. One logical budget regardless of N gateways — the fleet is for redundancy (a gateway dying, an IP getting soft-blocked) and never multiplies the spend. Every issued job carries a budget token; unconsumed tokens from failed leases return via the results/DLQ path, and the SQS visibility timeout is the lease.
- **Gateways** are dumb, stateless fetchers forked from Drop's `services/cr-api-bridge` shape: long-poll lease → HTTP GET with their IP-bound key → post raw body + status to the results queue → delete the request. launchd `KeepAlive`, single esbuild bundle, queue-name indirection (names via `GetQueueUrl`, overridable by env — what makes one bundle serve N gateways). Per-gateway circuit breaker: consecutive `403 accessDenied` (which is *also* what rate-limit overage looks like — the docs' most surprising fact, documented in cr-agent-api-docs but never encoded in elixir-bot; we encode it) opens the breaker, sets the gateway `draining`, and pages; jobs re-lease elsewhere. Honor `Retry-After` globally when a real 429 appears. Split heartbeats (Drop's pattern): process-alive metric every 60s, work-succeeding metric only on completed fetches — the alarm on the second is what catches a silently broken IP binding.
- **Two request lanes.** `cr-requests-live` and `cr-requests-bulk` are separate queues; gateways always drain live first. The live lane serves `cr_api_live` and `live: true` — an MCP call enqueues a job with a correlation ID, then polls Postgres for the resulting receipt (bounded ~8s; a healthy gateway long-poll picks the job up near-instantly, so typical latency is 1–3s); on timeout the tool returns a structured `live_unavailable`, never a hang. Live results flow through the normal results→ingest path, which is also what makes passthrough fetches opportunistically recorded. Without the split, an interactive request queues behind a burst of scheduled polls.
- **Payload size:** SQS caps messages at 256 KB and a raw battlelog can exceed it (30 battles of deck JSON runs 100–300 KB). Gateways **gzip every response body** (this repetitive JSON compresses ~10–20:1, so compressed bodies always fit in practice); a post-compression overflow is rejected at the gateway with a loud alarm — it means CR's response shape changed, and we want a human, not a silent S3 fallback that widens gateway IAM.
- **Budget state lives in Postgres, not memory.** The token bucket is a row the scheduler settles each tick (tokens accrued = rate × elapsed, capped at the burst allowance; jobs enqueued ≤ tokens available, live-lane reserve held back per §5.2). A Lambda that ticks every minute has no in-process state to keep — deterministic accounting in the DB is the whole trick, and it's also what the admin budget view reads.
- **Ingest** is an SQS-triggered Lambda and the admission boundary (validate identity fields and must-have keys before anything mutates durable state; optional CR fields stay optional so additive API evolution doesn't stop the recorder), then payload hash → receipt → canonicalization → projections. Idempotent by construction so at-least-once delivery and queue retries are free — the stateless-worker replacement for Drop's in-process dedup set. Freshness advances only on admission, never on HTTP 200 (elixir-bot invariant), so a rejected payload doesn't burn the subject's polling window.

### 5.2 Rate budget (the ToS-critical part)

Documented reality: aggressive limiting, per-IP, no quota headers, ~2s pacing guidance, ~60s server cache floor on player endpoints, overage often surfaces as 403. Recommendation:

- **Global steady-state ceiling: 1 request/second** (86,400/day), with scheduler-enforced pacing and burst cap of 5. This is conservative on purpose; it is also plenty: elixir-bot records a 50-member clan comfortably on ~1,140 calls/day.
- **Capacity math** at ~23 calls/player/day average (elixir-bot's observed mix): a 1 rps budget supports roughly **3,500 recorded players** before the budget, not the architecture, becomes the constraint. Raise the ceiling only deliberately, in small steps, watching 403 rates.
- Never poll a player endpoint more often than 60s (cache floor makes it pointless anyway). Reserve ~10% of budget for `cr_api_live` passthrough and interactive freshness (`live: true`), quota'd per account.

### 5.3 Adaptive cadence vs the battlelog window

The battlelog is ~30 battles, unpaginated, and can rotate in under 24h for a heavy player — that bounds required cadence. A player producing B battles/day needs polling every `≈ 30/B` days-worth; even 100 battles/day (extreme) is safe at ~4h. Adopt elixir-bot's heat model with gentler numbers:

| Tier | battlelog | profile |
|---|---|---|
| hot (battled in last poll) | 15 min | 2 h |
| warm | 1 h | 8 h |
| cold | 6 h | 24 h |
| starvation floor | 24 h | 72 h |

Heat: new battles observed → hot; decay one tier per scheduling epoch without activity; decay at epoch start, before planning (elixir-bot's ordering bug cost ~30 min of recognition latency). Plan order: starved first, then heat, then overdue — fairness floors beat heat so a cold player is never unrecorded past the floor.

Clan-level: `clan` every 15 min per followed clan — followed clans are derived from recorded players' profiles (§4.2 clan auto-follow), and the same roster payload seeds/refreshes `player` rows for every member for free; `currentriverrace` every 15 min on war/colosseum days, hourly on training days (gate on stored `periodType`, remembering colosseum practice days still report `training`); `riverracelog` daily + on enrollment backfill. Season-roll watcher forces profile snapshots for all recorded players in the final hour (donation preservation).

### 5.4 Completeness honesty

Every battlelog poll computes `captured` vs the profile's `battleCount` delta; the gap feeds the rollup completeness ratio and `get_coverage`. When the recorder was down or a player out-battled the window, the product *says so* rather than presenting a silent undercount — the Phase 3 trust category shows users will catch it anyway.

---

## 6. Auth flow

Mirror the proven thingy/librarian pattern nearly verbatim (it already survived contact with Claude's connector, consent double-submits, and DCR abuse). Two doors, one identity.

### 6.1 Web (magic link, behind the access gate)

0. **Access gate:** sign-in is only offered to `approved` accounts. Anyone else gets the request-access form (email + player tag + note), which creates a `requested` account and notifies the owner. Approval from the admin page flips status and sends the welcome email. Denied/unknown emails get the same neutral "if approved, you'll hear from us" response the request form gives — the gate must not become an email oracle.
1. Email → rate-limited (per-email-hash and per-IP; IP-only identity for the limiter — including User-Agent lets attackers mint identities) → send email containing a one-shot link **and a 6-digit code** (the code survives "link opened in the wrong browser," which otherwise breaks OAuth consent; 6 digits also triggers Apple autofill). Sender: Fastmail JMAP from `elixir@poapkings.com` (already provisioned for elixir-bot); librarian's `jmap-mail.mts` lifts nearly as-is.
2. Redemption via conditional single-use update (`used_at not set AND not expired`) so races lose; code path increments attempts *before* comparing, capped at 5, `timingSafeEqual`.
3. Session: compact HMAC-signed token in an `__Host-` HttpOnly cookie, sliding ~9-day TTL with a hard 90-day cap and a server-side session row so sign-out actually revokes.

### 6.2 MCP (OAuth 2.1)

- Streamable HTTP, stateless single-response mode; separate hostname (**`mcp.poapkings.com`**, vs the web UI at `elixir.poapkings.com`) whose CloudFront distribution forwards **no cookies** — surface separation as a routing fact, not a code check. Unlike librarian (whose fronting distribution lives out-of-band), this distribution is authored in our stack (§7).
- OAuth grants are only issued to `approved` accounts — the access gate sits inside the shared credential core, so both doors enforce it identically. Connect URL users paste: `https://mcp.poapkings.com/mcp`.
- **Dynamic client registration** (public clients, no secrets), per-IP rate limit plus a fail-closed global daily cap.
- **Authorization code + PKCE S256 mandatory.** `/authorize` renders server-side HTML reusing the *same* magic-code send/verify core as the web (one credential-issuance core, two shells — this is why the identities can't drift). Return `303` with `code`, `state`, and the RFC 9207 `iss` param (Claude's connector requires it). Discovery via RFC 8414 + RFC 9728; 401s carry `WWW-Authenticate: Bearer resource_metadata=…`.
- **Tokens:** opaque, prefixed (`eat_`/`ert_`), stored only as sha256, DB-TTL'd. Access 1h; refresh 30d rotating with family-replay revocation; **90-day absolute family lifetime** forcing re-consent (also our natural re-entitlement checkpoint).
- Per-request: token → `{account_id, entitlements, scope}` → scope check → hourly rate limit → per-account daily tool-call quota → audited call row (short TTL).
- Ship `serverInfo.version` fingerprinting the tool schema and declare `tools.listChanged: true` — a stateless server can never push the notification, and clients have been observed caching `tools/list` forever otherwise.

Identity key throughout: `sha256(lowercased email)`. Same value is the web session subject and the OAuth grant subject; entitlements resolve identically on both doors.

---

## 7. AWS infrastructure

One CloudFormation stack, raw CFN in the Drop/librarian house style, deployed by scripts (bootstrap/deploy/smoke) — and Drop's `parameters.mjs` discipline is a **must-port**: SECRET / REQUIRED / PRESERVED parameter classes with `UsePreviousValue`, because CloudFormation silently resets omitted parameters to template defaults (the documented Drop trap).

```
                    elixir.poapkings.com                      mcp.poapkings.com
                  CloudFront (dark CR-themed site)         CloudFront (NO cookies forwarded)
                   ├─ default → S3 (private, OAC)               └─ /mcp, /oauth/*, /.well-known/*
                   └─ /api/* → API GW ─ web-api λ (VPC)              → API GW ─ mcp λ (VPC)
                                                 │                          │
   EventBridge rate(1m) ─ scheduler λ (VPC) ─────┤     RDS Postgres         │
   SQS cr-results ─────── ingest λ (VPC) ────────┼──── db.t4g.micro ────────┘
                                                 │     (single-AZ, gp3)
   SQS cr-requests ◄── scheduler; leased by gateways (operator machines, per-gateway IAM users)
   SQS email ─────────── email-relay λ (NO VPC) ──► Fastmail JMAP (elixir@poapkings.com)
   Alarms ── SNS elixir-mcp-alarms ──► projects-ops-alerts SQS (sysadmin queue of record)
```

**Networking — NAT-free by design.** A small VPC, two private subnets (RDS subnet groups require two AZs), **no NAT gateway** (that alone would cost more than the database). The four DB-touching Lambdas (web-api, mcp, scheduler, ingest) live in the VPC and talk only to RDS plus AWS services through a **VPC interface endpoint for SQS**. Everything that needs the public internet is out-of-VPC and queue-fed: the **email-relay Lambda** consumes the email queue and speaks JMAP to Fastmail — VPC Lambdas never send mail directly, they enqueue. Lambda log delivery doesn't traverse the VPC (service channel), and custom metrics go out as **EMF over logs**, so no monitoring endpoints are needed.

**Database.** RDS Postgres, `db.t4g.micro`, single-AZ, gp3 20 GB with storage autoscaling, 7-day automated backups + PITR, deletion protection + Retain policy. No RDS Proxy until observed connection pressure demands it (hobby rule: no layers without an observed problem) — instead, small reserved-concurrency caps on each Lambda bound total connections. Scale path is a resize, not a rearchitecture.

**Queues.** `elixir-mcp-cr-requests-live` and `-bulk` (+DLQs, maxReceiveCount 5), `elixir-mcp-cr-results` (+DLQ), `elixir-mcp-email` (+DLQ); SSE on; DLQs alarmed on any visible message. Visibility timeouts are the gateway lease (§5.1).

**Database access — designed, because by default nobody can reach it.** Private RDS + no NAT + no bastion means there is *no* path to psql from anywhere, including Jamie's machine and the deploy script. Two deliberate doors: (1) a **migrate Lambda** in the VPC, invoked by the deploy script, is the only thing that ever applies schema migrations (§11.1) — deploy order is code-upload → migrate → flip; (2) a **break-glass admin path** for genuine interactive psql: a documented script that temporarily sets the instance publicly-accessible with the security group pinned to Jamie's current home IP, and reverts when done. Routine inspection shouldn't need break-glass — the admin page and an ops query Lambda (read-only, invoked via script) cover the common cases.

**Compute.** All Lambdas Node 24 arm64, esbuild-bundled. `scheduler` reserved concurrency 1 (the "one planner" guarantee), `ingest` small-batch from the results queue, `web-api` behind an API Gateway HTTP API, `mcp` likewise behind its own API route. Gateways are *not* cloud compute — launchd services on operator machines (§4.6, §5.1), never deployed by CI.

**Front doors.** Two CloudFront distributions: the site (private S3 + OAC, `/api/*` behavior forwarding cookies + the contract header) and the MCP door (no cookies in the origin request policy — the structural guarantee, authored in-stack rather than out-of-band like librarian's). ACM certs in us-east-1, DNS-validated; DNS stays Namecheap CNAMEs (house pattern, no Route 53).

**Secrets.** DB credentials and the JMAP token live in Secrets Manager and reach Lambdas via CloudFormation dynamic references at deploy time — never through agent context (Secret Safety) and never in CI: CI validates and deploys template + code but holds no CR keys and no mail credentials (Drop's rule, kept). CR API keys exist *only* in gateway operators' local `.env` files; the cloud never stores them.

**Observability.** Alarms → SNS `elixir-mcp-alarms` → the sysadmin `projects-ops-alerts` SQS queue (routing of record; no email subscription — librarian lesson). Alarm set: per-gateway split heartbeats (process-alive and work-succeeding), request-queue oldest-message age, all DLQs, scheduler errors/missed ticks, ingest failures, RDS CPU/storage/connection headroom, API 5xx rates, an MCP auth-failure spike filter, estimated charges. One dashboard: budget spend vs ceiling, 403 rate by gateway, freshness percentiles, completeness ratios.

**Steady-state cost** (the honest hobby math): RDS ≈ $13–16, SQS interface endpoint ≈ $8–15 (one per AZ used), CloudFront/Lambda/SQS/SNS/logs ≈ single dollars at this traffic. **≈ $25–35/month**, dominated by the database — which is the product's actual asset.

---

## 8. Phasing

**V1 — "record me, then ask me anything" (single-player value, ~8 weeks of nights-and-weekends scope):**
Full CloudFormation stack (§7) with RDS from day one. Web UI in the poapkings.com dark CR-themed family (request access, magic link, claim tag w/ soft verification, opt-in recording, freshness dashboard, connect page + disclaimer) plus the owner admin area (approval queue, gateway roster). Gateway schema first-class (§4.6) with Jamie's gateway enrolled through the real path; one gateway in the fleet. Full scheduler/budget machinery (the budget discipline must exist from day one — it's the ToS posture, not an optimization). Recording: player profile + battlelog + the player's clan heartbeat. Canonical battles, snapshots, rollups. **Season-roll snapshot watcher ships in V1** (moved from V2 in the audit): season donations are wiped at roll and unrecoverable, so deferring it makes the first seasons permanently lossy for data V2 features depend on — and it's a small check inside the scheduler tick that already runs. Live lane (two request queues) in V1 because `cr_api_live` and `live: true` are V1 tools. OAuth MCP with 11 tools: `list_my_players`, `get_coverage`, `get_player`, `get_player_timeline`, `query_battles`, `get_performance`, `get_card_performance`, `get_deck_performance`, `get_collection`, `get_card_catalog`, `cr_api_live`. (`get_player_timeline` moved into V1 in the audit: its data layer — snapshots + rollups — ships in V1 regardless, and the trophy-graph moment is the product's best demo.)
*Cut from V1:* war history, compare, liveness verification (soft claims only), self-serve gateway enrollment (schema yes, UI no).

**V2 — clans, war, and the volunteer fleet (the network-effect layer):**
Clan recording opt-in (leader claims + enrolls; `riverracelog` backfill — **net-new work**: elixir-bot documented the pattern but never built a backfill consumer), entitlement rules 2–4, `get_war`, `get_war_history`, `get_clan`, `compare_players`, liveness-proof verification. **Self-serve gateway enrollment:** raise-your-hand flow (submit static IP → Jamie issues a key from his Supercell account → guided install of the gateway bundle → probation → active), operator docs, per-gateway health page.

**V3 — depth, only where usage proves demand:**
Leadership-scoped activity analytics; scheduled data exports; opt-in aggregate meta stats (card win rates across consenting recorded players — powerful, but a privacy design of its own); verifytoken scope if Supercell grants it; supporter tier (quota-gated, donation-shaped) *only after* re-reading the Fan Content Policy with counsel.

**Explicit non-goals at every phase:** chat UI, Discord bot, deck advice, notifications/posting, anything on-chain.

---

## 9. Options & tradeoffs worth recording

- **Postgres vs SQLite-per-tenant:** SQLite-per-clan (elixir-bot's implicit model) was considered and rejected — battles are *cross*-tenant by nature (canonical dedup across observers is the point), and entitlements need one query surface. Postgres costs a managed instance; it buys the product's core mechanic.
- **Server-side aggregation vs raw-battles-only tools:** raw-only is purer MCP but forces agents to page hundreds of battles per question (slow, token-expensive, error-prone math). Recommendation: both — `query_battles` for ground truth, `get_performance`/`get_card_performance` for computed answers. The corpus's arbitrary-window comparisons decided this.
- **Gateway keys:** one shared key across gateways is impossible (IP-bound); per-gateway keys with a *global* budget is the only shape compatible with "redundancy not multiplication." The tempting alternative (sum the per-IP budgets) is exactly the quota-multiplication pattern we ruled out.
- **Recording default for claimed tags:** opt-in (chosen) vs auto-record-on-claim. Auto is better funnel, worse consent story; the web UI cost of one toggle is trivial. Revisit if V1 funnel data shows drop-off at the toggle.
- **Battle ID includes `type_class`:** slightly redundant given tag-set + time, but it cleanly separates boat battles (no real opponent tag) without a sentinel-tag hack. Cheap insurance on the single most load-bearing identifier in the system.
- **Two hostnames vs one path-split host — REVISED 2026-09-03 post-launch:** the two-name layout shipped first, but seeing the real connect URL Jamie chose consolidation: everything on `elixir.poapkings.com`, with `/mcp`, `/oauth/*`, and `/.well-known/*` as CloudFront behaviors whose origin request policy forwards NO cookies — the structural guarantee moved from hostname to behavior, equally structural. One distribution, one cert, one CNAME; the `mcp.` distribution was deleted before its DNS ever existed.
- **RDS vs Aurora Serverless v2 vs external Postgres:** the 24/7 recorder never lets serverless pause (0.5 ACU floor ≈ 3× the micro instance), and an external provider moves the system of record out of the account. Fixed small RDS chosen.
- **Serverless scheduler vs resident process:** EventBridge's single scheduled invocation replaces leader election outright; the planning pass is naturally periodic. The resident-process model was elixir-bot inertia, not a requirement.
- **NAT-free VPC via queue-fed email relay:** a NAT gateway (~$35/mo) solely so VPC Lambdas could reach Fastmail was rejected; email becomes an SQS hop to a non-VPC Lambda. Constraint to remember: **nothing inside the VPC may require arbitrary internet egress** — anything that does must be queue-fed like email or live outside the VPC. To be clear about *why* the relay exists at all: librarian sends JMAP straight from Lambda with no relay because its Lambdas aren't VPC-attached (DynamoDB); ours are (RDS). The weight is a VPC consequence, not a Fastmail one.
- **SES vs Fastmail JMAP (evaluated 2026-09-03, Fastmail kept):** SES's API is reachable from a VPC via interface endpoint (added Dec 2025), so direct in-VPC sending is possible — but the endpoint (~$8–15/mo) costs more than the relay (pennies), and SES adds immediate chores (DKIM/MAIL-FROM DNS at Namecheap, sandbox-exit review, mandatory bounce/complaint plumbing) plus a cold sender reputation on the sign-in critical path, where a spam-foldered magic link is a locked-out user. Fastmail's poapkings.com identity is already warm, `elixir@poapkings.com` already sends for elixir-bot (it's the service mailbox, not a personal one), bounces land where the agent-mailbox scheme already looks, and `jmap-mail.mts` lifts. The relay queue also buys durable retries + DLQ for auth-critical mail, and makes the transport swappable: if volume ever outgrows Fastmail, pointing the relay at SES is a ~20-line change behind the same queue. Revisit only on real volume or Fastmail-token pain.
- **Gateway keys from Jamie's Supercell account** (operator BYO-key rejected for now): cleanest one-developer-account ToS story, instant revocation, zero operator friction; caps the fleet near the ~10-key account limit, which is plenty for redundancy-not-quota. `key_source` column keeps BYO open.

---

## 10. Prior-art map (where the patterns live)

Surveyed 2026-09-03. House rule applies: **never copy-paste code between repos — move with history or write fresh**; this map is for reading before writing.

- **Auth/OAuth/MCP/quota — `librarian-thing/apps/librarian/lambda/`** (TS, Node 24). Lifts nearly clean: `shared/magic-link.mts`, `session.mts`, `web-session.mts`, `rate-limit.mts`, `quota.mts` (fail-open for known users / fail-closed for anonymous spend), `mcp.mts` (~250-line hand-rolled protocol; `serverInfo.version` fingerprints the tool schema — copy that verbatim). `shared/oauth-store.mts` + `auth/oauth-routes.mts`: standards-complete OAuth 2.1 (PKCE S256, refresh rotation + family-replay revocation, 90-day family lifetime) — logic preserved, every DynamoDB call rewritten for Postgres. `tests/mcp-defects.test.mjs` is the regression corpus of shipped MCP bugs. Entanglements to replace: Buttondown entitlements, `auth/handler.mts` router, `handleMcpRoute` embedded in `chat/runtime.mts`.
- **Gateway — `drop.poapkings.com/services/cr-api-bridge/`** (TS, launchd). The fork seed: SQS long-poll lease loop (`src/worker.ts`), queue-name indirection (`src/index.ts`), Retry-After-aware backoff (`src/clash-royale.ts`), split heartbeats (`src/heartbeat.ts`), rotating JSON logger, launchd installer (`scripts/install-launchd.mjs`), per-gateway IAM bootstrap (`infra/scripts/bootstrap.mjs`). What Drop lacks that we add: token-bucket budget, 403 circuit breaker, multi-gateway identity.
- **Recorder patterns — `elixir-bot`** (Python; patterns only). The spine: `engine/observations.py` (admission), `engine/ingest.py` (canonical battles, enrich-on-dedup, every trap commented), `engine/polling.py` (the whole heat scheduler in 175 lines), `engine/clock.py` (war calendar, observed anchors), `engine/projections.py` (rollups w/ completeness, MAX-merge for monotonic counters), `engine/event_contracts.py` (event vocabulary as data), `db/schema.py` receipts/payloads tables. Spec of record: `docs/reference/v5.1/`.
- **CR API truth — `cr-agent-api-docs`** (standalone repo; consume directly — elixir-bot's vendored copy has drifted). Load-bearing facts: 403-is-also-rate-limit (`models/errors.md`), battle-winner precedence, evolution-level semantics, pagination recipes.
- **Infra style — `drop.poapkings.com/infra/`**: `template.yaml` (single-stack layout, alarm set), `scripts/parameters.mjs` (SECRET/REQUIRED/PRESERVED — the param-wipe guard, must-port), CI split validate/deploy with CR-token-never-in-CI. `librarian-thing/apps/librarian/infra/cloudformation.yaml` for the OAuth/MCP Lambda + alarm patterns.
- **Docs format — `poap-agent-api-docs`** (historical; POAP protocol sunset 2026-07-31): format prior art for agent-facing API references only. No POAP anything in-product.

---

## 11. Versioning & evolution (added in the 2026-09-03 audit)

The tool surface *will* be tuned after real use — that's expected, not failure. The design must make change cheap and safe on both layers, because they version differently: the database is one shared instance that only moves forward; the tool contract has many independent clients that cache aggressively and update never.

### 11.1 Database versioning

- **Ordered SQL migrations in-repo** (`db/migrations/NNNN_description.sql`), tracked in a `schema_migrations` table, applied under a Postgres advisory lock by the **migrate Lambda only** (§7) as a deploy step — never at handler cold-start (concurrent Lambdas racing migrations is a self-inflicted outage), never by hand.
- **Expand-and-contract discipline:** additive first (new columns nullable/defaulted, new tables, new indexes `CONCURRENTLY`); destructive changes (drop/rename) land only after no deployed code reads the old shape. A migration and the code that needs it can deploy together; a migration that *breaks* old code cannot.
- **Fingerprint test** (elixir-bot's pattern, kept): a committed test asserts fresh-create-from-scratch and the full migration ladder produce semantically identical schemas — the drift between "what new installs get" and "what production accumulated" is a class of bug we've already been bitten by once upstream.
- **Rehearse against a copy:** any migration touching canonical tables runs against a PITR-restored copy first (elixir-bot rule: a migration *is* a deploy). Which matters because of the retention asymmetry: **projections are rebuildable only within the ~60-day raw-payload window; canonical tables (battles, snapshots, receipts) are the system of record and must never need a rebuild.** Migrations to canonical tables are lossless by policy.

### 11.2 Tool-contract versioning

- **`packages/contracts` is the single source of truth**: every tool's input/output schema, the error enum, the `meta` envelope, the `deck_hash` definition — as schemas, consumed by the server (validation), the tests, and the docs page. Semver'd `contract_version`, changelog file in the package.
- **`serverInfo.version` = `<contract_version>+tools.<fingerprint>`** where the fingerprint hashes the declared tool schemas, plus `tools.listChanged: true` — librarian's shipped lesson: clients cache `tools/list` forever, and a stateless server can never push the change notification; the version string is the only cache-buster that works.
- **Evolution rules:** new tool, new *optional* param, new response field = minor — ship freely. Rename, removal, semantic change of an existing field = major, and the old shape keeps working through a deprecation window (old tool stays registered, marked "deprecated: use X" in its description) — agents re-read descriptions far more often than users re-connect. Every response's `meta.contract_version` makes "which contract answered this" always diagnosable.
- **Never reuse a tool name for different semantics.** Retire names; don't repurpose them.

### 11.3 The tuning loop (how we learn what to change)

- **Per-call audit rows** (librarian's `mcp-audit-store` pattern): tool, bounded args, duration, result size, truncation flag, error code, account, short TTL. This is operational telemetry, not product data — nothing in the serving path may *decide* based on it (elixir-bot house rule).
- The questions the audit rows answer are exactly the tuning agenda: which tools are never called (cut candidates), which params are never passed (simplify), which calls end truncated (the tool's shape is wrong — add filters or aggregation), which error codes recur (agents are guessing wrong — fix descriptions), what people reach for `cr_api_live` to do (the next first-class tool). Review cadence: after the first two weeks of real use, then monthly.

## 12. Build notes (what the building agent needs)

- **The repo is public from day one** (Jamie, audit session). Consequences from the first commit: fixture discipline — real exported payloads are fine (all publicly queryable CR data) but get reviewed like code; verify tracking with `git ls-files`, never trust `.gitignore` alone (the elixir-bot lesson); no secrets, ever, including in fixtures and test snapshots; operator docs written as if a stranger will follow them, because at V2 one will.
- **Repo layout** (npm workspaces, Drop's shape): `apps/web` (Vite/React, dark CR-themed), `services/web-api`, `services/mcp`, `services/scheduler`, `services/ingest`, `services/email-relay`, `services/gateway` (the operator bundle), `packages/contracts`, `packages/game-data` (card catalog + upgrade costs), `db/migrations`, `infra/` (template + bootstrap/deploy/parameters/smoke scripts), `docs/` (this file and NOTES.md move in).
- **Read before writing** (§10 prior-art map). House rule: never copy-paste between repos — write fresh with the pattern open in the other window. `cr-agent-api-docs` is CR truth; when the API surprises us, the fix includes a docs patch there.
- **Local dev:** Postgres via Homebrew (`postgresql@17`, the versioned formula so brew can't silently jump majors — match RDS's major), run as a brew service; **no Docker** (Jamie's call — the native install fits the house style). Tests create/drop generated scratch databases per run and never touch a shared dev DB by default. Queue seams behind a narrow interface with an in-process fake for tests (the gateway is the only component that genuinely needs SQS to be real); Lambdas are plain handlers testable without AWS. **Fixtures:** export a corpus of real payloads from elixir-bot's `raw_api_payloads` (battlelogs, profiles, riverrace — real 2v2s, duels, boat battles, the shapes that break naive parsers) plus cr-agent-api-docs samples as goldens for admission/ingest tests.
- **Test posture:** unit tests over pure logic + the dist bundle (librarian/Drop style); start an `mcp-defects` regression corpus from day one; the migration fingerprint test (§11.1); smoke tests are **reads and refusal-paths only — never verify with writes against live data** (house rule, learned the hard way).
- **Secrets:** Secret Safety applies to the build process itself — the agent never reads secret values into context; `.env` files are written by bootstrap scripts, referenced by name.
- **A dev CR key** (second key on the home IP, same Supercell account) so local gateway testing never burns the production key's standing.
- **Manual-steps ledger — things only Jamie can do**, so the builder queues them instead of stalling: Supercell key issuance (prod gateway + dev); Namecheap CNAMEs for `elixir.` + `mcp.` and ACM validation records; Fastmail API token mint for the relay; bootstrap script first-run (IAM users, code bucket, `.env`); first account approval; projects-sysadmin registration (alarm-topic subscription to `projects-ops-alerts`, backup/restore verification in the Recovery Manager's rotation).

---

## 13. Roadmap consideration: elixir-bot as a client (reasoned 2026-09-03, nothing to build now)

Jamie's stated future: once Elixir MCP is robust, elixir-bot may shed its recorder half (~16K lines: CR polling, receipts, admission, canonical battles, war accumulation) and become a client — keeping its judgment half (awareness brain, management engine, awards, persona, Discord surfaces). The boundary lands exactly on this product's positioning rule: we're the memory, it's a brain. As a client it would add **zero** CR API load for POAP KINGS (one recorder per clan instead of two overlapping pollers — a ToS posture win).

**The structural mismatch:** elixir-bot is event-driven; this MCP is pull-only and stateless. The bridge is cursor-based tailing, which is why three cheap-now decisions are baked into V1:

1. **Monotonic insertion cursors** (`bigserial`) on `battle` and the event tables — any future consumer tails "everything since cursor X" in one call, exactly-once. Also serves exports/webhooks. Free in the DDL, painful to retrofit.
2. **War member values are named/documented as points, not fame** — members contribute points; fame is the boat's; per-member division of fame is banned. This is imported scar tissue from a real elixir-bot data-contamination incident; the CR payload's field name ("fame") is the trap.
3. **Event payloads carry evidence, not conclusions** (roster before/after, observation windows) — downstream judgment like elixir-bot's LEAVE-vs-KICK verification needs the raw signal.

(A receipt `source` enum for the hypothetical elixir-bot historical backfill was considered and **rejected as YAGNI** — Jamie's call: if that one-time import ever happens, its migration adds attribution then, which §11.1's additive discipline makes routine. Every real V1 receipt has a gateway, including live-lane fetches.)

**Noted, deliberately not pre-built:** a machine-credential grant type (the 90-day OAuth family re-consent is human-shaped; additive later — the token store already models families), and a `query_events since_cursor` bulk tool (V3+, when a real consumer exists). **Anti-goal, restated:** this future never justifies judgment tools (kick recommendations etc.) in this product — elixir-bot reads primitives and keeps its own engine. Sequencing: elixir-bot-as-client ≈ V2's clan layer + event cursor tool + machine auth — a natural V3/V4 milestone.

---

*This material is unofficial and is not endorsed by Supercell. For more information see Supercell's Fan Content Policy: www.supercell.com/fan-content-policy.*
