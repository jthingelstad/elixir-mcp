# The event feed, judged by the clans it serves — 2026-09-13

**Status:** analysis only. Nothing in product code changed. Jamie's framing:
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
An agent for a 50-member entry clan therefore carries on the order of 250 to
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

**8. The nudge moment is missing.** elixir-bot's most-used war signal is
end-of-day decks remaining. The MCP has `war_day_open` (a day started, ~10:08Z)
and a pulse at 07:00Z that happens to fall three hours before the 10:00Z
close, an accident of scheduling that the payload does not label. For a
US-centric clan 07:00Z is 02:00 Central. The routine recipe tells the agent to
"set an evening follow-up" itself, which is the timer the feed exists to
replace.

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
roster move with WHO (already right); the war-day nudge moment with a count
and who (missing); a member crossing an inactivity threshold, once (missing:
the pulse repeats it); the race finishing (missing: elixir-bot has
`race_finished`); week and season boundaries with the result (the MCP's
`clan_war_week_finished` payload is `{}`; the bot's carries fame, rank,
participation); a member's notable moment, named (present as an unnamed
count). It does not want "someone played".

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
   pulse) reports `race_finished: true` and empties the three lists; the
   pulse's `war` block says the same.
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

7. **`war_day_closing`.** Emitted per clan at a fixed distance before the
   10:00Z close (two fixed marks, 4h and 1h, is enough to start; per-clan
   hour when there is a reason), payload `{war_day, closes_at, untouched,
   partial, finished, participants}` counts only, plus `race_finished`. The
   agent calls `war_current` for the names. This is the single most valuable
   clan signal in the bot's inventory and the one the port left as "set your
   own timer". Add `race_finished` as its own discrete event while there.

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
