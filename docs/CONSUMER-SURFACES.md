# Consumer Surfaces — how third parties use Elixir MCP

**Status:** design of record; the Drop migration is UNDER WAY (2026-09-06).
Ratified principles below are Jamie's. What has shipped so far, against §7's
build order but starting with Drop at Jamie's direction:

- `collections_edit` (contract 0.24.0) — curate a collection over the seam.
  Domain-shaped, per §1: an action verb on a domain resource, not a Drop
  endpoint.
- Drop holds a small MCP JSON-RPC client and adds every player who has saved
  a Clash Royale tag to the `elixir-drop` collection, on tag save and on each
  login. Membership is what makes the hub record them.
- §7.2 shipped (contract 0.25.0): `players_profile` answers the clan badge,
  the player's clan role, arena, best trophies, favourite card, account age
  and current badge state. All of it already arrived in recorded payloads and
  was discarded.
- Drop's player enrichment reads `live_fetch`, its Clan Wars clock reads
  `war_current`, and `cards[]` is no longer stored.
- **The bridge is retired (2026-09-06).** Its request queue pair, IAM user,
  launch agent and alarms are deleted. Drop makes zero Clash Royale calls at
  runtime. The result queue survives as the manual season-repair channel
  only: podium-finalize has no producer in the repo, and deleting it would
  have removed a working repair path.
- **Open:** Drop still live-fetches enrichment rather than reading the
  recorded profile now that §7.2 landed. Moving it would drop 1-3s from a
  cold login and stop spending CR budget on cosmetic data.

Record deltas in `NOTES.md` as usual.

This document answers one question: *how should other systems — first-party and
third-party — consume Elixir MCP?* It grew out of assessing whether Elixir Drop
and poapkings.com should retire their own Clash Royale (CR) API plumbing and
read from Elixir MCP instead.

---

## 1. The governing constraint (read this first)

The consumer use cases below **define the shape of the problem domain, but must
never shape the design.** Actively guard against Elixir MCP morphing to serve
any one consumer.

- The use cases are **test cases, not a spec.** Several diverse consumers pull
  in different directions and *triangulate* the domain; the union of what they
  reach for tells you whether the domain model is complete. The multiplicity is
  itself the guard — the moment one consumer's shape starts dictating the
  design, the others misfit, and that misfit is the alarm.
- **Domain boundary:** Elixir MCP models **recorded Clash Royale game history
  and the analytics derived from it** — players, clans, battles, decks, cards,
  wars, coverage. Nothing else. It does not model any consumer's presentation,
  and it does not host another app's domain.
- **The test for any proposed addition:** *"Would this belong in the hub if this
  specific consumer didn't exist?"* A game fact or an analytic over game history
  → it belongs, whoever asked. A consumer's presentation shape, or a different
  domain → it lives on the consumer's side, or on a *different* seam.
