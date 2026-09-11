# Data flow and efficiency review — 2026-09-11

**Status:** analysis only. Nothing in product code changed. Written the
afternoon after two RDS memory recoveries (09:31Z and 14:02Z) on the
db.t4g.micro, and after the day's four fixes (guarded upserts 0071, the
two-hour payload cache 0071/0072, the battlelog high-water mark 0073, the
mark riding the lease 0074 + collector v2.0.29, and the clan cadence 05112f0).

**Lens.** Every fetch, byte, row, index probe and Lambda millisecond has to
earn its place: *does it add information a reader will ever use?* Numbers
over adjectives. Every number below names its source; the method and the
things that could not be measured are in the appendix.

**Sources.** The migrate Lambda's read-only `tables` / `stats` ops (14:33Z),
CloudWatch (RDS, Lambda, `ElixirMCP/*` EMF), Logs Insights over the six
Lambda log groups, Cost Explorer (Sep 1–10), the S3 payload archive (per-
endpoint inventory, and 433 consecutive payloads for 17 entities downloaded
and diffed locally — real tags and names stayed on this machine), the
scheduler / door / ingest / tool source, the collector repo, and
`cr-agent-api-docs` for what the API itself does.

---

## 0. The five findings that change the picture

1. **The database instance is not where the money goes; idle polling is.**
   The stack's run-rate is ≈ $51/month. The RDS instance is $7.90 of that
   (a 1-year all-upfront reserved instance bought 2026-09-07 for $95; the
   $96.88 September RDS line is that purchase, not usage). The web-api
   Lambda is ≈ $30/month net of free tier — 63,074 invocations and 163,318
   billed seconds in the last 24 hours (p50 253 ms, p95 8.2 s). Roughly
   three quarters of that is the two **live-channel** collectors (Ram Rider,
   Tesla) each running an unbroken loop of 8-second long-polls against the
   door, which the door services with a 500 ms database re-check loop. That
   loop is ≈ 350,000 Postgres transactions a day, the 148,875 sequential
   scans of `job`, and the 342,445 heartbeat updates on the 4-row `gateway`
   table. It exists to serve `live_fetch`, which was called **16 times in
   the last seven days**.

2. **The second crash was triggered by diagnostics, not by ingest.** Between
   13:25Z and 13:49Z the migrate Lambda's `probe` op ran thirteen times to
   completion (96–150 s each) plus two 300 s timeouts. `probe`'s
   `level_census` expands every deck in `battle_participant` with
   `jsonb_array_elements` (180k rows) on every call. ReadIOPS sat at ~500
   for 25 minutes, CPU at 27%, the scheduler and MCP Lambdas timed out from
   13:50Z, and at 14:06Z RDS cut `shared_buffers` from 23,081 to 11,295
   pages (180 MB → 88 MB) as its own mitigation. The instance now runs with
   half the buffer cache it had this morning. The first crash's precursor
   is the same shape: one migrate invocation that ran to its 300 s timeout
   in the 09:20Z bin with no output logged.

3. **Today's cache change broke a tool.** `players_collection` reads
   `api_payload.payload_json->'cards'`; the hourly sweep now nulls that
   JSON two hours after the last fetch, and the tool falls through to
   `cards: []` with no error. Confirmed live at 14:42Z on the caller's own
   tag: `as_of_payload` 11:03Z, `collection_level: null`, `cards: []`. The
   collection is 61% of every profile payload by bytes and is kept nowhere
   except as a hash in `player_snapshot_daily.collection_hash`. The `cards`
   catalog got an `endpoint <> 'cards'` carve-out in the sweep for the same
   reason and the collection did not; both are the same defect — product
   tools reading an ingest artifact.

4. **The clan roster is the cheapest activity sensor we have, and the
   scheduler does not use it.** A roster fetch is 2.2 KB compressed and
   carries the game's own `lastSeen` for ~50 players. In the diffed
   sample, 3.2 members' `lastSeen` moved per 20-minute poll. A player
   whose `lastSeen` has not moved since their last battlelog poll cannot
   have new battles; 61.5% of battlelog polls last hour found nothing new
   (142 of 231; 6,332 of 7,099 entries dropped at the collector). The
   `clan` endpoint at 31% of all fetches looked like the waste; it is
   closer to the thing that could remove most of the *player-endpoint*
   waste, if its cadence stays at or above the cadence it gates.

5. **Two tables will outgrow the instance on their own: `ranking_entry`
   (+~24,000 rows and ~5 MB a day from the hourly global board alone, read
   by `rankings_players` 245 times a week — the boards client — and by
   `rankings_timeline` once) and `battle_participant` (+~25,000 rows and
   ~45 MB a day incl. indexes).** Everything else is small or bounded. The
   1 GB question is not data size — the live working set is ~150–250 MB of
   indexes and recent pages — it is process memory under churn: autovacuum
   on the tables that were rewritten 8× per insert, the 60 KB profile
   payloads written to TOAST and nulled two hours later, and ad-hoc full
   scans.

---

## 1. Where the money goes (run-rate, this stack)

