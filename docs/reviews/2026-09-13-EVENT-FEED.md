# The event feed, judged by the clans it serves — 2026-09-13

**Status:** Parts I–III ratified by Jamie 2026-09-13 ("Let's go!"). Tier 1
shipped as contract 1.10.0 (c9f8d0e); the entry synthesizer is committed as
a prototype behind a read-only ops op (cbd2277); both pushed, deploy pending.
The analysis below is as written before implementation. Jamie's framing:
the notification stream exists to tell a consuming agent *"here is something
you may care about"*; it was ported from elixir-bot, which was tuned for one
mature clan, and it probably does not work at all for a clan of low-level
entry players. This review tests that against the record.

**Lens.** For each topic, one question: *when this row lands, does it change
what the reader does next?* A row that does not is a cost (a tool call to
read it, another to drill it, tokens to discard it) with no signal. Numbers
over adjectives; every number names its source.

**Sources.** `services/mcp/src/feed.mjs` (registry + fan-out),
`services/jobs/src/index.mjs` (`clanPulse`), the emitters in
`services/ingest/src/{roster,war,snapshots,cards,pipeline}.mjs`, the
`elixir_events` handler; Jamie's own feed read end to end with
`mark_seen: false` (105 events, 2026-09-05 → 09-13); recorded reads for seven
clans of different shapes (`clans_participation`, `war_current`,
`clans_roster`); the migrate Lambda's read-only `tables` op; elixir-bot's
`engine/event_contracts.py` for the lineage.

---

## 0. The findings that change the picture

**1. The feed has only ever been exercised for one real clan, on one person's
account.** Eighteen clans are recorded. Pulses on Jamie's feed exist for two:
POAP KINGS and the two-member test clan Elixir Kings. No agent-kind account
runs a real clan yet, so no agent has ever read the feed the design was built
for. Every statement below about *agents* is derived from the code paths and
from observed per-player emission rates, not from an observed agent feed.
That is the first thing to fix: stand up one agent on a foreign clan and
watch its feed for a week before changing anything else.

**2. The vocabulary is elixir-bot's internal event bus, minus the part that
made it work.** The bot's registry declares, per event, a `wake` policy:
`immediate` (fire a responder now), `batch` (coalesce, then fire), `digest`
(no wake; the daily deliberation reads it with everything else, and this is
the DEFAULT because "most event types are texture, not news"), `never`. The
MCP port kept the event names and flattened that to `coalesce: true|false`.
Every progression topic the bot classed as digest texture now lands as a
wake-lane row. The stream is the bot's raw input relabelled as notifications.

**3. For low-level players, the progression topics fire on nearly every
snapshot.** Jamie's two new alts in Elixir Kings are the measurement:

| player | day | rows on the feed |
|---|---|---|
| Big Thing (new account) | 09-13 | best_trophies_peak ×7, collection_level_milestone ×7, card_leveled ×11, card_unlocked ×4, battles_recorded ×8 |
| Big Thing | 09-12 | arena_changed ×4, best_trophies_peak ×2, collection_level_milestone ×2 |
| thingles (new account) | 09-13 | best_trophies_peak ×7, collection_level_milestone ×7, card_leveled ×15, battles_recorded ×8 |
| King Thing (maxed) | 09-13 | collection_level_milestone ×2, card_leveled ×1, battles_recorded ×7 |

(counts are the coalesced `count` per topic on one UTC day; source: Jamie's
feed). A beginner emits five to seven topic rows a day; a maxed player two.
An agent for a 50-member beginner clan therefore carries on the order of 250 to
350 unread rows per day, every one `{count: n}` with no name and no *which*.
And the topics that would actually mark a beginner's moment fire never
(`career_wins_milestone` at 1,000; `pol_promotion` needs Path of Legends) or
indistinguishably (`arena_changed` count 4: which arenas?).

**4. It is unaffordable for exactly the reader it targets.** A member-tier
agent has 500 tool calls a day (agents page). Because milestone payloads are
`{count}` and nothing else (pinned by test), the nod costs one drill per
row to find out what happened. Three hundred rows is three hundred drills. The
feed, as designed, cannot be consumed within the budget of the agent it was
built for, so the only rational agent behaviour is to filter it down to the
clan topics and ignore the rest, which is what the agents-page recipe already
tells it to do. The player stream for agents is dead weight today.

**5. `battles_recorded` is the most frequent topic and carries the least.**
It refolds on every poll that lands a new battle. The `tables` op shows
2,350 feed inserts and 1,647 deletes since 0030: seven of every ten feed
writes are re-folds of a row nobody has read yet. For an active clan it
answers "did anyone play?" with a permanent yes, so `events_pending` never
reaches zero and the "anything new?" hint on every response is meaningless
for an agent. For a dead clan the pulse says the same thing once.

**6. The pulse is the one topic that is a report, and it repeats itself.**
Th15_Guy sat in `quiet` for six consecutive pulses (8, 9, 10, 11, 12 days);
nothing was new after the first. Elixir Kings gets a pulse every day reading
`quiet: [], battles_24h: 8`. There is no "nothing changed" flag and no
threshold edge. Jamie's own principle ("a nod, not a report", NOTES
2026-09-08) is violated by the headline topic.

**7. Contract drift on the two topics that matter most, observable live.**
`member_role_changed` emits `{player_tag, name, role}`; the registry floor and
the Events page promise `prev_role, new_role, direction` (events 23/24,
2026-09-07). `member_left` emits `{player_tag, name}`; the floor promises
`role` (events 886/890/894, 2026-09-11). The registry test pins the registry,
not what the emitter produces. A reader that trusts the floor cannot tell a
promotion from a demotion.

**8. The feed tells the agent what time it is, and the clock does not tell
it enough.** `war_day_open` is 10:00Z on a war day dressed as an event: a
clock fact every agent can compute, presuming an interest in war the agent
may not have. Meanwhile `game_clock`, the tool for exactly that, returns
`day_ends_at` but not the next boundaries an agent needs to schedule itself
("call me three hours before the next close"). The pulse's 07:00Z happens to
fall three hours before the close, an accident the payload does not label,
and for a US-centric clan it is 02:00 Central. The routine recipe tells the
agent to "set an evening follow-up" itself, which is correct in principle
(the clock is the agent's) and unsupported in practice (the clock does not
give it the instant).

