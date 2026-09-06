# Consumer Surfaces — how third parties use Elixir MCP

**Status:** design / assessment (2026-09-06). Ratified principles below are
Jamie's; the two migration assessments are read-only analysis. **Nothing here
is built yet** — no code, stack, or contract has moved for it. When work
starts, this file is the design of record for the consumer story; record
deltas in `NOTES.md` as usual.

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

## 7. Open questions / next steps

- Should the hub retain a clan-daily snapshot series (completes the hub) or does
  poapkings keep one /clans poll/day?
- The payload-projection tool for game-domain player vanity fields — shape it as
  a player-attributes resource, not a roster row.
- Whether/when to stand up the small REST `/v1` read lane (Drop is its first
  consumer); MCP-first is fine until a second thin-service consumer appears.
- elixir-bot's recognition seam — its own read boundary, replacing the
  cross-repo DB file read.

None of the above moves code yet. Related repos:
[elixir-mcp](https://github.com/jthingelstad/elixir-mcp) (this hub),
[elixir-mcp-collector](https://github.com/jthingelstad/elixir-mcp-collector),
Elixir Drop (`drop.poapkings.com`), poapkings.com, elixir-bot.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
