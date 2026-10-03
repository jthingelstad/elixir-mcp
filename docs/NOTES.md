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

---

## 2026-09-29 - Deploy lanes: a site-only deploy leaves the stack alone

Structural assessment, Phase 4 (WS3). Every deploy ran the whole path:
the migrate push, the migrations, a template upload and UpdateStack,
even when only a page's CSS had changed. Two things kept a quieter path
from existing.

A bundle's S3 key was the hash of its zip, and `zip` stamps each
entry's mtime, so the same code built twice got two keys and
CloudFormation flipped all seven Lambdas on every deploy. The key is now
the hash of the bundle directory, each file's path and bytes in path
order (`infra/scripts/lib/deploy-lane.mjs`, `bundleFingerprint`).

The docs corpus, which four Lambdas carry (mcp, web-api, jobs, migrate,
through the registry), read the clock twice: its `built_at`, and the
site's `build` data it renders (`docs/limits.md`'s example `resets_at`
is "the next reset after this build"). Both now follow
`SOURCE_DATE_EPOCH`, which `buildAll` sets to the last commit touching
the corpus's sources (`CORPUS_SOURCES`: the site's `docs`, `_data` and
`_lib`, and `packages/docs`, `tools` and `contracts`). So
`corpus_built_at` now reads "when its sources last changed", and the
MCP copy of the reset example names the day after that commit; the
published pages build without the variable and keep today's date.
Measured: two builds of dd5d54c0 from different directories gave the
same seven keys.

The deploy then compares this build's code keys and the template with
the live stack (DescribeStacks, GetTemplate). All equal, no `--param`
and no `--rotate-origin-secret`: the **site lane**, which skips the
migrate push, the migrations and the stack update, and still imports
the archetype vocabulary, publishes the site and runs smoke and
acceptance. Anything else is the **platform lane**, the deploy as it
was; the log names what changed (`lane: platform - changed: McpCodeKey,
template.`). `--platform` forces it. A docs page is a platform deploy by
construction: it rides the corpus into four bundles.

Found on the way: CloudFormation hands back the template it was given
(GetTemplate, stage Original) with every non-ASCII character as `?`;
our section signs and dashes came back that way. The comparison does
the same to the local file (`sameTemplate`).

The first deploy after this merges is a platform deploy whatever it
carries: no live key is content-named yet.

---

## 2026-09-29 - 860c6c66 deployed, and the site lane proven on it

860c6c66 (#154, #155, #156, #157) is deployed with `--acceptance` in
full, because #156 moved shared code into packages. As the first deploy
with content-named keys it took the platform lane: all seven code keys
changed, and the template changed (#156's two lines). Migrations: 195
applied, 0 ran. Stack `UPDATE_COMPLETE` at 09:15Z, smoke green. It ran
09:14 to 09:31Z (4:14 to 4:31 AM CT). Acceptance: 1,189 cases, 13
failed, 57 skipped. Verdicts:

- budgets/clans_participation and catalogue/clans_participation#2 are
  one call, `clans_participation {"weeks":2}`, whose 15.3 s the run
  reused for four cases (also contracts and gym/334.3). The ceilings
  are 8 s and 15 s. Alone it passes twice, in 1,048 ms and 869 ms. The
  tool's p95 this week is 10.2 s, so it slows in heavy company; #156
  moved its SQL without changing it. Watch it.
- gym/196.2, gym/337.1, gym/343.2: live cases whose world moved, as at
  9.17.0.
- budgets/meta-cards-corpus-week (16.5 s),
  catalogue/battles_meta_cards#1 (15.8 s), battles_trends#1 (14.1 s),
  badges_rarity#1 (4.6 s): the open timing items; none of these tools
  changed.
- catalogue/cards_archetype#docs, elixir_collectors#docs,
  elixir_timeline#docs, war_history#notes: rare fields absent from this
  run, as at 9.12.8 and 9.17.0.
- gym/185.3, failing at 9.17.0, passed.

**The site lane, live.** The same commit, deployed again at 09:32Z
without acceptance (no code changed; this run is the lane's own test):

- `lane: site`, with the same seven keys uploaded;
- no migrate push, no migrations, no stack update (the stack's last
  event is still 09:15:24Z);
- then the vocabulary import, site publish, invalidation and 43 smoke
  checks, all green.

It took 37 seconds end to end. So the live template matched once
CloudFormation's `?` was allowed for, and the keys held from one build
to the next. The scheduler, email-relay and editor bundles kept the
keys a local build of dd5d54c0 gave them. The four bundles that carry
the corpus moved only because #157 touched a corpus source.

Read-back, reads only:

- `/api/public/status` is `ok: true`, and `/tools.json` is 9.17.0 (no
  contract change).
- `elixir_docs` over MCP reports `corpus_built_at`
  2026-09-29T09:13:23Z, which is 860c6c66's commit time, and the limits
  page's example resets 2026-09-30.
- Elixir Clan's CI deploys of d4a5cc0b, e4eb7035, dd5d54c0 and 860c6c66
  are green.

Nothing owed.

---

## 2026-09-29 - elixir_examples output schema correction queued

The Operator's bounded door-log read found twelve
`output_schema_mismatch elixir_examples result.examples is required` entries
in the trailing 24 hours, including two at 09:23Z after the 9.17.0 deploy.
The index correctly returns `examples`; a selected example correctly returns
its transcript and supporting details instead. The published output schema
incorrectly required `examples` for both shapes, so the door logged a false
mismatch without changing the response.

9.17.1 makes `examples` conditional, adds a registry-level regression over
both shapes, and will deploy with `--acceptance=elixir`. The JSON API has no
`elixir_examples` operation and is unchanged.

**Deployed.** e419f409 (PR #159) passed `validate` and deployed at 09:57Z
(4:57 AM CT) with `--acceptance=elixir`: 195 migrations were already applied,
so none ran. CloudFormation reached `UPDATE_COMPLETE`. Read-back found
`/tools.json` on 9.17.1 with `corpus_built_at`, `meta`, `notes`, and `docs` as
the shared required fields for `elixir_examples`; the false `examples`
requirement is gone. The post-deploy MCP log window had no
`output_schema_mismatch` event. Public status remained healthy with five
active collectors, no dead jobs or dead letters, and one-second admission and
fetch freshness. The `run` lease was released after that read-back.

---

## 2026-09-29 - The collector door gets its own Lambda

The structural assessment's CollectorFunction item, which Jamie chose to
do now. The door was three routes in the web-api and 99% of that
Lambda's requests: 235k of 237k over the three days to 06:00Z, peaking
at 402 a minute (lease p95 61 ms, submit p95 388 ms). A fleet burst
shared the console's 20 reserved slots, its throttle bucket and its log.

- `@elixir-mcp/collector-door` (packages): the door and the
  release-signature state, moved from web-api's `src` unchanged, with
  their tests. web-api imports the signature state for the console.
- `services/collector`: the Lambda, in the web-api's shape (origin
  check, a client per request, a soft deadline, the same timing line).
- The stack: `elixir-mcp-collector` with 10 reserved slots, its own
  role (`s3:PutObject` on archive `payloads/*` and outbox `email/*`,
  nothing else; a write-once put needs no read), a log group, errors
  and p95 latency alarms, and the submit-ingest filter on its log. A
  route `ANY /api/collector/{proxy+}` on the site API sends the fleet
  there; `$default` still goes to the web-api. No CloudFront change: the
  same behaviour, origin secret and forwarded collector headers. The
  database ceiling across the six functions goes from 43 to 53.
- The web-api keeps its collector routes and `payloads/` grant for this
  deploy, so nothing falls between the old route and the new. A
  follow-up removes both once the route has carried the fleet.

Decided with it: `family.json` stays in `packages/ui` (Jamie, "Leave it").

Not verified before the deploy: whether the stage's default route
throttle (20/s, burst 40) is a bucket per route or one for the stage.
The docs say it applies to all routes; either way the collector is no
looser than today.

---

## 2026-09-29 - e5fbcb79 deployed: the fleet is on its own Lambda

e5fbcb79 (#161) is deployed, after Jamie's go for the new role. Lane
platform (web-api and collector keys, and the template); migrations 195
applied, 0 ran; stack `UPDATE_COMPLETE`, 43 smoke checks green. No
acceptance: no tool family changed, and the suite does not exercise the
collector door. The route `ANY /api/collector/{proxy+}` was created at
12:03:26Z (7:03 AM CT).

Read-back, reads only, to 12:08Z:

- `elixir-mcp-collector` has the template's settings, and its role's
  one inline policy is the two `s3:PutObject` statements, nothing else.
- The site API has two routes: `$default` and the collector's.
- The collector log: 162 leases at 200 (p95 62 ms), 74 submits at 200
  (p95 371 ms, max 662 ms), nothing else. The submits are the proof of
  the archive write under the new role. No `submit_ingest_error`, no
  `AccessDenied`, no timeouts.
- Lambda metrics: 139 invocations, 0 errors, 0 throttles, peak
  concurrency 3 of 10.
- The web-api logged no collector route after 12:03:40Z; its last
  submits were at 12:03:07-08Z, before the flip reached the edge.
- `elixir_collectors`: five active, heartbeats current. Public status
  `ok`. No `elixir-mcp-` alarm out of OK.

Owed: the follow-up that takes the collector routes, the `payloads/*`
grant and the submit-ingest filter off the web-api. It changes a role,
so it waits for Jamie's go.

---

## 2026-09-29 - Clan's sign-in: a standing grant is not asked again

Jamie's call, from the structural assessment ("Clan reads Elixir
session"): Clan keeps its own session and OAuth, and two changes make it
feel like one sign-in with Elixir.

- **Remembered consent** (`services/mcp/src/oauth-routes.mjs`,
  `consentRemembered`). A signed-in GET of `/oauth/authorize` redirects
  with a code at once, logged `oauth_consent_remembered`, when all of
  these hold: the client is a provisioned family client whose every
  redirect is on a family origin, and this request's redirect is on
  Elixir's own origin (Clan yes, Drop no); the door is the person's own
  or the JSON API (never an agent's or integration's); and the person
  holds a grant (`oauth_family`) to that client for that door that is
  unrevoked, inside its 90 days, and carries every scope requested. The
  code carries exactly what was asked, and there are no boxes to widen
  it (`widen: false`). Anything less shows the page as before;
  `switch=1` still forces the email step.
- **Sign-out revokes** (`clan/services/api`). `POST /auth/logout`
  deletes the session, then calls `/oauth/revoke` with the refresh
  token and Clan's secret, best effort with 5 s: a failure is logged
  `revoke_failed` and the sign-out holds.

Why a GET may issue a code here: the code goes to a redirect Elixir
registered on its own origin, Clan's callback refuses one whose state
does not match the browser's login cookie, and PKCE binds it to the
verifier Clan holds server-side. A page that sends someone's browser to
the authorize URL gets a failed callback in that browser and no code.

What a person sees: signed in to Elixir, **Sign in** on Clan comes
straight back signed in. After signing out of Clan, the next sign-in
shows **Authorize** once. Every Clan sign-in still mints a grant of its
own, so a grant left standing by another browser also counts; the
Connections page lists each.

---

## 2026-09-29 - 6ce63925 deployed: Clan's sign-in, both halves

6ce63925 (#163) is live on both sides.

- **Elixir**, by `deploy.mjs` at 12:23Z (7:23 AM CT): lane platform
  (web-api, mcp, migrate and jobs keys, because the protocol page rides
  the corpus bundles; no template change), migrations 195 applied, 0
  ran, stack `UPDATE_COMPLETE`, 43 smoke checks green. No acceptance: no
  tool family changed.
- **Clan**, by `clan-deploy` after `validate` on main: `elixir-clan-api`
  updated at 12:26:59Z (7:26 AM CT).

Read-back, reads only: discovery still names `/oauth/revoke` with
`client_secret_post`; the published protocol page carries the
remembered-consent paragraph; no errors or `revoke_failed` on either
function's log since; public status `ok`, five collectors; no
`elixir-` alarm out of OK. The first `oauth_consent_remembered` line
waits for a real sign-in: a GET of the authorize door, or of Clan's
`/auth/login`, is a write, so none was made to prove it.

---

## 2026-09-29 - The web-api stops serving the collector door

The follow-up the collector Lambda's entry owed, with Jamie's go (it
narrows a role). From the route's creation at 12:03:26Z to 12:35Z the
collector Lambda served 1,120 leases, 519 submits and 4 config reads,
all 200, with no `SubmitIngestError`; the web-api logged no collector
route in that time, through its own redeploy at 12:23Z.

- **Code.** `services/web-api/src/routes/collector.mjs` is gone, and
  with it the web-api's door wiring and its `@elixir-mcp/ingest`
  dependency. It still imports the release-signature state from
  `@elixir-mcp/collector-door` for the console and the status page.
- **Role.** `elixir-mcp-web-api` loses `s3:PutObject` and
  `s3:GetObject` on the archive's `payloads/*`. Nothing else it runs
  touches that prefix: payload reads are migrate's (`ops-series`) and
  jobs' (`shape-census`), under their own roles. Its `calls/*`,
  `mail/sent/*` and outbox grants stay.
- **Environment.** `COLLECTOR_MIN_ENFORCE` comes off the web-api; only
  the door reads it. The parameter still reaches the collector Lambda.
- **Alarms.** The web-api log's `SubmitIngestErrorFilter` goes;
  `CollectorSubmitIngestErrorFilter` feeds the same metric and alarm.
- **Archive policy.** `ArchiveBucketPolicy` now depends on the one
  writer, `CollectorFunction`.

A collector request can no longer reach the web-api: the site API's
`ANY /api/collector/{proxy+}` route sends every one to the collector,
and the web-api answers any stray one 404.

---

## 2026-09-30 - Rankings Analyst daily board reconciliation

The documented `cloud-engineer` identity completed one read-only
`elixir-mcp-migrate` `{stats:true}` receipt at 11:02Z. Today's global Path
of Legends tick has exactly one receipt and its snapshot was observed at
10:07:57Z with 1,000 entries and `truncated: false`. Of 262 enabled location
boards, 254 were admitted within 26 hours (69 valid empty boards); all eight
stale locations were the known daily-held 404 state, leaving no unexplained
admission gap. There are 662 active ranking-origin recordings. The next season
roll is 2026-10-05T10:00Z, so the small-and-growing and held-collection checks
do not apply yet.

`node clients/boards/boards.mjs --json` completed without skips or collapse
holds: the global, US, Japan, and top-clan collections changed +46/-46,
+33/-33, +41/-41, and +1/-1 respectively. The post-sync
`--dry-run --json` receipt had zero additions and removals for all four
collections (100, 100, 100, and 10 members), proving equality with the
recorded boards at read time. No lease was used: collection synchronization is
the Rankings Analyst's explicitly authorized write.

Leaderboard result: the complete global board arrived at 10:07:57Z; the three
top-100 collections turned over 120 player seats and the top-clan board
changed one clan.

---

## 2026-09-30 - Queued Operator note: live acceptance response path

The Operator reported that `npm run acceptance` could not complete because the
live door kept a response stream open beyond the client's 20-second deadline.
The acceptance client now builds its workspace prerequisites, bounds header
and body reads, and cancels a locked stream; its focused regression tests pass.
Recheck the live acceptance response path before rerunning the suite.

---

## 2026-10-01 - Arena-week mail consumes the deck-list contract

The 2026-09-29 arena-week run composed no mail for 16 eligible recipients:
the builder read `cards` from `battles_decks` list rows, while that endpoint's
declared list shape intentionally carries only `card_names`. The source repair
uses those labels directly and has a regression test for both compact list and
full deck shapes. No missed mail was replayed; the next scheduled arena-week
run is the natural acceptance path.

---

## 2026-10-01 - The docs are grouped by task, from one list

Jamie, 2026-09-29: the docs "were heavily based on Elixir MCP as a product";
the new docs are task-first. The groups now have one source,
`apps/site/src/_data/docGroups.js` (Start, Ladder, Clan, Friends and emails,
Your AI agent, The record, Build on Elixir, Policy). The site's rail and docs
home and the MCP corpus (`packages/docs/build.mjs`) all read it; before, the
site's `SECTIONS` and the corpus's `SECTIONS` were two lists kept in step by
hand. A page whose `section` the list does not name fails both builds, and a
group with no pages yet (Ladder, Clan) is left out of the rail and the home.
Pages sort by group, then by `order` within the group.

Every existing page was re-keyed (front matter `section`, `order`, a shorter
`navTitle` on a few); no slug, title or H2 moved, so every URL, every MCP
`docs` pointer and every `/docs/integrations/#<code>` problem type is where
it was. `privacy.md` and `terms.md` were not edited: they stay in `policy`.
The tool reference stays generated and nests under Tools in "Your AI agent".
The layout (`_includes/doc.njk`) gained a breadcrumb, "Next:" links to the
following pages in the group, and "Something wrong on this page?", which opens
the console's feedback form with the page named. The architecture-diagram
test now scopes past the lede, since the breadcrumb carries icons too.

---

## 2026-10-01 - Eight task pages, and what writing them found

New docs pages, every sentence read against the code: `your-account`,
`follow-a-friend`, `watch-a-player`, `milestones`, `turn-an-email-off`,
`modes`, `sign-in-with-elixir`, `json-api`. Corrected on the way:
quickstart, recording and roles sent people to Account → Overview to track
a player, track a clan or ask for a tier (it is Tracking, Tracking, and
Profile ▸ Ask for more slots; approval already makes the requested tag the
primary). Connections and protocol said Elixir Clan signs in with
`account:email`; Clan asks for `cr:read clans:attest`, and Drop for
`cr:read recordings:write account:email`.

Found in the product's own copy and left for its owners (the docs say what
the code does):

- The tracked player's Notifications note says "never email", but notify
  off also drops the player from the Wednesday Tracking report
  (`subjectsFor` filters on `notify`).
- `elixir_track_player` applies `relationship` only when it adds the
  player; re-adding a tracked player as a friend changes nothing yet
  echoes the relationship in `applied`. Its error hint names "the
  console's Players page", which is Tracking.
- The Top 100 footer's turn-off link reads "Turn off Ultimate Champions".
- A milestone's "Next:" line is rendered but never built (`next: null`).
- The JSON API's problem `type` URIs link `/docs/integrations/#<code>`, and
  no heading on that page carries a code's id, so each lands at the top.
- The tool family pages double-escape quotes in tool descriptions
  (`&amp;quot;mine&amp;quot;`), live as well as in a fresh build.

## 2026-10-01 - One mail shell for every kind (email redesign, part 1)

Every mail now renders in `packages/mail/src/shell.mjs`: the logo PNG
(`apps/site/src/assets/mail/elixir-{48,96}.png`, from Jamie's Elixir logo,
shipped as an Eleventy passthrough) and the wordmark "Elixir", a product
pill, the gold-barred panel, and one footer whose first line says when
the kind comes in the reader's zone (`MAIL_SCHEDULE`, pinned to the
EventBridge crons by test). The relay's login, welcome and owner_notify
templates use the same shell; login and welcome say "Elixir", not "Elixir
MCP", and the code still leads subject and preheader; owner_notify
subjects are unchanged; no transactional mail gained an unsubscribe.
The five renderers whose hidden preheader differed from the one they
returned now pass one string. `tracking_report` is labelled "Your friends
this week" (Jamie approved; the kind id, preferences and tokens are
unchanged). The card_of_week fixture's art moved to absolute URLs, the
form production builds, and the shared test now refuses a relative or
non-PNG image. `node packages/mail/scripts/preview.mjs` renders every kind
into gitignored `packages/mail/.preview/`. The logo's URL answers only
after the next deploy uploads the site; until then a sent mail shows the
wordmark beside an empty 44 px cell.

## 2026-10-01 - Six Clan pages, written from the engine

The docs' Clan group now has its pages: `bring-your-clan`, `clan-week`,
`standing`, `clan-actions`, `clan-awards`, `clan-policy`, each read
against `clan/services/engine`, `clan/services/api/src/manage` and the
rail in `clan/apps/web/src/lib/rail.js`. They describe what Clan does
and the names of its controls (policy fields, action kinds, page names),
not the layout, so the canvas redraw under way keeps them true; a
renamed control or page is the one edit they need. Ladder's pages wait
for Ladder's code on `main`.

---

---

## 2026-10-01 - A battle's public page

Jamie approved the design canvas's battle page ("Public yes. Left is the
player right is opponent."; the share buttons "are actually 'copy deck'
buttons"). Contract 9.18.0 gave every battles_query row its `url`; this
change serves it. `/battle/*` is a CloudFront behavior on the API origin, so
web-api answers it with the app shell (`app.html`, read from the site bucket
at most once a minute) with the battle's title, description and canonical
link written in, and the app's Battle view reads
`/api/public/battles/<ref>`. Both read one projection
(`services/web-api/src/battle-page.mjs`), which calls battles_query's own
handler as no account: no audit row, no quota, no read stamp, so a page
view never moves the scheduler. Pages are `noindex`: public to a link, not
offered to search. A 404 is cached for a minute (the battle may yet
arrive), a battle for an hour.

Left is side 0, the side whose log was ingested first, which is always a
recorded player; when two recorded players meet, whoever was read first
is on the left whichever of them shares it. The share picture
(`/battle/<short id>.png`) is the next change; until it lands the preview
image is the site's own and the `.png` address is a 404.

---

## 2026-10-02 - A battle's share picture

Jamie, 2026-10-01: the share version should "look more like the web version
with the cards in the familiar 2x4 and player names in left and right. It
should show tier health, elixir. Many of the details," and no blog embed,
"just the image and a link." `/battle/<short id>.png` is that picture, 1200
by 630, and the page's `og:image` and `twitter:image` now name it.

It is drawn in the web API, not a browser: `share-image.mjs` writes SVG from
the page's own projection (`readPublicBattle` with `around: false`, which
skips the meetings and sitting reads) and rasterises it with
`@resvg/resvg-wasm`, about 150 ms warm on a laptop. The wasm and three fonts
ride in the bundle's `share/` (`share-files.mjs` is the one list, read by the
build and the tests). Inter is cut to static TTFs from the site's own WOFF2,
since resvg reads no WOFF2 (`services/web-api/fonts/README.md`); Clash is
the site's OTF. `font-metrics.mjs` reads advance widths from the fonts so
the chips fit their words and a long name is shortened before it reaches
the score. Card art comes from the site bucket's mirror at 128 px
(`assets/cards/*`, a read-only grant beside `app.html` in the stack); a
card the mirror lacks, and Mirror itself, is its name in the frame. CJK and
emoji in a name have no glyphs in these fonts and draw as nothing; the
page itself shows them.