**9. A nudge list for a boat that already crossed the line.** POAP KINGS
finished the race on day 4 at 09:38Z (`finish_time` set, fame 10,134);
`war_current.decks_today` still names 40 untouched. Facts-only does not
excuse a nudge list pointing at nothing.

---

## 1. What the feed is today

Per account rows, fanned out at write time, subscriptions implicit. Three
streams.

| stream | topics | who hears | shape |
|---|---|---|---|
| player | battles_recorded, badge_earned, legendary_badge_earned, arena_changed, best_trophies_peak, career_wins_milestone, collection_level_milestone, pol_promotion, card_unlocked, card_leveled | claimants with notify on; **agents via clan membership** | coalesced, `{count}` |
| clan | member_joined, member_left, member_role_changed, war_day_open, clan_war_week_finished, clan_pulse | accounts that added the clan with notify on | discrete, named |
| account | feedback_responded, recording_started/stopped, account_tier_changed (+ deprecated role_changed) | the account | discrete |

What is right and should stay: roster events are discrete and carry WHO;
first observation emits nothing (the flood guard); emits happen after the
ingest commit and swallow their own errors; coalescing folds only unread
rows; the topics-filter cursor protects unread rows of other topics (#13/#15);
`days_since_poll` beside `days_quiet` is the honest gap disclosure;
`decks_today` unions polls with recorded war battles (the round-3 lesson).

Jamie's feed over eight days, by topic (105 rows):

| class | topics | rows | share |
|---|---|---|---|
| clan management | clan_pulse 13, member_left 6, war_day_open 5, member_joined 3, member_role_changed 2, clan_war_week_finished 1 | 30 | 29% |
| own-player progression | battles_recorded 22, collection_level_milestone 8, best_trophies_peak 6, arena_changed 3, card_leveled 3, card_unlocked 1 | 43 | 41% |
| account / admin | feedback_responded 20, recording_started 12 | 32 | 30% |

Even on a person's feed with a dozen claims, fewer than one row in three is
about running the clan.

---

## 2. What the record says, clan by clan

Seven clans read today; recording since 09-07 unless noted. The point is the
spread of shapes, because the feed has one shape.

| clan | members | scope | what the feed would carry |
|---|---|---|---|
| POAP KINGS #J2RGCRVG | 47 | comprehensive, history to May | 30–34 members play daily, ~400 battles/day; quiet list 2–5 names; finished the race on day 4 by 09:38Z |
| Canadian #LG0 | 50 | comprehensive | 47 of 50 untouched on day 4 at 15:00Z; most members `war_decks [0,0,0]`. A clan that does not war, or wars late. A daily "untouched: 47" is not news here |
| ! ShocK-13 ! #P2P2Y880 | 25 | comprehensive | every member at the 14,000 trophy cap; war decks 16/16/12 across the roster; lost **8 members in one poll** at 14:48Z today (33 → 25, a purge); leader has no recorded battle |
| Calalas España #L9VRJ | 42 | comprehensive | 15+ joins in a week; war decks uniformly 12/16/12 |
| #MuUuKaNs!! #8UJ2UUJ8 | 35 | comprehensive | roster reshuffled on 09-10 and again 09-13; `war_decks` alternate `[12,0,12]` and `[0,16,0]`: a clan family that **moves its members between clans every week by design**. member_joined/left would be ~35 rows a week of intended churn |
| Elite Forcers #PPLCV9G2 | 6 | comprehensive | one member never recorded, leader 40 days quiet, zero war decks; the pulse would read identically every day |
| GUERREIROS PT #G89QUY2P | 50 | activity (since today) | 20 roster events in three days; 30 members with `trophies: null` (never profiled). Activity scope records roster and war only, yet the pulse would still compute `battles_24h`, `top_24h` and `quiet` from battles captured incidentally (opponent appearances), and count most of the roster as `never_recorded` |

Three things follow. **Churn is a clan trait, not an event**: for MuUuKaNs
and GUERREIROS a discrete row per join/leave is the noise, for POAP KINGS it
is the signal. **War posture is a clan trait**: for Canadian "untouched" is
the resting state, for ShocK-13 one untouched member is the story. **Scope
changes what the pulse may honestly say**: an activity-scope pulse with
battle counts is wrong in shape, not just in number.

None of these clans is the entry-level clan Jamie is thinking of. The
closest evidence is the two new accounts in Elixir Kings (§0.3), and it
already shows the failure mode: a beginner's ordinary day looks, in this
vocabulary, like a legend's best week.

---

## 3. What "something you may care about" means, per reader

**A clan-running agent** (the stated use case). Wants to be woken for: a
roster move with WHO (already right); a member crossing an inactivity
threshold, once (missing: the pulse repeats it); the race finishing (missing:
elixir-bot has `race_finished`); the week resolving with the result (the
MCP's `clan_war_week_finished` payload is `{}`; the bot's carries fame, rank,
participation); a member's notable moment, named (present as an unnamed
count). It does not want "someone played", and it does not want to be told
what time it is: the war-day nudge is the agent's own schedule, read off
`game_clock` and drilled with `war_current`, if that agent cares about war
at all. Nothing in the feed may assume it does.

**A person tracking their own players and friends.** Wants their own and
their friends' rare moments, named. Does not want `battles_recorded` at all;
does not want a count of card levels.

**An integration.** Nothing; already excluded.

The bot's `wake` classes map onto exactly this split. The MCP has the
registry (`TOPIC_CONTRACTS`) to carry it; the attribute is missing.

---

## 4. Recommendations

Tiered. Tier 1 is small and correct regardless of design; Tier 2 is the
design change; Tier 3 and 4 follow from it.

### Tier 1 — fix what is wrong now

