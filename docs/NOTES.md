# Elixir MCP notes

Working notes and decisions for **the current ISO week**, newest last.

- **What still stands:** `docs/DECISIONS.md`, one line per ratified
  decision and declined idea. Read it before proposing anything; don't
  re-litigate what it lists.
- **Earlier weeks:** `docs/notes/<year>-W<nn>.md`, unchanged. Search by the
  heading date a decision or commit names.
- **Rotation:** the first entry of a new ISO week moves the previous week's
  entries into `docs/notes/<year>-W<nn>.md` verbatim. A ratified decision
  also gets its line in `DECISIONS.md` in the same commit that records it.

Queued manual steps for Jamie still live in the entry that raised them.

---

## 2026-09-28 - #44: the catalog's tower troops are the current /cards list

`cards_catalog` answered five tower troops against the official four:
`29000000` "Archer Queen", beside the real Archer Queen `26000072`.

- **Where it came from: import drift, not game truth.** Every archived
  `/cards` payload (9, 2026-05-20 to 2026-09-16) lists the same four
  `supportItems`. A full read of the archive's 114,947 battle logs and
  62,062 profiles on 2026-09-28 found `29000000` in none of them. The
  card row's first sighting, 2026-05-28 22:20:24Z, matches elixir-bot's
  `tests/test_cr_api.py::test_get_cards_success`. That test mocks a
  `/cards` response of `{"items": [Knight], "supportItems": [{"name":
  "Archer Queen", "id": 29000000}]}`, and the mock leaked into the bot's
  raw payload table the same day as the two test stubs admission
  refused in the 2026-09-15 replay (W38 notes). The replay admitted this
  one as a catalog fetch. Its content hash was already held from the
  09-03 import, so it never reached the S3 archive, and the projector,
  which heals and fills from a fetch of any age, inserted the row as
  confirmed. Nothing goes to cr-agent-api-docs: the API never sent it.
  elixir-bot is retired, so its test stays as it is.
- **The fix (0191).** `card.in_catalog` is what the newest admitted
  `/cards` fetch lists. Only a fetch at least as new as
  `poll_state`'s last admission moves it, and only rows whose membership
  changed are written, so an unchanged re-fetch still writes nothing. A
  replayed or delayed older fetch still fills and heals rows but lists
  nothing. A payload without `supportItems` says nothing about tower
  troops. `cards_catalog.tower_troops` (and the `cards` resource) serve
  `kind = 'support' and in_catalog`. Rows never leave: `deck_sets` still
  pools every support id, and `cards_card` still answers `29000000` by id.
  The fill lists every confirmed row except those confirmed only by a
  `backfill-elixir-bot` receipt at the same instant; the next daily
  fetch corrects any it reads wrong. The fill was checked on sample rows
  on a scratch database.
- The `cards` list keeps its behaviour: a release-day stub still shows
  until the catalog heals it, which the ingest rule "Ingest never pauses
  on catalog integrity" wants. Only tower troops were filtered.
- Tests: `services/mcp/test/catalog-tower-troops.test.mjs`, five cases:
  the replayed leak, a battle stub, later confirmation, removal with the
  row kept and a stale fetch ignored, and a payload without
  `supportItems`. All five fail with the read filter removed.
- Contract 9.12.5 (behaviour patch; `cards_catalog` is mirrored by no
  JSON API operation). Deploy scope: `--acceptance=cards`.