The picture's time is UTC, labelled, since an image has no reader's clock.
A duel shows its games won and the last game's decks and towers; a 2v2
shows both players a side with one row of eight each, and its chip names
the winning side ("Left team won") rather than cutting the team to one
name. The edge keeps a picture a day.

---

---

## 2026-10-01 - Ladder ships its season home at /ladder

Ladder (design canvas 2026-10-01, Ladder.dc.html) is a section of the
console's app beside the Console, not a vertical: `/ladder` is routed to
`app.html` by the SpaRouter and by `serve-site.mjs`, and the app's root guard
hands Ladder its own paths (`lib/ladder.js`). It reads only through
`POST /api/explore`, so every read is metered like any other: the season
home is `battles_performance` twice (the season, and `group_by: week`) plus
`players_summary` (the default mode and the most-played deck). Decisions:
your own players only (primary, then alts; a friend's season is theirs), the
mode in the address and else the one played most of Trophy Road and Path of
Legends, a deck's rate only when it is one mode's own, and the week bars drawn
in SVG so their heights are attributes and not inline styles. The top bar
still marks Console under /ladder until the shell's Chrome takes a current
product from the route; that hook belongs to the shell's owner.

---

## 2026-10-01 - One top bar: places, Docs, the game, a fixed account slot

The 2026-09-29 canvas (TopBar, AccountMenu, Phone) replaces the bar. The
manifest (`packages/ui/src/family.json`) now names the places (Console,
Ladder, Clan), the game (Drop, `game: true`, drawn as the "Play Drop" candy
button), Docs, the logo and the sign-in path; its `tabs` are gone. The site's
own pages moved to `apps/site/src/_data/siteNav.js`: a row under the bar on
every non-docs page and a footer on every page. Family left the menus (Jamie,
2026-09-29); its pages are still built.

The old rule "the top bar carries no signed-in state" is replaced by "the
bar's shape never varies by session": the account slot is one fixed width
(196px wide, 96px narrow). An app fills it from the session it already holds
(empty while asking, Sign in, or the person and the account menu); the static
site always shows Sign in, and `/console/signin` forwards a reader who is
already signed in (and holds no login token) to their console. Nothing swaps
after load. The Console's rail lost its identity block: who you are and the
way out are the account menu now. Clan fills the slot from Clan's own session
and signs out with its own form post; Clan's rail identity block is left for
Clan's owner. The account menu's "Signed in to" chips are not drawn: the
Console cannot see Clan's or Drop's session, so it cannot say which are
signed in. Logo: `apps/site/src/assets/elixir-logo-96.webp`, rendered from
poapkings.com's 512px source.

The Console app's bar now takes its current place from the route: under
`/ladder` it marks Ladder, and its Console and Ladder links route in the app
instead of reloading (the hook Ladder's note above left for the shell).

## 2026-10-02 - The weekly kinds as the boards draw them (email redesign, part 2)

Every kind now has the sections its board draws, from the facts its
builder already reads through the tools, with card art through one
helper (`packages/mail/src/cards.mjs`; `cardAsset` moved there from the
Card of the Week builder). The clan report links the roster instead of
printing it: with the roster table, the 46-member fixture rendered at
110 KB, past Gmail's ~102 KB clip, so the footer and its turn-off link
were hidden behind "View entire message". A 50-member week now renders
at about 51 KB against a test ceiling of 95,000 bytes. The reader's own
players are marked from `links.mine`, which `deliver` fills from the
account's tags, so an issue's facts stay the same for every reader.
Collectors gained `card_id`, `state` and `since` in their facts; an issue
stored before renders from `status`. Milestones gained `instant`,
`battle` (from the moment's own `promoted_by`) and `card`. The old clan
issue is kept as `packages/mail/test/fixtures/clan_report-2026-09.json`
and renders in the shared test.

Left out because no tool returns them (the boards drew them):

- Arena: a day-by-day split (decks, not days), "Battles worth a look",
  and "new to you" for opponents.
- Milestone: the battle's link and both decks (battles_query's `url`
  landed in 9.18.0; the link is the next change), "Earlier today", and a
  card's type and elixir (the moment carries the rarity only).
- Card of the Week: the by-month table and "You and <card>". The trend
  chart renders only when a brief carries one; its URL
  (`assets/mail/card_of_week/<period>/season.png`) is written to the jobs
  bucket and nothing serves it yet.
- Clan report: "Next week is the Colosseum" (no tool says it), and the
  buttons into Clan's week and Actions (the report links the console's
  clan page; a Clan link is a product call for a report every tracker
  gets, member or not).
- Collectors: the board's weekly points per collector (the ledger's
  week is pooled; each row shows its points to date).
- Ladder: the boards link Ladder, which has no pages yet; the links go to
  the console, and the pill still says Ladder.
- Top 100 and Card of the Week keep their written bodies: the boards'
  structured sections are a product call.

---

## 2026-10-02 - The bar marks no place on a battle's page

The Console app's bar took its current place from `here.product`, so a
public battle page (`/battle/<short id>`) fell through to Console and lit it,
and at phone width the bar's button read "Console". A battle page is in no
place: it is public and reads signed out. `barArea(path)` in `App.jsx` now
names the place from the route (Console, Ladder under `/ladder`, none on a
battle page), the app's `Chrome` wrapper no longer defaults `current` to
Console, and the kit bar with no `current` lights nothing and says Menu.
Pinned in `chrome-menu.test.jsx` beside the bar's other cases, and in
`battle.spec.ts` at both widths. The sign-in wall now says "This part of
Elixir", not "Elixir MCP".

---

---

## 2026-10-02 - Ladder's Days played page