1. **Emit what the floor promises.** `member_role_changed` →
   `{player_tag, name, prev_role, new_role, direction}`; `member_left` adds
   `role`. Add one test that runs the roster projector on a diff and asserts,
   for every emitted topic, `Object.keys(payload) ⊇ TOPIC_CONTRACTS[topic].payload`.
   The registry-invariant tests cannot catch this; only an emitter-to-registry
   test can.
2. **A finished boat has no nudge list.** When the clan's standing carries
   `finish_time` for the current week, `decks_today` (in `war_current` and the
   pulse) carries `race_finished_at`. The lists stay, because who played
   today is still a fact; the instant beside them is what a reader needs to
   know they no longer mean who owes the race anything (the entry never says
   so itself: Part II, §9). *Shipped 1.10.0.*
3. **Label the pulse's war block for what it is.** At 07:00Z it describes a
   day that closes at 10:00Z. Add `closes_at` (the nominal period end) so a
   reader can compute "three hours left" instead of guessing, or move the
   nudge to its own event (Tier 2.3), in which case the pulse's block is a
   morning-after summary and should say so.
4. **Docs drift.** The Events page lists `war_day_open` payload as `{}`; it
   carries `season_id, section_index, war_day, is_colosseum`, and those are
   the useful part. Promise them.

### Tier 2 — bring back the wake lane

5. **Add `wake` to `TOPIC_CONTRACTS`**, elixir-bot's classes: `immediate`
   (member_joined/left/role_changed, war_day_open, war_day_closing,
   race_finished, clan_war_week_finished, feedback_responded), `digest`
   (battles_recorded and every progression topic), `never` (recording_started
   for agents, maybe). **Digest topics stop being feed rows.** They are the
   texture the daily pulse reads (§Tier 3) and a per-player question a tool
   already answers (`players_timeline`). `elixir_events` then IS the wake lane,
   `events_pending` means something again, and the 70% of feed writes that are
   re-folds go away. This is a one-line-per-topic data change in the registry,
   which was the bot's whole point in having one.

   If some progression must stay as rows for persons (own player's rare
   moments), gate it by audience: `wake: { person: "immediate", agent: "digest" }`.
   The registry already carries audience by kind.

6. **Name the thing.** A nod has a subject line. Where the emitter knows the
   one value that identifies the event, carry it: `arena_changed {from, to}`,
   `best_trophies_peak {best_trophies}`, `pol_promotion {league}`,
   `legendary_badge_earned {names ≤ 3}`, `card_unlocked {names ≤ 3}`. This is
   not the analysis lane (tenure, evidence, "what it means" stay with the
   tools); it is the difference between "a thing happened" and "a thing
   happened, drill to find out which", and it is the difference between one
   tool call and one per row. The `{count} and nothing else` test pin should
   be revisited with this distinction in hand.

7. **The clock is the agent's, not the feed's** (Jamie, 2026-09-13, on the
   first draft of this item, which proposed a `war_day_closing` topic). The
   test for a feed row is *could the agent have computed this itself?* A war
   day ending is a clock fact: every clan closes at 10:00Z, `game_clock`
   needs no clan, and the feed is pull, so a closing row could only be seen
   when the agent polls anyway. It adds nothing the agent lacked and assumes
   the agent wants a war schedule at all. So:
   - **No `war_day_closing`.** Withdrawn.
   - **Deprecate `war_day_open`** for the same reason; it is 10:00Z on a war
     day dressed as an event. Keep emitting through one deprecation window
     (the routine recipe on the Events page uses it), point readers at
     `game_clock`.
   - **Keep only observations:** `race_finished` (the boat crossed the line,
     unpredictable and clan-specific) as a new discrete topic, and
     `clan_war_week_finished` carrying the result (Tier 3.13). Whether an
     agent cares is what the `topics` filter is for.
   - **Make `game_clock` sufficient for self-scheduling.** Today it returns
     `day_ends_at` and `season_ends_at` but not the next boundaries an agent
     needs to say "call me three hours before the next close": add
     `next_war_day_opens_at`, `war_day_closes_at` (null on training days),
     `week_ends_at`, `next_training_starts_at`. One call, for nobody in
     particular; an agent that does not care never asks.
   - The pulse's 07:00Z is the same smell in a different lane: it is a time
     we chose. It is tolerable because the pulse is a digest the agent opts
     into by topic, and Tier 3.12 makes the hour the account's; but nothing
     in the feed should ever tell an agent what time it is.

8. **Edge-triggered quiet.** `member_quiet` emitted once per member per rung
   of a fixed ladder (5, 10, 20 recorded-quiet days), guarded by
   `days_since_poll` (never emit when the silence is ours), payload
   `{player_tag, name, days_quiet, days_since_poll, rung}`. Discrete, named,
   once. The pulse keeps the full list for the morning picture; the feed
   carries the crossing.

9. **Beginner-aware thresholds.** `best_trophies_peak` on band crossings
   (every 500, or arena boundaries) the way `career_wins_milestone` already
   uses 1,000; `collection_level_milestone` on multiples of 5 or 10;
   `card_leveled` only at max level or evolution unlock (an event), not every
   level; `arena_changed` upward only. The floor for "worth a nod" should be
   invariant to how fast the player is climbing.

### Tier 3 — the pulse as a morning brief that knows when to be quiet

10. **`changed: true|false` and `changes: [...]`** on the pulse: new names in
    quiet, roster net movement, war state transition, or nothing. A routine
    reads the flag first and skips the rest most days. Elixir Kings would
    read `changed: false` every day, which is the truth.
11. **Scope-aware shape.** An activity-scope clan gets a pulse without
    `battles_24h`, `top_24h` and `quiet` (or with them marked
    `basis: "incidental"`), and `never_recorded` is not reported at all,
    because it is the whole roster by construction. Carry `scope` in the
    payload.
12. **Per-clan pulse hour.** The record has every clan's battle-time
    distribution; the quiet hour before a clan's day starts is computable.
    Until then, per-account hour from the account timezone is a two-line
    change to the EventBridge fan-out (one rule, hourly, pulse the clans whose
    local hour matches).
