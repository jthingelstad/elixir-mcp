# Elixir notes

Working notes: what is open, what is queued for Jamie, and dated entries
for the reasoning behind a change. What still stands is
`docs/DECISIONS.md`, one line per ratified decision and declined idea;
read it before proposing anything. Earlier entries are in git
(`git log -- docs/NOTES.md`); the last full version is at `bb01d62b`
(`git show bb01d62b:docs/NOTES.md`), and the weekly archives that sat
in `docs/notes/` are listed in `docs/archive/README.md`.

## Open and queued

One line per item: when it was raised, what it needs, and who owns it.
Remove a line in the change that closes it.

### Jamie

- 2026-09-28: retire `session_secret_previous` on or after 2026-12-27.
  Deploy with `--param=SessionSecretPreviousInSecret=false`, then remove
  the key in the console (`docs/SECRETS.md`). Jamie.
- 2026-10-08: delete `elixir-clan/app` (keep the default recovery
  window) once the deploy that reads `elixir-mcp/app:clan_sealing_secret`
  has succeeded; Jamie copied the value across the same day. Jamie.
- 2026-10-04: whether privacy.md should name Clan's own-key model flow.
  Product wording, Jamie.
- 2026-10-08: beta invitations: Jamie invites POAP KINGS, with the
  wording as it stands (accepted 2026-10-08), and pastes Bring your
  clanmates' clan-chat line (Console ▸ Overview) into clan chat once to
  see whether `elixir.poapkings.com` at its end survives the chat filter;
  if it is masked, it comes out of the line (`apps/web/src/lib/invite.js`).
  Jamie.
- 2026-09-29: `min_client_version` is 2.0.30 with enforcement on. Raising
  it retires the pre-signing rollback lever. Jamie.
- 2026-10-03: co-leaders' own sign-in, verification and model-status
  read-back, any reviewed historical manual-award reconciliation, and a
  bounded paid drafting attempt remain live checks. Jamie with the
  co-leaders.
- 2026-09-27: growth priorities, held: the saturation ladder and planner
  class order, a pre-reset watcher, the `MaxAllocatedStorage` ceiling
  (100 GiB in the template) and a written trigger for a larger database
  instance. Jamie.
- 2026-09-27: collector-fleet trust, held: where the collectors are and
  a second site, a written trust decision before an outside operator's
  collector goes `active`, shadow verification
  (`docs/COLLECTOR-ZERO-TRUST.md`), and off-account replication of the
  payload archive. Jamie.

### Engineering

- 2026-10-08: after their first weekly mails, by 2026-10-15, stop
  tracking on Jamie's beta1/beta2 test accounts (beta1: #92P2LPLP; beta2:
  #9Y0LV2QLC and its auto-followed clan #QUV28PCG), then sign both test
  accounts out of every session. Operator.
- 2026-10-03: optional RDS downsizing (db.t4g.small, 20 GiB) waits a
  couple of weeks of measurements. Operator.
- 2026-09-28: one rate budget with no per-key pooling; revisit around
  2026-10-28. Operator.
- 2026-10-03: a recomposed closed week's collector credits can differ by
  one: it uses current lifetime points, not the period-end total.
- 2026-10-04: ordinary removal stays held until there is an all-mode
  coverage contract and receipt-bound counter tuples. Clan.
- 2026-10-05: membership counts changed while the join and departure
  lists were empty; cause unconfirmed. Data Auditor.
- 2026-10-05: a `live: true` race read that lands in matchmaking still
  says "The live fetch returned a payload our admission rejected."
  (`packages/tools/src/tools/shared.mjs`) and the receipt stays
  `rejected`.
- 2026-10-04: #292, Clan History browsing older recorded membership
  changes. Open.
- 2026-10-04: #296, slow warm Awards participation reads. Needs browser
  Network/Server-Timing evidence if it recurs.
- 2026-09-16: schema index diet, not started: drop
  `battle_participant_player` and `battle_participant_window`; a partial
  `clan_membership (clan_tag) where left_observed_at is null`; seed the
  Training Camp arena (54000001) and add the
  `player_snapshot_daily.arena_id` FK; `api_receipt.job_id` FK
  `on delete set null`; rename `poll_state.subject_tag` to `subject_key`;
  comments on the declined FKs.

### Parked, with their triggers

- 2026-09-27: measure with the `{statements}` op before changing any of:
  invoker fixed cost, a result cache, per-container connection reuse, MCP
  Lambda memory, the nightly and activity tidies.
- 2026-09-27: wait for scale: mail compose fan-out once a weekly run
  passes about 450 s; a split recording door.
- 2026-09-27: tool features, on a consumer ask: gaps as a precise
  control; an event as a population (`group_by: "event"`); a card's
  `changes[]` history; a supported-clients matrix.
- 2026-09-27: engineering system, when it pays: an ops registry with
  enforced modes, run receipts, scheduled CI with a pinned clock, a
  deploy batch marker, decision-citation tests, API Gateway managed
  overrides, a decisive smoke, e2e failure fixtures and router adoption,
  an `llms-full.txt` trim, a console bundle diet.
