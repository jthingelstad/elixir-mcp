# Clan Pulse — clan-management signals for agent routines

**Ratified by Jamie 2026-09-06 ("a good v1") — shipped in contract
0.22.0.**

## The intent

Jamie: *"I should be able to create a Claude routine that looks at
Elixir MCP on a regular basis to assist with clan management
activities."* The roster events just shipped cover membership churn;
this design covers the rest of what a clan-running agent needs —
grounded in what elixir-bot actually does, translated to a multi-tenant
service.

## What elixir-bot watches (the source inventory)

From its management engine and awareness loop:

1. **Inactivity** — days since last recorded battle per member; flat
   5d/8d thresholds with elder-floor grace and open-slot slack; produces
   leader action cards, never auto-kicks.
2. **War-day duty** — per-participant decks remaining *today*
   (`untouched / partial / finished` from decksUsedToday polls unioned
   with recorded war battles); the end-of-day nudge signal.
3. **Roster floor events** — joins, verified leaves, role changes, week
   finished, season closed, podium, clan birthday.
4. **Participation recognition** — who finished all decks, war-champ
   race, elder participation score (war + ranked + donations).
5. **Donations** — the weekly counter.

## Design principles

- **The feed carries signals; the tools carry detail.** An event is
  something worth waking a routine for, compact enough to read in one
  glance. The routine drills with the same tools any agent uses.
- **Facts, never judgments.** The pulse says "quiet 6 days", never
  "kick them". Thresholds beyond the reporting floor live in the
  routine's own prompt — different clans, different cultures.
- **Per added clan, notify-gated.** Everything fans out through
  `account_clan where notify`, like every clan topic today.

## New feed topics

### 1. `clan_pulse` — the daily digest (the headline of this design)

One per added clan per UTC day, emitted ~07:00Z. Payload:

```json
{
  "date": "2026-09-06",
  "battles_24h": 93,
  "members_active_24h": 6,
  "members_total": 46,
  "top_24h": [{ "player_tag": "#...", "name": "Raquaza", "battles": 21 }],
  "quiet": [{ "player_tag": "#...", "name": "...", "days_quiet": 6 }],
  "war": {
    "kind": "war", "war_day": 2,
    "decks_today": { "untouched": 9, "partial": 4, "finished": 12 }
  },
  "roster_changes_24h": { "joined": 1, "left": 0 }
}
```

- `quiet` lists members ≥ 5 recorded-quiet days (elixir-bot's floor),
  capped at 10, sorted by days — with the honest caveat that "quiet"
  means *no recorded battles*, and recording starts differ.
- `top_24h` is capped at 3. `war.decks_today` appears only on war days.

### 2. `war_day_open` — real-time war wake-up

Emitted when a NEW war-day period is first observed (the
`war_period_anchor` insert where `periodInfo(idx).kind === 'war'`,
already the clock's source of truth). Payload: `{season_id, week,
war_day}`. The routine wakes, notes the day, and checks attendance in
the evening.

### Already shipped, unchanged

`member_joined` / `member_left` / `member_role_changed` (real-time),
`clan_war_week_finished` (weekly).

## Tool extension: `war_current.decks_today`

The drill-down half of the war signal. `war_current` gains a
`decks_today` block for the current war day, mirroring elixir-bot's
`_remaining_decks`: counts plus the named lists —
`untouched: [{tag, name}]`, `partial: [...]`, `finished: [...]` —
computed from `war_attendance_day` unioned with recorded war battles
(the round-3 lesson: polls alone undercount). Only present on war days.

## Mechanism

- **Daily pulse**: EventBridge rule (07:00 UTC) invokes the migrate
  lambda with `{clan_pulse: true}` — it computes one digest per clan
  present in `account_clan` and inserts feed rows via the standard
  fan-out. Idempotent: a clan that already has a `clan_pulse` event
  today is skipped (safe to re-invoke by hand).
- **war_day_open**: emitted from the riverrace projector's anchor-insert
  path, post-commit like every emitter, recency-guarded like the weekly
  topic.
- No new tables; no schema change. Contract bump 0.22.0 (new topics +
  war_current field), changelog entry, elixir_events description update.

## The routine recipe (ships in the site docs)

A scheduled Claude session (cron/claude.ai schedule) that:
1. calls `elixir_events` from its saved cursor;
2. on `clan_pulse` — reads the digest; drills with `clans_standings` /
   `battles_trends` if something moved; drafts the leader brief;
3. on `war_day_open` — sets an evening follow-up; later calls
   `war_current` and reads `decks_today.untouched` for the nudge list;
4. on `member_joined/left` — updates its own notes, greets, or flags.

Everything above is facts-in, judgment-in-the-routine — the service
stays observation-only.

## Deliberately out (v1)

Donations leaders and elder-score computation in the pulse (the routine
can derive both from existing tools); per-clan pulse-time configuration;
push beyond the feed (email/webhooks). All revisit-able.