13. **`clan_war_week_finished` with the result.** Fame, rank among the five,
    decks used over decks available. The bot's `week_finished` carries this;
    the MCP's carries `{}` and forces a `war_history` call to learn whether
    the week went well.

### Tier 4 — consumers and measurement

14. **Measure the feed before and after.** A `feed_census` ops op (rows per
    account per topic per day, folds per insert, unread depth per account)
    alongside `args_census`. This review had to reconstruct the histogram from
    one account's page; the lane cannot be tuned without its own numbers.
15. **Run one agent on a foreign clan for a week** (Canadian or ShocK-13, with
    the owner's consent as a pilot) with the recipe from the agents page and
    read its feed daily. Everything in §0.3 and §0.4 is inferred; this makes it
    observed.
16. **Keep the cursor semantics; document the agent default.** With digest
    topics out of the lane the topics-filter cursor stop stops mattering. Until
    then, the agents-page recipe (own cursor, `mark_seen: false`) is right and
    should be the documented default for agents, with the note that
    `events_pending` is not for them.

---

## 5. What not to change

- **Facts, never judgments.** Every recommendation above is a fact with a
  threshold the reader can see; `member_quiet` says "crossed 10 recorded-quiet
  days with polls current", not "kick".
- **`member_left` stays raw.** The API cannot tell a leave from a kick; the
  purge at ShocK-13 (8 in one poll) is a pattern an agent can read from the
  timing, and the feed should not guess for it.
- **Watching gets the same as primary; no per-topic mute.** With a wake lane
  there is nothing to mute.
- **The drill-down stays in the tools.** Naming the subject of a nod (Tier
  2.6) is not putting analysis in the event.

---

# Part II — From what happens to who should hear it

Jamie, 2026-09-13, after Part I: *consider everything that happens as
players and clans play; a person's feed (self, alts, friends) and an agent's
feed (a clan) should be fed differently; assume nothing about what the
consuming agent is doing; a row must be something the consumer could not
have found out on its own; it should be synthesis, summarization, activity.*

## 6. The tests a row has to pass

Four, applied to every candidate below.

1. **Not computable by the reader.** A clock tick fails (§Tier 2.7). "The
   day rolled" fails. "Raquaza played 13 battles since you looked" passes:
   the reader would have to poll the record to learn it.
2. **Assumes nothing about the reader's purpose.** A row is a description of
   what happened to a subject, never an instruction, a threshold judgment, or
   a presumption of interest. "Untouched: 40" is a fact about the clan;
   "nudge these 40" is not a row.
3. **Synthesis, not ticks.** One row summarizes a subject's activity over the
   reader's own window (since its cursor). Ten counts on ten topics for one
   subject is the current design's failure; one entry per subject with named
   sections is the target.
4. **Named.** The subject line carries the *which* (arena 14, badge "Card
   Mastery: Hog Rider L3", joined "Ship It!"). Analysis (what it means,
   evidence, tenure) stays with the tools.

## 7. What happens in Clash Royale

The full inventory, before deciding what is feed-worthy. Marked by which
reader plausibly cares (P = a person watching self/alts/friends, A = an agent
representing a clan), and by whether the reader could compute it (C) or it
is an observation only the record has (O). Clock facts are marked K and are
never rows.

### A player's life

| happening | P | A | kind | note |
|---|---|---|---|---|
| played battles (ladder, ranked, war, 2v2, challenge, tournament, event, friendly), with results and crowns | P | A (aggregate) | O | the base activity; per-person for P, per-clan totals + standouts for A |
| trophies moved; new personal best | P | notable only | O | for a beginner every session is a new best: band it (every 500, or arena boundary) |
| arena promotion | P | notable | O | upward only |
| Path of Legends: promotion, global rank, season final league | P | notable | O | promotions are rare enough to name each |
| PoL season reset (league dropped) | – | – | K-ish | a reset, not a demotion; never a row |
| collection: card unlocked, card levelled, card maxed, evolution/hero form unlocked, collection level up | P (banded) | – | O | levelled-per-level is texture; maxed/evolution/form is a moment |
| badges: mastery level up, one-off legendary badge, YearsPlayed anniversary | P | notable | O | named; already split at the emitter |
| career thresholds: wins, three-crown wins, battle count, lifetime donations | P | notable | O | thousand-crossings |
| weekly donations given/received | P (own) | A (leader, total) | O | Monday reset is K; the count is O |
| clan membership: joined, left/kicked (indistinguishable), role changed, rejoined | P (friends) | A (own roster) | O | WHO, always |
| war: decks used per day, points, left out of the race roster | P (own/friends) | A (aggregate) | O | per-member is texture for A; the aggregate and the outliers are the signal |
| went quiet / came back | P (friends) | A (members) | O | edge-triggered on rungs; guarded by days_since_poll |
| unusual burst (60 battles in a day) | P | A (standouts) | O | relative to the player's own baseline |
| streaks (win/loss), win-rate swing | P | – | O | derived; needs a baseline; probably tool territory, not feed |
| deck change (most-played deck changed, archetype changed) | P | – | O | synthesis from battles; a nod-worthy moment for a friend-watcher |
| name change, favourite card change | P | A (roster names) | O | small; name change matters to rosters |
| challenge / tournament result (12 wins, badge) | P | notable | O | from badges + battles |

### A clan's life

| happening | P | A | kind | note |
|---|---|---|---|---|
| roster: joins, leaves, role changes, net size, purge (many leaves in one poll), churn rate, hoppers | friends' clans only | A | O | discrete WHO inside one card; the purge is the pattern the agent reads from timestamps |
| leadership change (leader transfer) | – | A | O | a role change to `leader` |
| war: week started, war day opened/closed, season started/ended, colosseum | – | – | K | never rows; `game_clock` |
| war: boat crossed the finish line | – | A | O | unpredictable, clan-specific |
| war: day result (period points, standing among five), week result (fame, rank, trophy change), rival overtook | – | A | O | resolutions are observations |
| war: participation aggregate at a moment (untouched/partial/finished, participants, members not in race) | – | A | O | fact with `as_of`; the moment is the reader's choice |
| clan score / war trophies moved; league changed; ranking position moved | – | A | O | from clan polls and rankings |
| donations: weekly total, leader, distribution | – | A | O | Monday reset is K |
| activity aggregate: battles, active members, per-day shape | – | A | O | the pulse's headline numbers |
| members quiet crossing rungs; members returned; never recorded | – | A | O | edge, named, guarded |
| standouts: most battles, new bests, badges, promotions among members | – | A (bounded) | O | this is where 50 beginners' progression collapses into one line |
| description / required trophies / type (open, invite, closed) / badge / location changed | – | A | O | leader actions visible in the clan payload; not recorded today (check) |
| clan anniversary, member join anniversaries, birthdays | – | – | K / invented | elixir-bot's; a clock or a community fact, not the record's |

### The game's life

| happening | P | A | kind |
|---|---|---|---|
| season rollover, war grid | – | – | K (`game_clock`) |
| card added, balance change, game event started/ended | P? A? | | O but global; already `game_events` / `elixir_changelog`; a global stream is a later question |

### The service's life (account stream, unchanged)

recording started/stopped, feedback responded, tier changed. Discrete, addressed, fine as they are.

## 8. Two readers, two shapes

**A person** watches people: primary, alts, friends, watching. They read at
irregular intervals (when they open Claude), hours to days apart. The
natural unit is *the person*: "what did each of my people do since I last
looked?" One entry per subject, sections for battles, trophies, ranked,
collection, badges, clan, war, quiet/returned, notables. Ten subjects, ten
entries, each a paragraph's worth of named facts. That is the whole feed.

**An agent** represents a clan and reads on its own schedule (it decides
that from `game_clock`; §Tier 2.7). The natural unit is *the clan*: one entry
per clan since its cursor, with sections for activity, roster (WHO, with
timestamps and roles), war (state with `as_of`, resolutions in the window),
quiet crossings and returns, donations, standouts (bounded, named). Members'
individual progression appears only as standouts; a member's detail is one
`players_summary` away. A 50-member beginner clan produces one entry, not 300
rows, and the beginners' climb shows up as "9 members reached a new arena
(names…)", which is synthesis.

An agent may ALSO be given players to follow (its leaders, say) and then
gets player entries for them; a person who adds a clan gets the clan
entry. The entry's shape follows the subject kind, not the account kind. What
the account kind decides is only the default subject set, which it already
does.

Neither shape has a `topics` list to opt into, because there are no topics:
there are subjects and sections. A reader that does not care about war reads
past the `war` section; a `sections` argument can trim it from the wire. No
row ever says what time it is, and no row ever says what to do.

## 9. The shape, concretely

Illustrative, numbers drawn from today's reads where they exist.

A person's entry (Jamie's feed, subject raquaza, window since the cursor):