- **Deployed 9.12.5** (PR #103, `115a10ff`) with `--acceptance=cards`.
  Migration 0191 ran (190 applied, 1 ran) and smoke passed. Acceptance
  ran 118 cases with 0 failed, so no verdicts were needed. Read back at
  04:18Z on 09-28 (11:18 PM CT on 09-27): `tower_troops` lists the four,
  and `29000000` is gone. The fill had already left it unlisted, which
  confirms that only a `backfill-elixir-bot` receipt confirmed it.
- **9.12.6: the same rule for `cards`.** The read-back found 134 cards
  against the official 123. All 11 extra rows are battle stubs with no
  rarity or cost: Super Witch, Super Lava Hound, Super Magic Archer,
  Super Ice Golem, Super Archers, Terry, Super Mini P.E.K.K.A, Super
  Knight, Barbarian Launcher, Party Hut and Party Rocket. These are
  event-only cards that `/cards` never lists. The issue's acceptance is
  123 and 4, so `readCatalog` now serves listed rows only for both
  lists (and `as_of`). The site's card pages already skipped cards with
  no cost or icon, so no page changes, and `/api/public/cards/<id>`
  still answers any card by id. The earlier line saying `cards` keeps
  its behaviour is superseded. A sixth test covers an event-only card.
  Contract 9.12.6, `--acceptance=cards`.
- **Deployed 9.12.6** (PR #104, `2b7f1761`) with `--acceptance=cards`.
  No migration was pending, smoke passed, and acceptance ran 118 cases
  with 0 failed. Read back at 04:33Z on 09-28 (11:33 PM CT on 09-27):
  - `elixir_changelog` since 9.12.4 lists 9.12.5 and 9.12.6;
  - `/tools.json` shows contract 9.12.6;
  - `/api/public/cards` (a CloudFront miss after the invalidation) has
    123 cards;
  - `cards_catalog` lists four tower troops, and a "super" query finds
    no card;
  - `/updates/2026-09-28-contract-9-12-6/` returns 200;
  - `health.ok` is true.
- Pending, for a natural event: the next daily `/cards` admission,
  about 15:37Z (10:37 AM CT), is the first live run of the membership
  update. It should move no row while the catalog is unchanged.

## 2026-09-28 - #43: console journeys cover the timeline's read case

- Re-verified against `c246a839`. The failure the issue names (the rail's
  unread dot read from `signals.events_unseen`, no `GET /api/me/timeline`
  fixture, an Activity heading of "Notifications") was repaired on
  2026-09-14 in `b508eaf0`, and later journeys moved with the timeline
  (`3980bb31`, its own rail item). `validate` has been green on main
  since. The issue's `App.jsx:1035` is now `App.jsx:1388`.
- What was still missing was the issue's second case: the journeys had
  only the unread one. A new journey serves `timeline_pending: 0` and a
  `read_to` at the item's time. It checks that the rail has no dot and
  that the row says `read`, not `unread`. It then reloads onto an empty
  week and checks the empty line and still no dot. Reverting the fixture
  to `timeline_pending: 1` makes it fail on the dot. The fixture comment
  now says the dot is on Timeline. Ten journeys pass locally.
- Tests only: nothing the site, console or a tool serves changed. So
  there is no contract bump and no deploy, because the built tree is the
  same. The issue asked for no live read.

## 2026-09-28 — Run Elixir MCP: acceptance distinguishes an active war from a missed finish

At 09:48Z the public status was healthy: 967 battles in the prior hour,
37-second fetch and admission freshness, zero dead jobs and dead letters, and
five fresh signed v3.0.6 collectors. `{stats: true}` recorded 740
battle-log polls with zero current-hour gaps; the scheduled efficiency,
activity, meta-rollup and archetype jobs all completed on schedule. No Elixir
alarm was in ALARM; RDS held about 671 MiB freeable memory, 16 MiB swap and
99.5% EBS byte balance.

The day's one read-only `npm run acceptance` pass found two related identity
failures on the current regular war week: the server correctly served
`in_progress: true` with `finished_early: null`, while the acceptance checks
treated its live fame and recorded finish-day detail as a closed-week result.
The checks now exclude an active row from the line-reached implication and
require `finished_early === false` before asserting no finish day. A local
regression test covers the active, finished, and closed-without-finish rows.
This is harness-only: no product contract, deployment, or second live
acceptance run is owed.

Preview check: all three Discord containers were up for 33 hours, but the POAP
KINGS editor routine retried every five minutes after its Claude workspace API
limit was reached (reset stated as 2026-10-01T00:00Z). The service remained up
and its event cursor was not replayed, but the retry cadence is an operational
gap in the Discord preview; it needs a failure-specific cooldown there, not a
restart or an early routine run.

## 2026-09-28 - Lane B of the 2026-09-27 review, decided

The lane A queue closed: #62-#73, #44 and #43 are deployed and read
back. Jamie has some non-blocking follow-ups, recorded in those issues'
closing comments. Before the revisit, each lane B feature was checked
against current `main` (7de2000): one agent per feature built a decision
card, and a skeptic challenged it. All six cards held. Jamie's answers:

- **Yes:**
  - **#46** (historical clan roles on `clans_participation`, for Elixir
    Clan's replay). The build plan is in the issue's 2026-09-28 comment.
  - **#110** (a `card_form_unlocked` moment, going forward only).
  - **#111** (stable timeline item ids). Jamie: "meaningful to the
    discord bots as well as Claude using the MCP … how you tell stories
    as an agent using the MCP is weak now." The id names the story, and
    a revision marks its growth.
- **Fixes, joining the queue as lane A:**
  - **#108:** `battles_compare` never attached the completeness note.
  - **#109:** event classification.
- **Parked in lane D, each with its trigger:** gaps as a precise
  control; the event as a population (`group_by: "event"`, an
  `event_tag` filter); card history `changes[]`; the supported-clients
  matrix.

**Mode ruling (Jamie, 2026-09-28).** DECISIONS 18 said `clanMate` and
`unknown` battles are casual everywhere, while 75, and `modeGroupOf`,
made every tagged battle event content. Two measurements forced the
question:

- 62% of clanmate friendlies carry an event tag;
- a player's 56 Royale Shuffle battles are type `unknown` with a tag.

Jamie, with a screenshot of the game's Game Modes list showing Royale
Shuffle and the Royale Shuffle Challenge as timed events: "those shuffle
battles are clearly events … Clan mate battles would typically be
casual." DECISIONS 18 and 75 now say it:

- a clanmate battle (`clanMate`, `clanMate2v2`) is casual even when
  tagged;
- an `unknown` battle is event content when tagged, and casual when not.

#109 carries the code, including any re-derivation of stored mode
groups.

**Also raised: agent storytelling.** Jamie finds how agents tell stories
through Elixir weak. #111 is one piece. A focused look, for example a
Gym journey that asks an agent to tell a player's or a clan's week and
judges the result, is a candidate after lane C.

## 2026-09-28 - #108 (A13): `battles_compare` carries the completeness note

`battles_compare` built its meta with bare `responseMeta`, so the capture
control `battles_performance` and `battles_query` attach through
`buildMeta` never reached a comparison ("Every aggregate ships its
control"). The gate (window ends inside seven days, player tag, newest
profile interval under 0.9 or unknown with a tail over 48 hours) moved
out of `buildMeta` into `completenessNotes(db, tags, windowTo)` in
`tools/shared.mjs`; `buildMeta` calls it with one tag and
`battles_compare` with its compared tags. One sentence per incomplete
side, each naming its tag, in the order asked, a repeated tag read once;
no incomplete side, no note. `meta.completeness_note` stays a string, so
no output-schema change: contract 9.12.7, a patch. `battles_compare` has
no `/api/v1` mirror. Test: `services/mcp/test/coverage.test.mjs`
(gapped + complete, unknown + gapped, complete twice, an old window).
Out of scope, parked in lane D: gap intervals as a precise control.

**9.12.7 shipped** (293490bc, PR #114), `--acceptance=battles` as the
issue asked (the `buildMeta` edit only moved its gate into
`completenessNotes`, no new query for a single subject); smoke green,
migrations ran 0. Acceptance: 197 cases, 3 failed, every
`battles_compare` case passed. Verdicts, each re-run alone:

- `catalogue/battles_meta_cards#1` (15.4 s): 3.8 s alone, a cold read.
- `budgets/meta-cards-corpus-week` (16.0 s, 16.0 s alone) and
  `catalogue/battles_trends#1` (10.2 s, 4.3 s alone): the open
  first-call slow-seed item (9.11.1, 9.12.0, 9.12.2); neither tool
  changed.

Read-back 13:28Z (8:28 AM CT), reads only: `/api/public/status` `ok:
true`; `elixir_changelog({since: "9.12.6"})` answers 9.12.7 and
`meta.contract_version` is 9.12.7. `battles_compare` over two sets of
four recorded players (King Thing, thingles, King Levy, raquaza; Ditaka,
pokemon, Vijay, OllieTurtle), last seven days, carries no
`completeness_note`, and `battles_performance` shows none for any of
them or for six more watched players: no side is incomplete today, so
the note showing when one is rests on the scratch test until a natural
gap.

## 2026-09-28 - #109 (A14): event classification

Jamie's mode ruling (the lane B entry above) reaches the code.
`modeGroupOf` and `modeGroupSql` checked the tag before the type, so a
tagged `clanMate`/`clanMate2v2` battle was `event`. Now
`isEventContent` / `eventContentSql` in `packages/contracts/src/modes.ts`
say "tagged, and not a clanmate's", and both folds, the battle tools'
`modeClause`, `participantModeClause` and `battles_opponents` use it. A
tagged `unknown` was already `event` and stays so. Tests:
`services/mcp/test/mode-groups.test.mjs` pins JS = SQL for every type
tagged and untagged, every `mode` filter = the fold, the daily rollup,
and the per-event rows; `record-to-wire.test.mjs` now expects the
fixture's tagged clanMate2v2 under `casual`.

- **`group_by: game_mode`** keys rows by `(game_mode, type, event_tag)`
  with `event_tag` only on event content, and `event_title` from
  `game_event` (null when never sighted). `EVENT_POOL_NOTE` names that
  view and is not attached to it. Out of scope, parked in lane D:
  `group_by: "event"` and an `event_tag` filter.
- **Stored groups.** Only `player_daily_battle_rollup` stores a group per
  battle. The meta tables never held a tagged battle: `META_POPULATION`
  and `metaPopulationClause` test `event_tag is null`, not the group, so
  a tagged clanmate friendly (casual now) stays out of the meta, as it
  was. That keeps DECISIONS 76's reason (a deck under an event's rules
  describes the event); it is noted in the code and in battles.md. If
  Jamie wants tagged friendlies in the casual meta, it is one clause
  plus a season re-derive. The rollup rows are re-derived by a new op,
  `{rollup_regroup}` (census, then batches to `done`), after the deploy.
- **Docs:** battles.md's `mode_group` row, the mode-group table, the
  event section (the note never named the pooled tags; it now points at
  the per-event view) and the meta section; the tool-change checklist's
  event-pool pointer named `invoker.mjs`, and the note lives in
  `tools.mjs`.
- Contract 9.12.8, a patch (behaviour correction; `by_mode` items
  declared). `battles_query` is the JSON API mirror: its rows'
  `mode_group` values change, its shape does not.

### Deployed and read back

- **Deploy.** PR #116 (`80db167e`, `cd40e3ac`), stack updated
  13:58Z (8:58 AM CT), full acceptance (`modes.ts` is shared);
  migrations applied 191, ran 0.
- **`{rollup_regroup}`.** Census: 3,094 tagged clanmate battles, 2,374
  event pairs misfiled. Two runs to `done` (282 + 93 batches), 2,374
  pairs recomputed, 6,844 participant-battles refiled from `event` to
  `casual`; census after: 0. `{vacuum}` refused the table (not on its
  allowlist); at this size autovacuum absorbs it, and ops.md and the op's
  comment now say so. The op is ready to retire with the next migrate
  change.
- **Acceptance, 1188 cases, 17 failed**, each triaged:
  - gym/157.3 (standings casual 11 vs `battles_query` 15 for #VGC22YGP):
    the rollup had not been regrouped yet; passes after the op.
  - gym/187.4 (event 283 vs 287): amended for the ruling, the week's
    four tagged clanMate2v2 friendlies are casual now.
  - gym/188.1, 188.2 (`/[Ee]vent battles/`): amended to `/[Ee]vent tag/`;
    the outside-meta disclosure names the tag, because the meta leaves
    out every tagged battle and that is no longer "event battles". The
    bites carry no such note, so both still fail on them.
  - gym/285.2, 304.1: live cases; pass alone.
  - gym/289.3, 337.1, 343.2: live cases whose world moved, as at 9.12.2
    and 9.12.7; not this change's tools.
  - budgets/meta-cards-corpus-week, catalogue/battles_meta_cards#1,
    catalogue/battles_trends#1, catalogue/badges_rarity#1: the open
    timing items (badges_rarity 4.6 s alone, trends 9.6 s alone, as at
    9.12.7).
  - catalogue/cards_archetype#docs, elixir_collectors#docs,
    elixir_timeline#docs, war_history#notes: rare fields absent from this
    run.
- **Read-back.** `elixir_changelog` since 9.12.7 lists 9.12.8 and
  `contract_version` is 9.12.8. #VGC22YGP, 2026-09-07 to 09-21, `group_by:
  game_mode`: 2v2 League and Seasonal Trophy Road are separate titled
  rows, and the clanMate2v2 rows carry no event tag. #C920YGLC2, from
  09-21, `mode: event`: Royale Shuffle (`unknown`, #2C9J8QUU) rows under
  event, one per mode, each holding one event tag. `/tools.json` carries
  `event_title`, and `/updates` lists the entry.
- **Pending natural check:** the next day's ingest writes new tagged
  clanmate friendlies to `casual` (census stays 0).

## 2026-09-28 - #46: participation replays a past war finish (9.13.0)

`clans_participation` now carries each member's `in_clan_at_war_finish`
and `role_at_war_finish` aligned to `war_weeks`, `role_changes` at full
verbosity, the clan's `role_history_since`, and `former_members`. The
rebuild (`services/mcp/src/role-history.mjs`) reads the membership
intervals and `role_changed` events at the clan's roster reads on either
side of each finish and serves a value only when the two agree; imported
tenure carries no roles, so role history starts at the first live roster
read. JSON API 2.7.0 mirrors it. PR #118.

### Deployed and read back

- **Census** (`{role_history_census}`, new): 0 inverted event windows, 0
  `role_changed` rows out of admission order, 0 memberships whose leave
  does not follow the join; 183 per-player chain breaks and 14 flip-flops
  inside an hour across all clans (the rebuild checks the chain per
  membership interval and serves null where it breaks); 637 clan receipts
  in 30 days admitted after a newer read, all in one clan.
- **Size and time.** The recorded clan at weeks 8: compact 47,032 bytes,
  373 ms warm (17 former members); full 52,113 characters, over the
  48,000 cap, so it answers `result_too_large` naming `weeks` and
  `verbosity`. Filed as known for the two catalogue sets until 2026-10-26.
  Compact has about 1,000 characters of headroom: a few more departures in
  the window push it over too. The JSON API operation has no cap.
- **Acceptance (`--acceptance=clans`), 132 cases, 3 failed:** the two
  catalogue sets above, and gym/337.1 (a live case on a clan that is no
  longer recorded; not this change).
- **Read-back** (weeks 3 compact): contract 9.13.0; the two members
  promoted on 2026-09-15 read `member` at the 136/0 finish and `elder` at
  136/1; a member who left on 09-19 and rejoined on 09-23 reads not in the
  clan at the 136/1 finish; five departures are under `former_members`.
- **Pending natural check:** the next finish (136/2's is still unobserved)
  fills its column once a roster read follows it.

## 2026-09-28 - #110: Evolution and Hero unlocks are moments (9.14.0)

Lane B, approved in the revisit: only the form-unlock moment; card history
`changes[]` stays parked (lane D). The collection projector's prior CTE now
reads `evolution_level`, and each form bit newly set (new & ~prior; 1
Evolution, 2 Hero) emits `card_form_unlocked` `{card_id, form}`, behind the
`moments` flag and silent on a player's first observation. The form rides
as its bit in `player_event.step` (no new column); 0192 replaces
`player_event_type_check` NOT VALID and 0193 validates it. Going forward
only, no backfill (Jamie, 2026-09-11). Surfaces: a `collection` item on
`elixir_timeline` ("unlocked Hero Valkyrie") and in `kinds`, a player
entry's `collection.forms_unlocked` (a form unlock alone makes an entry,
not a `quiet` line), the milestone mail (key `form:<card_id>:<form>`, rank
2) and the tracking mail. Timing: `at` is the read that saw it, "no later
than"; no earlier bound is served, because collectors skip an unchanged
profile and the record's previous read is only a loose lower bound (the
issue's `observed_after` names no served field; the docs say it of `at`).
The console renders the server's text, so it needed an e2e case only.

### Deployed and read back

- **Deploy:** 419734fa (PR #120), stack updated 15:32Z (10:32 AM CT);
  migrations 0192 and 0193 ran (191 already applied).
- **Acceptance (`--acceptance=players,elixir`, the issue's scope), 342
  cases: 316 ok, 18 skipped, 7 known, 1 failed.** gym/289.3 (players_profile
  on #20JJJ2CCRU asserting the "no YearsPlayed badge" note): not this
  change; the account turned one year old (YearsPlayed level 1,
  `account_age_days` 366, profile read 13:27Z), so the note's condition no
  longer holds. Verdict: amended with a `when` on
  `attributes.years_played` null, and 289.5 checks the held-badge branch
  (note absent); both re-run alone: 289.3 skipped, 289.5 ok. Also allowed
  `card_form_unlocked` for the docs catalogue rule, a kind a run's window
  may not hold.
- **Read-back:** `/api/public/status` ok; `/tools.json` 9.14.0;
  `elixir_changelog(since 9.13.0)` serves the 9.14.0 entry;
  `elixir_timeline` accepts `kinds: ["card_form_unlocked"]` (none yet in
  the last day) and carries the ledger-start note; `/docs/timeline/`
  documents the kind; `/updates/2026-09-28-contract-9-14-0/` answers 200.
- **Pending natural check:** the next form unlock on a recorded player
  appears as a `card_form_unlocked` item (and a milestone mail when it is
  Jamie's own or an alt's).

## 2026-09-28 - #111: every timeline item is a story, with an id and a revision (9.15.0)

Lane B, approved in the revisit for storytelling, not only dedupe (Jamie:
"how you tell stories as an agent using the MCP is weak now"). Every
`elixir_timeline` item (and `/api/me/timeline`, which spreads the same
build) carries `id`, the story, and `revision`, how far it has grown,
assigned in `buildTimeline` after the dedupe. The id is `tl_` plus 20 hex
of a sha256 over a namespace and the parts that name the happening; it
names the happening, not the reader, so a member's moment has one id on
the clan's timeline and on the player's own.

- **Ledger moments and attested facts:** the ledger's name plus the row
  id (`player_event`, `clan_event`, `account_event`, `attested_fact`), so
  sequences never collide and none is served raw. A duplicated row (the
  09-14 re-emits, feedback #48) takes the lowest identical row's id:
  `firstEventIds` looks back one day on the window index for a row with
  every typed column equal (a roster move also at the same instant), and
  the in-read collapse keeps the lower of the two. `accountItems` selects
  `event_id` now. Revision 1.
- **Sittings** (`battle_session`, `session_standout` are one story): the
  player's tag and the sitting's first battle, found by a bounded
  recursive walk back (200 steps) while the gap stays under 30 minutes,
  over the player's own battles as the timeline counts them (no boat
  defense, no late capture). Revision: the sitting's battles counted from
  that first battle through the item's last battle; a standout's, through
  the last rung the window learned, so a new rung raises it and a wider
  read of the same rungs does not. Both are in battles, so the two kinds
  of one id compare.
- **Derived items:** `returned` (player, instant), `quiet_crossed`
  (player, rung, instant), `clan_joined`/`clan_left` (player, clan,
  instant); anything unnamed falls back to a hash of its dedupe key (none
  today).
- The member-read note says update on a higher revision, where it said
  keep the newest per kind and `started_at`; the general note states the
  rule; `timeline.md` has the item field table (with `observed_at`, which
  was missing) and "Telling the story". Output schema: `id`, `revision`
  required on items. The tool description is at 599 of 600 characters,
  so the rule rides the notes and the schema.
- **Limits, stated:** an id hashes public parts without a secret, so a
  reader who knows a subject could test guesses at a ledger row id; it
  hides volume and order from a casual reader, which is what the issue
  asked. A genuine repeat of an identical ledger moment within a day (an
  arena bounce with no crossing battle on record) shares the first's id,
  as the read-time dedupe already serves it once. Seen while here, not
  changed: the clan path's member battle fetch does not exclude boat
  defenses, which the player path does (0171).

Tests (scratch database, `timeline-tool.test.mjs`): one sitting through
two overlapping windows has one id (revision 3, then 6); a standout
crossing 20 then 40 battles keeps its id at revision 20 then 40, and the
member's session shares it; a duplicated promotion keeps the lowest row's
id in a window holding either row; one sequence number in three ledgers
gives three ids, none showing the number. MCP 9.15.0, additive; the JSON
API has no timeline operation.

### Deployed and read back

- **Deploy:** 70f11c61 (PR #122), stack updated by 16:08Z (11:08 AM CT);
  migrations 193 applied, 0 ran.
- **Acceptance (`--acceptance=elixir`, the issue's scope), 188 cases: 3
  failed, 12 skipped, 7 known (the pre-existing presence cases, until
  10-02).** gym/302.1, 302.2 and 321.2 asserted the member-read note's old
  wording ("same started_at"); this change is what made them wrong, since
  the note now says a sitting returns under the same id with a higher
  revision. Verdict: amended to match "same id", with a reason; 302.3 (the
  control) amended the same way. All four re-run alone against live: ok.
- **Read-back:** `/api/public/status` ok; `/tools.json` 9.15.0;
  `elixir_changelog(since 9.14.0)` serves the 9.15.0 entry;
  `/docs/timeline/` carries "Telling the story";
  `/updates/2026-09-28-contract-9-15-0/` answers 200. Two overlapping dry
  reads (`days: 1` and `days: 2`, 16:10Z) served every item of the shorter
  window under the same id and revision in the longer one. Tyler's sitting,
  cut at the one-day window's edge (8 battles from 15:56Z), came back whole
  in the two-day read (11 battles from 15:49Z) under one id at revision 11.
  A standout and its session shared an id (Vijay's 43-battle sitting:
  standout revision 40, session 43).
- **Pending natural check:** a live sitting that grows between two reads
  keeps its id and raises its revision.

## 2026-09-28: the agent's participation read fits the cap (#124, 9.16.0)

Jamie decided the size question #46 left open: slim the agent (MCP) read
of `clans_participation` rather than accept the priced refusal. Before,
measured with `{profile_tool}` on the recorded clan (44 members, 17 who
left, 8 weeks, 9 war weeks): full **51,875** characters (refused), compact
**47,044** (956 under the cap).

**Where the characters went (compact):** member rows 30.7k, of which the
repeated keys were 13.2k and `in_clan_at_war_finish` + `role_at_war_finish`
6.7k; former-member rows 9.0k (keys 3.5k, place 2.5k); header, notes and
meta 7.3k. Full adds `war_points` (about 2.9k), `role_changes` (1.3k) and
two notes.

**What changed (MCP only; lossless):** the rows of `members` and
`former_members` are arrays named once by `columns.members` and
`columns.former_members`; an instant on a whole second drops `.000`; and
the two place columns are one, `place_at_war_finish` (the role where
known, else `true`/`false` presence, else `null`), which reads back
exactly because a role is only ever known for a member in the clan
(`role-history.mjs`). The invoker now passes the door (`surface`) to a
tool's context; the handler lays out the table when it is `mcp`.
`participation-table.mjs` holds the codec both ways. `/api/v1` and the
console keep object rows; the shared output schema admits both (rows
`anyOf` an array or the object), which moved the JSON API pin: 2.7.1, no
response change. The acceptance door and the replay door decode the table
to the objects, so every Gym case reads rows by name as before, and the
contract check reads the raw table (notes may name column names).

**Budget test** (`participation-size.test.mjs`): a 50-member clan with 20
departures, eight weeks of battles, donations and war, roles known at
every finish, a third of the members promoted inside the window and nine
joiners mid-window. Its object rows are 62,791 (full) and 54,910
(compact) characters; the agent's table 38,760 and 32,783, under the
40,000 budget the test pins, and the table decodes to exactly the
`/api/v1` rows.

Contract 9.16.0 (a minor: `columns` and `place_at_war_finish` are new;
the reshaping is wire cleanup, stated in `breaking`); JSON API 2.7.1.

**Fix forward, 9.16.1.** The first deploy of 9.16.0 (6b2392f0, PR #125)
laid out the table only when the door was `mcp`; a service token's MCP
calls audit as `svc:<name>` (`handler.mjs`), so the acceptance agent (a
service token) still read object rows: `contracts/clans_participation`
failed (`columns.members missing`) and the eight-week full catalogue cases
still refused at 52,121. The handler now treats `svc:*` as the MCP door
too, and the budget test reads through a `svc:` invoker as well.

Triage, the 9.16.1 deploy (`--acceptance=clans`): `contracts/clans_participation`
and the eight-week full catalogue cases (#0, #1) now pass, so their
known.json entries are removed. `catalogue/clans_participation#notes` and
`#docs` failed because the catalogue compares the notes with the values
it saw, and it saw the decoded objects, which have no
`place_at_war_finish`; both now walk the raw table the door returned too
(acceptance-only, no deploy). `gym/337.1` fails as before: clan
#GRJ20LQP is no longer recorded, unrelated to #124 and already noted on
#46.

## 2026-09-28 - #71's queued secret steps: unsubscribe key and session rotation

Jamie added `unsubscribe_secret` and rotated the session secret
(`session_secret_previous` holds the old value) in the console, then
approved the deploy. Both switches went in ONE deploy, because the new
`session_secret` was already in the secret: a deploy with only the
unsubscribe switch would have re-read it without the previous value and
signed everyone out.

- Deployed from main fc66965d at 18:17Z (1:17 PM CT) with
  `--skip-web --param=UnsubscribeKeyInSecret=true
  --param=SessionSecretPreviousInSecret=true --param=SecretEpoch=2026-09-28`.
  Exit 0, migrations ran 0 of 193, stack UPDATE_COMPLETE, smoke green.
- Read-back (names only, no values): the stack holds the three
  parameters; web-api carries `SESSION_SECRET`, `SESSION_SECRET_PREVIOUS`,
  `UNSUBSCRIBE_SECRET` and `SECRET_EPOCH`; mcp carries the two session
  keys; jobs carries `SESSION_SECRET` and `UNSUBSCRIBE_SECRET`. No errors
  on web-api, mcp or jobs since the flip; `/api/public/status` `ok: true`.
- Pending: Jamie's browser signed in before the rotation stays signed in;
  the first mail after the flip carries an unsubscribe link starting
  `t=u1.`.
- **Due on or after 2026-12-27** (90 days, the token cap): deploy with
  `--param=SessionSecretPreviousInSecret=false`, and only after that
  succeeds remove `session_secret_previous` in the console
  (`docs/SECRETS.md`, "Session secret" step 4).

## 2026-09-28 - Lane C of the 2026-09-27 review: the policy pages restate the service

The privacy and terms pages were agent-written early, with little input,
and had grown far broader than a hobby service needs: an inventory found
about four in ten of their promises were never ratified, and several
were stale. Jamie's direction: what the service does is right; the pages
change, not the code. They are now short and plain, framed as a free
service built as a hobby for folks who like the game, name no person
(contact admin@poapkings.com), and stay general enough that they need
not be revisited with every change. DECISIONS carries the line; they
change only with Jamie's word.

- Fonts are self-hosted: Inter's seven per-script variable subsets (OFL,
  licence beside them) ship from `/assets/fonts/` with the Clash face,
  declared in `packages/design/src/tokens.css`. The Google Fonts links
  are gone from both halves; the CSP's `font-src` and `style-src` are
  `'self'` only; the site test no longer admits a Google origin; and
  `build-site.mjs` fails a build whose stylesheet names a file that did
  not ship.
- Filed: #129 (a withdrawn owner's agents still authenticate; no
  `{account_remove}` op; the sign-in token rides the query string), #130
  (verify challenge reads uncapped per tag; milestone mail's fixed 26 h
  lookback; "Issue a new key" after a revoke is refused), and #131 (the
  copy pass bringing the other pages in line, with /consistency).