The second Ladder slice (LadderDays.dc.html) is `/ladder/days`. It reads
`battles_query` for the current season, compact, 50 a page, through
`next_cursor` up to 12 pages (`SWEEP_PAGES`, the newest 600 battles, at most
twelve calls of the reader's quota per view, cached five minutes). When the
sweep stops early, the days up to and including the oldest day it reached
are drawn "not read" and left out of every count, since that oldest day may
be partial. Days are the account zone's calendar dates; the calendar runs
from the season's first local day to the day before its last, plus the last
morning when a battle fell in it.

Decisions: no mode tabs on this page (it is the one page that shows every
mode at once), but each mode keeps its own mark and record everywhere,
including a night across modes, where the board's one pooled record became
one record per mode as played; the two mode tiles are the two modes played
most (the board's "Trophy Road nights" counted days, so the tile says
days); "All nights" is an in-place "Show all" rather than a page; a night
opens as a disclosure listing its battles, linked through the url
battles_query returned (the path of that url, so the link stays in the app,
as Battle.jsx does); and "When you play" is left out, following the removal
of the console's rhythm tile.

Boat defenses: battles_performance leaves them out (0171) and battles_query
does not, and its compact row carries the battle's `boat.side` but not which
side the row's player was on. Days played treats `boat.side: "defender"` as
a defense, which is right whenever the battle was recorded from this
player's own log (side 0). A defense recorded first from the attacker's log
would count here as the player's battle. The clean fix is a hub field (the
player's own boat role on the row); it is not added here.

---

## 2026-10-02 - Ladder's Decks page

The third Ladder slice (LadderDecks.dc.html) is `/ladder/decks`. It reads
`battles_decks` with `season: current` once over every mode (limit 100: the
modes a row was played in, the duel rounds, the deck count), then once per
mode, so each row's record, win rate, level gap and first and last days are
that mode's own; the every-mode rows, which pool a deck's modes, are never
shown. Trophy Road and Path of Legends decks are each read again by
`deck_hash` for their cards and archetype (one call per shown deck, six per
mode until "Show all"); war, event and the other modes stay one table with
no card art, so they cost no extra reads. A view costs 1 + modes + shown
trophy decks + one battles_performance per trophy mode (the season home's
read, cached).

Decisions: the board's per-card elixir badges are left out, because the
kit's CardArt has no cost slot and a shared tile change belongs to the kit's
owner; the deck's `archetype.average_elixir` stands in, so no cards_catalog
read is needed. The swap panel appears only for two decks of one mode with
the same eight card ids and a form moved, the earlier one's last battle
before the later one's first; decks played side by side are not a "before"
and "after". Its "core four" record (the two decks summed) and the board's
"small sample" line are left out: the first is a sum no tool returns, the
second a judgment. "Compare two decks", "War in Clan" and the rows as links
are left out (no such pages). The title counts distinct deck identities
returned, rows and duel rounds together. Duel rounds come from each mode's
`duel_decks`; war is read whenever there were duel rounds, and a duel deck
no mode claims is shown as "Duel" with no mode rather than a guessed one.
A war or event deck with the same cards and forms as a Trophy Road deck
says so (compared by `card_names`, whose forms the tool prefixes).

---

## 2026-10-02 - Ladder's Cards page

The fourth Ladder slice (LadderCards.dc.html) is `/ladder/cards`, one mode
at a time with the season home's tabs. It reads `battles_cards` twice
(`perspective` mine and opponent) and `battles_opponents` once
(`min_battles: 2`), each with `season: current` and the mode: three calls a
view. `battles_opponents` is outside the Ladder brief's tool list; it is the
read-only tool built for the board's Opponents panel (its
`distinct_opponents` and repeat rows are exactly the panel), where counting
opponents from a `battles_query` sweep would cost up to twelve calls.

Decisions: a form is its own row, as the tool keeps it; the card's art is
never a link and its name is the one link, a plain anchor to the static
`/cards/<id>/` page (a tower troop has none); both tables show twelve rows
until "Show all"; the panel heads count rows and distinct cards as returned,
and the mode's battles from `modes_in_window`. A repeat opponent's name
opens their console record, as on the battle page. Left out: the board's
"Trophy Road, everyone" column (a corpus share no Ladder tool returns; the
card page has it), its "the core four carry all 34 battles" line (an
interpretation of overlapping rows; the foot says rows overlap instead) and
"Opponents ›" (no such page). The tool's own floor (`applied.min_battles`,
three) is stated under each table. The rail's Cards item adds Lucide's
`gallery-horizontal-end` to the kit's Icon set.

---

## 2026-10-01 - The Console's rail and Overview, to the canvas

The 2026-09-29 canvas (ConsoleRail "proposed", Main, Phone). Your console's
rail is `RAIL` in `apps/web/src/App.jsx`: nine items in three groups
(Overview, Timeline, Explore; Your record: Tracking, Collections, Verify;
Access: Connections, Usage; Service: Status), with Send feedback as the
kit Rail's new `foot`. The switcher in the rail's head lists consoles in
groups (`railConsoles`: You, Your agents, Operate), so the Admin console is
a console you switch to rather than a rail item; Admin draws `ADMIN_RAIL`
(People, Access, Record). The account's own pages (profile, emails,
devices, sign-ins) draw `ACCOUNT_RAIL` with the kit Rail's new `back` link
and a "Sign out of Elixir" foot. Activity left the rail: its MCP request
log stays at `/console/account/activity/requests`, linked from Usage, which
the rail lights while you read it; Activity › Emails and Sign-ins are the
account rail's (`railPosition` says where each old address lands). Every
rail item keeps a `DOC_LINKS` entry, and `rail.test.jsx` pins that.

Overview shows only what the console already reads: `/api/me` (claims,
recordings, role), `/api/me/clans` (home clan, member counts),
`/api/me/usage` and the primary's `/api/me/battle-activity`. The canvas's
Ladder trophies, arena and season record, the clan's "N of 46 have not
played a war deck today", the Status dot and "sister clan" labels are not
drawn: none has a source the console can read without spending the
reader's metered explore calls, and "sister clan" is not in the record.
The Ladder tile names the primary player and goes to `/ladder`; the Clan
tile counts members and goes to `/clan/<tag>/week` (Clan sends a clan
that is not yours to its chooser). The "live" pill is the primary's
`freshest_poll`, said as "last read", because that is any endpoint's read,
not only the battle log. The Drop tile is the kit's `.drop-card`, the one
place outside the bar that wears Drop's magenta (new `--drop-*` tokens);
it is hidden on a phone, where the bar's sheet has the game. "Your tier"
left Overview (Profile has the whole table) and `SlotMeter.jsx` went with
it. The inline-style ceiling is 545.

---

## 2026-10-02 - The cards index and a card's page, to the canvas

The 2026-09-29 canvas (CardsIndex, CardPage) as built. `/cards` is new and
on the site's row ("Cards", after Home) and footer; `/cards/<id>` is
redrawn. Both are public and sign-in free.

**Data.** `GET /api/public/cards` gains `season`
(`readCardSeason` in `services/web-api/src/routes/public.mjs`): the latest
rolled-up season's `modes` (each mode group but `all`, with its decided
battles, most decided first) and `cards` (`{card_id: {mode_group: row}}`,
every form together, the same rollup `cards_card` reads), plus `as_of`
(the hourly increment's battle cursor) and `players_as_of` (the nightly
rebuild). `GET /api/public/cards/<id>` gains `as_of`. Both keep their
cache headers. The pages need a web-api deploy for these; until then the
index keeps its catalog list and the controls that need no numbers, and a
card page shows no "updated" chip.

**Build vs live.** The build bakes only catalog facts (name, rarity, type,
cost, forms), A to Z; the season's numbers are read in the browser
(`cards-index.js`, `cards-live.js`), so nothing on these pages goes stale
between deploys and nothing is invented at build time. A test build now
bakes six real catalog rows from `apps/site/test/fixtures/public-cards.json`
instead of none, so the card pages are built and tested in CI. The card
shape helpers live in `apps/site/src/_lib/cards.mjs`: Eleventy hands a
`_data` module with named exports to templates as an object, not as its
default, which collapsed every card page onto `/cards/index.html`.

**Sitemap.** Pagination only adds its first page to collections by
default, so the sitemap listed one card page of the 122.
`addAllPagesToCollections: true` on `card.njk`; the sitemap and edge-router
tests now derive the card pages from the fixture.

**Shared CSS** (`packages/design/src/components.css`, under "card tile"):
`.card-tile` (`__art`, `__body`, `__head`, `__rank`, `__name`, `__kind`,
`__share`, `__bar`, `__fill`, `__pct`, `__line`), `.card-thin`,
`.card-elixir` (`--lg`), `.card-modes`, `.card-filter` (`--round`),
`.card-search`, `.card-stat` (`__label`, `__value`, `__note`),
`.card-months` (`__col`, `__pct`, `__track`, `__bar`, `__label`,
`__wins`), `.card-figure`, `.card-mode-row`, `.card-call`. They sit on the
kit's `.card-art*`. Bar widths and heights are set by the page scripts
from the API's numbers. `[hidden]` is restated (important) inside the two
pages, because a class or utility that sets `display` beats the
browser's rule.

**Not drawn.** The canvas's "In your record" panel: the Console has no
page for one player's record with one card to link to. The Card of the
Week panel's week share ("in 31.1% of last week's battles") is not in the
API, and "Every Card of the Week" has no archive page, so the panel links
`/docs/email`. Months are every mode together (the only history the rollup
keeps), and the panel says so. The current mode's row in By mode is marked
in the accent tint, not the canvas's gold: gold is the brand's.
Spirit Empress (28000025) has no mirrored art yet; a missing image falls
back to the kit's blank frame with the card's name.

---

## 2026-10-02 - Console battle rows open the battle's page

Explore's two battle lists (a player's battles, `list/battles:<tag>`, and a
deck's, `list/deckbattles:<hash>`) link each row's time to `/battle/<short
id>` in the app, and a battle's record view gains a `page` field. The path is
read from the row's `url` (battles_query, 9.18.0) and never rebuilt from
`battle_id`, since the server lengthens a short id where two recorded battles
share a prefix (`battlePath` in `views/Explore.jsx`, which accepts only a
`/battle/<hex>` path). A row with no `url` keeps the record view link.

No other Console surface lists battles. Verify's proof line ("Win 3-1 vs …")
is one battle read from `/api/me/verify`, which carries no `url`, so it is
left alone; Ladder's Season reads `battles_performance` weeks, not battles.

---

## 2026-10-02 - The front page, to the canvas

`apps/site/src/index.njk` is drawn to the canvas's Site board: the hero
("Your Clash Royale, on the record.") with Request access and Browse card
stats, the logo at 288px (`assets/elixir-logo-288.webp`, the canvas's own
encode of the same art as the 96px mark), six capability tiles, Drop's
band and the ten most played cards in Path of Legends. Below the board it
keeps what the page has to carry: the agent transcript (so the
transcript-link and `transcript.js` pins hold), the corpus totals baked
from `/api/public/stats`, and the request panel that holds the second
`/console/signin?request` link. "What people use it for", "How it works",
"What's new" and "For machines" are gone, as the board has them gone; the
transcript's chips and its link to the examples carry the first, /data
and /updates the others. Their CSS (`.pipeline`, `.case-card`,
`.machine-link`, `.home-section`) went with them.

**No record on the page.** The board's tiles carry samples: a player's
Trophy Road and war W-L, named friends with their records, a named
newcomer. The home page has nobody's record to show and baking someone's
would be both stale and theirs, so each sample says what that part shows
instead: Ladder's four modes and its pages, two of the calls Clan hands
leaders, what a friend gets in Wednesday's email, the four weekly emails
by their real names and days. A site test pins that no tile holds a W-L,
a percentage or a count.

**Live numbers.** `assets/home-live.js` reads `/api/public/cards` once
(the season block from the cards PR) and draws the Cards tile's three and
the strip from Path of Legends alone, with the mode's own decided-battle
count and "updated N hours ago" from the rollup's cursor. Without a
season, without ranked in it, or on a failed read, both stay hidden. The
strip needs the web-api deploy that ships the cards `season` field.

**CSS** (`components.css`, "The front door"): `.home-title`, `.home-lede`,
`.btn--lg`, `.home-art`, `.home-band` (`__head`, `__title`, `--plain`,
`__note`), `.home-tile` (`__head`, `__icon`, `__product`, `__question`,
`__text`, `__sample`, `__row`, `__caption`, `__day`, `__ask`, `__tools`,
`__cta`, whose `::after` stretches the one link over the tile),
`.home-top3__*`, `.home-drop` (`__mark`, `__body`, `__eyebrow`, `__title`,
`__text`, `__play`, the last joining the candy button's rules) and
`.home-strip` (`__item`, `__card`, `__art`, `__name`, `__pct`, `__wins`).

## 2026-10-02 - A boat battle says the player's own role (9.19.0)

Ladder's Days played (#193) dropped a battle whose `boat.side` was
`defender`, so a member's real boat attack vanished from their calendar
when the battle was recorded from the defender's log.

- **Cause:** `battle.boat_battle_side` is the API's `boatBattleSide` as the
  recording log said it, for that log's owner, who is side 0. The rollups
  already flip it for side 1 (`notBoatDefense()` in
  `packages/record/src/boat-defense-sql.mjs`), but `battles_query` passed
  the raw word through as `boat.side`, so a reader of the wire could not
  tell an attack from a defense.
- **Fix, additive:** `boat.role` is the row's player's own part, by the
  same rule as `notBoatDefense()`; `side` keeps its meaning. Compact
  carries `role` beside `side`, so a compact reader can leave a defense
  out. Ladder's day counter reads `role`. MCP 9.19.0, JSON API
  2.10.0 (`/players/{tag}/battles` mirrors the tool).
- **Pinned:** `record-to-wire.test.mjs` reads the same battle from both
  players; `ladder-days.test.js` covers a defender-log attack and an
  attacker-log defense.

## 2026-10-02 - Emails from Elixir, the console page (email redesign, part 3)

Profile → Email is redrawn from the ConsoleEmails board: the weekly kinds
on a Monday-to-Sunday week by the day each arrives in the account's zone,
the two event kinds (Milestones, Clan actions waiting) below it, the last
four sends beside them, and Every email at the top. The page derives
nothing about the schedule: `GET /api/me/email` now returns each kind's
`product` (the mail pill's `MAIL_SOURCE`), `sends` (`sendTime`, the
footer's own function, in the account's zone; null for event kinds) and
`last_send_id`. `PUT /api/me/email` accepts kind `"all"`, which
`setPref` already understood from "all" unsubscribe tokens; Every email
is on only when all eight are. Who receives each kind, its schedule, its
default and the footer's per-kind link are unchanged.

Choices against the board: its "Preview ›" is "The last one ›", the
account's own most recent send of that kind (there is no preview route
for a kind, and a mail rendered from someone else's facts would not be
theirs); a kind never sent shows no link. A not-applicable kind
(Collector activity without a collector) is a dashed card with a
disabled switch, not faded: the first cut used opacity and axe failed
its contrast. In a seven-column week the switch wraps above the product
chip instead of squeezing it. The page sheds one inline style; the
ratchet ceiling is left for whoever lands last to lower. Journeys:
`apps/web/test/email-page.test.jsx` and `apps/web/e2e/email.spec.ts`
(wide, and @narrow with no sideways scroll).

Left for Jamie: the board names the Thursday kind "Ultimate Champions";
the page keeps the API's "Top 100" until the masthead name is decided.

## 2026-10-02 - Battle links and Ladder in the mail (email redesign, part 4)

The milestone's "The battle that did it" now links the battle's page.
`buildMilestone` passes the issue's `promoted_by` battle ids through
`battleLinks` (`@elixir-mcp/record/battle-links`, the read battles_query's
`url` uses since 9.18.0) and stores `battle.url` in the facts, so a
re-render of the stored issue keeps the same short id even after a later
battle comes to share its first twelve characters. An issue stored
before today has no `url` and renders without the link.

Ladder has pages now, so the two kinds about the reader's own players
link it: the Arena week's button opens the primary's season
(`/ladder?player=<tag>`) and its deck links Ladder › Decks; the
milestone's button opens that player's season. Ladder never reads a
tag that is not the reader's, so the friends report and the clan
report keep the console's record pages for names.

From Track C's review: the Top 100 footer read "Turn off Ultimate
Champions", the masthead placeholder. Both written kinds now name the
switch ("the Top 100", "Card of the Week"), whatever the masthead
becomes. The milestone's "Next:" line was never filled (the builder
wrote `next: null` since the first version), so it is removed rather
than invented. email.md said "Five of the eight are reports" against
its own "four weekly reports"; it now counts four weekly reports, the
milestone note built the same way, two written pieces and Clan's note.