```json
{ "kind": "player", "subject_tag": "#UL2V9QRG0", "name": "raquaza",
  "relationship": "friend",
  "window": { "from": "2026-09-11T14:00:00Z", "to": "2026-09-13T14:56:00Z" },
  "battles": { "played": 13, "won": 8, "lost": 5, "by_mode": { "ladder": 9, "war": 4 } },
  "trophies": { "from": 7250, "to": 7412, "best": 7412, "new_best": true },
  "ranked": null,
  "collection": { "level": { "from": 41, "to": 43 }, "unlocked": [], "maxed": [] },
  "badges": [ { "name": "Card Mastery: Hog Rider", "level": 3 } ],
  "clan": { "tag": "#J2RGCRVG", "changed": null },
  "war": { "decks_used": 4, "war_day": 3 },
  "presence": { "days_quiet": 0, "returned_after_days": null },
  "notables": [ "new_best_trophies", "collection_level_up", "badge_level_up" ] }
```

A clan entry (an agent for POAP KINGS, window since its cursor):

```json
{ "kind": "clan", "subject_tag": "#J2RGCRVG", "name": "POAP KINGS", "scope": "comprehensive",
  "window": { "from": "2026-09-12T07:00:00Z", "to": "2026-09-13T14:56:00Z" },
  "activity": { "battles": 432, "members_active": 34, "members_total": 47, "basis": "recorded" },
  "roster": { "joined": [ { "tag": "#20CLVPLG8R", "name": "VVSBUDGET", "at": "2026-09-12T13:37:59Z" } ],
              "left": [ { "tag": "#LCUVPUYCY", "name": "ㅤᴀɴᴅᴇʀㅤ:)", "role": "member", "at": "2026-09-12T16:18:13Z", "tenure_hours": 3 } ],
              "role_changes": [], "size": { "from": 46, "to": 47 } },
  "war": { "season_id": 136, "week": 1, "day_kind": "war", "war_day": 4,
           "race_finished_at": "2026-09-13T09:38:04Z",
           "decks": { "as_of": "2026-09-13T14:48:01Z", "untouched": 40, "partial": 4, "finished": 3, "participants": 47 },
           "resolved": [ { "war_day": 3, "period_points": 1500, "standing": 1 } ] },
  "presence": { "quiet_crossed": [ { "tag": "#YC8LLR8Q2", "name": "sniperhendo", "days": 5, "days_since_poll": 0 } ],
                "returned": [], "never_recorded": 0 },
  "standouts": { "most_battles": [ { "tag": "#2G2RPVPP", "name": "Aaqib Javed", "battles": 62 } ],
                 "new_bests": [], "badges": [], "promotions": [] },
  "donations": { "week_total": 9021, "leader": { "tag": "#C920YGLC2", "name": "Vijay", "given": 881 } } }
```

Every field is a fact with its window or its `as_of`. `race_finished_at`
being set is the only thing a war-minded agent needs to know that the
`decks` block is moot; the entry does not say so, because that is the agent's
inference to make.

## 10. Where the rows come from: the ledger, not the fan-out

The recorder already has the right table. `player_event` and `clan_event`
(migration 0001, design §13) are per-subject ledgers with `event_id` as the
cursor, evidence payloads, and timing windows; they hold roster events and
donation resets today, and one tool (`clans_roster.recent_events`) reads
them. The per-account `event_feed` (0030) was added beside them and became
the thing every emitter writes to, with fan-out at write time on the
premise that "accounts are few, watches are bounded". Eighteen clans in and
that premise is the scaling problem: every clan happening is copied once
per subscriber, then re-folded on every poll.