- Deploy note: the CSP is in `infra/template.yaml` and the fonts are in
  the site, so this wants a normal deploy (stack and site together, no
  `--skip-web`). A page an edge still holds from before may draw in the
  system font until it expires; nothing breaks. No tool changes, so no
  acceptance family.

## 2026-09-28 - #129: a withdrawn person's agents, removal requests, the sign-in link

Found while restating the policy pages: they promise access "can be
withdrawn" and an account removed on request, and three things stood
between those promises and the code.

- **A withdrawn owner's agents are refused.** Both doors
  (`validateAccessToken`, and the service-token select shared by
  `validateServiceToken` and `serviceTokenAccountByName`) read the
  token's own account and joined the owner only for its quota. Now an
  owned principal validates only while its owner is `approved` too, so a
  withdrawal reads as the ordinary not-found, as a suspended agent does,
  and resuming the owner restores the same keys. `describeRefusedCredential`
  names the refusal `principal_suspended`, not `wrong_door`. Test:
  `services/auth/test/oauth.test.mjs`, failing before the change.
  Integrations have owners too and follow the same rule.
- **Collectors are NOT tied to the owner's status** (unchanged). Whether
  a withdrawal should also drain the person's collectors, or leave them
  to the existing collector revoke, is Jamie's call; asked on #129.