- 2026-09-27: low-value hardening: roster ordering, attested-fact extras.

## Entries

Newest last. Each entry is `## YYYY-MM-DD — title`, then what changed and
why. A ratified decision also gets its line in `docs/DECISIONS.md` in the
same commit.

## 2026-10-08 — internal docs describe the current state

The internal docs were trimmed to what is true now: `docs/EMAIL.md`
(six kinds, with `clan_actions_waiting` and the collector upgrade notice),
`docs/SECRETS.md`, `docs/COLLECTOR-ZERO-TRUST.md` and
`docs/RELEASING-COLLECTOR.md`. Finished reviews (`docs/reviews/`), the
archive bodies, the weekly notes (`docs/notes/`) and the retired
`docs/card-of-week/` and `docs/top100/` prompts were deleted; git keeps
them, and `docs/archive/README.md` maps each old path to the commit that
holds it. Their open items are the list above. Code comments that cited a
review section keep their substance without the citation; shipped
migrations and the changelog still cite the old paths.

## 2026-10-08 — the database goes back to db.t4g.micro

Jamie's call. The small (2026-09-23) carried a record the tracked-only
correction has since removed, while the reserved instance bought on
2026-09-07 is a micro: size flexibility made it cover half the small,
and the other half billed on demand (about $11.70 a month). Since the
correction: CPU about 5% average with credits at max, 0-2 connections,
reads in KB/s apart from a daily burst near 09:00Z, about 690 MB
freeable on the small.

The purge left the files five times the data. `{rewrite_table}` (VACUUM
FULL) ran on the small first, about 14:15Z, under the session lease:
`deck_card` 853 MB to 228 MB (6 s), `battle_participant` 2,235 MB to
210 MB (8 s), `battle_participant_card` 3,766 MB to 414 MB (22 s). The
database went from 8.2 GB to about 2.2 GB.

The deploy changes the class (a few minutes of downtime, single-AZ)
and lowers `elixir-mcp-db-freeable-memory` from 150 MB to 64 MB; the
old micro idled at 80-260 MB and would have held the 150 MB alarm.
shared_buffers stays the engine default. The micro's real limit is EBS
throughput: about 4.7 MB/s once the byte balance is spent, as the Gym
sweep did on 2026-09-23. Space heavy sweeps, backfills and full
acceptance runs; `elixir-mcp-db-ebs-byte-balance` (25%) says when not.

## 2026-10-08 — Clan's sealing secret moves into the app secret

The stack read Clan's sealing secret from `elixir-clan/app`, the old
standalone Clan app's secret, through the `ClanModelSecretName`
parameter. It now reads `clan_sealing_secret` from `elixir-mcp/app`, and
the parameter is gone, so Elixir has one app secret. The value moves
unchanged: `src/sealed.mjs` derives its keys from the value with a fixed
salt, so the same value in another secret opens every stored model key.
`anthropic_api_key` was removed from the app secret the same day (read
by nothing). Jamie copied the value into `elixir-mcp/app` before the deploy; the old
secret is deleted after it ("Open and queued").

## 2026-10-08 — a green PR merges without catching up to main

Jamie's call. The main ruleset no longer requires a branch to be up to
date with main (`strict_required_status_checks_policy` off on ruleset
24050992). Auto-merge never updates a branch, so with two PRs open the
second sat green and behind until someone ran `gh pr update-branch`;
sessions had taken to merging by hand, which looked like auto-merge
never firing. GitHub's merge queue needs an organization-owned repo.

Nothing untested reaches production: `ci-gate.mjs` takes a PR head's
green check only when its tree is main's new tip, so a PR merged behind
main makes the deploy wait for main's own `validate` run, which always
runs the journeys. Two PRs that pass alone and break together now turn
main red after the merge instead of stalling it; fix forward by PR.
Everything else in the ruleset stands.

## 2026-10-08 — feedback becomes one system

Jamie, a beta gate: "one general feedback system that can work for all
of the types of feedback that we want to collect in Elixir". The decisions
Jamie agreed to are DECISIONS' "Feedback is one system", with the Feedback
Manager running daily for beta (the response-time promise kept rather than
softened).

Part one (backend): migration 0204 adds `feedback.area`, `via`,
`follows_id`, `response_mailed_at` and the `feedback_ref` table, backfilled
from `request_id`, `context.request_ids` and `send_id`; those three stay
written for one release (expand-contract) and a later migration drops
them. `@elixir-mcp/feedback` is the one service: filing (refs checked
against the filer, a bad pointer dropped and named, never the report),
the filer's list and item (an item opened is an answer read), the answer
(compare-and-set; new words are news again; a status alone is not), the
queue (area, status, category, unanswered; paged by id; counts by area)
and the backlog the ops lanes read (`{feedback_pending: {area}}`). The
MCP tools, the web routes, `/api/v1/feedback` (JSON API 3.1.0) and the
ops lanes all go through it. The `feedback_answer` mail kind and its drain
(`services/jobs/src/email/feedback-answers.mjs`, settled ten minutes,
skipped when already read, never the owner) ship here unwired; part two
wires it beside the Console's item page its link opens.