The shape in §8 wants the opposite: **write once per subject, synthesize
per reader at read time.**

- Emitters write happenings to the subject ledger, once, named, with
  evidence (`badge_earned {name, level}`, `arena_changed {from, to}`,
  `card_maxed {card}`, `race_finished {at}`, `member_left {tag, name, role}`).
  Diffs the record cannot reconstruct (badge levels, whose prior state the
  upsert discards) become durable here; diffs it can (battles, snapshots,
  memberships) need no ledger row at all.
- `elixir_events` becomes a read-time synthesis: for each of the caller's
  subjects, one entry built from the record and the ledger since the caller's
  cursor, shaped by subject kind. The cursor is an instant (or the ledger
  high-water id), per account, with the same `mark_seen` bookmark semantics
  and the same "second consumer keeps its own" rule.
- `events_pending` stays cheap: "has any subject of yours been admitted
  since your cursor?" is one indexed lookup over `poll_state`.
- Nothing prunes. The record is the archive; a reader that comes back after
  40 days gets a 40-day entry, which is what it should get.
- Fan-out, the coalescing CTE, the 30-day sweep and `event_feed` retire.
  The account stream (feedback, recording, tier) stays as addressed rows;
  it is small and genuinely per-account.

Cost. A person's read is one entry per subject, each about a
`players_summary` in weight. A clan entry is the pulse's query set (§0.6),
which today costs seconds per clan; that is acceptable for a feed read a
few times a day and should be measured (Tier 4.14) and cached per (clan,
quarter-hour) if an agent polls harder than that. The daily pulse stops
being a separate thing: a clan entry read at 07:00Z IS the pulse, at the
hour the reader chose.

**The smaller step, if the ledger route is too much at once:** keep
write-time rows but fold per SUBJECT into one accumulating entry (jsonb
merge in the coalescing CTE) instead of per (subject, topic). It fixes the
row count and the naming, keeps fan-out and stale moment facts, and is a
stepping stone rather than a destination.

## 11. What this retires from Part I

Tier 2.5 (`wake` classes), 2.6 (name the thing), 2.8 (edge-triggered
quiet), 2.9 (beginner-aware thresholds) and Tier 3 (the pulse as a brief)
all survive as *sections and rules inside the entry* rather than as topics.
Tier 1 stands as written. Tier 2.7 stands: the clock is never in the feed.
Tier 4.14 (measure) and 4.15 (pilot an agent on a foreign clan) become the
first two steps of any implementation, not the last.

---

# Part III — Before implementing

Jamie, 2026-09-13, on Part II: *"We aren't making an event stream for code,
this is a notification feed for an agent. It should be as ready to use.
Honestly it is something a person should be able to read and find valuable
too."* Ratified: the synthesized entry is the row; the raw happenings are
available inside it, not instead of it.

## 12. The vocabulary, settled

- **Entry.** One row of the feed: a subject's activity since the reader's
  cursor. Kinds: `player_activity`, `clan_activity`, plus the account rows
  (`feedback_responded`, `recording_started/stopped`, `account_tier_changed`).
- **Summary.** A deterministic, templated sentence or two at the top of
  every entry, written for a person: *"raquaza (friend): 13 battles since
  Thursday, 8 wins; new best 7,412 trophies; Card Mastery: Hog Rider reached
  level 3."* No model call, no judgment, every number from the sections
  below it. This is the "ready to use" half.
- **Sections.** The structured facts under the summary (`battles`,
  `trophies`, `ranked`, `collection`, `badges`, `clan`, `war`, `presence`,
  `notables` for a player; `activity`, `roster`, `war`, `presence`,
  `standouts`, `donations` for a clan). Always present, `null` when nothing
  happened, same keys every time.
- **Happenings.** The named moments inside the window (`badge_earned
  {name, level}`, `member_left {tag, name, role, at}`), available with
  `verbosity: full`, taken from the subject ledger.
- **Window.** `{from, to}` on every entry. `from` is the reader's cursor,
  `to` is the response's `as_of`, and `next_cursor` is that `as_of`.

## 13. Decisions to make before the first line of code

Each with a recommendation. Where Jamie has already ruled, it says so.

1. **Tool name.** Keep `elixir_events` and bump the contract major (the
   response shape changes; clients pinned to 1.x keep the old shape through
   a deprecation window). "Events" still describes it well enough, and a
   rename costs every connected client a re-fetch for no reader benefit.
   *Recommend: keep the name; 2.0.0.*

2. **What "since your cursor" means.** The window has to partition exactly
   across reads (no happening lost, none shown twice) and it has to be about
   *what the record learned*, not what the clock says. Battles arrive late
   (a log rolled, captured on the next poll); backfills arrive very late.
   *Recommend:* the window predicate is a commit-time column (add
   `admitted_at default now()` where a table lacks one, or the ledger's
   `event_id` for happenings), never `battle_time` or a collector's
   `fetched_at`; battles played inside the window count in the story;
   battles admitted in the window but played more than 24 hours before
   `from` are reported once as `late_captures: n` and not narrated. A test
   pins the partition: two abutting reads over a scratch record with
   concurrent admissions never lose or duplicate a happening.

3. **First read, no cursor.** Today's advice is "start from the newest
   event". With synthesis there is a better answer. *Recommend:* default
   `from` is 24 hours ago; `since` also accepts an instant so a routine can
   ask for "the last week" once; windows are capped at 30 days with
   `applied.window` saying so.

4. **Subjects with nothing to say.** A silent friend is information. A
   silent member of a clan is already in the clan entry's `presence`.
   *Recommend:* no entry for a quiet player subject, but the response carries
   `quiet: [{tag, name, days_since_battle, days_since_poll}]` for player
   subjects with nothing in the window, so silence is visible without a row
   per silent friend.