- **`{account_remove}`** (`services/migrate/src/ops-account-remove.mjs`,
  catalogued in the ops skill): dry run by default; by address or
  account id; for the person and every agent they own. Deletes the
  personal rows (listed in the op's comment and ops.md row), stops the
  recordings nobody else wants through `reconcileRecording`, keeps the
  game record and the clan facts the person attested (the op never names
  `attested_fact`: `attested-readers.test.mjs` keeps that table to its
  one reader and one writer), and leaves the account row as an anonymous
  tombstone (`removed:<account_id>`, disabled): a recording's
  `requested_by`, an attested fact's attester and a revoked collector's
  history must point somewhere. Refuses the owner, a non-person, an
  integration's owner, a live collector (revoke first), and a collection
  an integration is granted. Returns `manual`: the Buttondown address,
  and the sent-mail bodies under `mail/sent/` (keys returned; the
  migrate role holds no DeleteObject, so the bodies are deleted by
  hand); call captures expire on their 90-day rule. Running it for real
  is Jamie's, on a person's request (DECISIONS: account-touching write
  ops). Test: `services/migrate/test/ops-account-remove.test.mjs`, a dry
  run and a run against a scratch database.
- **The sign-in link moves to the fragment**, in two steps so no link in
  flight breaks: the console reads `#login_token=` as well as
  `?login_token=` (this PR), the relay then mints the fragment, and one
  link lifetime (15 minutes) later the query form is dropped.
- **Step 1 deployed** 2026-09-28 ~22:02Z (5:02 PM CT) from `00158ef0`
  (PR #133): migrations 193, none new; smoke green; `--acceptance=game`
  87 cases, 0 failed (the acceptance agent's service token, owned by
  the owner, passes the new owner check). The live console bundle reads
  the fragment. The same PR fixed a `participation-size.test.mjs` flake
  (`days_since_battle` stepping between two reads seconds apart).
- **Step 2:** the relay mints `/signin#login_token=` (PR #134).
  Deployed ~22:10Z (5:10 PM CT) from `0af44144`: smoke green, no
  acceptance (no tool changed); the relay function went live 22:09:15Z.
- **Step 3:** the console redeems only `#login_token=`; a stale
  `?login_token=` is scrubbed from the address bar and never redeemed
  (`apps/web/test/url-hygiene.test.js`). Deployed after 22:24:15Z, one
  link lifetime past step 2, so no query-form link was still valid.

## 2026-09-28 - #130: verify read ceiling, milestone lookback, a key after a revoke

Three independent correctness fixes from the review follow-up. No MCP
contract or JSON API change; one migration (0194, a new table).

- **Verify reads have a per-tag daily ceiling.** An open challenge being
  watched asked the live lane every 45 s with no quota hook (about 80
  reads in its hour), and nothing bounded how many challenges one tag
  could collect in a day. `LIVE_READS_PER_TAG_PER_DAY` = 120 in
  `services/web-api/src/routes/verify.mjs`: the sum of `live_reads` over
  every challenge for the tag created in the last 24 hours, whoever
  opened it. Past it, the start and the poll ask nothing, the challenge
  stays open, and the response carries `live_capped: true`, which the
  wizard turns into a note (the check waits for the regular recording).
  The collecting-path profile read is still bounded only by the
  per-hour start limit (5 per tag). Test: `verify.test.mjs`, across a
  re-opened challenge and a second account's challenge, and the reset a
  day later. `/docs/verify` states the number.
- **The milestone window runs from the last clean look.** It read a
  fixed 26 hours ending now, so a failed or skipped stretch longer than
  that lost its moments. 0194 adds `email_milestone_look` (account,
  `looked_at`), stamped when an account's look finishes cleanly
  (nothing new, sent, or already sent; never on a failure, a stop or a
  forced send). The window is 26 hours back from that instant, capped
  at seven days; no row reads the old 26 hours, so the first run after
  the deploy behaves as before. `email_milestone` still decides what is
  news, so the wider window never mails twice. `{account_remove}` deletes
  the new rows. Test: `email-run.test.mjs`, a failed send then two quiet
  days, 52 hours after the moment.
- **Issue a new key after a revoke.** `rotateToken` read the name and
  scope from a live key only and answered `no_active_token`, which the
  console swallowed. It now takes the most recent key, live or revoked,
  and locks the agent's account row so two issues cannot race. The one
  refusal left is `409 name_taken` (a revoked key's name does not hold
  its place, 0056, so another agent may hold it now), with a message the
  console shows beside the button through `useWrite`. Tests:
  `principals.test.mjs` (revoke then issue; the name taken since; a
  stranger's 404), and the e2e journey on an agent's Settings for the
  refused and issued paths.

Ship: stack, jobs, web-api and the site; no acceptance family (no tool
changed).

Shipped in PR #136 (fe391b0f..303a6e0f), deployed with no acceptance
(no tool changed): migrate ran 1 of 194 (0194), stack UPDATE_COMPLETE,
smoke green, site published. Code live 22:42:18Z (5:42 PM CT).
Read-back, reads only: `/api/public/status` `health.ok: true`;
`/docs/verify` states the 120-a-day ceiling, `/docs/agents` the
`409 name_taken`, `/updates` the entry; the rotate route still answers
401 without a session. The first milestone pass on the new code,
23:20Z (6:20 PM CT), logged `recipients` 21, `skipped` 21, `failed` 0,
`ms` 3124 (the look table read and stamped for every account).

Pending (natural events): the first milestone mail sent after a gap
longer than 26 hours; a verification that reaches the ceiling (the
wizard's note), which may never happen in normal use.

## 2026-09-28 - #131: the copy pass after the policy pages were restated

Copy only, no behaviour change: the pages and console copy that still
carried policy-grade promises written against the old privacy and terms
pages now say what the code does, in general terms, and link to
`/docs/privacy` rather than restating it. Each claim below was checked
against the code first. No MCP contract or JSON API change; no What's
new entry (nothing a user would notice as a change in the service).

- **Email** (`email.md`, `EmailPage.jsx`): the footer link is a *turn
  off* link that opens a page with one button (`GET
  /api/email/unsubscribe`); only the mail client's own unsubscribe is one
  click. The written issues' lint checks the numbers against the brief
  (it skips single digits, years and structural numbers), not "every
  number". The counting section is general and no longer points at a
  privacy "bucket two". Elixir Clan's note: the app needs no address to
  mail you (a family app may still be allowed the address at sign-in).
- **Support**: the roster is read often while members play, not every
  15 minutes (`recording.md`'s cadence table); the AI and backups lines
  match the privacy page.
- **Family**: the retired Elixir Agent entry is gone (`/family/agent`
  with it); the Discord bot entry describes the self-hosted
  elixir-mcp-discord; "each reads the hub" is now "where one of ours
  needs the record, it reads the hub". `about.md`'s family line matches.
- **Operators**: the credit opt-out promise is dropped (nothing
  implements it); a quarantine tells the maintainer, not the operator;
  the lifecycle can go back from draining to probation, and a
  quarantine drains automatically.
- **Limits**: the console sign-in limit answers `limited: true` with a
  message (not silent); the query budget lists all nine budgeted tools;
  retention adds what a call-log row keeps for its life and a database
  backups row (7-day RDS retention).
- **Connections, integrations, roles, verify**: the family-client
  definition after 0185; tracking also changes from an agent's tools; a
  JSON API family app shows no calls on Clients (its rows carry no
  `oauth_family_id`); a person's `/api/v1` grant is the other credential
  that door takes; a person's tool operation is logged as the tool call;
  roles' read rule names the attested-fact and account-data exceptions,
  feedback has no limit of its own (an agent's is one tool call), and
  the admin and owner lines match the routes; verify's start limit is per
  account and per player, and verification also gates a family app's
  clan mail.
- **Console**: Explore's "does not crawl" names the leaderboards;
  Profile's timezone and tier notes; Verify's expiry says an hour and the
  same eight cards (it said twenty minutes and a fresh deck);
  SignIn's "the corpus is public" and what approval does with the tag;
  Connections' "all of it spends your daily budget" excepts the family
  apps.
- **Sign-in mail**: the consent line says the client may "act for you as
  you approve on the next page".
- **The trace** (`/consistency` on the new DECISIONS line, one read-only
  reviewer over the pages the issue did not name): `/data/collect` said
  raw payloads are kept about 60 days and only owners request recording
  (payloads are archived and kept; any account, a collection or a ranked
  board records); `architecture.md` pointed at privacy "for exactly what
  that means"; the `account:email` scope text read as if any app could
  ask (it is family-only, 0185); `quickstart.md` promised "you will hear
  back either way" (only an approval mails); a template comment cited
  privacy.md for the 90 days. All fixed as copy.
- **DECISIONS**: "Four buckets, SETTLED" is renamed for its substance,
  and the address line no longer cites privacy.md's wording.

Left for Jamie (#131): `about.md` names a person in its "Who runs it"
line while the privacy and terms pages no longer do; should a denied
access request get a mail (the quickstart now says only an approval
does); and `/data/growth` still promises that "a retention policy comes
as the corpus grows" while the privacy page says game history is kept.

Deployed 23:54Z (6:54 PM CT) from main at `0ec6423c` (PR #138), no
acceptance: no MCP tool or `/api/v1` operation changed, only copy,
comments and the `account:email` scope description. Smoke green; read
back `/api/public/status` health ok, and `/docs/email`, `/docs/limits`,
`/docs/quickstart`, `/data/collect` and `/family/discord` serve the new
copy; `/family/agent` is gone. The deploy moved the card-roles
snapshot's `source_commit` to the reference's f72062c (roles unchanged),
which this PR commits.

## 2026-09-28 - Dependabot dev-toolchain group (PR #91) deployed

PR #91 bumped 14 packages, all patch or minor: the AWS SDK clients
(3.1137 to 3.1140), `@anthropic-ai/sdk` 0.128.0, vite 8.3.1, TanStack
Router 1.170.39, lucide 1.48.0, knip and prettier. It waited while a
session held the checkout lease, then was rebased onto main
(`gh pr update-branch --rebase`) and merged on a green `validate` as
dfa39844. Deployed at 00:42Z on 2026-09-29 (7:42 PM CT on 2026-09-28)
with 0 migrations run and all 43 smoke checks green. No tool changed, so
acceptance was not run. `/api/public/status` reports `health.ok` true.
The card-roles snapshot stayed at the reference's f72062c.

## 2026-09-28 - One origin: the Console, Clan and Ladder become paths

Jamie read the day's structural assessment of the Elixir family and
decided how it is laid out. Elixir is "an application solution that is
run by our clan, the POAP KINGS", so it keeps `elixir.poapkings.com` and
everything lives under it:

- `/` is the site and docs; the Console moves to `/console`, Elixir Clan
  to `/clan` (its API to `/api/clan`), and Ladder is built at `/ladder`.
- `/mcp`, `/a/*`, `/i/*`, `/oauth/*`, `/.well-known/*`, `/api/v1`,
  `/api/public/*` and `/api/collector/*` do not move: connectors,
  collectors and integrations hold those URLs.
- No redirects from moved paths: "nobody is using this yet". Links are
  changed in place.
- Clan's repository moves into this one as a directory. It keeps its own
  Lambdas, DynamoDB table and CloudFormation stack; the merge is for one
  kit, one gate and one set of instructions, not a shared runtime. Clan
  still reads Elixir only through `/api/v1`.
- Drop stays at `drop.poapkings.com` with its own accounts: "it's just a
  different thing". poapkings.com is the clan's website.

What it replaces: the assessment's option of single sign-on across
subdomains (an OIDC identity layer), a Drop identity migration and a
standalone platform refactor. On one origin the Elixir session cookie
already reaches `/clan`, so a person signs in once without either.

Order, one pull request each: the Console under `/console`; Clan's code
into the repo; the edge behaviors for `/clan/*` and `/api/clan/*`, with
Clan's sign-in moved to the new origin as it is (its OAuth client, a
redirect URI under `/api/clan/`); `clan.poapkings.com` retired. Jamie
approved the infrastructure (2026-09-28). Whether Clan then reads the
Elixir session directly (a session-to-token exchange, which does not
exist yet) instead of running its own OAuth session is still Jamie's call;
it is a change to Clan's sign-in alone and waits for it. Plan:
`../elixir-family/plans/one-origin.md`.

Left for Jamie: delete the `clan.poapkings.com` record at Namecheap
before Clan's CloudFront distribution is removed, so the name never
points at a distribution nobody owns.

Also unchanged, for the record: the collector fleet keeps one rate
budget with no per-key pooling (Jamie, to revisit in about a month as
use grows), and ranking-origin recording stays on as a dial Jamie can
turn off.

## 2026-09-28 - The Console moves to /console (one origin, step 2)

Every Console path now starts with `/console` (`CONSOLE` and `appPath()` in
`apps/web/src/lib/console.js`), written out rather than set as a router
basepath, because the kit's `Link` renders `to` verbatim as the href and a
basepath would break copied and middle-clicked links. `SpaRouter` is one
rule now: a file passes, `/` is the home page, `/console` and everything
under it is the app shell, and any other path is its site document or an
honest miss. That deleted `STATIC_PAGES`/`STATIC_PREFIXES`, the list that
the function, `STATIC_LINKS` and the Eleventy pages had to keep equal; the
site test still evaluates the function from the template and pins
`STATIC_LINKS` and the family tabs to pages the site builds.
`serve-site.mjs` and `build-site.mjs` follow the same rule.

No aliases, as decided: the Console's `REDIRECTS` lost `/dashboard`,
`/clan`, `/data/status`, `/account/collector`, `/admin/gateways`,
`/admin/tokens` and `/account/settings`, and a root Console address is a
404. `/console` goes to `/console/account/overview`; `/console/data`, no
longer shadowed by the site's `/data`, goes to its one page. Mail
(`MANAGE_URL`, notifications, the email routes) and the magic-link
sign-in (`/console/signin`) link under the prefix. What is left behind:
a sign-in link mailed before the deploy lands on a 404 (it lives minutes),
and older mails' manage links point at the root; one-click unsubscribe is
under `/api` and unaffected.

Outside this repository, three links to Console pages break with the
deploy and are fixed in their own repositories: Drop's "verify your
player" link (`ElixirConnection.tsx`), poapkings.com's two
`/data/dashboard` links, and Clan's `lib/links.js` and email link, which
land with Clan's move into this repository.

## 2026-09-28 - Elixir Clan moves in as `clan/` (one origin, step 3)

Clan's repository came in with its history, rewritten under `clan/` with
`git filter-repo` and replayed linearly (the ruleset refuses a merge
commit, so not `git subtree`); `git log -- clan` reads as it did there. Its
workspaces joined the root's (`clan/apps/*`, `clan/services/*`,
`clan/infra`), and its own `package.json`, lockfile, lint and prettier
configs, workflows and team scripts went: the root's are used.

- **The kit from the workspace.** `@elixir-mcp/ui`, `client` and `design`
  replace the git dependency pinned 136 commits behind; `lucide-react`
  and `marked` left Clan's manifest (the kit brings them). The fonts are
  the Console's self-hosted files, copied at build time, so Clan no
  longer loads Google Fonts.
- **One gate.** The root verify covers Clan (typecheck gains
  `tsc -p clan/apps/web`; knip learned Clan's workspaces and found 33
  unused exports, now module-private), `validate` builds Clan's web and
  Lambda, and `npm run e2e` runs Clan's journeys after the Console's.
- **The boundary.** `clan/infra/tests/boundary.test.mjs` refuses a Clan
  import of anything of Elixir's but the kit, and an Elixir import of
  anything of Clan's.
- **Deploy.** `clan-deploy.yml` replaces Clan's `deploy.yml`: after a
  green `validate` on main, in a new `clan-production` environment here,
  assuming `elixir-clan-github-deploy` through OIDC. Most merges do not
  touch Clan, so it keeps the SHA it last deployed in Clan's code bucket
  and deploys nothing when `clan/`, the kit, the fonts and the lockfile
  are unchanged since. The role's trust names this repository's
  `clan-production` environment (both subject forms) beside the old
  repository's until that one is archived.
- **The team.** Clan's four objectives stay paused and uninstalled until
  Jamie picks which resume; the checkout has one lease, this repository's.

Clan still serves at `clan.poapkings.com`; nothing a person sees changes,
except that Clan's links into the Console follow it to `/console`. Next
is step 4, Clan at `/clan` on this distribution.

## 2026-09-28 - Elixir's edge learns Clan (one origin, step 4a)

Step 3 landed: #144 and #143 merged, and the first `clan-deploy` from
here deployed at 22:06 Central (stack, 262 web files, smoke green at
clan.poapkings.com, marker written). `jthingelstad/clan.poapkings.com`
is archived, with a description pointing here.

Step 4a is the compatible half of Clan at `/clan`: everything that lets
this distribution serve Clan, with nothing a person sees changing yet.

- **The edge.** Three behaviours: `/api/clan/*` (before `/api/*`) to
  Clan's HTTP API, and `/clan` and `/clan/*` to Clan's own bucket (two
  patterns, since `/clan*` would take `/clans`). The Clan API's origin
  request policy forwards Clan's two cookies and nothing of Elixir's,
  so `__Host-elixir_session` never reaches Clan's Lambda. Clan's cookies
  stay `__Host-` and `Path=/` (the strongest prefix; scoping them to
  `/api/clan` would have meant `__Secure-`); the browser also sends them
  under `/api/*`, where the door reads only its own. `SpaRouter` routes
  `/clan` too (to `/clan/index.html`: Clan's build moves under `clan/`
  in its bucket in 4b) and is shared by Clan's two app behaviours. The
  CSP gains OpenStreetMap's tiles for Clan's map. `ClanApiDomain` is a
  new PRESERVED parameter with no default, so a deploy without it fails
  before anything changes.
- **Clan.** Its bucket admits this distribution (`ElixirDistributionId`,
  PRESERVED, empty until set), its web deploy also flushes `/clan*`
  here, and its Lambda reads `/api/clan/auth/*` as `/auth/*` and any
  other `/api/clan/*` as `/api/*`, so both addresses work until
  clan.poapkings.com goes.
- **Facts keep their app.** A person's attested fact was keyed by the
  host of its client's first redirect URI, so Clan's move would have
  relabelled its facts and broken the retry of one written before. The
  key is now the provisioned app (`family_oauth_client.app`), mapped to
  the keys the rows already carry (`clan.poapkings.com`,
  `drop.poapkings.com`); 0195 says so in the column's comment.
- **`{family_clients: {set_redirect_uris}}`** replaces a provisioned
  app's redirect URIs, all on family origins, for an app that moves.

Deploy order: this merge (Clan deploys itself, with the new parameter
empty), then Clan once by hand with
`--param=ElixirDistributionId=E1KBSTIXY6Q5OS`, then Elixir with
`--param=ClanApiDomain=bblx6sbg6d.execute-api.us-east-1.amazonaws.com`.

**Queued for Jamie** (the auto-mode classifier refused it to an agent):
remove the old repository's two subjects from the trust of
`elixir-clan-github-deploy`, leaving the two this repository's code
names (`githubDeployTrustFor` in `clan/infra/scripts/iam-policies.mjs`):
`repo:jthingelstad/elixir-mcp:environment:clan-production` and
`repo:jthingelstad@5351/elixir-mcp@1356061557:environment:clan-production`.
The old repository is archived, so they can no longer be used.

## 2026-09-28 - Elixir Clan answers at /clan (one origin, step 4b)

Step 4a is deployed in the order its entry gives: Clan by CI, Clan by
hand with `ElixirDistributionId`, then Elixir with `ClanApiDomain`
(0195 ran). Read back through this distribution: `/api/clan/health`
is 200 `{ok: true}`, `/api/clan/me` is Clan's own signed-out 401, and
`/api/clanx/...` stays Elixir's 404. That Elixir's session cookie is not
forwarded is the origin request policy's whitelist, pinned in
`infra-controls.test.mjs`, not something a read can show.

Step 4b moves the app itself; everything of it is in `clan/` but the
links.

- **Clan's app is under /clan.** Vite's `base` is `/clan/`, and every
  path is written with an explicit prefix (`clan/apps/web/src/lib/base.js`),
  as the Console's is, because the kit's `Link` renders `to` verbatim.
  The chooser is `/clan/clans`, a clan `/clan/<tag>`, and the app's
  own pages (`you`, `refused`, `verify`, `feedback`, `maintain`) win
  over a tag of the same name. The API client calls `/api/clan/*`.
- **Sign-in comes back to /api/clan.** The redirect URI is
  `ElixirUrl/api/clan/auth/callback`, and `APP_URL` is derived
  (`${ElixirUrl}/clan`), so the `AppUrl` parameter is gone and nothing
  has to be set by hand when the app moves. Mail links are
  `ElixirUrl/clan/<tag>/actions`.
- **Its web deploy uploads under `clan/`** and deletes what it did not
  build, the old root keys included: **clan.poapkings.com serves only
  403s from this deploy on** (no redirects, as decided). Its API there
  still answers until the distribution goes in step 5.
- **Clan counts visits on Elixir's Tinylytics site**, with pages under
  `/clan` and its API events kept apart by their `/api/clan` label.
  This reverses the 2026-09-12 choice of a site of its own, which was
  bound to clan.poapkings.com; Clan's old site keeps its history.
- **Elixir's links.** The family bar's Clan button (kit and the static
  bar's mirror), the docs and the worked examples go to `/clan`. The
  static bar pin now treats any product on this origin as a bare path,
  and the page-origin allowlist no longer admits clan.poapkings.com.
  `FIRST_PARTY_ORIGINS`, the mail campaign origins, the OpenAPI wording
  and the grants example keep the old host until step 5.
- **`register-client.mjs` is superseded:** `/oauth/register` refuses a
  family origin, and Clan's client is Elixir's provisioned family client,
  which never expires. It exits with a pointer to `set_redirect_uris`.

Deploy order: before the merge, add the new redirect URI beside the
old one (migrate Lambda, `{family_clients: {set_redirect_uris: {app:
"clan", redirect_uris: ["https://elixir.poapkings.com/api/clan/auth/callback",
"https://clan.poapkings.com/auth/callback"]}}}`); merge (Clan deploys
itself and flushes `/clan*` here); deploy Elixir for the links. A live
sign-in is Jamie's to try.

`elixir-family/plans/one-origin.md` said the edge would strip `/clan`
so Clan's bucket kept its layout; 4a passes the path through and 4b
moves the files, so the plan is corrected there.

## 2026-09-28 - clan.poapkings.com retired (one origin, step 5)

Jamie deleted the DNS record first (Namecheap's zone changed at 23:09
Central). Clan's stack then drops its distribution, router function and
header policies; the bucket admits only this distribution (Clan's
`docs/NOTES.md` has the stack side).

- **`FIRST_PARTY_ORIGINS` loses `https://clan.poapkings.com`.** A client
  with a redirect there is no longer the family's: the principal test
  says so, and every test that provisioned Clan at the old callback now
  uses `https://elixir.poapkings.com/api/clan/auth/callback`. The tests
  that need a second family host (the unprovisioned legacy client, an app
  that moves) use drop.poapkings.com.
- **The mail campaign origins** are `SITE` and Drop; Clan's links are on
  `SITE`.
- The OpenAPI wording of a family link and the `{oauth_grants}` example
  follow. Attested facts keep their stored source key
  (`clan.poapkings.com` maps to "Elixir Clan"), which names the app, not a
  host.

Order: `{family_clients: {set_redirect_uris}}` for `clan` with only the
new callback, before this deploys, so Clan's client never has a URI off
the family's origins; then the merge (Clan's CI deploy removes the
distribution); then Elixir.

## 2026-09-29 - The agent team: new names, one worktree per run

Jamie approved new names for the objectives (the old ones did not say what
each does) and asked that runs stop sharing a directory, which "has
happened a lot": scheduled runs collided in the one checkout, and a held
checkout lease stalled the runs queued behind it.

- **Names.** Elixir Operator (was Run Elixir MCP), Elixir Data Auditor
  (Keep the Record True), Elixir Feedback Manager (Close the Loop), Elixir
  Security Reviewer (Guard the Door), Elixir Rankings Analyst (Keep the
  Boards); Clan's four are in `clan/docs/NOTES.md`. The objective files
  are renamed to match. Keys, automation ids and automation memory are
  unchanged; notes, summaries and dated entries keep the names they were
  written with.
- **One worktree per run.** Every automation installs with
  `execution_environment = "worktree"` and
  `.codex/environments/environment.toml`, whose setup
  (`AGENT-TEAM/scripts/worktree-setup.sh`) refuses the main checkout,
  detaches at a freshly fetched origin/main (Codex starts a worktree from
  the last-fetched ref), links the gitignored `.env` files and the skills'
  reports from the main checkout (links, never copies: a copy of a secrets
  file is a secret), clones the card-art cache, links the sibling
  repositories into the run's own parent directory so `../elixir-bot/.env`
  and `../cr-agent-api-docs` resolve, and runs `npm ci` (about 4 s). The
  skills' `reports/` ignores lost their trailing slash: a link is not a
  directory to git, so every fresh worktree read dirty.
- **The lease guards production, not the checkout.** `objective-lease.mjs`
  keeps the lease and the notes queue in the clone's common git directory,
  so every worktree sees one of each. It is claimed for a deploy, a
  migration run or an ops-lambda write, never for an edit. New keys:
  `clan-run`, `clan-judge`, `clan-loop`, `clan-guard`, and the domain
  team's `clock` and `game`. `note <key> --reason` queues a blocked run's
  note without a lease; a claim records its worktree, and `clear-stale`
  judges that worktree rather than its own. Preflight is worktree-aware: a
  linked worktree clean at origin/main is eligible, and the lease is
  reported (`DEPLOY_LEASE=`), no longer a block. A long ops-lambda batch
  now holds the lease for its whole run (`elixir-operator.md`).
- **Cadences** are the ones installed in Codex, lightened in the app since
  the 2026-09-09 manifest; the manifests now record them. The schedule
  renderer learned "one weekday of each month" for Clan's monthly runs
  (projects-sysadmin 8c0d129).
- **Clan's four objectives resumed**, retargeted from the archived
  clan.poapkings.com Codex project to this repository.

`DECISIONS.md`: "Lease first" becomes "One worktree per run; the lease
guards production".

---

## 2026-09-29 - Phase 0 of the structural assessment: descriptions that had drifted

The 2026-09-28 assessment's Phase 0 ("decide and clean up") listed
descriptions that no longer matched the code or the decisions. Fixed:

- **The public architecture page** drew elixir-bot as a client and linked
  it as "the POAP KINGS clan agent". It retired on 2026-09-26; the diagram
  and the links now name the Discord agent (elixir-mcp-discord) and say
  Elixir Clan lives in this repository.
- **Clan's README** said it "requires a verified player". Since 2026-09-26
  (Jamie) an unverified claim makes someone a member and a role's powers
  wait for Verify (`clan/services/api/src/gate.mjs`).
- **Clan's VISION** called Elixir Ladder "a concept only, with no plans to
  build it". Ladder is a section of Elixir at `/ladder` (2026-09-28).
- **Clan's `oauth.mjs` and `store.mjs` headers** described a public client
  and a table holding only sessions.
- **DECISIONS** gains ranking-origin recording as a dial that stays on, and
  the one budget's reaffirmation, both Jamie's on 2026-09-28.

Left for Jamie: the collector door's `min_client_version` is still
`2.0.30`. Enforcement is on (`CollectorMinEnforce` read `1` from the
stack on 2026-09-29), but every retired Python twin reports a 2.0.3x
version, so one would still be served work. Raising the minimum past
2.x retires the pre-signing rollback lever, which is why it moves only
on Jamie's call (`docs/RELEASING-COLLECTOR.md`).

---

## 2026-09-29 - `packages/record`: services share through a package

Phase 4 of the structural assessment, first slice. The services shared
code by relative imports into each other's `src` (89 at origin/main);
web-api answered `/api/v1` from ingest's clock and profile modules and a
tool file of MCP's. The shared ones are now `@elixir-mcp/record`:

- **Moved, unchanged:** `war-clock`, `season`, `game-clock`,
  `recorded-profile` and `snapshot-columns` from ingest, `badge-names`
  from MCP, and `myPlayers` out of the `elixir_my_players` tool file into
  `record/players`. Thirty importers now name the package; the war-clock
  and badge-name tests moved with their modules.
- **The ceiling:** `packages/record/test/boundary.test.mjs` refuses a
  service import from the package and caps the cross-service imports in
  services' `src` at 74, a number that only goes down.
- **Parity:** `services/web-api/test/record-parity.test.mjs` pins that
  `/api/v1/me` and `elixir_my_players`, `/api/v1/game/clock` and
  `game_clock`, and `/api/v1/players/{tag}` and `players_profile` give the
  same facts. No response changed; no contract moved.

Next slices, not started: the mail's own `myPlayers` in
`services/jobs/src/email/shared.mjs` is a second derivation of the same
list, in another shape and order. Of the remaining 74 crossings, the
largest groups are web-api into MCP (18), the migrate Lambda's operations
into MCP and ingest (14), and jobs into MCP and ingest (12).

---

## 2026-09-29 - A clan's website reads Elixir: war history on `/api/v1`, more of the roster

Phase 8 of the structural assessment, data half. poapkings.com fetched
the game API itself for its roster, profiles and river races, with a
key borrowed from the retired elixir-bot's `.env`, and only for POAP
KINGS; its two sister clans had no live numbers. Elixir records all
three clans, so the site now reads from `/api/v1` with an integration
key of its own (`clans:read`).

- **`GET /api/v1/clans/{tag}/war-history`** (2.8.0) is the `war_history`
  tool, `seasons` 1 to 12, for a person's grant or an integration with
  `clans:read`, on any actively recorded clan like its siblings.
- **`clans_roster` (9.17.0)** adds what the site showed that Elixir
  already recorded: the clan's `required_trophies` and
  `donations_per_week` everywhere, and per member `clan_rank`,
  `previous_clan_rank`, `donations_received_this_week`, `arena` and
  `favorite_card_id`.
- **Why the member extras skip agents:** measured on the live POAP KINGS
  roster, a 44-member full read is about 36k characters; a 50-member clan
  at today's widest would be about 46k, and the extras add about 150 a
  member, which passes `MCP_RESULT_MAX_CHARS` (48,000). So they are
  served where no cap applies (`/api/v1`, Explore) and never on the MCP
  or service-token surfaces, the precedent `clans_participation` set.
  Reversible: dropping the `agent` test in `clans.mjs` serves them
  everywhere once the roster is paged or trimmed.

Not in Elixir, and so not served: a clan's location name, card and badge
art (the site reads card art from `/api/public/cards`), and `expLevel`.

---

## 2026-09-29 - 9.17.0 deployed, and poapkings.com reads it

d6a4b8a5 (PRs #149, #150 and #151) is deployed with `--acceptance` in
full because #150 moved shared code into `packages/record`; smoke green,
stack `UPDATE_COMPLETE`, migrations ran 0. Acceptance finished 07:10Z
(2:10 AM CT): 1,189 cases, 12 failed, 57 skipped. Verdicts, the new ones
re-run alone:

- gym/185.3 (1,141 vs 1,143 players): passes alone, two live counts read
  a moment apart.
- gym/196.2: the live case's world moved. Its `when` reads
  `elixir_coverage`'s intervals ending in the last seven days, which
  still hold kiruba's five uncaptured battles of 2026-09-21; the
  standings window now starts after that interval, so no note names
  them. `clans_standings` did not change.
- gym/337.1 (#GRJ20LQP no longer recorded), gym/343.2: live cases whose
  world moved, as at 9.12.2, 9.12.7 and 9.12.8.
- budgets/meta-cards-corpus-week (16.3 s; 16.7 s alone),
  catalogue/battles_meta_cards#1, battles_trends#1, badges_rarity#1: the
  open timing items; none of these tools changed.
- catalogue/cards_archetype#docs, elixir_collectors#docs,
  elixir_timeline#docs, war_history#notes: rare fields absent from this
  run, as at 9.12.8.

Read-back, reads only: `/api/public/status` `ok: true`; `/tools.json`
9.17.0 and `/docs/integration-api.json` 2.8.0 with `clanWarHistory`;
`/api/v1/clans/%23J2RGCRVG/war-history` refuses an unauthenticated read
(401); `/updates` lists the entry; `clans_roster` compact on MCP carries
`required_trophies` (Ship It! 1,000).

**poapkings.com's integration** is `poapkings-com` (public id
064a3a7dc196, `clans:read` only), created by the migrate
`{integration: create}` op with a locally minted `token_hash`; the raw
key went straight into the site's `.env` as `ELIXIR_API_KEY` and was
never printed. Its first reads were the change's live read-back: the
site's updater read POAP KINGS' roster (44 of 44 with a recorded
profile, clan facts equal to the game's), 13 war weeks, and both sister
clans' rosters. poapkings.com #30 made Elixir its source and is live
(the `--source cr` rollback stays until 2026-10-06).


---

## 2026-09-29 - The docs corpus is read on first use; its build no longer needs itself

Phase 4 of the structural assessment, "break the circular docs build".
`@elixir-mcp/docs` read `dist/corpus.json` at module scope, and the
site's build loads the MCP registry, which imports that package, while
the corpus is built from the site. A fresh clone failed resolving a file
that did not exist yet (red on CI from 77656e1, 2026-09-10), and a stub
the build wrote first (578c764) stood in for it since.

The package now exports `corpus()`, which loads the file on its first
call and keeps it; `searchDocs` is async. `elixir_docs`,
`elixir_examples`, `elixir_updates` and the resources and prompts read
it inside their handlers, so importing the registry reads nothing, and
the stub is gone. The literal dynamic import still bundles: esbuild
inlines the JSON into the MCP Lambda (checked by bundling it and reading
the corpus from the bundle alone, 26 pages, 11 examples, 283 updates).
A test loads the module with no `dist/` beside it. No response changes;
no contract or JSON API version.

---

## 2026-09-29 - Services import packages, never each other

Phase 4 of the structural assessment, "zero relative imports between
services". 74 imports from one service's `src` into another's remained
after `packages/record` took the clocks; there are none now, and
`packages/record/test/boundary.test.mjs` holds zero with three rules (no
package imports a service; no service's `src` leaves its directory by a
relative path; no service imports another by name). Tests stay exempt.

What moved, with history (`git mv`):

- `services/auth` and `services/ingest` were libraries, not Lambdas: now
  `packages/auth` and `packages/ingest`, same package names.
- The job ledger and its plan: `packages/ledger` (`@elixir-mcp/ledger`,
  `/plan`). The scheduler keeps its handler and metrics.
- The outbox and owner notices: `packages/outbox`.
- The send ledger, archive and delivery from `services/jobs/src/email`:
  `packages/mail`.
- The SQL a tool and a job both read (`daily-sql`, `standings-sql`,
  `participation-sql`, `boat-defense-sql`, `mode-filter`,
  `gateway-cards`): `packages/record`.
- Everything else in `services/mcp/src` but the door (`index`, `handler`,
  `oauth-routes`, `protocol`, `resources`), plus web-api's `onboard.mjs`:
  `packages/tools` (`@elixir-mcp/tools`, `/shared`, `/cards`, `/<file>`).

Two seams were cut rather than moved. The result cap
(`renderToolResultText`, `MCP_RESULT_MAX_CHARS`) left `protocol.mjs` for
`packages/tools/src/result-text.mjs`, so web-api's Explore and the
invoker stop importing the MCP door. Integration administration
(create, configure, rotate, revoke, suspend, resume, list) moved from
web-api's admin route into `@elixir-mcp/auth/integrations`, answering
`{ status, body }`; the route and the migrate `integration` op both call
it, and the migrate op no longer imports a web-api route.

Tests moved with their code where they test only moved code (37); door
tests stay with their service. The deck seed helper is
`packages/tools/test/deck-rows.mjs`. Each package names its exports and
dependencies, knip checks both, and the docs, skills and role files that
named the old paths were updated (notes and reviews left as written).

Checked: `npm run verify` green; all seven Lambdas bundle and import.
Against main, every bundle holds the same modules under their new paths
except where a seam was cut: web-api no longer bundles the MCP protocol
and resources, and migrate drops the `/api/v1` door it pulled in through
the integrations route (about 5 KB smaller). No response changes; no
contract or JSON API version.