Part one shipped as #364 and deployed the same day (migrations ran 0204;
smoke green; `{feedback_pending}` answered with `by_area`, nothing
pending). The acceptance run had five failures none of this touched,
and each reproduced alone: gym 132.4 and 332.5 (a "NOT comparable
across rows" note), gym 312.2 (live participants 44, expected 47),
`elixir_data_insights#0` at 6.6 s over its 6.1 s ceiling (the database
went back to db.t4g.micro this morning) and `elixir_timeline#docs`
(documented fields no response carried this run).

Part two: the kit's `FeedbackSheet` (one modal, native `<dialog>`) at the
foot of Ladder's and Clan's rail, and Clan's **Report this** beside an
action (refs `clan_action`, `clan`, `player`), Standing (`policy`) and
the award races (`award config:v<n>`), category `judgment`. The Console's
item page reads `/api/me/feedback/<id>`, shows the area, the refs and
the thread, and replies with `follows_id`; the admin queue filters by
area on the server (unanswered, oldest first by default) and answers
with `shipped_in` as a compare-and-set. Clan's own feedback store,
routes, views, ledger methods, `{clan_maintenance}` feedback/respond
lanes and `CLAN_MAINTAINER_TAGS` are retired (the store held nothing:
the lane read total 0 on 2026-10-08); `/clan/feedback` and
`/clan/maintain` now forward to the Console. The `feedback_answer` drain
is wired on the one-minute rule. The Feedback Manager runs daily
(manifest; the installed Codex automation follows).

Still to do: a contract migration that drops `feedback.request_id`,
`send_id` and the `context.request_ids` writes once nothing reads them;
Clan's empty `feedback#` rows (none exist) need no cleanup; and the
Discord agent passing `on_behalf_of` when it relays a member's feedback
(elixir-mcp-discord). Integrations made before 3.1.0 need
`feedback:write` granted to use `/api/v1/feedback`.

## 2026-10-08 — Clan's default model: Haiku 5.5 in place of Haiku 4.5

Jamie, 2026-10-08: "Approved: upgrade librarian-thing, elixir-mcp and
elixir-mcp-discord from Haiku 4.5 to claude-haiku-5-5 per the plan, merge
and deploy; leave drop, elixir-bot and saved clan choices unchanged".

- `MODEL_PREFERENCE` (`packages/clan-engine/src/words.mjs`) is Sonnet 5,
  Opus 5.5, Haiku 5.5. It only names the default when a leader adds a key,
  so a key that reaches neither Sonnet 5 nor Opus 5.5 now starts on Haiku
  5.5. A key that reaches only Haiku 4.5 still gets it (the `claude-*`
  fallback).
- **Saved choices are untouched.** No migration or backfill: a clan that
  saved `claude-haiku-4-5-20251001` keeps drafting on it, and choosing it
  again still validates (against the key's own model list). The picker
  was the key's model list as Anthropic gave it when the key was added;
  decided by Jamie on 2026-10-08 ("yes Clan should refresh that list
  automatically"), it now refreshes itself (the next entry).
- The request needed no change for Haiku 5.5: one forced tool call, no
  sampling params, thinking, effort or prefill, and no model-id gate to
  fix. Forced `tool_choice` runs without thinking, so the budgets cover
  the tool input only. The pitch goes from 1200 to 1600 `max_tokens`: its
  fields allow about 1,400 characters, and Haiku 5.5's tokenizer (about
  30% more tokens than 4.5) plus a non-English pitch could reach 1200.
  The Leader Message (400) and chat line (250) answers are under 100
  tokens and keep theirs.
- `anthropic.mjs` now refuses a `refusal` stop (code `refusal`, Clan
  error `model_refused`, 422) and a `max_tokens` stop (code `max_tokens`,
  `model_cut_off`, 502) before reading the tool call, even when one is
  there: a cut-off call's input is partial, and `chatMessageFromDraft`
  would have filled an empty line with its plain template. Both are
  recorded in the clan's use log with their tokens. An answer with no
  tool call otherwise stays `no_answer` (`model_failed`).
- No MCP contract or JSON API change. Haiku 5.5 is $0.10 / $0.50 per
  million tokens in / out (to 100K-token prompts); Clan keeps no price
  table, only token counts.

Shipped as #366 (e159a87e) and deployed 20:09Z (3:09 PM CT): platform
lane (web-api, mcp, email-relay, migrate and jobs bundles), migrations
ran 0 (204 applied), stack UPDATE_COMPLETE, smoke 43 ok. No acceptance:
no MCP tool or JSON API operation changed. Read-back: `/api/public/status`
`health.ok` true, `/updates` lists the entry, and the four functions show
no ERROR, timeout or 5xx line since. No Clan model call had run yet (the
email relay had no invocations), and none was made to check it: a draft
spends a clan's own key. The question this left (a key's model list was
the snapshot from when it was added) was decided by Jamie the same day:
"yes Clan should refresh that list automatically" (next entry).

## 2026-10-08 — a clan key's model list refreshes itself

Jamie, 2026-10-08: "yes Clan should refresh that list automatically".
A clan whose key was added before Haiku 5.5 (or any later model) can now
choose it without adding the key again.

- **Trigger: lazy, from the picker.** `GET /model` reports
  `refresh_due` (never checked, which is every key added before this, or
  checked 24 hours ago or more; `MODELS_REFRESH_MS`). The Settings page
  then asks `POST /model/refresh` after it has drawn and reloads when the
  list changed, so it never waits on Anthropic. A draft answered 404
  (`model_unavailable`) clears `models_checked_at`, so the list is due the
  moment a leader comes to pick another; the failing draft itself does
  not wait on a read. Drafting never reads the list. Not a jobs-lane
  sweep: only the web-api role may write `clan-model/` requests and the
  jobs Lambda holds no model secret, so a scheduled refresh needed an IAM
  change for no gain.
- **The read is the key-add read** (`keyModels` in `manage/model.mjs`:
  `/v1/models` through the bridge, Claude ids only), on the clan's own
  key, only while the person who added it leads the clan. It spends
  nothing.
- **Bounded:** the attempt (`models_checked_at`) is written before the
  read, so a clan's key is read at most once in 24 hours whatever the
  outcome, plus once after a `model_unavailable`.
- **The saved model never changes.** A refresh merges only `models`,
  `models_checked_at`, `models_refreshed_at` and `models_refresh_error`
  into the key item as it is after the read, and only while it is the
  same key, so a choice made meanwhile stands. A saved model the key no
  longer lists stays chosen: `model_listed: false`, and the picker shows
  it as a disabled, selected "not offered by this key now" with a note.
- **Failures keep the list.** 401 or 403 sets `refused_at`, the state a
  draft's 401/403 already sets (the page asks for the key again; the
  key could not draft anyway). 429, a provider error, an unknown outcome,
  a thrown transport error, an empty list or one with no Claude model
  record `models_refresh_error` (`{at, code, status}`) and change nothing
  else; drafting goes on.