5. **Who is a subject.** A person: every claim with notify on (primary,
   alts, friends, watching) as player entries, every added clan as a clan
   entry. An agent: its clan(s) as clan entries, plus any player it tracks
   explicitly. **Members of an agent's clan are not subjects** (Part I §0.3);
   they appear inside the clan entry. *Ruled in principle by the 2026-09-08
   frame ("agents get the clan's players and nothing beyond"); the change
   is that "get" now means "inside the clan entry", not "as rows".*

6. **Entries are shaped by subject kind, never by account kind.** A person
   who adds a clan gets the same clan entry an agent does; an agent that
   tracks a player gets the same player entry a person does. Account kind
   only decides the default subject set. *Recommend as stated.*

7. **Scope-aware clan entries.** An activity-scope clan has no member
   battles of its own. *Recommend:* its entry carries `scope` and omits
   `activity.battles`, `standouts.most_battles` and `presence.quiet`
   (or marks them `basis: "incidental"`); `never_recorded` is not reported
   for activity scope at all.

8. **Thresholds that are disclosed, not judged.** The only thresholds in an
   entry are rungs a reader can see: quiet crossings at 5/10/20 recorded
   days (guarded by `days_since_poll`), trophy bests at 500-bands,
   collection level at multiples of 5, career wins at thousands, card
   moments at maxed/evolution/form. *Recommend these numbers; they are
   data in one table, changeable without a code path.*

9. **Bounds.** Roster lists ≤ 20 with `more: n`; standouts ≤ 5 per list;
   badges ≤ 5 named; the existing `MCP_RESULT_MAX_CHARS` mirror applies.
   *Recommend as stated.*

10. **The ledger writes.** Every named happening becomes one
    `player_event`/`clan_event` row at the emitter (badge level with name,
    arena from/to, best-trophies band, collection level, card maxed /
    evolution / form, PoL promotion with league, race finished, week
    resolved with fame and rank, role change with prev/new/direction, leave
    with role). One write, no fan-out. Aggregates (battles, activity,
    donations) come from the record. *Recommend as stated; this is the
    design's own §13 restored.*

11. **What retires, and when.** `event_feed`, the coalescing CTE, the
    30-day sweep, the `clan_pulse` job and EventBridge rule, `war_day_open`
    and the `TOPIC_CONTRACTS` audience table. The account stream stays as
    addressed rows. *Recommend:* ship 2.0.0 with the old shape served to
    1.x contract pins for one window (the routine recipe on the Events page
    is the known consumer), then remove.

12. **The console's Activity page is the human surface.** It reads
    `event_feed` today. *Recommend:* it renders the same entries through
    `web-api`, summary line first; that is where "a person should be able to
    read it" gets tested every day.

13. **Cost and cache.** A clan entry is the pulse's query set, seconds per
    clan today. *Recommend:* measure with the existing Server-Timing and
    EMF before deciding on a cache; if needed, cache per (clan, quarter
    hour) building blocks, never the reader-shaped entry.

14. **`events_pending` and `game_clock`.** `events_pending` becomes "any
    subject of yours admitted since your cursor", one indexed lookup;
    honest, and for an active clan usually true. `game_clock` gains
    `next_war_day_opens_at`, `war_day_closes_at`, `week_ends_at`,
    `next_training_starts_at` so a reader can schedule itself (Part I
    §Tier 2.7). *Recommend as stated.*

15. **Docs and examples.** The Events page is rewritten around entries;
    the agents recipe drops `topics` and keeps "own cursor, never mark" for
    a second consumer; the examples are regenerated from the live door
    (never invented); `CLAN-PULSE.md` is archived as superseded.

## 14. Does it hold regardless of the consumer's goals?

The claim to validate: one shape serves any reader without knowing what
the reader is for. Checked against the consumers we can name.

| consumer | what it reads from the same entry | gap |
|---|---|---|
| clan-management routine | `roster`, `presence`, `war`, `activity` | none; the nudge moment is its own schedule off `game_clock` |
| hype / highlights bot for a clan Discord | `standouts`, `notables`, badges, bests, promotions | none; names are in the entry |
| recruiter / churn watcher | `roster` with timestamps and tenure, `size` | a purge is visible as many leaves at one instant; no judgment needed |
| war-only agent | `war` section; `sections: ["war"]` trims the wire | none; it never sees a clock row |
| a person watching friends | player entries, `quiet` list, summary lines | none; this is the primary human use |
| a personal coach for one player | player entry's battles by mode, W-L, bests; drills with `battles_performance` | the entry is the wake, the tools are the analysis, as designed |
| a leader reading the console Activity page | the same summary lines | none, once the console renders entries (§13.12) |
| an analyst wanting raw happenings | **not the feed**: `players_timeline`, `clans_roster.recent_events`, the ledger via tools | deliberate; the feed is a notification surface, not a firehose |
| an integration (headless, no "me") | none (excluded today) | unchanged |

What makes it robust rather than merely broad:

- **Completeness is structural.** Every section is always present; a reader
  never has to learn which keys appear when. Silence is a `null`, not an
  absence.
- **Neutrality is checkable.** Every threshold is a disclosed rung; every
  moment fact carries `as_of`; every window is echoed. There is no field a
  reader could mistake for advice. A test can assert no entry ever contains
  a verb of instruction.
- **The clock is never inside.** Nothing in an entry says what day it is;
  a reader that cares asks `game_clock`.
- **Cost is flat in what happened.** One entry per subject, bounded lists,
  regardless of whether the subject is a maxed veteran or a beginner
  climbing four arenas in a day. The beginner clan that broke the current
  design is one entry with `standouts.arena_promotions: 9`.
- **It degrades honestly.** Activity scope, never-polled members, late
  captures and capped windows all say so in the entry rather than
  silently narrowing it.
- **It reads as prose.** The summary line is the same text a person and an
  agent see; if it is not valuable to a person reading the Activity page,
  it is not valuable to an agent either, and that is testable with fixtures
  before any agent is connected.

The one thing this cannot promise is that a reader wanting sub-minute
notification of a single happening is served; the feed is pull, and the
entry is a summary. That reader polls `war_current` or `clans_roster`
directly, which is cheaper for them and for the service.