Still left out: the milestone board's two decks under the battle (the
battle page's read lives in web-api's `battle-page.mjs`; the jobs
service would need it in a shared package first), and the Arena board's
"Battles worth a look" (no tool picks a closest win or a war duel).

## 2026-10-02 - The site escapes text once

The tool family pages showed `&amp;quot;mine&amp;quot;` (Track C's docs
review): the site's own `esc` filter escaped a description and Nunjucks
autoescape escaped the result again. Two more paths did the same:
front matter rendered into data (`title: "{{ ex.title }}"`) came out
escaped and was escaped again in `<head>`, and the outline's heading text
was marked's HTML, escaped again.

- `esc` is gone; autoescape is the one escape.
- Templated front matter takes `| safe`, so the data holds raw text.
- `headings` decodes marked's entities, so `h.text` is plain text.
- `site.test.mjs` sweeps every built page for an escaped entity.

## 2026-10-02 - Operator acceptance-capacity watch

The queue's 2026-10-01 acceptance receipt reported 24 failures across 1,189
cases. The product-contract cases (Gym 183.3 and 349.1, `war_history` notes,
and record-versus-game war standings) remain with Elixir Feedback Manager and
need Jamie's decision where the queue says so. The Operator capacity portion
was read, not replayed: a full rerun is forbidden until triage is complete.

At 09:48Z, `/api/public/status` was green: 1,090 battles in the prior hour,
four-second fetch/admission freshness, zero queued, leased or dead ledger
jobs, zero outbox DLQs, five fresh signed v3.0.6 active collectors, and 16
capture gaps in 21,035 polls. `{stats:true}` agreed: 819 battle-log polls in
the trailing hour with zero gaps, 20 prior-day fetch errors (ordinary 404s
plus three transport receipts), and no current fetch errors. All
`elixir-mcp-*` alarms were quiet.

`{audit_census:{days:1}}` attributes the latency tail almost entirely to the
acceptance principal (1,870 calls; 83 adversarial/refusal outcomes). Its
normal readers remain under the 18-second query budget but are close enough to
watch: `battles_meta_cards` p95 17.7s with two timeouts, `cards_card` p95
14.9s, and `badges_rarity` p95 6.0s. Read-only `{profile_tool}` reproductions
show the source cost: the seven-day corpus card meta path reads
`meta_season_pop` and makes tens of thousands of deck-card probes; the
full-season Knight card profile scans `battle_participant` and `battle`, then
walks card-bearing decks for its exact partner block. These are measured
walks, but they do not yet identify one small index that collapses the served
query without moving the product contract. No runtime, schema, collector, or
production mutation was made. Reassess only with a repeated natural/read-only
receipt; do not loosen ceilings or add an index from a single cold-plan read.

## 2026-10-02 - Assessment improvements: analytical reads, historical presence and first use

Jamie approved recommendations 1, 2 and 3. The fleet recommendation is
withdrawn: he runs all five collectors across three locations with no shared
infrastructure; no collector change is needed.

The bounded production profile of seven-day corpus card meta read 59,289
deck-card index probes, 21,885 deck-card blocks and 18.3 seconds cold. Corpus
card reads now materialize deck identities once, while small segment reads
retain their indexed join. Trends reuse one selected battle population for
weekly totals, modes and distinct players. Season card partners read the
existing meta population plus raw battles learned after its cursor, so a
late capture into an old game day is counted once, including a rebuild day
that already overlaps the raw tail. Cursor and rows share one query snapshot. Scratch equivalence tests
cover cache, tail, absent cache, form and trophy-band paths. No migration,
instance resize, cache reset or raised acceptance ceiling is involved.

Historical clan presence retains historical tenures. Window-end quiet and
never-recorded summaries select membership at that end; crossing/return
moments select membership and role at their own time, including returns
learned after departure. A regression reproduced disappearing
presence after a later departure, and now holds the closed window equal;
future joiners are excluded. Contract 9.19.1, unchanged response schemas;
elixir_timeline has no JSON API mirror, so that contract stays 2.10.0.

Overview links incomplete setup, offers its first supported starter question,
and separates an authorized connection from its successful data read. The
profile alone supports a first question and a clan is optional. Long inline
code wraps in the phone quickstart; preformatted commands keep their own
horizontal scrolling and are keyboard-focusable. The shared design change is checked in both apps.

Preflight queued three existing findings: loop's 2026-10-01 product-contract
acceptance failures, run's analytical latency failures (also #195), and
Clan Operator's five successful slow clans_participation reads. This run
addresses card/meta/trends latency; the unrelated product cases and Clan
participation latency remain routed to their owners. Acceptance is scoped
to battles, cards and elixir for these changes; the full untriaged suite is
not replayed.

Pre-deploy gates: `npm run verify` green across every workspace; 97 focused
tool/identity/history regressions and all 72 browser journeys (57 Console,
15 Clan) pass. First use was rendered at 1440 and 390 pixels with no page
errors or horizontal document overflow; quickstart at 390 pixels passes
the layout and serious/critical accessibility checks. The consistency trace
reviewed MCP, Console, shared summaries/mail, docs, ledger and JSON API
mirrors, and corrected delayed returns, tenure roles and boundary guards.


The 9.19.1 deployment of PR #213 (`404d82fe`) updated the stack with no
new migrations and passed all 43 smoke checks. Clan's shared-design CI deploy
also passed. The scoped battles/cards/elixir acceptance ran 498 cases,
17 failures, 18 guarded skips and 423 distinct calls. Every failure was triaged:

- Corpus card meta's seven-day budget passes (7.3s, below 15s). Card profile,
  synergy and weekly trends retain cold latency failures: Gym 324.1 and
  catalogue battles_trends#1, cards_card#0/#2, cards_synergy#0/#1. The exact
  deployed profile shows partners reading 144,928 blocks and writing 56,033
  temporary blocks. The follow-up narrows deck identities to the anchor,
  bounds raw participants by newly recorded battles before expanding rounds,
  and sends card-profile deck filtering to SQL. Trends' cold plan fetches
  32,350 participant blocks across 1,236 player-index walks; its follow-up
  bounds corpus rows by time before applying recorded-player membership.
  This is fix-forward, with the same ceilings and no new index or migration.
- Gym 303.1/.2/.4, 304.2 and 318.1/.6 assert today's-roster behavior that the
  approved historical-membership decision replaces. The amended cases retain
  exact overflow counts and inclusive-to/exclusive-from controls. The wide
  September 8-19 presence window restores two crossings for historical members
  and excludes one return before an observed join (19 versus 18 moments).
  Seven expired historical-presence known entries are removed; 267.2,
  272.4/.5 and 303.3 already pass without amendments.
- Gym 196.2's guard ignored the existing five-expected-battle warning floor.
  The live subject has one captured of three expected battles; no warning is
  correct. Eligibility now requires comparable intervals totaling at least
  five, retaining the low-ratio and named-warning assertions and control.
- Gym 285.2's separate current-season reads disagreed by three games; rerun
  alone passed. The record can advance between reads. No product or tolerance
  change was made.
- Gym 154.1/.4 and 207.1 reproduce alone: August's final rollup (as of
  September 26 13:34:50.405Z) has 51,568 decided games, while the raw August
  window now has 51,638; Witch has 8,354 versus 8,358. This is the existing
  final-versus-raw snapshot issue, routed to Elixir Data Auditor for the
  final-snapshot decision, with known entries expiring October 9. The
  September 24 finalization rule remains intact; this run does not rewrite
  an older final cache or change canonical data. The parity cases stay active.
- Existing known rankings 342.3 remains with Rankings Analyst; this change
  does not alter reset-board history.

The follow-up is contract 9.19.2, unchanged JSON API 2.10.0. The first-use
read-back passes at 390 pixels with no page errors, document overflow or
serious/critical accessibility violations. Public tools and changelog confirm
9.19.1; the production pipeline and five signed v3.0.6 collectors stay healthy.


PR #214 (`7f9e36c6`) shipped 9.19.2, again with no new migrations and
43 green smoke checks. The scoped battles/cards gate ran 310 cases,
six failures, eight guarded skips and 279 distinct calls. Card profiles
now pass: catalogue Knight 8.1s (previous gate 17.9s), Barbarian Barrel
10.9s (previous 15.6s), and the formerly timed-out Archer Queen case
10.9s. Card meta's seven-day budget passes at 7.6s.

Two remaining tight budgets are fix-forward: catalogue trends#1 at 4.4s
against 4s and synergy#0 at 8.6s against 6.794s. The exact trends profile
still reads 27,593 participant heap blocks before retaining 1,078 recorded
ladder observations. Its final query selects covered player/time keys,
filters recording membership, then fetches the heap-only values. A seeded
regression holds multiple distinct games at one timestamp, a mixed mode
and an unresolved result, without multiplication or changed exclusions.

The exact synergy profile reads 142,897 blocks: three population-table
scans plus the full participant heap despite a bounded recording cursor.
The final query reads anchor-bearing cached participants and every duel
parent once, expands rounds afterwards, and probes participants only for
bounded recent battle IDs. The overlap check remains against the full
cache's primary keys; its planner barrier prevents another full cache scan.
The absent-cache path bounds battle IDs by the canonical season time.
Cache/tail/form/band equivalence still passes; no index or migration is needed.

The other four failures (Gym 116.3, 203.4, 287.4 and 322.4) reuse one
collection meta-decks response. The first isolated rerun also failed;
`audit_census` over the gate window confirms two meta-decks query timeouts.
The subsequent exact call returns in 2.9s with all membership/sync notes;
each assertion is rerun alone. This is the existing cold collection-read
latency item, retained for Elixir Operator under #195, not a text change.
No note assertion or query ceiling is weakened, and no new known entry hides it.

The finalized-August parity and pre-fix rankings exceptions remain as
previously triaged. This final tuning patch is 9.19.3; JSON API stays 2.10.0.

## 2026-10-02 - Elixir right sizing direction and assessment

Jamie reframed Elixir as the recorder for enthusiastic players and clans,
with personal exploration, friends, useful emails and clan management at its
center. MCP is a connection to the record, not the product's definition.
Jamie confirmed removal of global leaderboard capture and history while
retaining profile-reported player ranks, and inclusion of full Clan
consolidation into one application, session, storage and deployment. Ultimate
Champions and Card of the Week are removal targets from the original request.
These supersede the earlier top-of-ladder positioning, ranking dial, separate
Clan architecture and unconditional archive-retention decisions. Runtime
retirement and irreversible deletion have not happened.

The engineering assessment and implementation sequence are in
`docs/reviews/2026-10-02-ELIXIR-RIGHT-SIZING.md`; the purpose is recorded in
the public About page, not a second product spec. Jamie subsequently
confirmed the corpus/meta and recommendation removals in this same session
(the follow-up entry below records the scope).
Social and model drafting remain separate product calls. No contract version
changes in this documentation round.

Read-only migrate stats/tables measured 33 accounts, 1,027 active recordings,
686 ranking-origin recordings, 653,635 battles and a 9.41 GB database. Origin
is not a safe deletion selector. Per-battle observer provenance lives in the
archive, and the archive is versioned: retention overlap and exact object
versions must be established before an approved purge. Exact removable
battles, archive bytes and financial savings are not yet measured.

The original simplify worktree contained pre-existing work and was left
untouched. This assessment was prepared from origin/main 62032320 in its own
worktree. Public health and the two read-only ops passed; no production
writes, schedule changes, sends, lease claims or data deletion occurred.

Queued implementation: settle the additional cuts, stop capture and
editorial delivery, remove the capabilities and their replay paths, build a
private reviewed purge manifest, execute the bounded purge, consolidate
Clan with an import rehearsal and one authoritative writer, then remove
obsolete infrastructure and maintenance ownership. Each runtime step uses
the repository gates and live read-back.

Validation: `npm run verify` passed for the documentation proposal, including
the merged site build and all workspace tests. Runtime and data retirement
remain pending; this proposal is for review, not a production removal release.

## 2026-10-02 - Game wide meta and recommendations are confirmed removals

Jamie: "Yes, retire game-wide meta statistics and corpus-powered
recommendations. Our job is recording what you and your friends do, sending
notificaitons, making that avialble to agents, and being a dashboard where you
can explore what has happened." Then: "Recommendations are going OUT. Game
wide meta OUT."

The plan and decision ledger now mark those capabilities for removal rather
than as proposals. Remove public corpus card/deck statistics, global meta
analysis, deck-set and upgrade advice, scoring/candidate/prior machinery and
their dependent rollups. Do not substitute recommendations over a friends
cohort or a smaller corpus. Keep factual personal and clan exploration, card
catalog/art and canonical deck identity. Clan management remains in scope;
this decision retires gameplay advice, not the clan's policy/action engine.

The About page records the four responsibilities: recording the circle,
notifications, making the record available to agents and a dashboard for
exploring what happened. Runtime removal and data deletion remain pending.
Regional/mode boards, autonomous event/tournament capture and Clan social/model
features remain separately labelled proposals. No contract or runtime changes
in this documentation follow-up.

Follow-up validation: `npm run verify` passed. The final About-page wording
also passed the docs corpus tests and merged site build/tests (9 and 34
tests). No runtime changes or production writes were made.

## 2026-10-02 - Collections are a confirmed retirement

Jamie: "we already have a classification of friends, alts, etc for accounts
we are following. Move forward with retiring collections."

The decision ledger and right-sizing plan now retire all named player/clan
recording Collections, including public, private and manually curated groups.
Keep existing primary/alt/friend/watching classifications and private
nicknames. No replacement grouping feature, suggested-creator catalog,
speculative recording or popularity-based quota exemption is introduced.

The cutover must distinguish deliberate user requests from board/ops and
integration populations, preserve legitimate historical evidence and shared
recordings, and check pooled player/clan quotas before ordinary tracking
migration. Drop's refresh worker awaits collection enrollment before profile
refresh; Jamie then confirmed "we should remove that feature from drop."
Remove Drop's automatic enrollment call/helper/client operation, collection
config and sync script in its own change; verify queued refreshes and deploy
Drop before retiring collection API operations/grants. No replacement
integration enrollment feature is planned. Keep the person's OAuth tracking
and unrelated profile reads/refreshes. Do not turn integration or
board populations into the owner's follows. Preserve the clan tracking
handlers currently colocated in the collections web API module.
Keep recorded owned-card collections, card levels and form-unlock history;
those are game facts rather than named recording groups.

Jamie explicitly confirmed that Drop using Elixir as an authentication method
and gaining authorized account access is useful and within scope. The plan
and decision ledger preserve Drop's OAuth sign-in/client, consent and account
access independently of the removed automatic collection enrollment.

About, Recording, Integrations and the product update distinguish the
ratified direction from still-deployed behavior. This follow-up updates the
draft planning PR; runtime removal, contract changes and data deletion remain
pending. No production writes, sends, schedule changes or lease claims.