- **Smell:** a tool, endpoint, or field named or shaped for a consumer
  (`drop_profile`, a roster row matching poapkings' columns) is morphing caught
  in the act.
- **Principle:** build **domain resources, not consumer endpoints.** Each
  consumer adapts on its own side of the seam (field selection, presentation,
  its own derived shapes). There can be more than one seam; overloading the one
  that exists is how domains rot.

---

## 2. Hub-and-spoke PULL — never app-to-app push

The load-bearing architecture principle. Elixir MCP is a **hub**: the recording
pipeline writes history *into* it and publishes to nobody; consumers *pull* what
they need with their own tokens; no app reaches into another.

This is a deliberate reaction to prior spaghetti: elixir-bot used to *push* data
into poapkings.com, intermingling two apps that should know nothing about each
other. The scar is still visible as a guardrail in poapkings' `CLAUDE.md`
("must not add website publishing back to Elixir"), and its recognition importer
was already rewritten to *read* elixir-bot's DB rather than be pushed to. That
was the right instinct with the wrong tool — a cross-repo SQLite file read is
still an intimacy between two apps (it depends on the other's private schema,
path, and migration state). The hub replaces that intimacy with a versioned
contract.

**Consequence for design:** every consumer is a downstream reader of a seam.
Never resurrect app-to-app push. When two apps must share data, the producer
writes up into a hub and the consumer reads down from it; neither learns the
other exists.

---

## 3. The four first-party consumer archetypes

| # | Use case | Wants | Facade | Elixir MCP's value |
|---|----------|-------|--------|--------------------|
| 1 | **Direct MCP** (human / Claude connector) | Exploratory, semantic, "ask anything" | MCP JSON-RPC, session token | The rich tool layer itself |
| 2 | **Agentic MCP** (elixir-bot) | Reason + call many tools | MCP JSON-RPC, service/session token | Tool discovery + composition |
| 3 | **Intelligence + publication** (poapkings.com) | Bulk, analytical, historical reads | **MCP JSON-RPC** (rich/varied) | ⭐ the differentiated data — history, trends, deck/war analytics |
| 4 | **Incidental metadata** (Elixir Drop) | Thin, fixed present-moment enrichment | **REST read lane** (cacheable) | Mostly infra retirement |

---

## 4. Facade split — one core, two protocols, shared governance

Not "MCP vs REST." One capability core, two protocol faces:

```
        MCP JSON-RPC  (rich/varied consumers)      REST /v1/*  (thin services)
                 \                                      /
                  \                                    /
              capability core (players, war, live_fetch, ...)
                          |
        token model · 300 calls/hour cap · global CR budget · job ledger
```

- The split is by **read richness, not by has-an-LLM.** MCP JSON-RPC serves
  agents (#2) *and* rich scripted consumers (#3 poapkings wants the full
  analytical toolset, so it is MCP-shaped despite having no LLM). A small
  read-only REST lane serves thin, fixed-read services (#4 Drop's two cacheable
  resources: a player resource and an interpreted war-clock resource).
- **Governance lives below both facades and is non-negotiable:** the same `svt_`
  service token hits the same 300-calls/hour bucket and the same global CR
  budget whether it arrives via MCP or REST. REST must never become a
  rate-limit bypass.
- Agents gain nothing from a REST lane for data reads (the tool layer already
  serves them); REST's beneficiary is the non-agent service class. Keep the REST
  lane small — domain *resources*, not a mirror of every tool.

**Verified facts about the current `svt_` lane** (from source, 2026-09-06):
transport is MCP JSON-RPC at `POST /mcp` with `Authorization: Bearer svt_…`
only — there is no REST lane today (`/api/*` rejects `svt_`). Service tokens are
owner/partner/admin-bound; universal reads mean any recorded tag resolves with
no per-tool ownership check; the 300/hour cap applies to every token type; a
generous role-based daily quota sits on top; POAP KINGS is recorded
comprehensively (clan polled every 15 min, members re-snapshotted
hours-to-daily). Both Drop and poapkings already hold a freshly-minted but
**unwired** `ELIXIR_MCP_KEY`.

---

## 5. Assessment — Elixir Drop (archetype #4)

**Correction found while building (2026-09-06):** "everyone who signs up" is
not achievable and was never the shape of Drop's data. The CR tag is OPTIONAL,
deliberately kept out of setup, and UNVERIFIED. Of 26 accounts, 14 have a tag
and 13 are distinct. So the collection holds *every account that has saved a
tag*, and a member is a tag somebody typed rather than a proven identity.

**What Drop needs:** (a) low-volume player enrichment — name, clan, YearsPlayed
account age — triggered by login/refresh/tag-edit, 6h-deduped, cosmetic (profile
block + Buttondown metadata); (b) an autonomous 5-minute Clan Wars clock (the
authoritative season source, driving leaderboards + podium finalization).
Correction from Jamie: Drop does **not** use the card catalog — the "practice on
your cards" idea was abandoned and never surfaced — so its stored `cards[]` can
be dropped entirely.

**Path:** Drop reads from the hub via a small MCP JSON-RPC client (svt_ token).
Enrichment via `live_fetch /players/{tag}`; the war clock via `war_current` on
**recorded** POAP KINGS — which leaves the CR API entirely (zero CR budget, no
collector). Elixir MCP becomes the single authority for the interpreted war
clock (both its own `war_current` and Drop read the same core), so Drop stops
duplicating the calendar math in its bridge.

**Retire:** the `cr-api-bridge` service, both SQS queues + DLQs, the
`elixir-drop-cr-bridge` IAM user, the CR key, the local Mac host, and the
`cards[]` persistence path.

**Trade to weigh:** shared fate — Drop's CR data comes to depend on Elixir MCP
uptime (well-mitigated: cached snapshots persist; the clock already falls back
to calendar math). Net across the world: one CR key instead of two, and Drop's
biggest CR consumer (the 576-calls/day clock) stops hitting Supercell.

---

## 6. Assessment — poapkings.com (archetype #3)

**What it is:** an Eleventy static site, built ~daily on the IP-restricted host,
that fetches the CR API and publishes rendered pages + JSON. It is the heaviest
first-party CR consumer: ~52 calls per build (1 clan + ~49 per-member player
fetches + 1 river-race log). It keeps its **own** history store
(`data/clash-royale.sqlite`) and already couples to Elixir via a fragile
read of elixir-bot's private `elixir-v51.db` for recognition.

**Field coverage (the crux, resolved):**
- Recorded and served free: name, clan, role, trophies, battle_count,
  three_crown_wins, collection_level, years/account-age, weekly donations.
- Not projected today: arena, exp_level, all-time best_trophies, favorite_card,
  full badges list — **but physically retained** in the raw `api_payload` (the
  latest per-tag payload is never swept). So the gap is projection/exposure, not
  capture. Of these, only `favorite_card` is actually *rendered*; the rest
  appear only in JSON/llms dumps.
- Resolution options, best first: (1) a small server-side tool that projects
  these game-domain player attributes from the retained payload — no live
  budget; (2) `live_fetch`; (3) drop the unrendered ones. With (1),
  **poapkings' ~50 daily player fetches go to zero.** (Note: #1 passes the §1
  test — badges/favorite-card/arena/exp are real Clash Royale player facts, so
  exposing them completes the domain model; it must be shaped as game
  attributes, not as a poapkings roster row.)