- The page shows "Model list: From Anthropic, <date>"
  (`models_refreshed_at`, written on key add and each success).
- No MCP contract or JSON API change (`/api/clan` is Clan's own API).

Shipped as #368 (eac18b80) and deployed 20:31Z (3:31 PM CT): platform
lane (web-api, mcp, migrate and jobs bundles), migrations ran 0 (204
applied), smoke 43 ok. No acceptance: no MCP tool or JSON API operation
changed. Read-back: `/api/public/status` `health.ok` true, `/updates`
lists the entry, an unsigned `POST /api/clan/<tag>/model/refresh` is
refused 401, and web-api, mcp and jobs show no ERROR, timeout or 5xx line
since. No clan had opened Settings yet, so no refresh had run, and none
was started to check it: a refresh reads Anthropic with a clan's own key.


## 2026-10-08 — Primary player's clan followed automatically; first ten minutes

The first-ten-minutes assessment that day found no new account following
a clan: the one-click offer sat on Tracking, and adding a tag lands on
the player's own page. Jamie: "I like the primary option, go ahead with
that. And for the product call yes it should follow it automatically for
the primary player assuming they have a clan set (not all players are in
a clan)." DECISIONS: "Primary player's clan is followed automatically".

- **Auto-follow** (migration 0205, `followPrimaryClan` in
  `packages/claims`): runs after `addPlayer` commits and after every
  admitted player profile (ingest, after its commit; replays and
  backfills never). Activity scope; the primary only; a clan only from
  an admitted profile (no clan or no profile yet: nothing). Skips when
  the clan is already followed at any scope, when the person once
  stopped tracking it (`account_clan_declined`, written by `removeClan`),
  or when the pool has no free activity slot: it never displaces a clan,
  and the one-click offer (Tracking, Overview's link, the primary
  player's page) stays the fallback. A follow Elixir made
  (`account_clan.auto_followed_at`) moves when the primary changes clan;
  one the person made, re-scoped or chose as primary clan is never moved.
  Each is an `account_event` (`clan_added`/`clan_removed`, `auto: true`)
  and a `primary_clan_followed` log line.
- **Backfill (0206).** `account.auto_follow_clan` was added false
  (constant default, no row written) and then defaulted true, so at first
  only accounts made from that deploy on were followed. Jamie, the same
  day: "Approved: backfill auto_follow_clan for the 35 existing elixir
  accounts". Migration 0206 turns it on for the approved people made
  before 0205 (the agents and integrations among the 35 never follow a
  clan this way); each follow then happens on the primary's next
  admitted profile, under every rule above. `{account_role: {list}}` now
  shows `kind` and `auto_follow_clan`.
- **First read on add:** a new tag asks the live lane for one profile
  read, at most once a day per tag, so a mistyped tag is named ("Tag not
  found", `collector_fetch_error.http_status` 404) instead of waiting.
  Timing copy is now "usually within a few minutes" and "roughly the last
  30 battles" everywhere (Console, welcome mail, docs, the tool's note;
  ladder.md said 25).
- **Ladder pending:** "Your first capture is on its way" until the first
  battle log lands (`apps/web/src/ladder/AGENTS.md`, the one polling
  exception).
- Fixed: adding a player logged `recording_started` twice.
- MCP 11.4.0 (elixir_track_player notes); JSON API 3.1.0 unchanged in shape.

## 2026-10-08 — Bring your clanmates; invites carry no referral ids

With a new member's primary clan followed for them (above), each
clanmate who signs up gets that clan's Monday report, so inviting
clanmates is how Elixir grows. The only invite tooling was Elixir Clan's
Spread the word, behind 10 members and an active policy.

- **Bring your clanmates** (`apps/web/src/components/BringClanmates.jsx`,
  words in `src/lib/invite.js`) on Console ▸ Overview and below Ladder's
  season home, shown only when `/api/me/clans` names a home clan: a line
  for clan chat, a longer note for Discord or a message, and
  `navigator.share` where there is one. Without a clan it draws nothing.
- The clan-chat line goes through Clan's chat filter (`chatSafe`, now
  exported as `@elixir-mcp/clan-engine/chat`), stays within 200
  characters at any clan name (a name too long falls back to "our clan's
  week"), and is tested against `chatWarnings`. It ends with the bare
  domain `elixir.poapkings.com`: `chatWarnings` flags only `http(s)://`
  and `www.`, and whether the game masks a bare domain has not been
  observed, so the sentence before it stands on its own. Worth one look in
  clan chat; if it is masked, record it in cr-agent-api-docs and drop it.
- DECISIONS: "Invites carry no referral ids". The link is
  `https://elixir.poapkings.com/console/signin?signup` for everyone; the
  copy buttons send no analytics event.
- Ladder reads `/api/me/clans` for the panel: account state, not a
  game number, so it sits beside Pending's first-answer poll as the
  second non-tool read (`apps/web/src/ladder/AGENTS.md`).
- The Arena email's coverage note and Ladder's signed-out page said the
  log holds 25 battles; both now say roughly the last 30, as #371 did
  elsewhere.
- MCP 11.4.0 and JSON API 3.1.0 unchanged.
- Deployed aa0a33e1 (#372), stack update 21:46Z (4:46 PM CT), platform
  lane, no acceptance (no tool changed; console, site, mail copy and a
  data migration). Migrations `{"applied":205,"ran":1}`: 0206 ran.
  `{account_role: {list}}` afterwards: 25 approved people with
  `auto_follow_clan` on (24 made before 0205 plus one made since), 8
  agents and 3 integrations off. No `primary_clan_followed` from the
  backfill yet at 21:50Z; they come with each primary's next profile
  admission (Logs Insights on `/aws/lambda/elixir-mcp-collector`).

## 2026-10-08 — times name their clock; counts say what they count

From the fresh-person journey (screenshots 13, 15, 18, 22):

- **One clock per reader.** Ladder printed night spans and season times
  with no zone ("6:28 – 7:14 pm", UTC for an account with none set) while
  the battle page used the browser's zone for the same signed-in reader
  ("2:14 PM CDT"). Ladder now names the zone on every time it prints
  (`zoneShort` in `ladder.js`); the battle page uses the account's clock
  whenever someone is signed in and the browser's only when nobody is,
  as its own comment always said. The kit gained `browserZone()`.
- **Day bucketing, decided: unchanged.** Days played buckets by the
  account's local day, which `ladder.md` states ("lays the season on your
  calendar in your own timezone"; "a battle after midnight counts on the
  next day"). The 10:00Z game-day grid (DECISIONS) is for tool daily
  series and the war clock, and the Console's activity year is a UTC-day
  chart that says so (DECISIONS, "The console tells time in the
  account's zone"); neither governs Ladder's calendar. With no zone set,
  the local day is UTC and the lede says "UTC".
- **The offer, not a default.** `ZoneOffer` (Overview and every Ladder
  head) says times are UTC while the account has no zone and offers the
  browser's, saved only on the click. Whether to set it at sign-up went
  to Jamie and was approved the same day (below).
- **Tool calls, not MCP calls.** The Console's and Ladder's reads are
  Explore tool calls and spend the daily budget, so Overview's tile says
  "tool calls today" and how many were the site's own reads
  (`web_calls_today`, new on `/api/me/usage`). The usage counts now hold
  only what the `mcpday#` limiter charges: Elixir Clan's reads (family
  exemption) and `/api/v1` calls are no longer counted as spending it
  (`CHARGED` in `routes/account.mjs`). Quota policy is unchanged.
- **"30 battles in the last 28 days"** replaces "in 28 UTC days", which
  read as days with battles.
- **Clan, The week:** the lede names the week shown ("The week of Sep
  28, the latest to close: it closed at the Monday reset on Oct 5") and
  the running week's card names its own ("the week of Oct 5, closes Oct
  12"); a week from before Elixir followed the clan says so and when the
  first full week closes, from `recorded_from` (the engine's report:
  `first_roster_observed_at`, else `recording_active_since`). Week shape
  is unchanged.
- No MCP or JSON API change: MCP 11.4.0, JSON API 3.1.0.

## 2026-10-08 — First-read baselines, Tag not found at once, Ladder waits for the battle log

From the fresh-person journey (round 3).

- **A first sight is a baseline, not a join** (migration 0207,
  `packages/ingest/src/roster.mjs`). The player timeline read
  `clan_membership` and narrated every row that opened in the window as
  `clan_joined`, so a clan's first roster read said "alex joined" the clan
  alex leads; and a clan read only for its tracked players that then
  became tracked (auto-follow, 0205/0206) diffed its whole roster against
  one or two rows. `clan_membership.baseline` marks a row opened on a read
  that could not have seen the player absent (the clan's first read, or the
  first read that recorded that member; `clan.roster_recorded_all` says
  which kind the last read was). Baseline rows emit no `member_joined` and
  `players_timeline` skips them. Not covered: a coverage gap (a clan
  unread for weeks) still diffs as joins; there is no clean gap concept to
  key on.
- **Rows before 0207 are not rewritten.** The read-only op
  `{"membership_baseline_census": true}` (optionally `{clan_tag}`) counts
  the open-on-first-read rows still narrated as joins and the
  `member_joined` events of a follow burst. The question this raised
  (clean them up or leave history as written) is answered in the next
  entry: Jamie approved marking the first-read rows, and there was no
  burst to delete.
- **Tag not found at once** (`apps/web/src/views/account/TagFix.jsx`):
  first-answer carries `tracked_since`; the Console polls every 5 s for 3
  minutes after an add (`nextPoll`). Not found is a `callout--bad` alert
  with the inline fix (`#fix-tag`: add the right tag, primary stays
  primary, then stop the typo), and the page shows "tag not found" in
  place of the green chip and the freshest poll: CR's battle log for an
  unknown tag is an admitted `200 []`, so `poll_state` looks healthy for
  a typo. `useNav` carries a URL fragment now.
- **Ladder pending** holds until the profile AND a battle-log read are in
  (`capturePending`, `captureLanded`); tests replay both arrival orders.
- **Stop tracking asks first**: "Stop tracking #TAG? Yes, stop / Cancel".
- `account_clan_*` text names the clan, and "automatically: #PLAYER's
  clan" for an auto-follow (it named the player tag as if it were the
  clan).
- Copy: `noun(n, one, many)` in the kit for every count that can be 1;
  the add forms' placeholder is `#2PYQ8GJ0` (not in the corpus), not
  Jamie's tag.
- MCP 11.4.1 (timeline baselines, account clan text); JSON API 3.1.0
  unchanged.

## 2026-10-08 — Journey round 3 is live; the first-read join census

Deployed 44931c1b (#375) at about 5:35 pm Central: migration 0207
applied, acceptance `elixir` 189 cases, 0 failed. The live contract reads
11.4.1.

`{"membership_baseline_census": true}`, run once after the deploy:
35 membership rows across 11 clans were opened on their clan's first
membership observation and still read as joins (20 of them claimed
players; 11 in the last 30 days, 9 claimed); the earliest is from
2026-03-12, the latest 2026-10-08 21:32Z (the journey's own #GGJG2CCR,
1 row). No `member_joined` event came from a follow burst.

**Answered.** Jamie, 2026-10-08: "Approved: mark the 35 first-read
membership rows as baseline in elixir production". Migration 0208 does
it with the census's own criteria (a row whose `joined_observed_at` is
its clan's earliest, not yet baseline): `baseline` only, no delete,
idempotent. The census re-run before the change still read 35 rows, 11
clans, the latest 21:32Z, so nothing written after 0207 matches.
`{membership_baseline_census}` now also reports
`marked_first_read_rows` (the first-read rows from before 0207 that are
baseline, which only 0208 sets): the deploy's count reads back there.
Moments are not stored: `clan_joined` is derived from `clan_membership`
and skips a baseline row, so nothing else needed suppressing.

## 2026-10-08 — a new account starts on its browser's zone

Jamie, the same day, closing the queued item: "Approved: new elixir
accounts take the browser's time zone at signup".

- **The zone rides the request.** The sign-in form sends
  `Intl.DateTimeFormat().resolvedOptions().timeZone` as `timezone` on
  `POST /api/auth` (left out when the browser gives none). The server runs
  Profile's check (`accountZone` in `packages/auth`, now shared with
  `POST /api/me/timezone`: empty or UTC is null, an unknown zone is
  dropped, never a refusal) and freezes the result in the magic login's
  context as `signup_zone`, beside `signup_news`.
- **Only a new account takes it.** `openVerifiedAccount` writes it in the
  insert alone, as it does the news choice: signing in to an existing
  account, approved or pending, never changes its zone, set or not.
  Existing zone-less accounts are untouched and stay UTC; `ZoneOffer`
  still offers them the browser's zone.
- **Which device.** Code and link both read the frozen context, so a
  link opened on another device opens the account on the zone of the
  browser that asked, not the one that redeemed; anything a redeem body
  carries is ignored, as for the news choice.
- **Mail.** Weekly kinds still send at 14:00 UTC for everyone; the
  account zone names their day and time (footer, Emails page) and the
  clan report's days, which `loadRecipients` already read with UTC only
  as the null fallback. Nothing in `services/jobs/src/email` assumed a
  new account was UTC; the welcome mail carries no time.
- Tests: `public-signup.test.mjs` (new by code and by link, cross-device,
  missing/UTC/invalid/non-string, existing approved and pending with and
  without a zone); `signin.test.jsx`; `signup-news.spec.ts` on a Chicago
  clock. No MCP or JSON API change: MCP 11.4.1, JSON API 3.1.0.
- Deployed d66d5dcd (#377), stack update at 22:58Z (5:58 PM CT), CI
  gate green;
  migrations 207 applied, none new; smoke 43 ok; acceptance not run (no
  tool output changed). Read back live, reads only: `/updates` lists the
  entry, Your account and Privacy carry the new lines, and the sign-in
  bundle sends `timezone` beside `newsletter_opt_in`. The server half
  (a new account storing it) is proved by the scratch-database tests
  only: a live proof would mean creating an account.
- The same PR gave `responsive-reflow.spec.ts`'s two ten-width loops
  `test.slow()`: they timed out at 30 s on CI (main 808431b6, and #377
  twice) while taking about 6 s locally.

## 2026-10-08 — the beta pulse

Jamie, 2026-10-08: "Approved: round 4 primary, aggregate beta pulse
funnel in elixir Admin, PR and deploy". DECISIONS: "The beta pulse is
aggregate by signup week".

- **Admin ▸ Beta pulse** (`apps/web/src/views/Admin.jsx`, cells in
  `src/lib/pulse.js`) over admin-only `GET /api/admin/pulse`
  (`services/web-api/src/beta-pulse.mjs`). The last eight ISO weeks
  (UTC, the running one included) by signup week, each step a count and
  its share of that week's signups: added a player, primary set, the
  primary's admitted profile, its admitted battle log, a clan followed
  (and how many by auto-follow), a verified player, and came back in week
  1 and week 2. A came-back window still running says how many are in it
  ("open"). Then product mail sent per kind for the last four weeks.
- **Who is counted.** People only, never agents or integrations; denied
  requests and staff are out. Staff are owner and admin accounts, and a
  staff test mailbox is any account whose address is a staff address
  with a `+tag` (Jamie's beta1/beta2 journeys): read from the accounts
  table, no address in the repository, both counted apart in the
  footnote. No cell names, lists or links an account.
- **From records Elixir already keeps; nothing new is stored.** "Ever"
  where the record keeps history (`claim_added`, `clan_added` with
  `auto`, `claim_verified` events beside the current rows), "now" where
  it keeps state (primary, capture). Came back: a `signed_in` event, a
  session opened or last seen, or a call of the person's own in
  `mcp_call_audit` (Console, Ladder, MCP, API) on a UTC day 1-7 or 8-14
  days after the signup day; an agent's calls are its own, not its
  owner's. `account_event` and the call log are not trimmed; sessions go
  30 days after they lapse, which the events cover for sign-ins.
- **Mail opens are not here.** Sends come from `email_send`; opens are
  the pixel's, in Tinylytics (`/mail/<kind>/<period>`), per mail and never
  per reader, and the servers never read them back (DECISIONS,
  "Analytics is client-side Tinylytics only"); the page says so and links
  Tinylytics.
- Tests: `services/web-api/test/beta-pulse.test.mjs` (cohorts, every
  step, the windows and their open counts, staff, test mailboxes, agents,
  integrations, denied, mail, and no id, address or tag in the answer),
  the route's admin/member split in `web-api.test.mjs`, and
  `apps/web/test/admin-pulse.test.jsx`.
- No MCP or JSON API change: MCP 11.4.1, JSON API 3.1.0.

## 2026-10-08 — the beta pulse and 0208 are live; two Gym guards

Deployed 9319942d (#379) at 23:31Z (6:31 PM CT): migrations 207 applied,
1 ran (0208); smoke ok; acceptance `players,clans` 234 cases, 2 failed,
31 skipped.

- **0208** marked the 35 first-read membership rows across 11 clans as
  baseline, as the census counted them; none deleted (Jamie: "Approved:
  mark the 35 first-read membership rows as baseline in elixir
  production").
- **The beta pulse** is at Console ▸ Admin ▸ Beta pulse; mail opens are
  only in Tinylytics.
- **Privacy:** privacy.md does not mention the beta pulse (Jamie
  2026-10-08: "Privacy page: no").
- **Triage, gym 132.4 and 332.5** (`players_summary` for #20JJJ2CCRU,
  asserting the "NOT comparable across rows" note): amend the guard.
  Their only `when` was `neq top_deck.dominant_mode.mode
  best_deck.dominant_mode.mode`, which holds when `best_deck` is null (no
  deck with 10+ battles in the window, or the best deck is the top deck),
  so they ran with nothing to compare. The guard is now `all` of `has
  best_deck.dominant_mode.mode` and the `neq`, with an `amended` reason
  on each case (Jamie: "Approved: add a has best_deck guard to gym 132.4
  and 332.5 in elixir-mcp acceptance/gym.json, with the deploy-results
  NOTES entry, by PR"). `acceptance.test.mjs` pins it: no best deck, or
  one in the top deck's mode, is SKIPPED; two modes without the note
  fail. Re-run alone against live with `--only`, both read SKIPPED. No
  deploy: a triage edit needs none.

## 2026-10-08 — card art rides in card responses (MCP 11.5.0)

Jamie: "Card art should be in the api response for cards." A top
player's Ladder and battle page drew Hero Electro Wizard and Evo Electro
Giant as text: the web built `<id>_hero-128.png` / `<id>_evo-*.png` from
the played form and the mirror had no such file.

- **Why the files were missing:** the mirror (`mirror-card-art.mjs`) was a
  hand step, last run 2026-09-22. Run again today it still cannot write
  them: Supercell's CDN answers 404 for exactly those two icons the
  `/cards` catalog lists (Electro Wizard `heroMedium`, Electro Giant
  `evolutionMedium`); the other 182 icon URLs answer 200. A form can be
  listed before its art is published.
- **What shipped:** `cardArt` in contracts maps a card's `iconUrls` to one
  URL per form on Elixir's origin (285 wide; -128/-192 at the same
  address). cards_card carries `card.art`; cards_catalog carries `art`
  when ids or query narrow it (the whole catalog would add ~14,000
  characters against the 48,000 cap); `/api/public/cards` and
  `/api/public/cards/{id}` carry it. The kit's `CardArt` reads the
  catalog's art through `CardArtProvider` (the web app wraps the router
  in `CardArtSource`) and falls back form, then base, then the name, so
  the two cards now draw base art under the Hero/Evo ribbon. Card pages
  and the cards index do the same; the share image reads the base key
  when the form's object is missing.
- **Mirror, not hotlink (DECISIONS, Web):** no surface hotlinks Supercell
  for card art. Every deploy runs the mirror before build-site, seeded
  from the site bucket (`--seed-bucket`) so a worktree deploy uploads the
  art and the 14-day asset prune never takes it; a mirror failure only
  warns. The two missing forms are written by the first deploy after
  Supercell publishes them.
- **Left:** mail's `cardAsset` still names the played form's file and
  cannot fall back in a mail client, so a mail showing Hero Electro
  Wizard or Evo Electro Giant draws a broken image until Supercell
  publishes them; collector avatars and Verify's card faces
  (`icon_medium`) still hotlink Supercell; tower troops have no art.

## 2026-10-08 — came back means a later day on the person's clock; housekeeping

Jamie's answers the same day, to the recommendations they name:

- **"8. agree": the beta pulse's came back.** BACK WK 1 and 2 now count
  only the person using Elixir: a `signed_in` event or a call of their
  own in `mcp_call_audit` (Console, Ladder, MCP or API; a service
  token's `svc:` calls under the account are not the person), on a day
  1-7 or 8-14 after the signup day, both days on the account's own time
  zone (UTC when it has none, or one Postgres does not know). A session
  only seen or refreshed no longer counts: a tab left open past UTC
  midnight was counting as a return. "Open" is judged on the same clock.
  Signup weeks stay ISO weeks in UTC. Nothing new is stored
  (`services/web-api/src/beta-pulse.mjs`; tests in `beta-pulse.test.mjs`:
  the open tab, a next-local-day read, a zone-less account on UTC, an
  unknown zone, a service token, and a UTC+14 window that has closed);
  the Admin footnote says so. The DECISIONS line carries the rule.
- **"9. agree, no need to review for approval": privacy.md.** The
  sentence that AI models "write some of the mail from public game data
  and help read and answer the feedback you send" is gone (DECISIONS: no
  model-written mail). Whether to name Clan's own-key model flow was not
  answered and stays in Jamie's list.
- **"10. we can skip this":** inbox placement for strangers is not being
  pursued; the line that tracked it is gone.
- **"11. fine":** Jamie's beta2 test account gets beta1's treatment, and
  both test accounts are signed out of every session then (Operator
  line).
- **"12. remove":** the 2026-10-05 `channels_ok: 0` line; STEWARD's
  10-08 rebuild logged `channels_ok` on all three bots.
- **Invitations:** Jamie invites POAP KINGS with the wording as it
  stands, and pastes the clan-chat line once to watch the chat filter.
- No MCP or JSON API change: MCP 11.5.0, JSON API 3.1.0.