## 15. Validation before build

1. **Prototype the synthesizer read-only against the live record** (an ops
   op or a script over the existing read paths, no writes) for two readers:
   Jamie's account and a POAP KINGS agent. Dump seven days of entries at
   three cadences (hourly, daily, weekly). Jamie reads them as a person and
   says whether they are valuable. This is the cheapest possible test of the
   whole premise and it costs no deploy.
2. **Run the same dump for Canadian, ShocK-13, MuUuKaNs and GUERREIROS PT**
   (the four clan shapes in Part I §2) and read those too; if the entry is
   dull for a clan that does not war, or noisy for a clan that hops, fix the
   template before the schema.
3. **Measure the query cost** of a clan entry per window size on the live
   database, with Server-Timing, before choosing a cache.
4. **Then** Tier 4.15: one agent on a foreign clan for a week, reading its
   feed daily, before the old shape is removed.

---

# Part IV — The timeline

Jamie, 2026-09-13 evening, after 2.0.0 shipped: *"I think my choice of
words 'notifications' sent this in an odd direction. A more meaningful word
is 'timeline'. The items in here are a timeline and the agent should be
able to see what is in the timeline, dry-run the unread timeline to
consider things, move its read pointer to the top."* And on battles:
*"individual battles should not be in it, but 'battle sessions' should: a
gap of 30 minutes breaks the session; speaking about sessions would be
natural for players."*

## 16. Two layers, named

- **The timeline** is the stream of things that happened, in order, each
  with an instant and a subject. It is the ledger (`player_event`,
  `clan_event`, `account_event`) plus a few items derived at read time that
  have a moment but no observer (a quiet rung crossed, a return, a battle
  session).
- **The entries** are the summary of the unread span of the timeline, per
  subject, as shipped in 2.0.0.

The read pointer is the account's instant bookmark. *Dry run* is
`mark_read: false`; *move the pointer to the top* is `mark_read: true`;
*see what is in it* is the response. The Discord consumer confirmed the
need the same evening: on 2.0.0 it has to guess whether a window is worth a
post by hunting for objects inside section lists. With items, the answer
is "the unread timeline is non-empty".

## 17. Items

`{ at, subject_tag, subject_name, kind, section, text, facts }`, oldest
first, capped per response with `more`. `section` names the entry section
the item belongs to, so `sections` filters items and entries together.

| kind | subject | source | facts |
|---|---|---|---|
| `battle_session` | player | derived: recorded battles grouped by gaps of 30 minutes or more | started_at, ended_at, battles, won, lost, drawn, by_mode, trophy_net |
| `badge_earned`, `legendary_badge_earned` | player | ledger, written at ingest | name, level |
| `arena_changed` | player | ledger | from, to (ids and names from the arena catalog) |
| `ranked_promotion` | player | ledger | from, to (league names) |
| `best_trophies_band` | player | ledger | best |
| `collection_level_step` | player | ledger | level |
| `career_wins_step` | player | ledger | wins |
| `card_unlocked` | player | ledger | card_id, name, rarity |
| `member_joined`, `member_left`, `member_role_changed` | clan | ledger (exists) | tag, name, role / prev_role, new_role |
| `race_finished` | clan | ledger, written when finish_time first appears | fame, at |
| `week_resolved` | clan | ledger, written when a week's finished_observed_at is first set | season_id, week, fame, rank, trophy_change |
| `quiet_crossed`, `returned` | clan member or player | derived at read time | days_quiet, rung / after_days |
| `feedback_responded`, `recording_started`, `recording_stopped`, `account_tier_changed` | account | `account_event` | as today |

Deliberately not items: individual battles (a session is the unit), card
level-ups (a count in the collection section), progress inside a badge
level, and anything a clock could have told the reader.

For a clan, members' progression moments (badges, arenas, promotions,
bests) ARE items, named, because that is what a highlights routine wants;
the cap keeps a beginner clan's climb bounded, and the entry's standouts
still carry the aggregate.

## 18. Sessions

A session is a run of one player's recorded battles where no two
consecutive battles are more than 30 minutes apart. One item per session,
placed at its start. A session still open at the window end says so. The
player entry's `battles` section gains `sessions` (count) and the clan
entry's `activity` gains `sessions` and `members_with_sessions`.

## 19. The rename

Tool `elixir_timeline` (contract 3.0.0; `elixir_events` removed, no
window). Arguments `from`, `to`, `timezone`, `mark_read`, `sections`,
`verbosity`. Response `{ window, read_to, timeline, entries, quiet,
subjects, next_cursor, has_more, notes, docs, meta }`. `verbosity: compact`
keeps the timeline and each entry's summary and notables; `full` adds the
sections. The console page becomes Timeline and renders the same
response. `meta.events_pending` becomes `meta.timeline_pending`.

## 20. What retires with it

The per-account `event_feed` table, its emitters and coalescing, the
`TOPIC_CONTRACTS` registry, `events_seen_through`, the 30-day prune, and
the old console route. The ledger carries every named happening from
ingest onward; nothing the timeline shows is reconstructed from a table
that forgets.

---

## Appendix — method and limits

- Jamie's feed was read with `since: 0, mark_seen: false, limit: 200` and
  fits one page (105 rows, ids 1 → 2314; the gaps are other accounts' rows).
- Per-player emission rates are the coalesced `count` per topic per UTC day
  on that feed for four players; a proper rate needs the census in Tier 4.14.
- `event_feed` insert/delete totals are cumulative `n_tup_ins` / `n_tup_del`
  from `pg_stat_user_tables` via the `tables` op; the deletes are the
  coalescing CTE's folds (nothing else deletes from the table before the
  30-day sweep, which has not yet run).
- Activity-scope semantics ("roster and war") are taken from the
  `elixir_track_clan` tool description; the pulse code does not branch on
  scope, which is the finding.
- No agent-kind account's feed was readable from this session; §0.3/0.4 are
  derived, and Tier 4.15 is how to make them observed.
- Clan reads are as of 2026-09-13 14:57Z, war day 4 of season 136 week 1.