**The unlock (why #3 matters most):** poapkings could publish intelligence it
structurally cannot produce from roster snapshots — per-member war participation
history (it already hoards `fame`/`boat_attacks`/`decks_used` in SQLite but
can't cleanly expose it), player timelines, deck/card performance, clan
standings, pilot scores, corrected war history past the CR API's 20-week window.

**Recognition is a SEPARATE seam (domain-boundary correction):** recognition /
awards (war_champ, iron_king, rookie_mvp) are **elixir-bot's clan-management
domain, not game history.** Do **not** drag them into Elixir MCP just because the
hub exists — that is exactly the morphing §1 forbids. Recognition is
elixir-bot's own seam: elixir-bot exposes a clean recognition read boundary,
poapkings reads it there, and poapkings reads *game history/analytics* from
Elixir MCP. Two hubs, two domains, still pull-not-push.

**Preserve:** poapkings has accumulated a 152-day clan-level daily trend (since
2026-03-11) and river-race history past the API window. Member-derived
aggregates are reproducible from the hub's per-player daily snapshots; the pure
clan-level facts (clanScore/clanWarTrophies/donationsPerWeek over time) either
need the hub to retain a clan-daily series (ideal — it already polls /clans every
15 min) or poapkings keeps a single /clans poll/day (1 call vs 52). Freeze
today's SQLite as the historical base — do not discard it.

**Recommendation:** poapkings consumes the hub via MCP JSON-RPC (svt_) —
(1) replace roster + per-member reads with `clans_roster` + recorded profile
tools, adding the payload-projection tool so player fetches hit zero;
(2) publish the new analytics; (3) move recognition off the DB-file read to
elixir-bot's own seam; (4) settle clan-daily history.

---

## 7. Resolved design questions (2026-09-06)

Each was settled against the §1 test. None of this moves code yet.

**7.1 Clan-daily retention → the hub, by finishing its own V1 table.**
`clan_daily_metrics(clan_tag, day, member_count, donations_total, metrics
jsonb)` has existed since migration 0001 with **zero writers** — a
designed-but-unwired table (the "cards endpoint was never scheduled" class). The
clan payload is already polled every 15 min and retained in `api_payload`,
carrying `clanScore`, `clanWarTrophies`, `donationsPerWeek`, `requiredTrophies`,
`members`, `type`, `location`. A clan's facts over time are core recorded game
history regardless of any consumer, so this passes §1 on its own. Design: a
projector at clan-payload admission upserts `(clan_tag, day)`, promoting the four
scalars to typed columns; expose via a `clans_timeline` tool mirroring
`players_timeline`. Retained payloads (Postgres latest + S3 archive twins) allow a
one-shot backfill of the recorded era. **poapkings keeps no /clans poll.**

**7.2 Payload-projection shape → game attributes, normalized; avoid the badge
blob.** **PRIORITY RAISED 2026-09-06 (Jamie): three of these fields are the
reason Drop still pays for a live fetch.** `players_profile` returns name and
`clan{clan_tag,name}` and nothing else about the player as a game entity, so
the hub cannot answer **clan badgeId**, **clan role**, or **account age**
(the `YearsPlayed` badge, whose `progress` is days played). Drop renders all
three, so its enrichment reads `live_fetch` instead of recorded history:
1-3s on the path, and a slice of the shared CR budget, for facts the hub
already receives in every player payload and throws away. Jamie: "clan badge,
clan role, and account age are things that we definitely want Elixir MCP to
know." They pass §1 on their own — they are game facts about a player, not
Drop's presentation. Closing this lets Drop's login path read recorded data
and stop live-fetching entirely.

 The player payload carries `arena{id,name}`, `bestTrophies`, `expLevel`,
`currentFavouriteCard{id}`, and ~139 `badges` (level/progress/target/iconUrls).
Decisions: `arena_id`, `best_trophies`, `favorite_card_id` become typed columns
on the daily snapshot, with names/icons resolved via the catalog at read time
(never store icon URLs). **`expLevel` is not projected** — deprecated in the 2026
progression model; `collectionLevel` (already recorded) is its replacement.
**Badges go in a normalized `player_badge` current-state table** (`player_tag,
badge_name, level, max_level, progress, target, observed_at`), upserted on
change — not a jsonb of 139 badges per member per day. `players_profile` gains an
`attributes` block and a `badges` list shaped as the game's player model;
consumers select what they render.

**7.3 REST `/v1` → defer; Drop goes MCP-first.** This revises §4's implication
that Drop uses REST. A REST lane is justified by *breadth* of thin consumers and
there is exactly one today; a small JSON-RPC client in Drop is cheaper than a
facade to secure, version, and maintain, and the caching argument is weak at
Drop's volume (~12 recorded reads/hour for the war clock). Build REST when a
second thin-service consumer appears or one genuinely cannot speak JSON-RPC —
domain resources only, same-token-same-bucket from day one.

**7.4 elixir-bot's recognition seam → a versioned artifact elixir-bot publishes;
delivery is a deployment detail.** The projection moves into the owner: at
`season_closed` (an existing hard-post floor event) elixir-bot emits
`recognition.json` v1 — completed seasons only, the privacy-safe honors shape
poapkings' importer computes today. elixir-bot owns the contract; poapkings reads
the artifact, never the DB. Start as a same-host file at a known path (both apps
live on this Mac; zero new infra), shaped identically to what a URL would serve.
Downstream consequence: once poapkings reads game data from Elixir MCP it no
longer needs the IP-restricted CR key and could build entirely in GitHub
Actions; if it does, the artifact moves to a fetchable URL (S3/GitHub) as a
delivery swap, not a redesign. Elixir MCP stays pure game history throughout.

**Build order when Jamie says go:** 7.1 clan-daily projector + backfill →
7.2 attributes/badges projection (expand migrations) → poapkings migration →
Drop migration (MCP-first) → 7.4 recognition artifact. REST stays deferred. Related repos:
[elixir-mcp](https://github.com/jthingelstad/elixir-mcp) (this hub),
[elixir-mcp-collector](https://github.com/jthingelstad/elixir-mcp-collector),
Elixir Drop (`drop.poapkings.com`), poapkings.com, elixir-bot.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