Validation: `npm run verify` passed for the Collections plan update. Final
scope clarifications passed formatting, docs corpus tests (9) and the merged
site build/tests (34). Drop's runtime source was read to verify the dependency;
its code and deployment have not changed in this planning PR.

## 2026-10-02 - Right sizing: stop global capture and editorial sends

Jamie authorized implementation of the ratified right-sizing plan. First
runtime cutover: contract 9.20.0, JSON API response shapes unchanged.
Global leaderboard endpoints are refused before enqueue, lease and archive
admission, including historical replay. The planner no longer seeds boards,
the leaderboard catalog or missing season finals. Remaining bulk work is
checked against active player/clan capture authority; intentional live
player/clan reads remain available.

Ranking presence and the four board Collection slugs no longer confer
recording authority. The bounded `retire_board_recordings` operation previews
by default and reconciles active subjects using remaining claims, account
clans, other Collections and explicit ops reasons. Apply disables all board
dials and consumes obsolete jobs in bounded batches without penalizing collectors,
including expired obsolete leases beyond the current cleanup batch. It preserves
recording provenance and every game fact and archived payload. No canonical
schema migration is needed for this reversible control-state cutover.

Ultimate Champions and Card of the Week schedules and permissions are removed.
Jobs, direct composition/delivery, editor and relay boundaries consume retired
work without sending it; forcing a send cannot bypass retirement. Their
switches are absent and cannot be re-enabled. Existing sent history and old
unsubscribe links remain usable. Editor infrastructure and historical renderers
remain dormant until the later deletion phase.

The installed Rankings Analyst automation was already PAUSED; the repository
manifest and generated schedule now agree. No board writer was found in this
machine's LaunchAgents. Runtime refusal also protects a writer on another
machine. Collections other than the four retired board populations remain
transitional, including Drop's enrollment; their separate consumer cutover
has not shipped. Meta/recommendation removal, full Clan consolidation and the
reviewed database/S3 purge remain pending.

Runtime PR #218 merged on green `validate`; deployed main
`9ca9fe0e56ee1614d16685e0c44e50f07feb7bbc`. `npm run verify` passed,
the merged site built, and Playwright passed 57 Elixir and 15 Clan journeys.
CloudFormation lint had no errors; its two warnings (Postgres 17 deprecation
metadata and an SNS action) reproduce on the prior main template.

