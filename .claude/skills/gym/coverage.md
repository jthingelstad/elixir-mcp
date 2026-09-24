# Gym coverage

One row per MCP family. **Clean** means a Gym run filed no new findings and
confirmed every regression it checked, on the contract version shown, and
no later deploy has touched the family. Only the orchestrator edits this
file (`SKILL.md`, "The sweep").

Before the Gym moved into the repo (as of 2026-09-23), the cloud Gym had
explored only `rankings` (6.1.0, 09-19/20) and `war` (6.10.0–6.19.0,
09-21/22/23). Neither run was a clean pass: both filed findings, now
shipped, and both need a regression pass.

| Family | Status | Contract | Date | Rounds | Report | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| badges | r4 fixed (6.36.8); not clean (1 finding). Round 5 only if Jamie asks | 6.36.7 | 2026-09-23 | 4 | reports/2026-09-23-badges-r4.md | r4: 10/10 regressions confirmed (#183 as decided); #193 done (cut pages), #194 praise. Open: timeline badge level-ups incomplete (Ak, Mega Goblin; elixir family); a clan collection as segment answers not_found |
| battles | r4 fixed (6.36.10); not clean (1 finding). Round 5 only if Jamie asks | 6.36.8 | 2026-09-23 | 4 | reports/2026-09-23-battles-r4.md | r4: 50 regressions confirmed, 3 retired (battles_levels gone); #199 done (seasonal Trophy Road past 14,000 counted as trophy battles), #200 praise; mode description lists event |
| cards | r4 fixed (6.36.11); not clean (3 findings, 2 partials). Round 5 only if Jamie asks | 6.36.9 | 2026-09-23 | 4 | reports/2026-09-23-cards-r4.md | r4: 12/14 confirmed; #204 tournament band notes, #205 first_seen_in_catalog note, #206 synergy freshness, #207 praise. Open: closed-window raw season corpus read times out at 18.3 s; Mirror; level_played; 192.1 flaked once under load |
| clans | r4 fixed (7.1.4); not clean | 7.1.2 | 2026-09-24 | 4 | reports/2026-09-24-clans-r4.md | r4: #236 capture over window, #237 joiners named, #239 default 30 days, #240 truncated, #241 recent_events cut, #242 counter vs rows; leader journey #264 roster first stint (participation tenure held for Jamie) |
| collections | r3 fixed (6.36.11); not clean; **PARKED after 3 rounds** (every finding shipped) | 6.36.9 | 2026-09-23 | 3 | reports/2026-09-23-collections-r3.md | r3: 5/6 held, #160 partial -> #201 (years_played null wording), #202 (clan collection as segment: input error with route), #203 praise; #116 selection effect +2.7 points, note served |
| elixir | r5 fixed (7.1.7); not clean; rounds 3-5 on the 7.x newsfeed | 7.1.6 | 2026-09-24 | 5 | reports/2026-09-24-elixir-r5.md | r4 #244-#255 (7.1.5: player_tag, filter before cap, ms bounds); r5 #269-#274 (7.1.7: member sessions whole and named, pointer untouched on member reads, presence from gaps, (from, to] documented). Journeys r1/r2 (#256-#268) shipped 7.1.6-7.1.7 |
| game | r3 fixed (7.1.1); not clean; **PARKED after 3 rounds** (every finding shipped) | 6.36.11 | 2026-09-24 | 3 | reports/2026-09-23-game-r3.md | r3: #219 date-only keeps notes, #220 events rolls over whole window, #221 inverted refused, #222 praise; 126.5 needs the first grid-pinned read |
| players | r3 fixed (7.1.3); not clean; **PARKED after 3 rounds** (every finding shipped but 234 cost table) | 7.1.0 | 2026-09-24 | 3 | reports/2026-09-24-players-r3.md | r3: #228 season on series, #229 seasonal entry rows, #230 key note, #231 lower bound, #232-#233 declarations/profile, #234 count described (no cost table), #235 praise |
| rankings | r3 fixed (6.36.12); not clean; **PARKED after 3 rounds** (every finding shipped) | 6.36.10 | 2026-09-24 | 3 | reports/2026-09-23-rankings-r3.md | r3: 13 regressions confirmed; #208 departures are not moves (0162-0163, strict floor), #209 source echo + future-season windows, #210 praise; 175.3 superseded by #208; 209.2 valid until 2026-10-05 (re-point then) |
| war | r3 fixed (7.1.2-7.1.3); not clean; **PARKED after 3 rounds** (every finding shipped) | 7.1.0 | 2026-09-24 | 3 | reports/2026-09-24-war-r3.md | r3: #223 banked fame (0164), #224 going-in trophies (0165), #225 deprecation/docs, #226 rival points (new fields), #227 praise; war-day paths untested (training day) |
| journey | r1 (new user) and r2 (clan leader) fixed (7.1.6-7.1.7) | 7.1.4 / 7.1.6 | 2026-09-24 | 2 | reports/2026-09-24-journey-r1.md, -r2.md | r1: 5 of 10 first questions right first time; #256 min_players, #257 one-player rarity, #258-#259 member reads, #260 promote/kick route, #261 examples. r2: #263 boat defenses out of war days (standings rollup and after-close battles open, known), #264-#267 |

**2026-09-23 incident:** the sweep's afternoon load drained the db.t4g.micro's EBS byte balance to 0. The database is now db.t4g.small (Jamie). Deploy gates run per family (`--acceptance=<family>`).

**Round 2 complete (2026-09-23):** all ten families ran; none was clean, and every finding shipped (6.30.0 to 6.36.2). Round 3 is the last before a family is parked for Jamie (SKILL.md, "The sweep").