| Line | $/month | Basis |
|---|---:|---|
| Lambda compute (all six functions) | ≈ 30 net (35 gross) | 88,011 GB-s/day measured from `@billedDuration` over the last 24 h; arm64 $0.0000133/GB-s; 400k GB-s/mo free tier |
| — of which web-api (the collector door + site API) | 33 gross | 83,619 GB-s/day; 63,074 invocations; avg 2.59 s |
| — of which the two live-channel long-poll loops | ≈ 20–27 | inferred: p50 253 ms vs avg 2.59 s; two collectors × 8 s waits × continuous |
| VPC interface endpoint (SQS, for the in-VPC email enqueue) | ≈ 10 | Cost Explorer `VpcEndpoint-Hours` $3.48 / 10 days |
| RDS db.t4g.micro | 7.92 | $95 all-upfront 1-yr RI, active since 2026-09-07; size-flexible within the t4g family |
| RDS gp3 storage 20 GB + 7-day backups | ≈ 2 | `RDS:GP3-Storage` $0.08/day; backups inside the free 20 GB |
| CloudWatch (16 alarms + logs) | ≈ 2 | `CW:AlarmMonitorUsage` 15.9 |
| S3 archive (0.42 GB, 39k objects) + requests | ≈ 1.5 | 66,894 Tier-1 + 120,042 Tier-2 requests in 10 days (the sweep's HEADs are most of Tier-2) |
| API Gateway | ≈ 0.5 | 169,806 requests / 10 days |
| **Total** | **≈ 51** | |

Account-wide lines that are not this stack but dwarf its database: AWS
Config $6.64 (2,212 configuration items in 10 days, much of it this
stack's deploy churn), Bedrock ≈ $20.

**What this says.** Upgrading the instance to db.t4g.small costs ≈ $11.7/mo
(the RI covers half of a small). That is less than what the live lane's
idle polling costs today. The order of operations is: stop paying $20–27/mo
to wait on a queue that is empty 99% of the time, then decide the instance.

---

## 2. (a) Flow per endpoint: what a poll adds, what repeats, where it dies, what it costs

Fetch mix since 2026-09-03 (55,715 receipts): battlelog 40.4%, clan 32.0%,
player 20.7%, currentriverrace 4.1%, rankings_pol 3.3%, everything else
0.2%. Hour 12Z today (before 05112f0): 1,234 fetches — battlelog 248,
player 79, clan + war 906 (73%). Hour 13Z (after): 922 — 188 / 51 / 682.

Payload sizes are archive averages (compressed, distinct-content objects)
and local measurements (raw). "Repeats" is the share of a payload that
restates what the record already holds, from field-level diffs of
consecutive payloads keyed by tag/id (see appendix A).

| Endpoint | Subjects · cadence | Wire (gz / raw) | What one poll adds | Repeats what we hold | Where the repetition dies today | Cost before it dies (per poll) |
|---|---|---|---|---|---|---|
| **player_battlelog** | ~980 observers · yield EWMA 15 m–24 h, burst bound, reader cap, floor 24 h | 16.4 KB / 282 KB API→collector; **after 0074: ~1–3 KB hub-bound, 26 B (`[]`) when nothing new** | 3.3 new battles per poll fleet-wide (767 across 231 polls last hour); 61.5% of polls add nothing; sample: 12% of entries new, 83% overlap | 89.2% of entries (6,332 / 7,099 last hour); 69% of raw bytes are card lists whose names/icons repeat the catalog | **Collector** (the mark) for entries; the hub's mark filter underneath; content-hash dedup at the door for the rest | Collector: full 282 KB download + gunzip + filter (the API has no `since`). Hub: 1 mark read, 1 player upsert (unnest), receipt, payload row (jsonb TOAST of the filtered array), S3 put when content is new; when new: multi-row battle + participant insert, observation rows, rollup delete/insert per (player, day), burst window query, EWMA update. ~9 statements when empty, ~15–20 when not. Lambda p50 ~250 ms. |
| **player** | ~1,000 · 8 h active / 24 h / 72 h dormant; tracked cap 8 h; pre-reset force | 14.5 KB / 60 KB | A handful of counters (donations, battleCount, trophies: <1 change each per poll), 2.6 badge progress ticks of 139, 9.6 card-count changes (chest openings) | cards 61% of bytes (kept only as a hash), badges 28% (guarded upsert writes only the 2.6 that moved), 9% of polls byte-identical | **Projector**, mostly: badges guarded; snapshot overwrites the day row; **but** `player` identity row and `years_played` rewrite unguarded every poll; the whole 60 KB lands in TOAST and is nulled 2 h later (two TOAST writes + dead space per poll for a reader that never comes) | ~10 statements; ~50 KB TOAST written then deleted; 1 S3 put (14.5 KB); Lambda ~200 ms. |
| **clan** | 301 clans (30 tracked, ~270 incidental) · since 05112f0: 15 m/60 m/4 h tracked, 4 h/12 h/24 h incidental; was flat 15 m | 2.2 KB / 13.2 KB | 3.2 `lastSeen` moves, ~1 donation counter, 0.04 membership events, 0 role changes per 20-min poll | 98% of bytes is `memberList`; clanRank/donations/trophies/clanScore (the most-changed fields) are never projected; 23% of fetches byte-identical | **Projector**: per-member guarded `player` upsert (only lastSeen/name changes write); membership diff. **Not dying:** the `clan` row rewrite (unguarded: 21,377 updates on 5,151 rows), and the 50 per-member round trips | ~55 statements (one per member), 1–2 dead tuples, 1 S3 put; the cheapest fetch we make on the wire. |
| **currentriverrace** | ~30 tracked clans · 30 m war days / 120 m training | 5.4–8.7 KB / 60 KB | War days: decksUsedToday/fame deltas for our ~45 participants (≈10 changed leaves per poll), periodPoints. Training days: essentially nothing we store | **68% of bytes are the other four clans' participant lists, projected as 5 standings rows and otherwise dropped**; the rest is MAX-merged | **Projector**, but with unguarded MAX-merge upserts: `war_participation` 145,432 updates on 12,739 inserts (11:1), `war_attendance_day` 79,924 on 2,700 (30:1), `war_week_clan` 5,190 on 310 | ~155 statements per poll (3 per participant + standings), ~60 dead tuples, 1 S3 put. The most write-amplified endpoint left. |
| **riverracelog** | ~30 clans · daily | ~50 KB / — | Final standings once a week; otherwise a re-read of logged weeks | ~90% (10 logged weeks re-upserted daily) | Projector (coalesce/MAX) | ~150 statements/day/clan; negligible |
| **rankings_pol** (global, hourly) | 1 board hourly + 262 locations daily | 30 KB / 106 KB (global); 1.9 KB avg elsewhere | 667 rank moves, ~90 rating changes, ~70 entrants in/out per hour among 1,000 | Every hour differs, so nothing dies: 1,000 new `ranking_entry` rows + 1,000 `player.last_seen_at` touches per hour | Content hash at the projector (identical → `last_confirmed_at` only) — never fires for the global board | ~24,000 rows/day, ~5 MB/day, 24,000 dead `player` tuples/day; the fastest-growing table |
| rankings_pol_season, leaderboard(s), rankings_clans/clanwars, events, globaltournaments, cards | once / daily | 400 KB (a final) … 32 B | Bounded, daily, one-time | n/a | n/a | Negligible at steady state (the 470k finals rows were one-time) |

Two things the table makes plain:

- **The API has no delta form**, so collector-side filtering saves hub
  ingress, S3 objects, TOAST and Lambda parse time — not API bytes and not
  budget tokens. A token is only saved by *not polling*, which is a
  scheduler decision (section 4).
- Of the five write-amplified sites found this morning, three were fixed
  (battles, participants, rollups). Two remain: the war projector's
  MAX-merge upserts and the identity rewrites (`clan` row, `player` row on
  profile, `player.last_seen_at` hourly touch from boards). Same one-line
  fix as this morning's.

---

## 3. (b) Storage: hot, cold, derived, and what it costs

Production at 14:33Z: 1,000 MB total. pg_stat counters below are since an
unknown reset (`stats_since: null`), several days; the NOTES numbers at
11:54Z are consistent with the same window.

| Table | Size (heap+idx+toast) | Rows | Growth | Hot / cold | Canonical / derived / cache | Readers (tools) | Write pattern now |
|---|---:|---:|---|---|---|---|---|
| `api_payload` | **379 MB** (4.7 + 4.5 + **370 dead TOAST**) | 2,718 | 0 (sweep keeps latest per entity) | cold | cache of S3 | `cards_catalog`, `cards_synergy` (cards row); `players_collection` (**broken**); `live_fetch` | 22,187 ins / 21,616 del / 29,199 upd; TOAST churn ≈ every admitted payload written then nulled |
| `battle_participant` | 329 MB (251 + 77) | 179,829 | ≈ +25k rows, +45 MB/day | hot (last 14–30 d by `player_time` index); cold beyond | canonical | `battles_*` (20 refs), `opponents`, `war`, `clans`, `synergy`, `shared` | guarded since 0071; 722k historical updates on 100k inserts, now ≈ 1:1 |
| `ranking_entry` | 109 MB | 518,880 | +24k rows / +5 MB per day | latest snapshot hot; history cold | canonical (append-only) | `rankings_players` (245 calls/7 d), `rankings_timeline` (1) | insert-only |
| `battle` | 32 MB | 79,216 | +~12k/day | hot | canonical | as participants | guarded |
| `player` | 28 MB | 197,954 | slow | hot (names) | canonical | everything, for names; `players_search` shows `last_seen` | **1,446,677 updates** (86% HOT); hourly `last_seen_at` touch from boards/logs ≈ 24k/day |
| `api_receipt` | 22.6 MB | 55,715 | +6.5k rows, ~2.7 MB/day | 24 h hot | canonical (audit) | `elixir_coverage`, status, call audit | append |
| `player_badge` | 22.6 MB | 138,516 | slow | warm | canonical | `badges_*` | guarded (6,525 upd) |
| `battle_observation` | 21 MB | 82,595 | +~3 MB/day | **write-only since 0073** | audit (seeded the mark) | none in `services/mcp` | append |
| `player_daily_battle_rollup` | 16 MB | 97,178 | small now | warm | derived (rebuildable) | timeline/summary | 471k deletes historically, now ≈ new battles only |
| `job` | 9.2 MB | 35,951 | churn | hot control | operational | door, scheduler, status | 148,875 seq scans (the lease loop's `count(*)` by `leased_by` has no index) |
| `player_snapshot_daily` | 4.5 MB | 5,441 | +~1k/day | warm | canonical | `players_*`, `elixir_*` | overwrite within day |
| `war_participation` / `war_attendance_day` / `war_week_clan` | 5 MB | 20k | small | hot on war days | canonical | `war_*` | **unguarded MAX-merge: 230k updates on 16k inserts** |
| `clan_membership` | 2.1 MB | 11,372 | small | hot (1.96M idx scans) | canonical | many | fine |
| `poll_state` / `gateway` / `rate_limit` / `budget_state` | <1 MB | — | — | hot control | operational | scheduler, door | 91k / 342k / 147k / 3k updates, all HOT — WAL, not bloat |
| `capture_audit`, `mcp_call_audit`, `clan_event`, `player_event` | 4 MB | — | append | cold after a day | audit | status, coverage, events | append |

**Hot working set** (what must stay in memory for the recorder and the
tools to be fast): the control tables, `player` PK, `battle` PK,
`battle_participant` PK + `player_time` index for recent days,
`clan_membership`, `battlelog_high_water`, `poll_state` ≈ 150–250 MB.
`shared_buffers` was 180 MB this morning and is 88 MB now (RDS's automatic
cut at 14:06Z); the rest is served from the OS page cache and, when that is
squeezed, from disk (ReadIOPS 500–1,000 during the crash windows). A 1 GB
instance holds this working set; it does not hold it *and* a 2-minute
jsonb expansion of every deck *and* three autovacuum workers at 64 MB each
*and* 60 KB profile bodies being written and nulled all day.

**Which tables need to be relational.** The tools join on `battle`,
`battle_participant`, `player`, `clan_membership`, `player_snapshot_daily`,
`player_badge`, the `war_*` set and the control tables — those stay.
`ranking_entry` is read by snapshot id (`as_of`) and by (player, time) for
the timeline; append-only, columnar-shaped, and the only table that grows
~2 GB a year at today's scope. It is the one Parquet-in-S3 candidate with a
matching access pattern (a nightly export of snapshots older than N days,
DuckDB in the jobs Lambda or Athena for the timeline; the latest snapshot
per board stays relational for `rankings_players`). `battle_observation`
needs no home at all now. `api_payload` should hold nothing a tool reads.
DynamoDB: still no access pattern — the hot writes are relational upserts
that 52 tools read back relationally; the declined-today decision stands.

**Disk vs memory.** The 370 MB of dead TOAST under `api_payload` is disk,
not memory; a one-off `VACUUM FULL api_payload` (2,718 rows; seconds) gets
it back and is safe off-peak. It is not what crashed the instance.

---

## 4. (c) The cadence principle

Today's rules: yield EWMA to `TARGET_BATCH` for battlelogs; a burst (loss)
bound; a reader cap; activity buckets for profiles; war-day type for river
races; liveliness × relationship for clans; flat daily for boards and the
catalog; a fairness floor; starved-first ordering; a 10% live reserve; a
bucket cap. They were added one at a time and each is defensible. There is
one principle underneath, and it has two terms, not one.

**Poll a subject when the expected new information per fetch justifies a
token — except where waiting loses information, in which case poll before
the loss.** Formally, for subject *s* on endpoint *e*:

```
next_poll(s, e) = min(
  t_last + I_target(e) / Î(s, e),        # information-rate term
  t_loss(s, e),                          # loss-deadline term (hard)
  t_last + floor(e)                      # reader promise (a ceiling on staleness)
)  and never sooner than t_last + max_age(e)   # the API's own cache: a poll inside it returns the cached copy
```

- **Î(s, e)** is the expected information rate: battles per hour for
  battlelogs (the yield EWMA, already there); the same signal for
  profiles (a profile only changes when the player plays, opens chests or
  donates — all of which move the roster `lastSeen`); membership events
  per hour for clans (stamped since 05112f0); decks-used deltas for the
  river race; the board's own content hash for rankings (identical →
  slower). **The free signals are all in hand already**: `battleTime`,
  `lastSeen`, `decksUsedToday`, counters, content hashes, and now the
  collector's `observed`/`filtered`.
- **t_loss** is where the endpoint's source *forgets*: the battlelog is a
  30-entry rotating window (the burst bound is exactly this term);
  `decksUsedToday` resets at the war-day boundary (one poll in the last hour
  of a war day is sufficient for attendance; 30-minute polling all day is
  paying for yield signalling, not attendance); the pre-reset donation
  snapshot (already forced). Everything else is cumulative or
  current-state: waiting delays, it does not lose.
- **max_age** is the API's `cache-control`: `/clans/{tag}` and
  `/currentriverrace` 120 s, `/players`, `/battlelog`, rankings 60 s
  (`cr-agent-api-docs`, index.md). Nothing in today's rules goes under it,
  but it is the floor the rule should name.
- **floor(e)** is the fairness floor. It is a *reader* promise ("never
  staler than a day"), not an information rule. Keep it, and say that is
  what it is.

**What the principle changes.**

| Today's rule | Under the principle | Verdict |
|---|---|---|
| Yield EWMA → `TARGET_BATCH` | is the information-rate term for battlelogs | keep |
| Burst (loss) bound | is the loss-deadline term | keep; promote from `half` arm to all once the A/B is read |
| Reader cap | a reader-value term (information *a reader will use*) | keep |
| Profile activity buckets (8 h / 24 h / 72 h) | replaced by a **gate**: skip the profile poll when the roster's `lastSeen` for this player has not moved since the last admitted profile (the profile cannot have changed except by clan/name events, which the roster also carries). For players in no polled clan, fall back to the buckets | change |
| Battlelog yield when a fresh roster says `lastSeen ≤ last battlelog poll` | **skip the poll** — no battles are possible without being online. Fleet-wide 61.5% of battlelog polls are empty; the sample says 3.2 of ~50 members move per 20-min poll. Expect roughly half of battlelog fetches and most profile fetches to disappear for clan members | change (the biggest saving left) |
| Clan liveliness × relationship (05112f0) | keep for *incidental* clans. For *tracked* clans the roster is the gate for ~50 subjects' battlelog and profile polls: its cadence must be ≤ the cadence it gates, so 15 minutes while awake is right and is the cheapest 15-minute fetch in the system (2.2 KB) | keep, restated |
| War day 30 m / training 120 m | training days carry near-zero information → 4–6 h; war days: 60 m plus one forced poll in the last hour of each war day for attendance | change (small: 4% of fetches) |
| Flat daily boards | boards are reader-driven (the boards client); the global hourly board is a product decision (the season-story video). Daily locations at 1.9 KB are already cheap | keep |
| Fairness floor, starved-first | reader promise; keep, but a starved *dormant* profile (floor 72 h) is a poll for a snapshot nobody reads — see question 3 | keep |
| Live reserve 10%, bucket cap 300 s | budget mechanics; irrelevant while use is 15–35% of ceiling | keep |

**Where no-change detection should live, per endpoint, and its contract
cost:**

| Endpoint | Cheapest place | Saves | Contract cost |
|---|---|---|---|
| battlelog | collector (done, 0074); **plus scheduler gate** by roster `lastSeen` | mark: hub bytes/rows; gate: the token itself (~50% of battlelog fetches) | mark: shipped (two optional fields). Gate: none (server-side) |
| player | **scheduler gate** by roster `lastSeen` (saves the token); a collector-side canonical hash second (saves 14.5 KB, the TOAST write, the snapshot no-op — but not the token) | gate: most profile fetches for clan members; hash: bytes | gate: none. Hash: one optional lease field (`filter.unchanged_if_hash`), one optional submit flag (`unchanged: true`, no body), and the projector must write the day's snapshot row from the previous one — moderate |
| clan | hub (it *is* the sensor; every poll carries new `lastSeen`) — never the collector | n/a | none; fix the projector's per-member loop and the unguarded clan row instead |
| currentriverrace | projector (drop the other clans' participants before projection — already effectively dropped; guard the MAX-merge upserts) | ~60 dead tuples and ~100 no-op statements per poll | none |
| rankings global hourly | projector (content hash; done) — it never fires. Storage is the question, not detection | — | none |
| everything daily | nothing to detect | — | — |

Trust note: the collector's `observed`/`filtered` are asserted, not
verifiable. A lying collector that submits `[]` with `observed = filtered`
makes the hub believe nothing happened, which stretches the yield cadence
toward 24 h for that subject. Bounded (other collectors take the next lease,
the fairness floor catches it), but it is a new lever the zero-trust doc's
"lying collector" section does not yet mention. A roster-`lastSeen` gate
cross-checks it for free.

---

## 5. (d) Ranked changes — cost saved per unit of effort and risk

Effort in engineer-hours is a guess; savings are measured or derived above.

| # | Change | Layer | Effort / risk | Budget | Postgres | S3 | $ / month |
|---|---|---|---|---|---|---|---|
| 1 | **Replace polling with check-ins** (§9.1): no long-poll, no 500 ms DB loop; the door answers every call with `next_check_in_s`; settle the ledger from the scheduler tick. Live becomes a priority flag with a stated latency, not a channel (§9.2) | door / collector / config | 1 day incl. a collector release; low. Live latency is the only trade, and Jamie has accepted seconds | 0 | −300k tx/day, −148k `job` seq scans, −340k `gateway` updates | 0 | **−25 to −30** |
| 2 | **Cache only what a waiting reader asked for.** Write `api_payload.payload_json` only for `lane = 'live'` jobs (and until #3 lands, the cards row) — a *lane* rule, not an endpoint carve-out. Bulk payloads keep the hash row (dedup) and go to S3 only | projector | 2 h; low | 0 | −≈95% of TOAST writes (every admitted bulk payload, ~60 KB profile / ~30–80 KB filtered log, written then nulled) and the autovacuum behind them | 0 | 0 (memory headroom) |
| 3 | **Give the catalog and the collection a real home; delete the `endpoint <> 'cards'` carve-out.** `card` table (≈120 rows, replaced on change) read by `cards_catalog`/`cards_synergy`; `player_collection` (one compact row per player: ids, level, count, evolution; ~2–3 KB → ~25 MB for 10k players) written guarded from the profile projector, read by `players_collection`. No tool reads `api_payload` afterwards | projector / storage | 1 day; low | 0 | +25 MB once; −1 special case | 0 | 0 (restores a broken tool) |
| 4 | **Guard the remaining unguarded upserts** — `war_participation`, `war_attendance_day`, `war_week_clan`, the `clan` row, the profile's `player` row and `years_played`; collapse the roster's 50 per-member statements and the race's 3-per-participant into single `unnest` statements | projector | 3–4 h; low (same pattern as 0071) | 0 | −≈230k dead tuples per window, −~150 round trips per race poll, −50 per roster poll | 0 | 0 (memory / IO) |
| 5 | **Roster-`lastSeen` gate for battlelog and profile polls** (section 4). Needs one sentence verified against `cr-agent-api-docs`: `lastSeen` moves on any session, so "unchanged ⇒ no battles" holds | scheduler | 1 day + tests; medium (a wrong assumption reads as capture loss — the capture audit will show it) | **−≈50% battlelog, −most profile fetches for clan members (≈ −150–200/hr of today's ~300)** | proportional | −≈2k objects/day | 0 (Lambda ms) |
| 6 | **`ranking_entry` history to Parquet in S3**, nightly, snapshots older than 7–14 days; latest per board stays relational | storage | 1–2 days; medium (timeline reads two stores) | 0 | −5 MB/day of growth on the hot instance | +5 MB/day (cents) | 0 |
| 7 | **Bound `probe`** — sample `level_census` (5k battles), and put the census on a nightly EMF metric instead of an ad-hoc op; alarm on migrate duration > 60 s | ops | 1 h; none | 0 | removes the trigger of the second crash | 0 | 0 |
| 8 | `player.last_seen_at` touch: hourly → daily | projector | 15 min; none (only `players_search` shows it) | 0 | −≈23k dead tuples/day | 0 | 0 |
| 9 | Stop writing `battle_observation` (the mark and the receipt carry coverage now); or keep it and add nothing | projector / storage | 1 h; low — confirm no reader | 0 | −3 MB/day, −1 statement/poll | 0 | 0 |
| 10 | War cadence: training 2 h → 4 h; war day 30 m → 60 m + one forced last-hour poll | scheduler | 1 h; low | −≈30/hr | small | small | 0 |
| 11 | `VACUUM FULL api_payload` once, off-peak | storage | minutes; locks a 2.7k-row table | 0 | −370 MB disk | 0 | 0 |
| 12 | Enhanced Monitoring at 60 s before buying a bigger instance (OS memory split is invisible today: no EM, no Performance Insights) | ops | 10 min; ≈ $0.5/mo | 0 | 0 | 0 | +0.5 |
| 13 | Retention: `api_receipt` and `mcp_call_audit` 90 d, `job` done rows 7 d, `capture_audit` 30 d | storage | 1 h; low | 0 | bounds four append tables | 0 | 0 |
| 14 | **Collector visibility** (§9.3): three nullable receipt columns (`rows_written`, `new_facts`, `ingest_ms`) + one optional submit field (API body bytes), then yield / edge-filter / door-calls-per-fetch on the fleet, detail and status pages | door / projector / web | 1–2 days; low. Ship the columns with #1's release | 0 | +12 B per receipt | 0 | 0 — it is what makes #1 and #5 visible |

Not recommended: multiplying the rate budget (section 6.1); moving hot
tables to DynamoDB (no access pattern); an archive retention policy (the
whole archive is $0.01/month of storage — section 6.3); a collector-side
diff engine (section 6.2).

---

## 6. (e) The standing decisions, argued

1. **One global budget; the fleet is redundancy.** Keep — but for a
   different reason than the one written down. The budget is not binding:
   543 used in the first 40 minutes of hour 14Z (≈ 815/hr) against 3,600,
   with `due_starved: 9`; the 2026-09-10 review measured a 49-hour mean of
   170/hr. Multiplying it would change no fetch. On the terms: Supercell
   publishes no number; `cr-agent-api-docs` records observed behaviour only
   (no rate headers, 403 on overage, ~2 s spacing safe, limits appear
   per-IP; keys are IP-allowlisted). The terms review NOTES cites
   (`elixir-mcp-terms-review.md`) **is not in the repo** — the pointer is
   dead; it should be restored or the decision re-recorded from the terms
   themselves. The constraint that actually binds is *work per fetch on a
   1 GB database*, and that is the review's subject.

2. **Collectors are dumb proxies.** Extend the definition rather than break
   it: a collector applies **server-named filters over the server-named
   path** — the mark today, a hash tomorrow — and never chooses targets,
   never keeps state across leases, never interprets payloads. That line
   keeps the collector testable with a fixture and keeps the hub correct
   when the filter is ignored. Where it stops: computing deltas (needs the
   previous payload on the collector — state), or stripping fields the hub
   "doesn't need" (interpretation; the roster's `lastSeen` is the example of
   a field that looked like noise and is the sensor). Hash-based
   `unchanged` is fine; anything beyond it is not worth its contract.

3. **Archive every distinct payload, in the API's shape, forever.** Keep,
   and stop worrying about it: 420 MB and 39k objects after eight days,
   growing ~20 MB and ~2k objects a day — $0.01/month of storage, ≈ $0.10 of
   PUTs. The only readers are replay (`migrate`) and the captured tool-call
   record; nobody reads it to answer a question. The right question is not
   cost but *what it is for* (question 4): if it is the rebuild source, the
   filtered battlelog arrays since 0074 are still complete (every battle
   crosses once), and the `[]` objects (one per player, content-addressed)
   are harmless. Sampling or diffs would save nothing measurable and would
   cost the "API's own shape" property. A lifecycle rule to Infrequent
   Access after 30 days saves cents; do it or don't.

4. **Postgres holds canonical records losslessly; tools read relationally.**
   Keep for everything that is joined. Change for `ranking_entry` (§3): it
   is the one canonical table whose growth is unbounded by subject count
   (one board × 24/day × 1,000 rows regardless of how many players we
   record) and whose reads are by snapshot. The 60-day raw-payload
   rebuild window in ENGINEERING.md is now the *S3* window (Postgres holds
   2 hours), which is fine and should be reworded.

5. **Replay bypasses freshness and the mark; live reads return whole
   payloads; the hub stays correct when a filter is ignored.** All three
   are right and cheap. The mark's per-observer scope is right (the
   opponent-log trap is real). One addition: the collector's counts are
   asserted (§4, trust note) — the doc should say so.

6. **The 1 GB instance.** Not yet. The crashes were memory under *churn and
   ad-hoc scans*, not data. After #1, #2, #4 and #7 the recurring churn
   (TOAST write-and-null, the war upserts' dead tuples, the idle loop's
   transactions) and the trigger (probe) are gone. Then measure 24 hours
   with Enhanced Monitoring on: if `SwapUsage` stays above ~50 MB or
   `FreeableMemory` under ~150 MB at steady state, buy the small — the RI
   makes it $11.7/month, and RDS will not give back the 180 MB
   `shared_buffers` on its own (it is a parameter now; restore it in a
   custom group once memory is understood).

---

## 7. (f) What in today's changes is wrong or fragile

1. **`players_collection` is broken** (confirmed live, §0.3). Any consumer
   of it — elixir-bot, Drop, an agent — sees an empty collection for every
   player whose profile was polled more than two hours ago, which is every
   player 22 hours a day. No error, no note: `cards: []` beside a real
   `as_of_payload`. Fix by #3, or by extending #2's lane rule until #3
   lands. This should be fixed before anything else in this list.
2. **The `cards` carve-out is the same defect with a bandage on it.** A
   sweep that knows endpoint names is a policy with a hole in it; the
   next endpoint a tool reads from `api_payload` gets another `<>`. Rule:
   tools never read `api_payload`; it is an ingest artifact. (Jamie's point
   on 2026-09-11; agreed.)
3. **The 2-hour cache writes every bulk payload to TOAST for readers that
   never come.** `live_fetch` is 16 calls a week and reads within seconds.
   The design nulled the JSON to save 400 MB of resident TOAST and kept the
   write. #2 removes it.
4. **`probe` is a full-table jsonb expansion and it was run fifteen times
   in 25 minutes on a swapping instance.** The op is fine as a nightly
   census; as an interactive lever with "retry on TooManyRequests" advice
   it is the one thing today that demonstrably took the database down.
5. **The high-water mark's capture-audit under the collector filter reads
   `filtered === 0` as a gap.** Correct, but it also fires on the first
   filtered poll of a player whose seeded mark sits behind a log that
   rolled — which is a genuine gap, so the two `gaps` last hour are probably
   honest. Worth confirming against those two receipts before trusting the
   rate.
6. **The clan cadence for incidental clans (4 h / 12 h / 24 h) coarsens
   membership tenure for ~270 clans' members** — joins and departures are
   observed at up to 24-hour granularity, and `game_last_seen_at` for
   ranked players goes stale by the same amount. That is the intended
   trade; it is also in tension with #5 (the roster as the gate): a gate
   from a 12-hour-old roster can only ever say "known idle", never "known
   active". The 15-minute tracked cadence is what makes the gate work, so
   05112f0 should not be pushed further for tracked clans.
7. **Two counts of 30 vs 25.** The scheduler's `LOG_CAPACITY = 30` (measured
   over 2,000 payloads) and 0073's comment "a log is the last 25 battles"
   disagree; `cr-agent-api-docs` says ~30–40. Only the loss math uses the
   number, and it uses 30. Fix the comment before someone tunes to it.
8. **RDS silently halved `shared_buffers`** at 14:06Z. Nothing in the repo
   records it; the next person reading `{tables:true}` will see 11,295
   pages and assume it was always so.
9. **`ELIXIR_LOSS_BOUND` is still `half`** three days after the A/B began
   and the arms were noted as unbalanced at baseline. Either read the
   result or promote it; a half-applied loss bound is a half-kept promise.
10. **Small:** the `job` lease loop's `count(*) … where leased_by = $1 and
    status = 'leased'` has no supporting index (148,875 seq scans);
    trivial to add, irrelevant once #1 lands.

---

## 8. (g) Questions only Jamie can answer

1. **"Every 15 minutes while awake" for tracked clans** — is that a product
   promise readers rely on, or is the roster's job to be the activity
   sensor? The answer is the same cadence, but it changes what the docs
   should say and whether 05112f0's tracked branch can ever be stretched.
2. **How coarse may membership tenure get for incidental clans?** 24 hours
   today. If a ranked player's clan history matters for the season-story
   video, 4 hours everywhere is +~200 fetches/hr (still <15% of ceiling).
3. **Do dormant players need a daily snapshot at all?** The 72-hour floor
   forces a profile poll and a 60 KB payload for a player nobody reads and
   whose counters have not moved. A gate (#5) would skip it; the timeline
   would then show a flat line from the last snapshot, which is also the
   truth. Is "a row every N days" a promise?
4. **What is the archive for?** Rebuild source (then it is complete and
   done), audit of what the API said (then keep `[]` objects too), or a
   dataset (then Parquet exports are the real product and the raw objects
   are the staging area). Cost is not a factor at $0.01/month.
5. **Is `players_collection` a promise?** If yes, #3 builds it a table
   (~25 MB). If no, retire the tool and the carve-out together.
6. **What latency may `live_fetch` have?** Answered 2026-09-11 afternoon:
   seconds are fine, an LLM is never bothered by a few seconds, and live
   should be an escape hatch rather than a lane the whole fleet is shaped
   around. §9.2 turns that into a design; the one number still open is
   whether the escape hatch stays synchronous (≤ 15 s, check-ins every
   10 s) or goes asynchronous ("requested; ask again").
7. **How far back must the hourly global board be readable relationally?**
   Drives when #6 (Parquet) must land: at +5 MB/day the table passes
   `battle_participant` in about six weeks.
8. **Instance:** spend $11.7/month now, or spend a week on #1/#2/#4/#7 and
   measure first? This review says measure; the RI makes either choice
   cheap to reverse.
9. **The terms review** — where is `elixir-mcp-terms-review.md`? NOTES
   links it as the basis of golden rule 3 and it is not in the repo.
10. **What do collector points reward?** Today one per admitted fetch,
    lifetime; credits at ten fetches each. Under §9 a fetch that found
    nothing new is the thing we are trying to stop doing, so counting it
    the same as a war-day harvest works against the design. Points for
    *new facts* (battles, events, changed rows) are computable from the
    same receipt columns §9.3 asks for — but changing what a ladder
    counts is a product decision, and it retroactively reorders the
    ladder.

---

## 9. Additions after Jamie's read (2026-09-11 afternoon)

Three points from Jamie on the first draft: the Lambda line was invisible
and is big; collectors poll far too fast and even "live" can wait seconds,
so rethink whether the live lane makes sense at all; and the collector
pages in the admin should show efficiency — what is filtered at the edge —
not just fetch counts. This section is the design sketch for each, with
the numbers that bound it. It will take iterations; the goal here is to
fix the shape and the arithmetic so the iterations are small.

### 9.1 Check-ins, not polling

**What happens today.** Work is planned in 5-minute ticks (~50 jobs a
tick at this hour; the tick can plan 270). Collectors discover it by
polling `/lease`: the bulk collector waits 2 s per call and sleeps 20 s
when empty; the two live-channel collectors wait 8 s per call and never
sleep. The door services a wait by re-checking Postgres every 500 ms
(`begin` → advisory lock → `count(*)` on `job` → `select … for update skip
locked` → `rollback`) and runs `settleLeases` (three updates over `job`)
on every call. Per collector per fetch that is ≈ 2.7 door calls; per idle
hour it is 450 calls × 8 s of Lambda per live collector. Measured: 63,074
web-api invocations and 163,318 billed seconds a day, p50 253 ms (the
submits), mean 2.59 s (the waits).

**The model to move to.** A collector *checks in*; the door answers
immediately with either a job or nothing, plus **`next_check_in_s`** — the
server telling the collector when to come back. No `wait_s`, no server
loop. The value is computed from what the door can see in the same
query it already runs: `0` while queued work remains for this
collector's lanes, `10` when the queue is empty (so a live request is
picked up within ten seconds by whichever collector checks in first), and
`idle_backoff_s` (20–30) when the collector is on probation or the
scheduler tick is more than a minute away. The collector sleeps exactly
that long. Contract cost: one optional field in the lease response; a
collector that ignores it keeps its current loop and merely wastes its
own time, so the door's `poll.*_wait_s` go to 0 in the same deploy and
the hub is correct either way.

| | Door calls / hr (3 collectors, ~600 fetches/hr) | Lambda s / hr | ≈ $ / month | DB transactions / day |
|---|---:|---:|---:|---:|
| Today (measured) | ≈ 2,600 | ≈ 6,800 | 30 | ≈ 350k polling + 15k work |
| Check-ins, `next_check_in_s` 0 / 10 / 30 | ≈ 1,200 work + 1,080 idle | ≈ 350 | ≈ 1.5 | ≈ 30k |
| + batch leases (up to 10 jobs per check-in, submits unchanged) | ≈ 700 + 1,080 | ≈ 250 | ≈ 1 | ≈ 25k |

Batch leases are the second step, not the first: once the waits are gone
a door call costs ~250 ms, and 1,200 of them an hour is $1.50. Do the
one-field change, measure, and only then decide whether batches (which
change the quarantine arithmetic — `missed_streak` counts leases, and an
abandoned batch of ten is an instant quarantine) are worth their contract.

**Ledger settlement** moves to the scheduler tick (every 5 minutes; the
lease TTL is 90 s, so a lease is settled at most ~5 minutes late instead
of ~2 s late — nothing waits on that except the quarantine counter). The
door stops running three `job` updates per call.

### 9.2 Live: an escape hatch, not a lane

**What live is today.** A gateway attribute (`channel = 'live'`, set at
enrollment; there is no admin switch), a job lane (`lane = 'live'`, which
`leaseJob` already serves first), a 10% budget reserve the planner never
spends, the 8-second long-poll above, and on the MCP side a 12-second
Postgres poll for the receipt (`services/mcp/src/live.mjs`,
`timeoutMs = 12000`) inside a 25-second Lambda. `live: true` exists on
`players_profile`, `clans_roster`, `war_current` and `battles_query`, plus
`live_fetch`. Sixteen calls in seven days; mean 2.3 s.

**What it is for.** A reader who wants *now*, not the record: "what did I
just play", a roster right after a kick, a race score mid-day. The reader
cap already makes the *next* scheduled poll of anything a reader asked
about ≤ 60 minutes away; live closes the last hour. That is worth
keeping as an escape hatch. It is not worth a channel, a reserve, or the
fleet's polling rhythm.

**The design.** Retire the *channel* and the *reserve*; keep the *lane*
as queue priority (already true) and the tool flag. Latency becomes a
stated number that falls out of §9.1:

| Variant | Live latency (lease → admitted) | What changes | Cost |
|---|---|---|---|
| A. Synchronous, check-ins every 10 s when idle | ≤ 10 s pickup + ~1.5 s fetch + ~0.3 s admit ≈ **≤ 12 s**, typically 6 s | `live.mjs` timeout 12 s → 18 s (inside the 25 s Lambda); nothing else | ≈ $0.5/mo of idle check-ins |
| B. Synchronous, check-ins every 30 s | ≤ 32 s | exceeds the MCP Lambda; would need a longer Lambda timeout and a client that waits | ≈ $0.2/mo |
| C. Asynchronous: the tool returns `pending` with the job id at once; the agent calls again (or the next scheduled read finds it) | pickup as A or B, no waiting Lambda | a new response shape on five tools (contract minor) and a behaviour LLM clients handle but do not love: an extra turn | lowest |

Recommend **A**, with **C as the fallback the tool takes when no collector
has checked in within the window** (fleet asleep, all on probation) instead
of today's bare `timeout`. Then delete: `channel`, `live_reserve`,
`poll.live_wait_s`, the live long-poll branch in both collector twins, and
the "collectors on the live channel are ours" distinction in
COLLECTOR-ZERO-TRUST.md §"Channels" — every collector is a bulk collector
that happens to pick up priority work first. The zero-trust posture is
unchanged: live jobs were already leasable by any collector allowed the
lane; making every collector eligible only means an operator's collector
may serve a live read, which the door already stamps and the hub already
verifies like any other submission.

**Does live make sense at all?** As the hatch, yes, at ~$0 once §9.1 lands.
What does not make sense is spending the fleet's shape on it — and the
numbers say that is exactly what has been happening: roughly $25 of the
$30 web-api line, and the majority of the door's database traffic, are
the cost of a two-second promise made to sixteen calls a week.

### 9.3 Collector visibility: show efficiency, not activity

**What the pages show today** (screenshots, 2026-09-11 14:5xZ). Fleet:
name, operator, state, heartbeat age, fetches in the last hour. Detail:
machine/state/channel/points/version, three tiles (points lifetime,
credits, fetches 24 h), two clocks, fetches per day (9 days), "what it
fetched" by endpoint. Status: budget used vs ceiling, work waiting,
recording health, capture per collector in 5-minute and hourly buckets.
Every number is a count of *fetches*. A collector that fetched 7,797
payloads of which 61% carried nothing new looks identical to one that
fetched 7,797 payloads of news, and the edge filter that dropped 89% of
battlelog entries last hour is invisible.

**What the pages should answer.** For each collector, and for the fleet:
*how much did it fetch, how much of that was new, how much never reached
the hub, and what did the hub have to do with it?*

**Fleet table** — replace "fetches 1h" with four columns:

| Column | Definition | Source today |
|---|---|---|
| Fetches 1 h | admitted receipts | `api_receipt` (exists) |
| **Yield** | new battles + membership events + changed rows per fetch (or simply "% of fetches that changed the record") | projection result per receipt — needs one nullable column (§ below) |
| **Filtered at edge** | entries dropped by the collector ÷ entries observed, battlelog receipts | `api_receipt.observed / filtered` (0074, exists) |
| **Door calls / fetch** | check-ins per admitted fetch (1.0 is perfect; today ≈ 2.7) | the per-gateway `rate_limit` bucket `collector-work#<id>` already counts calls per hour |

Keep state and heartbeat; drop the "revoked 7 d ago · 0" row from the
default filter (it is noise on a four-row page).

**Detail page** — the three tiles become five, and "what it fetched"
gains a second bar per endpoint:

- Tiles: fetches 24 h · **new information 24 h** (battles / events /
  changed snapshot rows) · **bytes: API → collector vs collector → hub**
  (the edge filter in bytes; the hub knows the submitted size from
  `body_gzip_b64.length`, the collector reports the API body size in one
  optional integer beside `observed`) · **hub cost 24 h** (ingest ms and
  rows written, from `processResult`'s `timings` and the projection
  counts) · door calls / fetch.
- "What it fetched": per endpoint, fetches *and* yield — for
  `player_battlelog` new battles per fetch and the nothing-new share; for
  `clan` membership events and `lastSeen` moves per fetch; for `player`
  changed snapshot fields per fetch; for boards changed-vs-confirmed
  snapshots. This is the per-endpoint table of §2 drawn live, per
  collector.
- Points: today "one per admitted fetch, lifetime" rewards fetching. If
  points are meant to reward *contribution*, they should count
  information (new battles, events) rather than payloads — otherwise a
  collector on a nothing-new subject earns the same as one that harvested
  a war day. That is a product decision (question 10 below), and the
  number is available once the receipt carries the projection counts.

**Status page** — the budget bar stays, but beside "596 of 3,600 this
hour" put **"of which 41% changed the record"** (or the per-fetch yield),
and add one tile to Recording: **filtered at the edge, last hour**
(entries observed / dropped / crossed — `battlelog_filter_last_hour`
already exists in `{stats}`). The capture charts could stack *yielding*
vs *empty* fetches instead of (or under) per-collector colour.

**What it needs from the data.** Almost all of it exists after 0074; the
gap is that the projection's result (`battlesInserted`, `joined`,
`departed`, `roleChanged`, `changed` badges, snapshot written, rows
written) is computed inside `processResult` and thrown away after the
door's reply. Three nullable columns on `api_receipt` — `rows_written
integer`, `new_facts integer` (the endpoint's own definition of "new":
battles, events, changed rows), `ingest_ms integer` — and one optional
submit field for the API body size, give every page above its numbers
without a second store or a scan. `api_receipt` is 22 MB and append-only;
this adds ~12 bytes a row.

**Ordering.** 9.1 first (it is the money and it needs a collector
release either way), the receipt columns in the same release, then the
pages — the fleet table and status additions are small; the detail page
is the iteration Jamie will want to look at in the browser twice.

---

## 10. Jamie's answers (2026-09-11 evening) and what they change

The ten questions in §8 are answered. Recorded here verbatim in
substance, each with the consequence for the recommendations above; §10.3
is the revised ranked list where it differs from §5. These are product
decisions and are the standing ones from now — NOTES carries the pointer.

### 10.1 The decisions

| # | Question | Decision | What it changes |
|---|---|---|---|
| 1 | Is "every 15 minutes while awake" a promise? | **No.** Membership events are what the roster poll is for; they are infrequent; detecting a join or leave within a few hours is fine. | The roster is no longer polled for itself at 15 min. Its cadence has two inputs: the membership-event rate (hours) and the *gate* it can provide for its members' battlelog and profile polls (§4, #5). The 15-minute branch of 05112f0 goes; the tracked/incidental split goes with it for the roster (it stays for river-race polling, which only tracked clans get). |
| 2 | How coarse may incidental membership tenure be? | **Coarse is fine.** | 05112f0's 4 h / 12 h / 24 h stands as the *ceiling* for every clan; one rule for all clans (§10.2). |
| 3 | Do dormant players need a daily snapshot? | **No.** Players may be idle; there is no obligation. | The 72-hour profile floor is retired; a profile is polled when the roster's `lastSeen` has moved since the last admitted profile, when a battlelog delivered battles, or by the pre-reset watcher — and the watcher only for players whose last snapshot had donations > 0. ~68% of subjects sit on the daily branch and ~17% on the 3-day branch (09-09 audit); most of that spend (~50 of ~80 profile fetches an hour, and a 60 KB payload each) disappears. |
| 4 | What is the archive for? | **A rebuild source, and more importantly the substrate for future analytics the SQL will not do well (map-reduce, Athena) and for AI corpus building not yet envisioned.** | This is the biggest reframing. The archive is the *dataset*, Postgres is the *serving store*. Consequences: keep every payload, in the API's shape, forever (settled); the Hive layout stays; the filtered battlelog arrays since 0074 are still a complete corpus (every battle crosses once) and the `[]` objects are harmless noise; **an analytics layer is now a real direction** — nightly Parquet exports of the projected tables (battles, participants, snapshots, rankings) beside the raw archive, Athena/DuckDB-readable, partitioned by day — and any history question the hot instance cannot afford (card history, board history, season stories) is answered *from S3*, not by keeping more in Postgres. The 60-day rebuild window in ENGINEERING.md is the S3 window and should say so. |
| 5 | Is `players_collection` a promise? | **Yes** — the cards a player holds power deck-building suggestions on the tool surface, and should build a history of player events ("unlocked Mega Knight"). Jamie: "perhaps a gap in our collection today." | It is a gap: the collection is stored only as a hash, and there are no card events. #3 becomes a `player_card` table (player, card id, level, count, evolution/star form, first_seen_at, observed_at; guarded upsert from the profile projector; ~150k rows / ~20 MB for the ~1,200 profile subjects) plus two feed topics, `card_unlocked` and `card_leveled`, on the same first-observation-is-silent rule the badges use. Card *history* beyond "current" is an S3 question (answer 4): every profile payload since 09-04 is in the archive, so the history can be backfilled from there rather than kept relationally. |
| 6 | Live latency? | **Asynchronous `live_fetch` would be really smart — and then the special collector status for live goes and the whole fleet handles it.** | §9.2 variant **C** is chosen, not A. `live: true` comes to mean: *answer from a receipt newer than the endpoint's own `max-age` if one exists; otherwise enqueue one priority job (idempotent — one queued per subject) and return the recorded answer now with `pending: true, retry_after_s`.* The second call finds it. Delete: `gateway.channel`, `live_reserve`, `poll.live_wait_s`, the 12-second Postgres poll in `services/mcp/src/live.mjs`, and the live branch in both collector twins. Idle check-ins can then be 30 s (≈ $0.2/mo), and every collector — operators' included — picks up priority work; the door stamps and the hub verifies a live result exactly like a bulk one. |
| 7 | How far back must the hourly global board be readable? | **"We got a little crazy with the global leaderboard."** Snapshot it daily at the global reset; make sure the golden board is locked at the end of the season. | `ranking_board` global `pol` `every_minutes` 60 → 1440 — a one-row change, no deploy. `ranking_entry` growth 24k → 1k rows/day; the Parquet move (#6) is no longer needed for growth (it may still come from answer 4, as an export). The 1,000 hourly `player.last_seen_at` touches go with it. The golden board is already the finals path (`rankings_pol_season`, fetched once per settled month from the API's own final, 9,999 places); the daily snapshot is the running record, not the lock. One open detail: *which* daily moment — the 10:00Z season-roll hour is the natural one. |
| 8 | Instance now or measure first? | **Make the changes and see where the new baseline is.** | Matches §6.6. Enhanced Monitoring on before the baseline is read (#12). |
| 9 | The missing terms review | "Not sure what is needed." | Nothing operational. NOTES links a file (`elixir-mcp-terms-review.md`) that is not in the repo; either the file is restored from wherever it lives or the link is removed and golden rule 3's basis re-recorded in NOTES. It matters only because rule 3 cites it as evidence. |
| 10 | What do points reward? | **A fetch that results in data. No points for a fetch that returned nothing.** | `fetch_points` increments only when the receipt's `new_facts > 0` (§9.3's column). Collectors do not choose targets, so this changes the scoreboard, not behaviour — but it stops the scoreboard rewarding the thing the design is removing. Whether lifetime points are recomputed retroactively is open (they can be, from receipts, once the column is backfilled from the archive — answer 4 again). |

### 10.2 One rule for the roster, now that it is not a promise

With answers 1–3 the clan roster's cadence is the min of two needs, both
cheap to compute from what the projector already stamps:

- **Membership-event need:** `clamp(1 / event_rate_ewma, 1 h, 24 h)` —
  hours for almost every clan (0.04 events per poll in the sample).
- **Gate need:** if any comprehensive member of this clan has a battlelog
  or profile poll due sooner than that, poll the roster *first*, at that
  earlier time, and let `lastSeen` decide whether the member's poll
  happens. One 2.2 KB roster fetch stands in for up to ~50 member polls,
  of which ~61% would have been empty; it pays for itself when two or
  more members are due.

Everything else in 05112f0 — liveliness, churn, the tracked/incidental
distinction — collapses into those two lines for the roster endpoint.
The API's 120 s `max-age` on `/clans/{tag}` is the floor nothing goes
under.

### 10.3 Revised ranked list (supersedes §5 where they differ)

| # | Change | Layer | Effort / risk | Effect |
|---|---|---|---|---|
| 0 | **Global PoL board hourly → daily** (`ranking_board` row) | data | 1 minute; none | −23 fetches/day; −23k `ranking_entry` rows/day (−5 MB/day); −23k `player` touches/day |
| 1 | **Check-ins, not polling** (§9.1) with **async live** (§9.2 C): `next_check_in_s`, idle 30 s; delete channel, reserve, the 12 s live poll; `live: true` = fresh-or-pending | door / collector / mcp | 1–2 days incl. a collector release and a contract minor for the pending shape; low–medium | ≈ −$28/mo Lambda; −320k DB tx/day; every collector serves live |
| 2 | **Cache only live-lane payloads** (a lane rule) — interim until #3 lands; the `cards` carve-out goes with #3 | projector | 2 h; low | −≈95% TOAST churn |
| 3 | **`card` catalog table + `player_card` table + `card_unlocked` / `card_leveled` feed topics**; `players_collection` reads the table; tools never read `api_payload` | projector / storage / mcp | 1–2 days; low | restores a broken tool, closes the collection gap, +~20 MB |
| 4 | **Guard the remaining upserts** (war MAX-merges, `clan` row, profile `player` row, `years_played`) and collapse per-member loops to `unnest` | projector | 3–4 h; low | −≈230k dead tuples/window; −~200 round trips per race+roster poll |
| 5 | **Roster gate + one roster rule** (§10.2) + **retire the dormant profile floor** (answer 3) + pre-reset watcher only where donations > 0 | scheduler | 1–2 days + tests; medium (verify `lastSeen` semantics on live data for a day; the capture audit is the check) | −≈50% battlelog fetches, −≈60% profile fetches, −the 60 KB payloads behind them; roster fetches roughly unchanged for tracked clans, fewer elsewhere |
| 6 | **Analytics layer in S3** (answer 4): nightly Parquet of battles / participants / snapshots / rankings beside the raw archive; Athena table definitions; card history backfilled from archived profiles | jobs / storage | 2–3 days; low (additive, off the hot path) | none on the instance; the dataset becomes queryable |
| 7 | **Bound `probe`**, nightly census, alarm on migrate duration | ops | 1 h; none | removes the trigger of the 14:02Z recovery |
| 8 | `player.last_seen_at` touch daily, not hourly | projector | 15 min | −≈23k dead tuples/day (mostly moot after #0) |
| 9 | Stop writing `battle_observation` | projector | 1 h | −3 MB/day |
| 10 | War cadence: training 4 h, war day 60 m + forced last-hour poll | scheduler | 1 h | −≈30 fetches/hr |
| 11 | `VACUUM FULL api_payload` once | storage | minutes | −370 MB disk |
| 12 | Enhanced Monitoring before reading the new baseline (answer 8) | ops | 10 min | visibility |
| 13 | Retention on the four append tables | storage | 1 h | bounded growth |
| 14 | **Receipt columns + collector visibility** (§9.3); **points only for `new_facts > 0`** (answer 10) | door / projector / web | 1–2 days; ship the columns with #1 | makes #1 and #5 visible; scoreboard matches the design |

Dropped from §5: the Parquet-for-growth move (#6 old) — answer 7 removes
the growth, answer 4 turns the export into a feature rather than a
pressure valve.

### 10.4 The follow-ups, answered (2026-09-11, later)

1. **Daily board moment: 10:00Z**, the season-roll hour — the season's
   last daily snapshot is also its pre-roll board.
2. **Membership detection ceiling: 4 h for tracked clans, 24 h for the
   rest.** These are the clamp bounds in §10.2's roster rule.
3. **`live: true` returns the recorded answer *and* `pending`** — an agent
   always gets something on the first call.
4. **Card history: no backfill.** Capture `card_unlocked` / `card_leveled`
   from now forward into the user's notification queue; current state in
   `player_card`. A further review of the notification event stream is
   queued separately — the card topics land in whatever shape that
   review settles.
5. **Points: count from now forward, no backfill.**

### 10.5 Keep it simple — what that removes

Jamie's framing for all of it: *alpha/beta, no real users yet, keep it
simple.* Applied to the list:

- **No backfills anywhere.** Not card history, not points, not
  `new_facts` on old receipts. Every new column starts null and fills
  from its ship date.
- **The analytics layer (#6) is deferred**, not planned: the archive is
  already in the shape it needs (Hive layout, API's own JSON); build the
  export the day there is a question to ask it, not before.
- **Batch leases (§9.1 step two) are dropped.** One field,
  `next_check_in_s`, is the whole polling change.
- **Visibility (#14) ships as the three receipt columns and the fleet
  table's three new numbers** (yield, filtered at edge, door calls per
  fetch). The detail-page redesign waits for the notification-stream
  review, since half of what it would show is events.
- **One roster rule** (§10.2) replaces liveliness, churn and the
  tracked/incidental branches; the clamp is 1 h–4 h tracked, 1 h–24 h
  otherwise.
- **The instance stays micro** until the baseline after these changes is
  read (answer 8).

What remains is eight changes, in this order: #0 board row, #1 check-ins
+ async live, #2 lane-scoped cache, #3 catalog + `player_card` + two
topics, #4 guarded upserts, #5 roster gate + dormant floor retired, #7
bounded probe, #14 receipt columns + fleet numbers + points rule. Then
measure (#12) and decide the instance.

---

## Appendix A — Method and instruments

- **Payload diffs.** 433 objects for 17 entities downloaded from the
  archive to this machine: 2 clans (80 payloads, one full day of a tracked
  clan at 20-minute polls), 2 river races (44), 6 players (167 profiles,
  122 battlelogs), the global PoL board (20 hourly). Consecutive payloads
  per entity were flattened to leaf paths; lists of members, participants,
  cards and badges were keyed by tag/id/name so reordering does not read as
  change. Numbers are per consecutive pair. Payloads carry real tags and
  names; none appear in this document.
- **Tables and churn.** `{tables:true}` and `{stats:true}` on the migrate
  Lambda at 14:33Z; pg_stat counters are cumulative since an unknown reset
  and span several days (they agree with the 11:54Z values in NOTES).
- **Lambda.** CloudWatch `Invocations`/`Duration` per function (7 days and
  hourly today); Logs Insights `REPORT` lines in 10-minute bins around both
  crashes; `@billedDuration × memory` over the last 24 hours for dollars.
- **RDS.** `FreeableMemory`, `SwapUsage`, `Read/WriteIOPS`, `CPU`,
  `DatabaseConnections` hourly for 48 hours and at 5-minute resolution
  around both recoveries; `describe-events` for the recovery and the
  `shared_buffers` notice. Enhanced Monitoring and Performance Insights are
  off, so the OS-level memory split (Postgres vs page cache vs RDS agent)
  could not be seen.
- **Cost.** Cost Explorer Sep 1–10 by service and by usage type; the RI
  from `describe-reserved-db-instances`.
- **Not measured.** Per-route split of web-api invocations (no access
  logs) — the lease/submit split is inferred from p50 vs mean and from
  `fetches_1h` on the status page. API→collector bytes are computed from
  archive object sizes, which are distinct-content only (a lower bound on
  fetches, an exact count of objects). The `probe` op was not re-run for
  this review, on purpose.
- **Nothing was written to production.** Two read-only MCP calls
  (`players_collection`, `elixir_coverage`) on the caller's own tag
  confirmed §0.3.