Production receipt: CloudFormation `UPDATE_COMPLETE` at
2026-10-02T14:23:12.298Z (the stack's event, not its update-start time),
schema 195 already applied, zero migrations run, contract 9.20.0 on
`/tools.json`. All 43 deployment smoke checks passed. The eight editorial
schedule/permission resources are absent from the deployed stack.

Under the session lease, preview traversed 1,028 active recording subjects:
956 would stop, 72 would remain. Apply matched in six bounded batches
(200, 200, 200, 200, 200, 28), disabled 302 board configurations and stopped
956 recordings. No obsolete queued/leased/dead jobs remained to consume;
every batch reported `retired_jobs_pending: false`. Repeat preview checked
the remaining 72, stopped zero, and returned `done: true`. No game facts,
membership provenance, historical boards or S3 payloads were deleted.

Read-back at 2026-10-02T14:53:29.138Z: public health healthy, last admission
36 seconds ago, five active collectors, zero queued or leased jobs, zero
dead jobs and zero DLQ messages. Due work was player/profile and battlelog
reads. This proves continuing capture, not a user-capacity estimate: the
fleet still shares one 1 request/second budget.

The prior orphan lease was cleared only after verifying its chat was
interrupted, its worktree absent, the stack settled, and migrate's backend
read showed no active work. A shared Codex process PID was not treated as
proof the former session was still running. The new session lease covers
this deploy and bounded cutover only.

Full production acceptance was **red**: 1,189 cases, 15 counted failures,
58 skips, 789 distinct calls. It was not repeated wholesale or relabelled
green. Each failure has this verdict:

- `budgets/clans_participation`: 16,065 ms against 8,000; alone 16,127 ms.
  Open performance defect on the retained clan tool, not a flake. Keep
  its ceiling and repro unchanged; carry it into the Clan consolidation.
- `gym/154.2`: corpus `cards_synergy` query timeout; alone passed in
  17,709 ms. File the timeout/jitter here; the global corpus path is
  explicitly pending retirement, not optimized or exempted by this phase.
- `gym/183.3`: old Hunter/current-clan fixture was present before cutover;
  after cutover its clan is no longer recorded and the read correctly
  refuses `not_recorded`. Live fixture no longer applicable; retain the
  case until the badge/corpus retirement reviews its replacement coverage.
- `gym/185.4`: the same formerly active Hunter appeared in the corpus;
  after the authorized cutover the control passes alone (2,661 ms).
  Control preserved unchanged.
- `gym/285.2`, `gym/304.1`: different live read moments, as at 9.12.8;
  both pass alone (16,372 and 3,869 ms). File the comparison race here,
  leave assertions and tolerances unchanged.
- `gym/337.1`: clan no longer recorded; repeats alone. Existing moved
  live fixture (9.12.2/9.12.7), not a new roster regression. Preserve the
  refusal rather than enroll a clan solely to make a test pass.
- `gym/343.2`: old board-note live fixture still fails alone, as at
  9.12.8. Pending history/tool retirement; no new `known` exemption.
- `catalogue/badges_rarity#1`: 5,374 ms against 4,000; alone passes
  (3,614 ms). Timing jitter filed here, ceiling unchanged.
- `catalogue/cards_synergy#0`: 9,238 ms against 6,794; alone 12,496 ms.
  Open corpus performance defect on a path pending retirement; no widened
  budget and no claim this gate passed.
- `catalogue/clans_participation#2`: 16,065 ms against 15,000; alone
  passes (10,979 ms). The stricter budget case above remains open.
- `catalogue/cards_archetype#docs`, `elixir_collectors#docs`: methodology
  names `archetype_census` (operator op) and `submit_retry`/`retry_statuses`
  (collector config), not MCP result fields. Allow their verified surface
  names with reasons in `catalogue-allow.json`.
- `catalogue/elixir_timeline#docs`: attested `previous_name`,
  `previous_player_tag`, `previous_best` were absent in this window, but
  are served by the conditional attested-fact path. Allow with reasons;
  do not manufacture a private fact as a test.
- `catalogue/war_history#notes`: sampled historical week had no periodLog
  day rows; `end_of_day_rank` is real on populated days, pinned by scratch
  war tests. Allow the conditional field with its reason.

The five already-known historical snapshot/board-gap failures remain
reported under their existing expiries. No new known-failure entry, deleted
control, broadened timing ceiling or production test write was introduced.
Narrow catalogue reruns answered all four groups and passed their notes
checks, including `war_history#notes`. Their shared-doc checks cannot be
used as a whole-suite green gate: they inspect the union of every response
in the run, and selecting only one group omits fields from other tools
(`bridge_spam`/`named_by`, collector `fetched_at`, other timeline kinds and
war-current/participation fields). Those reduced-union failures were
inspected; no further allowance was added to compensate for missing reads.
Receipt verification initially hit a local Tailwind subprocess `SIGABRT`
with empty stderr on the design-token test; its other three checks passed.
The unchanged design suite passed all four alone. Filed as a local tooling
flake here; no assertion, test or dependency was changed to make it pass.
The first runtime cutover is live; these open performance/fixture items
mean the full acceptance gate remains red. Collections/Drop enrollment,
meta/recommendation removal, full Clan consolidation and reviewed historical
database/S3 deletion remain separate unfinished stages.

Cutover review tightened job cleanup to bounded `SKIP LOCKED` batches with an
explicit remaining-work check. Fleet bulk admission holds the shared session
cutover lock across errors, archive and projection; reconciliation acquires
its exclusive transaction counterpart and drains submissions already in
flight. Scratch regressions cover a skipped locked job, 1,001 obsolete expired
leases without collector penalties, and an admission paused in archive IO
while reconciliation waits. No production writes are used as tests.

Pre-push validation: `npm run verify` passed through all workspace tests.
Browser gates passed 57 Elixir journeys and 15 Clan journeys, including axe.
A prior local attempt collided with a concurrent site build; the final verify
ran sequentially. CloudFormation lint reports no errors and only the same
W3691 and W3037 warnings as the current main template. No stateful resource
is changed by this schedule removal. The reference vocabulary files are clean,
and acceptance credentials are available by local ignored file reference.

## 2026-10-02: Collection retirement, dependent caller first

Drop PR #73 (`236ff13c3c1e3c7ff736449aa7908ce2f4c2e47c`) merged and deployed via run 37026214468. Production CFN `elixir-drop-prod` UPDATE_COMPLETE at 15:20:29.235Z; API, refresh and CR-results Lambdas Active/Successful at 15:20:50Z, with no Collection environment setting. Stack parameter removed. Verify:non-browser passed 644 API + 697 web tests; CI browser gates and deployed API checks passed. OAuth sign-in, account access, personal `/me/players` tracking, profile reads/refreshes and refresh queue behavior remain. No synthetic user traffic or mail was created. No installed sync-elixir-collection automation/LaunchAgent was found. Drop lease released after read-back.

Elixir cutover removes Collection CRUD routes/tools, integration add grants, selectors, quotas and UI, and stops Collection-only capture through the shared recording evaluator. Direct tracking and operator exceptions remain. No membership, canonical fact, archive payload or historical grant is deleted. This preserves provenance for the later exact purge. The optional preference question about five curated clans received no reply; the default is existing direct follows only, consistent with retirement. No personal follows or notification choices are fabricated. Contract 10.0.0; JSON API 3.0.0. `retire_collection_recordings` provides bounded preview/apply with the existing capture lock and obsolete-job cleanup.

Queued notes reviewed before release: 2026-10-01 loop/run reported 24 acceptance failures and explicitly requested triage before rerun. The 9.20.0 receipt above triaged every current failure; full acceptance remains red and is not claimed healthy. The queued 2026-10-02 Clan note attributes five successful participation reads of 9.9–16.4s to Elixir; this is the same open latency issue, not resolved by this cutover. Request IDs: 28eb047c-5fd9-4ecb-8394-a3736014bfe7, 201eb317-5b89-40f0-82bd-662e1f1d185e, a4bba8db-1c54-43e9-bfaa-d7dd669d5374, d9ba0f8e-4f62-44af-8de7 (the queued note was itself truncated). Queue evidence is transcribed without hiding the open work.

Collections validation: final `npm run verify` passed; built-site validation passed; `npm run e2e` passed 57 Elixir and 15 Clan journeys with axe. Inline-style ceiling lowered from 534 to the measured 485; its focused test passed. Read-only consistency reviews found and closed remaining selector declarations/docs, Connection scope display, write-only service-key semantics, obsolete grant input (now refuses before policy mutation), and account-removal FK handling for inert grants. Scratch account removal reports and clears only grants attached to the removed person's historical Collection rows; no production account removal was invoked. The 59 retired Collection acceptance criteria retain their dated refutation; 20 corresponding known-bad captures remain archived and their obsolete bite gates explicitly skip. No remaining capability's assertion was relaxed.

## 2026-10-02: Collections production receipt (10.0.0 / JSON API 3.0.0)

PR #220 merged at d6bbab8998dbcced4079adb7e81536d6af1fdc8f, validate 37029381518 green. Elixir stack reached UPDATE_COMPLETE at 15:55:08.228Z (stack event, not the update-start timestamp). Migrations remained at 195 with zero new migrations. Live tools.json is 10.0.0 with no Collection tools; integration OpenAPI is 3.0.0 with no Collection routes; status is healthy and changelog serves the breaking retirement. Integration list read-back has no Collection grant/permission surface.

Under session lease 21e9910e-9b82-4125-ad61-bfc4a80f596b, bounded retirement preview checked 72 recordings: 44 unsupported, 28 retained. Apply matched the preview, with no board settings/jobs left to retire. Repeat preview checked 28, stopped zero, retained 28, and reported done. No canonical history, archive payload, membership or historical grant was deleted, and no follow or notification choice was manufactured.

Full acceptance remains **red**: 1,189 cases, 41 failures, 115 skips, 751 distinct calls. Every failure was inspected; no new known exemption, wider ceiling or synthetic enrollment was added. Verdicts:

- budgets/clans_participation: 15,034 ms against 8,000; isolated 7,705 ms. Prior repeated 16s runs remain an open retained-tool performance issue; one faster rerun does not resolve it. catalogue/clans_participation#2 shares that same 15,034 ms read against 15,000.
- budgets/meta-decks-clan-season: 16,133 ms against 10,000; isolated 9,829 ms. Timing variation on a path explicitly pending retirement; unchanged ceiling.
- gym/103.1, 156.3, 324.2, 325.6 and catalogue/cards_card#3: personal/clan card-profile query timeouts. Narrow gym/103.1 passed in 14,614 ms; no claim all timeouts are resolved. The next phase replaces the global/profile statistic work with factual selected-history reads. gym/349.9 passed in isolation (9,813 ms); its initial missing card field was inspected as a failed read, not catalog identity loss.
- gym/103.2, 283.2, 285.2 and 327.1: separately timed card/meta/profile comparisons changed between reads or saw failed reads. All passed in isolation (9,007, 7,592, 10,241 and 9,543 ms). Assertions and tolerances remain unchanged.
- gym/283.1: its card-profile read failed during the full run, so its observed_at note was absent. A direct read succeeded and includes the recorded inventory timestamp note.
- gym/92.1, 144.4, 185.5, 193.1, 193.3 and 193.4: old corpus badge fixtures assume a specific badge/pair remains held after recording cuts. Direct corpus read now has 59 profile-bearing players and a Royal pair held by one distinct player; the note correctly uses singular player, while the fixture requires plural players. The Classic pair/2v2 row need not occur. Pure badge naming/pair semantics remain scratch-covered; corpus access retires next.
- gym/183.1, 183.2, 183.3, 194.1, 286.1, 286.2, 286.3, 301.2, 308.1, 308.2, 308.3, 309.1, 309.2, 323.1, 335.2, 337.1 and 337.2: these reads name clans whose Collection/board-only recording stopped. Direct inspection of #P9GPQ2Y0, #Q9QPPGGG and #8UJ2UUJ8 confirms not_recorded, so their old coverage/statistics notes are absent by design. #GRJ20LQP is the previously moved roster fixture. Do not enroll subjects to satisfy an obsolete fixture. Retained scoped behavior/refusal paths stay scratch-covered.
- gym/343.2: the previously failing historical board-note fixture still fails; board tools retire next. gym/346.4: old board fixture expects the previous recorded-location list, which cutover changed; same retirement.
- catalogue/cards_card#1: derived usage still passed a Collection selector; the release correctly refuses bad_request. Canonical read-only catalogue refresh removed this obsolete argument set: 32 tools, 83 sets, seven-day window. Refresh is a reviewed fixture diff, not a gate exemption.
- ground/war-standings-agree-with-the-game: the 10-minute-fresh asynchronous poll had 14,150 fame versus the live game's 14,600. Isolated read subsequently agrees. Record/game counters can move between capture and the reference read; the exact-equality control stays unchanged, with the comparison race recorded here.

The gate is not healthy merely because scoped reruns pass. Retained participation latency and card-query timeouts remain follow-up work. The three previously queued notes are transcribed in the preceding entry; they were cleared only after comparing the queue to the same reviewed snapshot. Drop's earlier CFN timestamp in the preceding entry was its update-start timestamp, not its completion event; its successful deployment and Lambda read-back remain verified.

## 2026-10-02: Recorder scope, global statistics and recommendations retired

MCP 11.0.0 removes nine board/meta/recommendation tools, corpus segments, card/archetype corpus fields, public global card statistics, both meta rollup schedules and the editorial model service. JSON API remains 3.0.0; none of its mirrored operation shapes changed. The game calendar stays; war-calendar unresolved health moves to the existing hourly operational sweep, and factual archetype stamping shares the existing nightly activity job. No new timer, metric or infrastructure lane is introduced. Editorial and dead-letter queues were read-only checked empty before removal. Sent mail and historical canonical/archive/Collection provenance are preserved for the later reviewed purge.

Scoped card reads now query the selected player or current clan members' first observed play by form, plus requested-window clan played facts and observed holdings; they do not read game-wide rollups or partners. Cards and home are built catalog/recorder surfaces without global-statistics fetches. Archived acceptance bites remain; obsolete Gym criteria carry dated retirement reasons. Retained personal, clan, war, identity, coverage and timeout controls remain. This stage has no canonical schema contraction. Validation and production receipt follow after gates.

Recorder-scope validation: final `npm run verify` passed after rebasing onto the Collections receipt (`39b937e5`). `npm run e2e` passed 51 Elixir and 15 Clan journeys, including catalog search/rarity/cost/sort and factual card pages at phone, tablet and desktop widths, reduced motion and axe. One journey originally addressed Sort as an exact label whose surrounding label included options; addressing the rendered Sort combobox fixes the selector. Scratch card regressions retain player freshness and tower play, exclude unrecorded current members' incidental opponent histories, preserve unknown inventory, and carry event-aware per-mode counts beside member results. CloudFormation lint has no errors; its two warnings (Postgres engine default and the existing SNS receive policy) are identical to current main. The Rankings Analyst's paused installed `keep-the-boards` automation was deleted and its repository schedule/lease key retired. Final read-only inspection found both editorial queues at zero visible, in-flight and delayed messages. No live history write or purge has run.

### 2026-10-02: recorder runtime deployment, live gate and 11.0.1 correction

PR #222 merged at 5f9b9c82. The stack's actual UPDATE_COMPLETE event is
2026-10-02T17:05:57.834Z (the update began at 17:01:59.831Z); migrations
reported 195 applied, zero new. MCP 11.0.0 removed the nine global board,
meta and recommendation tools and the editorial Lambda, queues and model
parameters. No canonical history, sent-mail record or S3 payload was deleted.
The installed keep-the-boards automation was deleted after retirement;
no board launchd installation was found.

The initial deploy smoke stopped before acceptance because its Tools page
title still expected Elixir MCP. The actual document title is Tools - Elixir.
This PR corrects that stale assertion; the repeated read-only smoke passed.
The full separately invoked live acceptance completed: 1,133 cases,
28 failures, 357 skipped and 518 distinct calls. It was RED, not a healthy
release. Every failure has the following disposition:

- Fix forward: contracts/recorder-cards-facts, catalogue/cards_card#0,
  gym/324.2, 325.1, 325.3 and 325.6 timed out on earliest selected-history
  play. The deployed profile op's log confirms that exact query exhausted
  its 30-second statement limit; catalog/identity reads were milliseconds.
  The official AWS MCP synchronous Invoke timed out at its client and
  produced three read-only profile logs, so this receipt does not call it
  one invocation. No repeat was requested. 11.0.1 uses the shared deck/card
  identity projection for earliest form play and removes the unused battle
  join, preserving selected subjects and duel rounds. Limits stay unchanged.
  gym/283.1 and 283.2 read the same failing card response; keep their factual
  inventory coverage, and explicitly name observed_at versus since in notes.
- Decision changed: gym/105.2, 107.1, 156.1, 232.2, 261.1, 261.3 and 280.1
  still asserted retired archetype corpus counts, meta exclusions, upgrade
  targets, the recommendation example or routing to corpus. Refuted with
  the dated decision; cases and controls remain as history.
- Unavailable historical fixture: gym/183.1, 183.2, 183.3, 194.1, 286.2,
  301.2, 308.2, 308.3, 337.1 and 337.2 target clans whose recording reason
  retired. Their coverage and unknown-inventory criteria remain valid and
  explicitly blocked awaiting a naturally recorded partial-profile clan.
  No automatic recording was restored for a test.
- budgets/clans_participation (10,057 ms against 8,000) and gym/335.2
  (historical clan timeline note) were rerun alone. Participation passed at
  5,862 ms; its previously open performance item remains visible. The timeline
  returned not_recorded, confirmed by a direct read-only shape check; marked
  blocked for the same unavailable-fixture reason, not a note regression.
- catalogue/elixir_docs#docs named five quickstart OAuth parameters absent
  from this run's MCP history responses. Added narrowly explained docs
  allowances for registration/authorization/token exchange fields, preserving
  the response-field audit for recorded facts.

Discord PR #16 merged at 8435f954 and v0.3.1's release workflow is green.
Shared instructions, default routines and all three private instance prompts
now follow recorder scope. Each private prompt change was committed in its
own clean instance repository; no pre-existing work was included. OrbStack
was observed stopped, so container code activation remains pending, not
claimed live. No synthetic message or early routine was sent.

The first patch verify caught an important gate interaction: live
needs_fixture blocks also skipped four historical bites. The replay runner
now explicitly says it supplies recorded fixtures, so those unchanged
criteria still fail on the old faulty captures. A regression proves that
live runs make no call when blocked and a replay still catches the missing
field. No criterion or captured evidence was weakened to pass the gate.
### 2026-10-02: Clan state consolidation foundation (not a cutover)

Read-only live inventory counted 146 DynamoDB items across 20 kinds: 15
sessions and 131 durable items, including one sealed model key. No item
values, tokens, personal text or IDs were returned to agent context.
The durable counts establish the preservation checklist; sessions are
intentionally left behind when Elixir's session takes over.

The common ledger moved into packages/clan-state and the legacy runtime
now consumes that one package through a temporary Dynamo adapter. Migration
0196 adds an empty private Postgres item store and import receipt table;
no existing game table changes and no live state has been imported. Stable
keys and full item JSON preserve IDs, version pointers, evidence, mail
watermarks, preferences and sealed boxes. Model keys stay outside clan
listings, as they were. The importer requires a private snapshot's exact
SHA-256, refuses unknown kinds and session/token/plaintext-key material,
imports only into an empty destination transactionally, verifies counts,
and refuses to overwrite subsequent state on a repeated import.

Scratch Postgres tests prove lossless/idempotent import, refusals, complete
version history, literal prefix matching and concurrent action counters,
first-attribute assignment and daily claims on independent connections.
The fingerprint was regenerated from that newly migrated scratch database.
The first full verify caught the new migration pin using a directory prefix
instead of the required filename; corrected before shipping. No deployed
migration file was edited. Auth, routes, jobs, key sealing and legacy-runtime
retirement remain the following consolidation work, not reported complete.

The pure engine, its golden tests and geographic data now move by rename to
packages/clan-engine. Legacy API and UI consume that workspace package;
there is no second copy. Browser place files still split by country, and
the legacy Lambda build still includes the same place data. Active reading
maps and the no-clan-specific-source guard follow the new paths. This
extraction does not itself migrate accounts or activate the Postgres store.

### 2026-10-02: 11.0.1 deployed, isolated card checks pass

PR #223 merged at 12cdb548; the actual stack UPDATE_COMPLETE event is
2026-10-02T17:30:51.032Z. Card-family acceptance reported 112 cases, four
failed, 81 skipped and 33 calls. The first Witch/mine read timed out;
contracts/recorder-cards-facts, gym/283.1, gym/283.2 and gym/325.6 shared
that failed response. Each was re-run alone and passed (4673, 4202, 3976
and 3371 ms respectively). An isolated read-only profile also completed
without an error. This is a load/cache-dependent performance failure, not
a fully green deploy gate; retain the cold-query performance follow-up.
Read-only smoke passed after deployment. No history or archive was deleted.

The foundation passed full verify after rebasing onto 11.0.1. The engine move
passed all 51 Elixir and 15 Clan browser journeys and both deployment bundles.
The Clan deployment change detector now includes both shared Clan packages.
This foundation does not change a tool or shared tool implementation, so the
root deploy uses smoke without another full live acceptance sweep; the
existing card cold-query performance follow-up remains open.

### 2026-10-02: Clan foundation deployed and shared account path prepared

PR #224 merged at c6558283. The actual stack UPDATE_COMPLETE event was
2026-10-02T17:49:47.692Z; ordered migration 0196 applied once. Root smoke
passed and public recorder health was true; no live tool implementation
changed, so no additional full acceptance sweep was run. Clan's CI deploy
37043789449 also passed on c6558283. No existing Clan item was imported,
changed or deleted by the foundation; it adds empty private storage. The
production lease was released after read-back; no queued lease note existed.

The next preparation moves service logic into packages/clan while the legacy
Dynamo/session deployment adapters continue to serve users. A disabled internal
web-api path accepts the resolved Elixir person, uses existing facts directly,
and preserves fresh membership and role checks. Account preferences persist
only explicit actions; gate and roster caches are request-local. Ordinary
page reads of the account/selection gate do not create a second session or
write a preference. Verified clan fact writers moved into the shared record
package; their external audience/scope checks remain. Scratch tests cover
CSRF, base64 bodies, friend refusal, unverified member access, immediate shared
session revocation, account isolation and factual write permissions. Cutover,
model egress/key preservation, scheduled jobs, the unified UI, old-stack
retirement and the exact purge manifest remain required work.

Read-only consistency review found GET evaluations that reconcile private Clan
cards needed the same lock as decisions, and accepted O/0 tag aliases needed
one canonical lock key. Both are corrected; scratch tests observe the actual
Postgres lock waiter for GET and POST using the alias. No additional auth or
privacy regression was found. The privacy ratchet now names the moved factual
writer, preserving the same two allowed writers, and MCP/public tools have an
explicit private-state import guard. Legacy source pointers were updated.

### 2026-10-02: Shared-runtime receipt and remaining Clan cutover preparation

PR #225 merged at e5bf8561. Root UPDATE_COMPLETE was observed at
2026-10-02T18:22:31.534Z; migration 0196 was already applied (ran 0).
Smoke passed and public health was true. The first local deployment build
stopped before upload because that checkout had the previous workspace
installation; refreshing dependencies resolved it. No tool behavior changed,
so this preparation used smoke without another full live acceptance sweep.
The existing card cold-query performance follow-up remains open.

A fresh consistent private item-key census found 131 durable Clan items and
15 temporary sessions. Durable kinds include policies and versions, actions,
logs, counters, mail watermarks, awards, recruiting, schedule claims,
preferences, places and one sealed model key. No bodies or credentials were
returned by the census. No state has been imported or deleted.

The next disabled preparation adds an explicit frozen-source import op,
count and canonical-content comparison, a legacy read/write/schedule freeze,
and the existing jobs runtime's one-clan morning evaluator. Its claim completes
only after all steps succeed; transient evaluation, standings or mail failures
can retry. It shares the normalized clan lock with web decisions and keeps
historical app attester identity/provenance without any network credential.

The existing non-VPC relay can carry a narrowly typed private Clan model
operation through the existing S3 endpoint and queue. Request and reply bodies
are authenticated and encrypted under a distinct derived key, bound to their
random id; the old sealing key domain remains unchanged. An immutable claim
precedes provider use, so duplicate notifications and interrupted outcomes
never retry a paid call. Expired requests do not call a provider. The root
feature switch defaults false, preserves previous values on deploy, and leaves
session routing, jobs, model transport and state cutover inactive. No paid
model call was made. The unified UI, reviewed private import, actual activation,
old-stack/credential retirement and the historical purge manifest are still owed.

Preparation review corrected four latent cutover defects: model sealing secrets
are limited to web-api and the network relay; uncertain S3 delivery/reply reads
return an explicit uncertain outcome; paid attempts are reserved before provider
dispatch and finalized in place, so interruption cannot bypass the daily use
record; the model bridge computes its wait against the current request deadline.
Unknown key-owner roster status refuses use. Existing 90-day model-use retention
has a bounded, model-call-only cleanup. Morning work prioritizes unattempted clans
before retries and bounds attempts, so one failing clan cannot starve another.
The private import rejects invalid export dates as well as invalid freeze dates.
Scratch regressions cover each refusal, interruption, fairness and retention path.

Verification first caught an ops-catalogue insertion in the inline example rather
than the real table; the duplicate/missing-row tests caught it and the row was
moved to the actual catalogue. CFN lint caught duplicate job flags in preparation;
those were removed, and unrelated collector/MCP sealing-secret references were
removed before activation. These were local preparation failures, not production
changes. Both templates now have zero new CFN errors; the existing PG17/SNS and
legacy redundant-dependency warnings remain. Scoped Guard checks pass for private
encrypted outbox storage and default-off cutover/freeze parameters.

Clan CI deployment 37047238842 passed on e5bf8561 after the shared-runtime
preparation. Its separate runtime remains in use until the import/UI cutover.
The four separate Clan owners remain active; their private-state maintenance
interfaces and duties must move to the existing four Elixir owners before the
legacy schedules and stack retire. No cadence change is planned by implication.

Disabled cutover preparation passes the complete `npm run verify` gate,
51 Console and 15 legacy Clan Playwright journeys, and both Lambda builds.
The infrastructure assertions now cover default-off legacy cookies, enabled
shared-session routing, both web runtime timeouts, external MCP no-cookie
isolation and the two permitted sealing-secret consumers. The first full
rerun caught old assertions that assumed routing and timeout could never
change; those assertions now pin both explicitly selected modes. No tool
implementation changed, so this deploy uses smoke rather than live tool
acceptance; no Clan switch, state transfer or paid provider call is authorized
by a verification run.


Shared cutover preparation 7f6a8acd (PR #226) is deployed: root stack read-back
was UPDATE_COMPLETE with ClanInternal=false, migrations applied 196/ran 0,
all smoke checks passed and recorder health.ok was true. No private state
import, cutover, provider use or historical deletion occurred. The merged
main's validate run 37049943129 failed in the card-art browser assertion after
its branch gate had passed: CI lacked the ignored art cache and the honest
fallback removed the missing img. Clan CI 37050388464 therefore skipped its
deploy; its new MigrationFrozen parameter is not yet installed. The next
change makes only the inspected art a test route fixture and checks the actual
missing-cache fallback too. This is a tracked CI defect, not a bypass.

The shared application now mounts Clan through a lazy route factory from
packages/clan-web; every view and its tests moved, with no duplicate view
source. The existing root query provider and router own the shared UI. Its
private Clan cache is under [me, clan], so refreshing the common account also
invalidates Clan. The account menu and sign-out are Elixir's; Clan's rail keeps
its in-game identity and checks. Writes use the shared CSRF header; the model
route alone allows the 30-second client window. A temporary build wrapper
keeps the old bucket usable while routing is disabled; it retires after the
frozen state import and shared switch. The legacy OAuth loop is off in the
shared routes. A complete sign-in journey caught an outgoing route remount
consuming the return path twice: completion state now belongs to the common
application provider and survives that remount.

Private maintenance now has a bounded IAM-only migrate operation for Clan
feedback and action evidence. Reads do not move reply pointers, never select
model-key items, and reconstruct missing action history without persisting it.
Feedback responses preview by default, need an exact current-item digest and
explicit apply, and use the existing product response service in a transaction.
No live response or maintenance mutation was used as a test. This replaces
the direct Dynamo feedback/actions scripts for the consolidated owners.

Review found and fixed pre-cutover Clan navigation, stale private cache across a new login, the model-key PUT client timeout and feedback read/write lost updates. The browser session advertises the actual server switch; disabled or unknown links load the legacy document. New sign-in cancels/removes old private queries before mounting the next identity. Postgres feedback updates use body compare-and-patch; a stale reader leaves a newer reply unseen and a stale decision refuses. Scratch races cover concurrent private replies. Maintenance pages expose totals/cursors, actual grants and morning receipts; the four existing owners now carry the conditional Clan duties with no implicit cadence increase. Legacy owners stay active until live cutover read-back.

Final source review found no remaining actionable blockers in auth/private-state maintenance. The client advances a session generation before cancellation; forced Clan refreshes and selection writes cannot repopulate a previous identity after sign-in. Immutable policy versions are pageable, and action summaries embed at most three stored log entries per card; full logs remain pageable. Scratch coverage checks 25 actions with 200 legal comments each and concurrent feedback replies. Verification: full npm run verify, 69 Playwright journeys (including disabled/unknown routing handoff and responsive shared app), both Lambda builds and eight workflow guards pass. The card-art CI assumption is fixed with inspected-image fixture plus honest missing-art fallback. No tool implementation changed: this UI/private-op preparation deploy uses smoke, with no tool acceptance sweep. Production routing/import remains disabled in this change.

PR #227 CI found a real art-fallback race: uncached images could fail before the deferred catalog script installed its error listener. The script now checks completed failures after registering, and the browser regression deliberately delays that script until after 404 art responses. The red CI gate remains respected; no merge or deployment proceeded past it.

### 2026-10-02: Checked retirement of Clan’s separate OAuth client

The IAM-only family_clients retire_app operation previews by default and applies
only to the exact provisioned Clan client after ClanInternal is active and the
exact applied import digest exists. It expires that registration, burns unused
codes, revokes its grant families and writes connection-revoked receipts, while
retaining its audit identity. Drop is outside this operation. Migrate receives
the actual ClanInternal parameter so its check cannot be accidentally omitted.

Read-only review caught an in-flight authorization escaping a simple revocation
sweep. Final grant minting now locks and rechecks the live client registration
in the same statement that inserts its family; retiring the registration takes
the conflicting lock. Access validation also refuses an expired registration.
Scratch tests cover overlap, refusal paths, idempotence and a live Drop control.
No live credentials have been retired by this source change. MCP and JSON API
contracts are unchanged; no tool result changed, so this deployment uses door
smoke and focused OAuth regression coverage, without a tool acceptance sweep.

Final read-only review found no remaining blockers. Full npm run verify,
both root builds and 69 browser journeys pass. CloudFormation lint has no
errors; its existing W3691/W3037 warnings remain outside this change, and
the scoped lint and cutover Guard rules pass. No live auth write was used
to test the operation.

The legacy deployment smoke now reads the actual MigrationFrozen parameter
and requires the deliberate 503 clan_migration refusal on business reads
during transfer, while continuing to require a healthy read-only health door.
It makes the same six safe reads in either mode; it never creates a login.
Both modes and the full verification gate pass. This closes an expected
false alarm that would otherwise interrupt the approved freeze deployment.
### 2026-10-02: Board credential and documentation retirement checks

The former collection-updater MCP key still belongs to the owner account
alongside unrelated keys. A separate retire_board_recordings credential
branch previews only its nonsecret metadata and applies only to its exact
token id/name/audience after all board dials are disabled. It revokes that
key once with an audit receipt; no account, sibling key, recording, fact or
archive changes. Scratch tests cover preview, unrelated/stale IDs, active
board refusal, preservation and idempotence. Live revocation is still owed.

Consistency review found active live-read docs still promising board tools,
meta comparison examples and the retired analyst's operational ownership.
These now describe the retained personal/clan record. The four-owner
workflow and generated manifest schedule agree. No matching board launchd
writer was found on this Mac; other hosts were not scanned. The stale
primary-checkout board credential file will be retired by exact path after
the server key is revoked, without reading its value or executing its client.

No tool implementation or response changes: contracts remain MCP 11.0.1
and JSON API 3.0.0, deployment uses smoke without a tool acceptance sweep.

Review caught legal same-name credentials on different accounts and revoked
predecessors. Preview now lists all matching nonsecret metadata with account
references; apply selects the exact token id first. Collision regressions
preserve the predecessor timestamp and the peer’s live key. The obsolete
ranking_health and pros_census queries and their exclusive tests retire;
recorder/fetch-error diagnostics remain. Final read-only review found no
blocker; 25 focused tests, full npm run verify and Lambda/site builds pass.

PR #227 deployed from c927c73b after green main validate and legacy Clan CI.
Door smoke passed; /api/me advertises clan_internal:false and public health
is healthy with zero DLQ objects. Migration 0196 was already applied, with
no new migrations. No private import or shared Clan activation occurred in
that deployment. Lease b7726415-181c-4f44-a7dc-ac558a81d0f2 was released.

## 2026-10-02 - Clan account/storage/runtime cutover and source retirement

- PR #228 (`12f60355`) and PR #229 (`6f5dd250`) deployed from green merged main.
  The legacy runtime froze at 19:58:07Z; business/auth reads returned the
  migration notice and its scheduled evaluator refused work. After five quiet
  minutes, the private export excluded old sessions/logins and held 131 durable
  records (205,840 bytes). Preview, apply and complete-body comparison passed:
  131 stored, 131 matching. Policies/actions/logs, awards/snapshots, preferences,
  schedules, morning/mail receipts and the original sealed model key are kept.
  Snapshot SHA-256: `ef613a80de5401b49100576cd945d3b10a2b711ef190a5f8b33e7f6646863476`.
- Canonical deployment activated ClanInternal and preserved the actual maintainer
  configuration. Smoke passed; `/api/me` advertises enabled Clan, `/clan` serves
  the common app, `/api/clan/me` returns signed-out 401 without an OAuth loop,
  and `/api/clan/health` returns 200. No live member/model/mail writes were used
  as tests. No tool contract changed, so this transfer used focused scratch
  identity/import tests, browser journeys and smoke rather than an MCP sweep.
- Exact Clan OAuth retirement expired the registration, revoked ten active grants
  and burned two outstanding codes. Read-back: zero live Clan grants, retired
  Clan service key; Drop remains active with four grants and its existing key.
  The historical Clan integration identity remains as the internal attester.
- The board updater's exact token 10 retired separately, without suspending its
  owner or touching sibling tokens. Its old mode-0600 local credential file was
  removed by pathname without reading plaintext; read-back confirms revocation.
- Four installed legacy Clan automations were deleted after handoff; the four
  root owners keep their current schedules. The old runtime remains frozen
  until its verified infrastructure teardown. No canonical battle/board history
  or payload archive has been purged; that waits for the exact private manifest.
- This cleanup moves useful behavior tests into the shared package, removes the
  old app/API/Dynamo/OAuth adapters, CI deploy and obsolete maintenance source,
  and removes CloudFront legacy origins/cookie policy. The private-state import
  guard survives in the root web API test suite. A disabled feature has no old
  runtime fallback. The sealing secret is retained unchanged.
- Validation: full `npm run verify`, 69 Playwright journeys (including shared
  Clan identity/deep links and responsive/axe coverage), all Lambda bundles,
  workflow lint and scoped CFN lint/Guard pass. The 131 shared Clan tests now
  exercise the common account context; retired OAuth/Dynamo-only tests leave
  with their implementation. Read-only consistency review found no access,
  privacy, build or data-loss blocker; its stale-doc findings were corrected.
  Existing template warnings W3691/W3037 remain separately acknowledged.

## 2026-10-02 - Private right-sizing census foundation

The IAM-only `right_sizing_census` operation exports bounded primary-key pages
of retention evidence and game-record/archive identities. Every database
transaction is repeatable-read/read-only with a 30-second statement timeout.
The cutoff and snapshot UUID bind continuation cursors; unknown tables,
credentials and delete/apply requests refuse before a connection. Pages are
immutable content-addressed AES256 files under a dedicated private prefix;
repeated writes compare existing bytes to the digest. Account export excludes
email and auth data; event export allowlists retention kinds and fields; cached
payload bodies and receipt error bodies are omitted. Timestamp key precision
is preserved. Metadata and opaque continuations alone return to the caller.

This prepares evidence, not permission to purge. Cross-page state is not one
long database snapshot: historic immutable facts are cutoff-bound, and mutable
requests must be rechecked immediately before any approved destruction. The
exact manifest still requires historical intent, archive observer mapping,
complete version/marker inventory, overlap/dependency counts, unresolved cases
and backup disposition. No deletion capability is granted or implemented here.

## 2026-10-02 - Clan legacy infrastructure retirement and private provenance preparation

PR #230 (`9ec16b97`) deployed from green main. The 43 door smoke checks pass;
CloudFront is Deployed with only site/api/mcpapi origins and routes Clan to the
common application/API. Post-deploy frozen-import comparison again reports
131 stored, 131 matching, equal true. Shared Clan health returns 200; unsigned
me returns 401 without an OAuth redirect. No live test wrote a private record.

The legacy elixir-clan stack reached DELETE_COMPLETE. Its 262 static web assets
and 198 versioned code artifacts were removed from the separate buckets. The
retained legacy DynamoDB table was explicitly retired only after its durable
copy matched; both buckets and the table now return absence. The two bootstrap
deployment roles, unused runtime boundary and clan-production GitHub environment
were removed. Shared OIDC and elixir-clan/app remain; the latter still seals the
preserved model key. Lease 6954b6b8-06d7-4b69-8420-5efbe166822b was released.
No canonical game/history or payload archive deletion occurred.

The complete private payload inventory at 20:19:00Z has 325,116 versions, five
markers, 2,143,668,884 bytes and 326 pages; its SHA256 is
c80b0a15ac0cc29c4c8a752f1678d90bb3f1388a7cf86c9dd989979267576fdb.
This is inventory, not classification or approval. The RDS backup window is
seven days with eight automated snapshots and no observed manual snapshot;
backup expiry remains separate from active-row/S3 removal.

Private census preparation expands to game-history identities, retired card
meta keys and per-battle dependent counts. A resumable downloader verifies every
page digest before checkpointing. The archive observer scan reads exact versions
and uses the same canonical identity function as ingest, preserving observer
order, duel and boat semantics. Bad or unreadable objects remain unresolved.
Neither tool implements game-row or payload deletion. The exact retention and
purge manifest, mutable-reason recheck and Jamie's manifest approval are still
required before destruction. Contracts remain 11.0.1 and JSON API 3.0.0.

Read-only review corrected census coverage for added_at/first_seen_at/window_end
and dependent participants through their parent battle cutoff. Each page labels
its cutoff policy and per-page snapshot isolation; untimed keys are current
inventories, not historical as-of assertions. Resume revalidates receipt/content
chains and the server lane inventory, and bounded page-size retries stay at the
same cursor. Deliberate operator enrollment/tracking evidence is preserved with
sanitized source/relationship details. The final mutable-evidence recheck is
still required. No private database export or game-history deletion has run.

The private export pins the live schema digest in every page and cursor. A
resume compares the actual schema catalogue again; changed columns, keys or
foreign keys require a fresh census. The definition also names its cutoff
algorithm version. A scratch ALTER regression verifies refusal after drift.


## 2026-10-02 - Provenance export deployment and reconstructing-source audit

PR #231 and PR #232 deployed from green merged main `dffb8468` under lease
5836de0f-0f8b-4b83-aeb3-64d0f601d570. Migration 0196 was already applied
and zero new migrations ran; door smoke passed. No MCP or JSON API operation
changed, so this private census release used its scratch regressions and the
69 browser journeys rather than a tool acceptance sweep. The cutoff-bound
private history export is running; it is not permission to delete history.

The battle observer map is complete: 153,186 exact versions, 1,321,331
observations, zero unresolved reads. Its SHA256 is
0bdf17d33c3310a5e967bf59ff8090f620a424770f81bc7902b2f730842bb82c.
A separate complete inventory found 77,883 call-capture versions totaling
205,066,903 bytes; no editorial outbox objects remain. Call response mapping
is still running, and no capture body is copied into the repository.

The separate read-only references group closes the census over deck-card
dependency counts, war anchors, call-capture pointers, editorial issue hashes
and send identifiers. It leaves the in-flight history group's definition
unchanged. Mail facts, notes and selection candidates are hashed in memory
and never returned or stored in export pages; call arguments and network
identity fields are excluded. The downloader refuses cross-group resumes
and explicitly disables AWS invocation retries. No delete capability, key
export, delivery or enrollment action is added.


The completed history census has a known limited lane: clan_event chooses
nullable joined_observed_at and therefore inventories joined-member events,
not the role/war events whose join stamp is null. The schema-clock audit
found no other nullable cutoff. Do not use that lane's count as the full
clan-event target. The references group supplies a complete clan-event
identity inventory using its non-null window_end, with a paginated scratch
regression for null join stamps. The old history definition is deliberately
unchanged, and no destructive selection uses the incomplete excerpt.


Profile provenance and board entity projections are also separate reference
lanes. They export daily keys/source/clan/receipt relationships and ranking
entry entity tags without profile statistics or board scores. This allows
incidental identities and roster-derived snapshots to be reconciled against
retained histories; a board entry alone does not establish ownership or a
safe profile-deletion selector. No source bodies or private Clan records are
exported.


The references census also preserves live-lane job identities and timing
without request credentials or payloads. These reconcile receipts from
explicit one-off profile refreshes; retiring automatic enrollment must not
misclassify a deliberate refresh as autonomous bulk capture.

The captured-response version audit is complete: 77,883 exact versions were
read without a failed object. A separate hash-bound card-response audit found
3,232 versions carrying retired meta fields. These are manifest candidates,
not deletions. Mixed battle-log preparation now verifies the old compressed
body and complete ingest identity map, requires an exact disjoint disposition
for every whole entry, preserves unresolved entries, and produces a new
content-addressed key in the original fetch partition. The original remains
unchanged. Team, duel and boat fixtures prove retained raw entries are equal;
altered versions and incomplete/contradictory classifications refuse before
staging. Existing destinations must match retained JSON identity before use.

The purge preparation preserves whole already-available logs for current
comprehensive-clan members, including battles predating a member's join, and
keeps ambiguous histories protected. This covers a later legitimate log
returning an older battle. Basic player/clan identities and the factual war
calendar remain. Retired profile and clan projections require established
retired reasons with no retained direct/clan/explicit-refresh overlap.

0197 is an additive replay-disposition foundation only; it performs no purge.
Original receipt admission and payload hashes remain audit facts. Explicitly
retired receipts are excluded from replay, while mixed receipts can use a
verified retained-only content identity. The prepared bounded operation must
match a private manifest and batch digest, current schema and retained-reason
guard, and an explicit approval digest before apply. It checks dependent
counts/events, rebuilds affected UTC rollups, and refuses changes rather than
expanding scope. Table keys and SQL are a closed allowlist. Historical mail
headers, sends and rendered mail remain; only retired editorial facts/notes
are candidates. Old diagnostic capture bodies can be purged while their
audit rows remain. No irreversible action is approved or performed yet.

Replay safety review added mechanical overlap checks against direct follows,
historical personal requests, operator exceptions and comprehensive members.
Admission is drained through the existing recording-cutover lock, and later
admitted logs are checked for target identities, including defenders whose
tag the API omits. A missing newer source refuses the batch. Projection rows
are locked before freshness validation, previews use the same checks, parent
cascades require their children to be gone, and a backfill pins its receipt's
effective replay identity inside the projecting transaction.


### Purge preparation: admission and ownership review

No history or original payload archive has been removed. The prepared executor
resolves event owners independently of primary keys and protects personal
membership/war overlap, including the parent weeks and indivisible supporting
roster/race bodies. Game-wide aggregates remain separate removal targets.
An admission receipt-ID ceiling, captured under the ingest cutover lock, replaces
fetch timestamps as the proof boundary for late original envelopes. A separate
read-only census can prove every admitted source through that ceiling; any later
source must be checked before a canonical battle can go. Private mappings bind
full original and replacement hashes and exact archive versions. Additive 0197
and validation 0198 keep original receipt admission immutable while retired or
filtered replay is explicit. Constraint validation uses its own lock phase.
The exact private manifest still requires Jamie's approval before irreversible
row or archive deletion.

All admission lanes, including live requests and jobless imports, now share
the cutover barrier. Scratch delayed-commit cases prove a receipt ceiling
cannot pass an earlier allocated, uncommitted receipt. The nightly activity
projection excludes retired automatic-only recordings, while later personal
follows remain eligible regardless of birth provenance. Affected activity
caches are invalidated/rebuilt from retained battles, not treated as facts.

Redirected replay refreshes warm archive inventories on a hash miss and verifies
full content identity even on shared cache hits. A missing retained replacement
refuses without advancing a cursor. Replacement paths use exact canonical
observer prefixes and the reader's hash suffix; full hashes shared across
observers remain separately bound to each observer's key. Scratch cases cover
a missing ordinary source followed by a valid redirected source both within
one batch and across consecutive batches.

## 2026-10-02 - Bound factual card reads to the selected history

The purge-foundation deploy completed, but whole-suite acceptance reported
five card-read failures: three query timeouts and two checks reusing a refused
response. The read-only `profile_tool` identified two cold statements at
14.36 s and 15.66 s, reading 36,984 and 22,123 shared blocks. The first expanded
rounds through repeated global scans and probed deck identity once per game;
the member query probed played-card facts even for games without that card.

Both statements now materialize only selected scalar participant columns
before using the canonical duel expansion. Earliest play groups games by deck
identity before card lookup. Member play filters card-bearing game identities
before reading played-card levels and battle metadata. No schema, contract,
recording reason or history is changed. The scratch regression checks earlier
play outside a narrowed window, both forms in different duel rounds, round
wins/losses and levels, a round without the card, and tower play in every round.
Private manifests and published retained-only bodies remain intact; canonical
history and original archive versions have not been deleted.

## 2026-10-02 - unchanged cache re-fetches in the approved purge

Private previews refused selected content-addressed caches whose identical
body was fetched again after review. Moving the review cutoff did not resolve
continuous timestamp refreshes. Cache removal now binds original creation,
full semantic identity and protected ownership; a timestamp-only re-fetch does
not change its scope. Changed identities and post-cutoff creations still
refuse, as do new admitted source overlaps in battle batches. Scratch tests
cover refresh, identity changes and new creation. No game history has been
purged; exact-manifest human approval is still required.

## 2026-10-02 - card history uses the existing covering index

The first post-deploy card read still timed out after the scoped-query fix.
Read-only profiling showed the earliest-history scan using the participant
heap index: requesting side prevented the existing player/time covering index
from serving it. Card queries no longer carry unused side values. The shared
boat-defense predicate accepts a side expression, so these reads resolve side
by primary key only for boat defense checks. Other callers retain their
predicate. Fixtures keep both own boat attack sides, exclude both defense
sides, keep an unknown mode, and preserve earliest forms and duel rounds.
No index or migration is added; no game history has been purged.

### Approved right-sizing purge execution (2026-10-02, 20:24 Chicago)

Jamie approved the exact private manifest
`ccf2771e0ce5870edfc95e43cb41797cfd5687f92f1531ece1a6a0c9a1f717c9`.
The digest-bound database executor began at 01:24Z on October 3 under the
interactive production lease, in 17,018 sequential transactions of at most
250 targets. The current code, retained-reason and schema fingerprints
passed. Original S3 versions remain until independent database preservation
and receipt-disposition verification passes. The run is in progress; no
deploy or other migrate operation may share its write window.

The final maintenance cleanup is prepared in a separate actor-owned checkout;
it cannot deploy until database, original archive and temporary-export
verification complete. The existing automated backups retain their ordinary
seven-day window; no backup deletion is authorized.

### Interrupted batch read-back and unchanged resume

The approved run stopped after 6,704 completed batches on an S3 HTTP 500
(`InternalError`, one attempt). A read-only preview of the next exact
250-target badge batch passed the retained-reason/schema checks and found
all 250 targets still present. No original S3 deletion had started. The
unchanged digest-bound executor resumed from batch 6,705 under the same
lease and manifest approval; no batch size, retry policy or target changed.

### First battle batch refused by the rollup statement limit

The approved run completed 15,055 batches, then the first battle transaction
timed out in `refreshDailyRollups` under its existing 15-second statement
limit. The transaction rolled back; the checkpoint did not advance and
read-only backend inspection found no orphaned purge query. Named VACUUM
(ANALYZE) on `battle` and `battle_participant` completed in 1,139 ms and
2,317 ms, respectively. The same batch's read-only preservation preview
passed, but a single unchanged attempt after maintenance timed out again.
No battle batch or original S3 deletion completed. Further attempts are
stopped while a scoped rollup query fix is measured on scratch data.
The exact approved manifest remains immutable; any replacement technical
binding must be reviewed before further irreversible deletion.

The isolated rollup-query prototype passed canonical verification and browser
checks, but production-size scratch comparison showed no improvement:
original/scoped 438/447 ms, with identical values and unchanged-row behavior.
It was not committed or deployed; the production code and approved root stay
unchanged. A scratch comparison of the original writer measured 430 ms for
250 hash-ordered games, 41 ms for 25 hash-ordered games, and 2.6 ms for 25
games grouped by player/day. The next concrete manifest therefore preserves
all selected keys, dependencies, declared events, archive versions and the
15,055 completed receipts, while repartitioning only the remaining battle
phase into 16,440 ordered batches of at most 25. Total batches become 31,814.
Temporary batch metadata is being staged and independently compared before
Jamie reviews the new digest. No further irreversible deletion is authorized
under that new root yet.

Replacement digest prepared for Jamie's review:
`7170ed3f65a756fdcfba050db71213bad827f8c37bf2ae745a28a6069920abbf`.
Independent comparison preserves all 4,248,826 target keys, 410,985 battles,
their dependencies, 208 events, original archive selection and nonbattle
ordering. All 16,440 additional metadata bodies were staged/read back; a
34-page version inventory proved their exact owned versions. Temporary
cleanup grows to 34,997 versions (2,170,573,232 bytes), plus registered
verification exports. All 52 read-only production previews passed. Old-digest
approval and mutated predecessor receipts refuse before AWS. The prepared
checkpoint has no new approval; execution remains stopped pending Jamie's
reply to the concrete replacement-manifest review. No original archive
version or battle batch has been removed. The synthetic benchmark database
and its isolated prototype checkout have been removed.

The runtime cleanup is being preserved as a draft PR. It must not merge or
deploy until the approved database, archive-version and temporary-export
purge proofs complete. The later empty-table contract migration remains a
separate release after this draft has removed the last deployed readers.

The replacement manifest remains unapproved. No deletion executor is running;
the production lease was released while review is pending. Resuming requires
the exact replacement approval, a fresh lease and unchanged deployed-code,
schema and retained-reason guards. The canonical verification gate passed,
including all workspace tests; the prepared UI journeys passed 69 checks.

### Replacement-manifest resume (2026-10-03, 04:14 Chicago)

Jamie replied "Resume" to the concrete replacement-manifest review. The
private approval records that direct human text for exact digest
`7170ed3f65a756fdcfba050db71213bad827f8c37bf2ae745a28a6069920abbf`.
A fresh interactive production lease was acquired, and the digest-bound
executor resumed from the 15,055 unchanged predecessor receipts. Every
remaining battle batch contains at most 25 selected games; the original
selection and preservation guards remain unchanged. Do not merge or deploy
the cleanup draft while the database/archive/export phases are incomplete.
Draft PR #239's existing `validate` check is green; its current commit is
`ab45835c`. The original approval-wait notes above remain historical receipts.

The first resumed run completed 114 battle batches (2,850 selected battles).
It then refused the next transaction when a new admitted observer arrived
between source preflight and the locked preservation check. The transaction
rolled back, as intended. A read-only preview of the exact next 25 targets
passed with the same manifest/schema/retained-reason guards. The unchanged
executor resumed from batch 15,170 under the existing approval and lease;
no target, batch, limit or deployed code changed.

The second run stopped after 1,381 resumed battle batches (34,525 selected
battles total) on the same new-observer race, with the next transaction
rolled back. Its exact next-batch read-only preview passed. Execution remains
stopped while Jamie's proposed faster path is assessed. Collectors remain
active; no archive deletion has started. A bounded sample of 142 Lambda
REPORT lines measured median 1,011 ms, mean 1,083 ms and maximum 3,358 ms.
Ten-minute RDS metrics averaged 22.6% CPU and 0.7 ms read latency. These
measurements do not suggest substantial acceleration from pausing collectors.

Jamie asked whether deleting the S3 replay sources and rebuilding into a
fresh database would be preferable. This is under assessment, not an
approved replacement. The archive holds distinct bodies, while unchanged
captures still add database receipts. Historical roster replay deliberately
avoids the forward-only membership state machine; replay also suppresses
moments. Accounts, grants, tracking choices, Clan state, notification ledgers
and unresolved canonical history require a verified direct transfer. Any
fresh-database plan must compare retained state before archive deletion or
old-database retirement. No fresh database or infrastructure was created.
A scratch benchmark is measuring larger player/day-grouped batches of the
unchanged rollup writer; production code and the manifest stay unchanged.


### Grouped current-database manifest prepared (2026-10-03)

Jamie selected finishing cleanup quickly in the current database. No fresh
database or infrastructure was created. Console already provides Stop tracking
on player detail; it preserves recorded history. A global historical deletion
feature would require shared-history policy and is not part of this cleanup.

The completed checkpoint remains 16,436 batches, including 34,525 selected
battles. The faster private manifest preserves all 4,248,826 target keys,
410,985 selected battle identities and dependencies, 208 declared events,
original archive selection, guards and deployed code. Its exact digest is
`e958818afbd39b03a03979dd00fe1199b0c035477e71a6c8191ab59387fc9819`.
It groups the 376,460 remaining selected battles by participant/day into
2,441 batches of at most 250, bounded by estimated rollup work. This replaces
15,059 remaining small battle transactions. There are 2,760 remaining batches
in total and 19,196 plan batches. Both predecessor approval chains and every
completed receipt body remain bound and independently checked.

All 52 read-only production preview categories passed, as did five additional
previews across the remaining phase (including two 250-battle batches).
Full graph/scope comparison passed. The 2,441 new temporary metadata versions
were staged and read back; the exact version inventory passed over 36 pages.
Temporary cleanup now includes 37,438 versions (2,248,659,911 bytes), plus
registered owned verification exports. Original archive selection remains
224,155 versions (1,082,135,855 bytes). Old approval and altered predecessor
receipts refuse before AWS. No new approval or executable checkpoint exists.

Jamie authorized an optional hour-long collector pause. A private one-time
controller drains the five active collectors, stops its purge child at
45 minutes if needed, waits for possibly outstanding Lambda work, restores
every attempted drain and reads back the fleet after the 60-second cache
horizon. Seven isolated stub-only checks passed, including partial drain
failure, deadline, purge failure, cached status, lost recovery response and
old approval refusal. No production collector transition was used as a test.
The healthy-path restoration budget fits within an hour; an AWS failure can
delay restoration and is reported. No second window runs automatically.

The concrete private review includes continued small batches, grouped batches,
a new set-based purge and a verified retained-row transfer to a fresh database.
Grouped existing-code execution is recommended. Original archive deletion
still follows complete retained-history verification. The whole cleanup may
outlast the collector window. Other sessions may develop/test in their own
worktrees; deployments, migrations and production retention/recording writes
must wait while the purge lease is held. Draft PR #239 stays unmerged until
database/archive/export proofs finish, followed by post-delete vacuum and
health read-back. The later empty-table contract stays a separate migration.

Execution is stopped for exact grouped-manifest review. Collectors remain
active and no original archive version has been removed.


### Grouped manifest approved and resumed (2026-10-03, 05:14 Chicago)

Jamie replied "Approved." directly to the concrete grouped-manifest and
bounded collector-window review. Private approval binds exact digest
`e958818afbd39b03a03979dd00fe1199b0c035477e71a6c8191ab59387fc9819`
and the separately reviewed controller hash. The checkpoint preserves all
16,436 completed receipt bodies. A fresh shared production lease was claimed;
the current retained-reason and schema guards matched before the collector
window started. No deployment or migration runs concurrently. Original
archive deletion remains gated on complete database preservation proof.


Jamie subsequently directed: "Prioritize completing the cleanup work. Keep
collectors paused if needed. We need to get this completed to do anything
else." This supersedes the optional one-hour limit. The owned deadline
controller is suspended while its unchanged approved deletion child continues;
an owned foreground supervisor records progress and resumes the controller's
restoration path after the child terminates or the supervisor fails. Neither
the deletion manifest nor its guards, targets or executor changed. Direct
human steering and exact process identities are recorded privately. Collectors
stay drained during this extended database phase; no further feature work or
production deployment is being advanced before cleanup completes.
