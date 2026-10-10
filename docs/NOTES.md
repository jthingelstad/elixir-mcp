# Elixir notes, to 2026-10-10

The archive of the dated working notes, frozen on 2026-10-10. Nothing is
added here any more:

- **A change's notes** are a file of its own in `docs/notes/`, written in
  the change's pull request (`docs/notes/README.md`).
- **Open items**, Jamie's queue and parked ideas are GitHub issues in this
  repository, labelled `needs-jamie`, `engineering` or `parked` (a parked
  issue names its trigger). The list that stood here moved on 2026-10-10:
  #414 to #433, with #292 and #296, which were already issues.

What still stands is `docs/DECISIONS.md`, one line per ratified decision
and declined idea; read it before proposing anything. Earlier entries are
in git (`git log -- docs/NOTES.md`); the last full version is at
`bb01d62b` (`git show bb01d62b:docs/NOTES.md`), and the weekly archives
that sat in an earlier `docs/notes/` are listed in
`docs/archive/README.md`.

## Entries

Oldest first, to 2026-10-10.

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
## 2026-10-08 — live_fetch only fetches (MCP 11.5.1, 0209)

Jamie: "is this because any use of live_fetch creates those records?
Based on current layout of Elixir I would say that live_fetch should ONLY
live fetch and not record data." A test run that day called `live_fetch`
for `/players/#VL9ULV8RL` and `/players/#UYPLUQ0U9`, players nobody
tracks, and the record kept their profiles: every live-lane result was
admitted and projected like a scheduled poll.

- **What shipped:** `job.record` (0209, default true). `live_fetch` mints
  its job with `record = false`; the door copies the row's flag onto the
  envelope at submit; ingest's `processFetchOnly` admits the payload (a
  malformed body is still refused) and holds it in `live_fetch_result`
  for the caller's next ask, deleting rows older than an hour. No
  api_payload, api_receipt or S3 archive object (no replay can project
  it), no projection, no poll_state freshness or retry, no clan follow,
  no collector point. A failed fetch-only read keeps its
  `collector_fetch_error` row and stamps no retry.
- **What still records, and why:** `live: true` on players_profile,
  clans_roster, war_current and battles_query (the tool answers from the
  record, so the record is what moves; true for any tag, tracked or not —
  whether an untracked tag's live read should record is a separate
  product call), Verify's battle-log reads (`routes/verify.mjs`, a
  claimed player's log) and the first read on add (`requestFirstRead`,
  #371: the tag is tracked from the add). All call `makeLive` with the
  default `record: true`. A recording ask behind an open fetch-only job
  turns it recording (`recordOpenJob`), and a fetch-only result is never
  that ask's "fresh" read; a fetch-only ask never turns a recording job
  off. `requestFirstRead` reads `api_receipt`, so a tag live_fetched and
  then added still gets its first read.
- **Budget and audit that remain:** the live token is charged at mint
  (`budget_charge`), the account's `liveday#` quota at mint, the job row
  stays (pruned weekly with other done jobs), `mcp_call_audit` has the
  call, and the scheduler's `fetches_hour` adds `live_fetch_result` rows.
- **Strays:** `{live_fetch_strays}` (read-only op) names every player tag
  live_fetch read in a window, whether anyone tracks it, and for the
  untracked ones what the profile admission left (snapshots, progress,
  badges, cards, PoL season, profile membership, player events), the
  player row, battles and memberships from elsewhere, and receipts by
  lane.


## 2026-10-08 — each agent has its own hour

Jamie's answer, verbatim: "6. yes, seperate limits". The evidence is in
STEWARD 10-08. Jamie's three Discord agents and a replay all spent the
owner's one hourly bucket of 300 (`mcp#<budget account>`). The replay emptied
it at 5:06 pm, and the bots got 429 from 5:08 until 6:00.

- `services/mcp/src/handler.mjs` `hourlyBucketFor`: the bucket is
  `mcp#<principal accountId>`. A key that carries its own `hourly_rate_limit`
  still spends `mcp#token#<id>`, the 2026-09-21 rule. Nothing changes for a
  person or an integration, because their principal is their budget account.
  The Explore page keeps the person's bucket.
- The ceiling is unchanged: 300 for every tier (`HOURLY_RATE_LIMIT`). There
  is no per-tier hourly number to cap against yet. If roles ever get one,
  the agent's ceiling is its owner's tier's.
- The daily tool-call quota and the live lane still key on `account.budget`
  (the owner). They were not raised.
- This is the MCP door's request limit. The collector rate budget is
  untouched.
- One consequence to watch: an owner with N agents can now make up to
  (N+1) × 300 MCP requests an hour. The daily quota is still the real cap,
  (Jamie's own account is owner-tier, so its day is unlimited).
- A replay that borrows a bot's own agent key still shares that bot's hour.
  Give a replay its own agent, or a key with its own ceiling
  (`{service_token_limits}`), to keep it off a live bot.

## 2026-10-08 — card art is byte-identical, never resized (MCP 11.5.2)

Jamie: "it is important with card art that we not modify it at all. we
can host them locally, but you cannot resize the images or alter them in
anyway." 11.5.0 (#381) served card art that the mirror had decoded and
re-encoded at 128, 192 and 285 pixels (`infra/scripts/lib/png.mjs`), so
no served file was Supercell's own bytes.

- **Mirror:** `mirror-card-art.mjs` now stores exactly the bytes each
  `iconUrls` icon serves, one file per card and form
  (`<id>.png`, `<id>_evo.png`, `<id>_hero.png`; contracts `cardArtPath`):
  no decode, resize, re-encode, metadata strip or format change; a
  non-PNG source is refused, never converted. Every run re-fetches every
  listed form; a matching sha256 is verified, a new or changed file is
  written and read back against the download's sha256. It removes the
  old resized names from the local cache and never seeds them from the
  bucket. `png.mjs` is deleted (nothing else used it);
  `services/mcp/test/card-art-mirror.test.mjs` holds the mirror to Node's
  own modules and keeps image code out of every card-art path.
- **Missing forms are expected:** Jamie: "For some reason it takes a
  couple weeks for new cards art to show up… this happens every time."
  A form the catalog lists answers 404 on Supercell's CDN for about two
  weeks; the mirror asks again on every deploy and the base card stands
  in until then (Hero Electro Wizard and Evo Electro Giant today).
- **Surfaces:** the kit's `CardArt`, card pages and the cards index draw
  the original with `width`/`height` (no srcset, no width copies). Mail
  draws the original with `width`/`height`, and an Evo or Hero the
  mirror lacks draws the base card, decided at compose time
  (`resolveCardArt`; the jobs Lambda HEADs the site bucket, new
  read-only `s3:GetObject` on `assets/cards/*` and `SITE_BUCKET`). This
  closes the #381 "Left" mail item.
- **Share images** (`/battle/<id>.png`) draw card art into a composed
  PNG, scaled to 78 pixels inside it; Jamie ruled that fine ("it is
  completely fine to encode card art into those battle images… other
  sites do that"). They now read the original files, and a miss is asked
  again rather than kept for the life of the function.
- **Contract:** 11.5.2, a correction: `art` URLs lose the `-285` suffix
  and the `-128`/`-192` copies are gone. JSON API 3.1.0 unchanged.
- **Left:** collector avatars and Verify's card faces still hotlink
  Supercell's `icon_medium` (unaltered); tower troops have no art.

**Live.** #387 merged as f96fb0d2 and was deployed from green
`origin/main` at 01:06Z (20:06 CT) with `--acceptance=cards`: 32 cases,
0 failed. The mirror wrote 182 originals, refused none, and found 2 forms
missing (`26000042_hero`, `26000085_evo`, both expected). A second deploy
of green main (da251e46, 01:17Z, 20:17 CT) verified all 182 against fresh
downloads. Read-back (reads only): the sha256 of Supercell's icon equals
Elixir's copy for Knight base/evo/hero, Hero Valkyrie, Evo P.E.K.K.A and
Electro Wizard. All are `image/png`. A battle page, its share PNG and
`/cards/26000042/` (base under the Hero ribbon) all draw art.

- **The first deploy baked the old names into the card pages.** The site
  build reads `/api/public/cards`, and CloudFront caches that response
  for an hour (`max-age=3600`). The build read the pre-flip catalog, so
  `/cards/` named `-285.png` until the second deploy rebuilt it. Any
  change to an `art` URL needs a second deploy once the cache turns
  over, or the site must build those paths from `cardArtPath` instead
  of the response's text. Neither is built.
- **The resized objects are deleted.** Jamie, verbatim: "Approved: delete
  the 546 resized card art objects (assets/cards/*-128/-192/-285.png) from
  elixir-mcp-site-999153317627 and invalidate CloudFront /assets/cards/*".
  Done 2026-10-09 about 02:00Z: the bucket holds the 182 originals and
  no resized object, the invalidation completed, and an old `-285.png`
  URL answers 404. Mail sent before 2026-10-08 named the resized URLs,
  so its card images now show alt text only.
- **Flake:** `services/mcp/test/query-budget.test.mjs` ("a read-only
  tool behind a lock…") failed once under full-suite load ('5s' !== '0').
  It passed alone 3 of 3 and on the next full verify. The run was
  unrelated, but the flake is a defect and remains open.

## 2026-10-08 — 11.5.1 and the per-agent hour are live; the strays stay

**Deploy.** #384 (live_fetch only fetches, 0209, 11.5.1) and #386 (each
agent has its own hour) went out in one deploy from green `origin/main`
90acd3a0, using `--acceptance`. 0209 ran and the stack is
`UPDATE_COMPLETE`. Acceptance found 824 cases with 2 failed, and both
failures are the known ones: gym 312.2 (live participants 45, expected 48)
and `elixir_timeline#docs`.

**Read-back** (reads only):

- `/tools.json` reports 11.5.1. Its live_fetch description says "It stores
  nothing".
- `/api/public/status` is healthy.

**Strays.** Jamie approved the deletion, verbatim: "Approved: delete the
profile snapshots live_fetch stored for untracked players in elixir
production". `{live_fetch_strays}` (days 90) read 5 tags. 2 are tracked
and 3 are not.

- **#VL9ULV8RL and #UYPLUQ0U9** were live_fetched at 23:05Z on 10-08, with
  one live-lane receipt each (`record` true, from before 0209).
  - `player_snapshot_daily`: 1 and 1
  - `player_progress_daily`: 2 and 0
  - `player_badge`: 107 and 136
  - `player_card`: 125 and 127
  - `player_pol_season`: 1 and 1
  - `player_profile_membership`: 1 and 1
  - `player_event`, `battle_participant` and `clan_membership`: 0
  - The `player` row is NAMED for both.
- **#9Y0LV2QCL** has an unnamed `player` row and no footprint or receipt.

The admission fed more than a snapshot: the player's name, cards, badges,
profile membership and Path of Legends season. The approval's condition
was to stop and report rather than widen the delete, so no deletion
migration was written. Jamie's call:

- delete the whole profile footprint plus the `player` row, receipt,
  payload and archive object, or
- leave them.

0209 means live_fetch can no longer create more.

**Feedback for the Feedback Manager.** `{feedback_respond}` is the Feedback
Manager's op under the `loop` lease, so these two items are left for it.

- **#34** (`planned`): shipped in 3.13.0. `battles_decks` rows carry
  `mean_level_gap`, `modes` and `dominant_mode`, and the response carries
  `comparable` with the conditional note, covering all three of the
  filer's proposals. Suggested: `done`, `shipped_in` "3.13.0".
- **#88** (`seen`): shipped in 6.19.0, which added `clan_war_trophies` and
  deprecated `clan_score`. 9.1.0 removed the war family's `clan_score`
  alias. On 10-09, `war_current` serves `clan_war_trophies` and no
  `clan_score`. Jamie, 10-08: "rename it and deprecate clan_score
  immediately", and that is already the shipped state. Suggested: `done`,
  `shipped_in` "6.19.0", and say the alias went at 9.1.0.

No `war_trophies` field was added. The war family already uses the clan
family's name, as the filer asked ("Fix the war family up to the clan
family's two"). A third name for the same number would break "One name,
one meaning". `clans_roster.clan_score` and the `clans_timeline`
`clan_score` metric are the profile's clan score, which is correct.

## 2026-10-08 — milestone mail is the big firsts; the friends mail collapses

Jamie approved round 5's "milestone mail digest and Friends mail
cleanup" and answered the product call: "4. Agree with recommendation."
The recommendation: mail immediately only for a new arena or league, a
new best trophy band, a new Evo or Hero form, and career milestones;
card unlocks and badge levels roll into the weekly mail as counts.

- **Evidence** (a read-only review of Jamie's received mail, three
  weeks): about 40 milestone mails, mostly "You unlocked Ice Spirit" and
  badge levels for two low-level alts, every one in Trash. The friends
  mail drew POAP KINGS as one ~1,000-character semicolon-joined
  paragraph, printed "Arrows Mastery to level 10.." and listed watched
  players quiet 169 days. The timeline read held 321 items in 7 days,
  much of it card unlocks and level-5 badges.
- **Milestone** (`MILESTONE_MAIL_KINDS` in `build-milestone.mjs`):
  `arena_changed` up, `ranked_promotion` up, `best_trophies_band`,
  `card_form_unlocked`, and "career" as the two existing step kinds,
  `career_wins_step` and `collection_level_step`. `card_unlocked`,
  `badge_earned` and `legendary_badge_earned` no longer mail and are no
  longer written to `email_milestone`. A one-off legendary badge is not
  in Jamie's list, so it is counted with the badges, not mailed. The
  hourly look, the seven-day reach-back and once-ever keys are unchanged.
- **Tuesday Arena** carries `progress`: per own tag, the entry's
  `collection.unlocked`, `badges.earned` and `badges.legendary` as
  counts, with a link to `/console/account/timeline`. Every alt's entry
  is read now, not only an alt that battled. A week with no battles at
  all is still skipped, counts and all.
- **Friends**: card unlocks and badges leave the card moments
  (`MOMENT_KINDS`) for a count from the entry; a clan is
  `clanSummaryParts` (new in `summary.mjs`; `summarizeClan` joins the same
  clauses, so MCP output is byte-identical) as a headline plus three
  bullets and "N more"; `days_quiet` of 30 or more collapses into one
  line; `clause`/`sentence` in the renderer end a sentence once. The
  double period came from the "You" row appending "." after moment
  texts that already end in one.
- **Not changed:** the timeline (order, items, cap) and every MCP and
  JSON API response; no contract bump (MCP 11.5.2, JSON API 3.1.0).
  Issues stored before this render as they did (`line`, no `progress`).

## 2026-10-08 — `{tag_footprint}`: the whole record of a tag, read before a deletion

Jamie, verbatim: "Approved: delete the full record footprint of untracked
live_fetch tags" (three tags admitted by the pre-11.5.1 live_fetch path).
`{live_fetch_strays}` counts only the tables a profile admission writes,
so a deletion scoped to "the full footprint" needs a read of every table
that can hold a player tag first, and the same read after.
`{tag_footprint}` (read-only) finds every base table with a tag column
from the catalog and counts each tag's rows, with what would make the
tag tracked, its battles and their other side, its MCP calls and its
payload archive objects. The deletion is its own migration, after this
read.

## 2026-10-08 — 0210: the live_fetch strays leave the record

Jamie, 2026-10-08, verbatim: "Approved: delete the full record footprint
of untracked live_fetch tags" for three untracked tags admitted by the
pre-11.5.1 live_fetch path (the tags are in 0210's SQL only).
`{tag_footprint}` (#390) read every table with a tag column first.

- **Two tags go, by migration 0210.** Each held one live-lane admission
  (`record` true, before 0209) and what it projected, and nothing that
  makes it tracked: no recording, claim, challenge, sign-up request,
  agent identity, nickname, open job, membership, battle or event. Before
  (tag A / tag B): `player` 1/1, `player_badge` 107/136, `player_card`
  125/127, `player_pol_season` 1/1, `player_profile_membership` 1/1,
  `player_progress_daily` 2/0, `player_snapshot_daily` 1/1, `poll_state`
  1/1, `api_receipt` 1/1, `api_payload` 1/1; every other tag column 0.
  0210's guard refuses (and stops the deploy) if either became recorded
  since the read; the deletes are scoped by tag literal, children first.
- **One tag stays whole.** Its `player` row came from an account adding
  the player (a claim recording, since stopped, and that account's
  events), not from live_fetch: all five of its live_fetch reads failed
  (five fetch errors, no receipt). The approval was for what live_fetch
  admitted, and anything a claim made is the account's history, so
  nothing is deleted for it.
- **Left, on purpose:** the job rows and fetch errors (operational,
  pruned on their own clocks), `mcp_call_audit` (the call log), the clan
  row the profiles upserted (a clan's, shared), and `mode_season`,
  `arena` and `card` (global).
- **Owed to Jamie:** the two payload archive objects in S3
  (`payloads/endpoint=player/entity=<tag>/dt=2026-10-08/...`). No
  migration reaches the bucket and nothing holds `s3:DeleteObject` (the
  bucket is versioned, write-once by policy). With the receipts gone no
  replay walks to them; deleting them is a console step for Jamie, keys
  in the session report.

## 2026-10-08 — 0210 is live; the two strays are gone

**Deploy.** #390 (`{tag_footprint}`) and #392 (0210) each went out from
green `origin/main` under the `session` lease, no acceptance (an op and a
data migration; no tool changed). 0210 ran (`applied 209, ran 1`);
`/api/public/status` is healthy.

**Read-back** (`{tag_footprint}`, reads only): both deleted tags now read
0 in every tag column except one `job` row each (operational, pruned with
done jobs), with no player row, receipt or payload row. The third tag and
a tracked neighbour read exactly as before the deploy, table by table.
About 520 rows went, so no `{vacuum}`. Still owed: the two payload
archive objects in S3 (Jamie, console; previous entry).

## 2026-10-08 — a legendary badge is a milestone mail

Jamie, verbatim: "Approved: legendary badges send immediate milestone mail
in elixir-mcp, PR and deploy". `legendary_badge_earned` joins
`MILESTONE_MAIL_KINDS` and mails once, ranked beside a new best. It is no
longer counted in Tuesday's Arena week (`progressOf` drops
`legendary_badges`; stored issues still render the old field). Plain badge
levels and card unlocks stay counted. MCP 11.5.2 and JSON API 3.1.0 are
unchanged; the deploy needs no acceptance family (mail only).

## 2026-10-08 — what you faced, most losses first, as a choice (MCP 11.6.0)

**What.** Ladder ▸ Cards' opponent side (Across the table from you, and
Opponents met again) gains an order the reader chooses: **Most faced**
(the default, unchanged: most battles first) or **Most losses** (most
battles lost first, then most battles). The choice is an address
(`/ladder/cards?order=losses`); the mode tabs and the season switch keep
it, other pages never carry it. Every card row and every repeat opponent
shows its level gap, or a dash where the record has no levels. No row is
labelled and no line advises.

**MCP 11.6.0 (additive).** `battles_cards` takes `sort`
(`battles` | `losses`, echoed in `applied.sort`); `battles_opponents`'
`sort` also takes `losses`, and its rows gain `mean_level_gap`. The
pages read the tools' order (rule "a number Ladder needs that no tool
returns is a tool change"): a client re-sort of `battles_cards`' top 120
by battles would not be the top 120 by losses. Neither tool is an
`/api/v1` operation, so JSON API 3.1.0 is unchanged.

- **The minimum.** A card row needs 3 battles (`battles_cards`' existing
  floor, `applied.min_battles`); an opponent needs 2 meetings (the page
  already read repeats only). Losses is a count, not a rate, ordered ties
  to the most battles, so a single loss cannot lead the list; the page
  states both floors beside the choice.
- **The level gap** is the one already stamped at ingest
  (`deck_avg_level - opp_deck_avg_level`, 0156), on the display scale
  `displayLevel` converts to at the one seam; no new level arithmetic.
  For `battles_opponents` it is the side mean, as on every other battle
  tool, so a 2v2 row's gap includes both opponents; a duel has none.
- **Wording.** "nemesis" and "a strength" left `battles_cards`'
  declaration, its OPPONENT note, the pooled-modes note
  (`controls.mjs`), the battles docs and `ladder-cards.js`.
- **Acceptance.** `identities.mjs` gains
  `battles_cards-battles_opponents-losses-order`: both orders hold the
  same rows and counts, the floor holds, the losses order is losses then
  battles descending, and every opponent row carries `mean_level_gap`.

## 2026-10-08 — a race in matchmaking is no race yet (MCP 11.6.1, 0211, 0212)

Closes the 2026-10-05 open item: a `live: true` race read that lands in
matchmaking said "The live fetch returned a payload our admission
rejected." The next season roll is Monday 2026-11-02.

**Where "rejected" came from.** Not the collector: the Go client sends
the API's 200 body untouched and ignores the door's `outcome`. Admission
refused the matchmaking body (`state:matchmaking`, 7176f673, so it was
already not charged), the receipt said `rejected`, and the live lane
(`tools/live.mjs`) turned any non-admitted receipt inside the cache window
into `reason: "rejected"`, which `liveRead` (`tools/shared.mjs`) threw as
`live_unavailable` with that message. `live_fetch` failed the same way.

**Evidence.** The payload archive under `currentriverrace` holds no
matchmaking body (no object under 526 bytes; new content is always
archived), and on 2026-10-05 the three recorded races have no object
between 09:03Z and 13:47Z: the daily 404 hold (fixed in #308) kept the
recorder off the race through the whole roll, so the matchmaking body was seen only by
crprobe (cr-agent-api-docs PR #4). The live-tool calls in
`{audit_census}` for 09:30Z to 12:00Z that day have no `live_unavailable`.
So no recorded receipt is a matchmaking one, and 2026-11-02 is the first
roll the recorder reads through (the race keeps its cadence through the
404 since #308), so it will meet the state on its own polls.

**What changed.**
- Admission: the body `{periodIndex, sectionIndex, state: "matchmaking"}`
  with no `clan` is its own outcome, neither admitted nor rejected:
  receipt `admission = 'matchmaking'` with no errors (0211 widens the
  check on `api_receipt` NOT VALID, 0212 validates it; `live_fetch_result`
  widened in 0211). Nothing projected, freshness holds (read again on the
  30-minute race cadence), no collector charge (`chargedRejectionSql` is
  now `admission = 'rejected'`), the raw body archived as always.
  `RACE_MATCHMAKING` is now the admission value `matchmaking`, not the
  error string `state:matchmaking`; readers of a usable race keep
  `admission = 'admitted'`, so the race lane's series backfill never
  walks it.
- Live lane: a matchmaking receipt in the cache window answers
  `reason: "matchmaking"` (no new mint until the window passes);
  `liveRead` returns `state: "matchmaking"` with `fetched_at` and
  `retry_after_s`.
- `war_current`: `live_status: { state: "matchmaking", fetched_at,
  retry_after_s }` and a "No race yet" note; the rest is the last race
  recorded. No race recorded: `live_pending` with `retry_after_s` (live)
  or `not_recorded` naming the matchmaking read (not live). Without
  `live: true` the note rides while the clan's latest race receipt is a
  matchmaking one.
- `live_fetch` of `/clans/{tag}/currentriverrace`: the API's body as
  `data`, `live_status` matchmaking, the note. Still stores nothing.
- No web or Clan surface reads the race live: Clan's and `/api/v1`'s live
  read is `live_fetch` of `/clans/{tag}` only. JSON API 3.1.0 unchanged.
- Never a missed race: no race row exists to count, and Clan judges the
  week's `decksUsed` from admitted races only.

**Proof without waiting for 2026-11-02.** Replays of the reference's
body (no tags) through the real pipeline and live lane on scratch
databases: `packages/ingest/test/admission.test.mjs`,
`packages/ingest/test/pipeline.test.mjs` (receipt `matchmaking`, archive
put, war tables and freshness untouched, not charged) and
`packages/tools/test/live.test.mjs` (war_current live and not, an
unrecorded clan, live_fetch).

**For the collector:** nothing. **For cr-agent-api-docs:** nothing new;
`models/river-race.md` and `clans.md` already state the body and "treat a
race without clan like the 404: no race yet". Still open, not changed
here: a `live: true` race read during the roll's 404 (no receipt, only a
`collector_fetch_error`) stays `pending` and mints a new read each call
past the cache window.

**Deployed** 2026-10-09 02:36Z (21:36 CT on 10-08), e26d2fac, with
11.6.0 and the Ladder Cards change: migrations ran 2 (0211, 0212),
contract 11.6.1 live. Full acceptance: 825 cases, the two known failures
only (gym 312.2, live participants 46 against 48 members with two not in
the race roster; `elixir_timeline#docs`). Read back: `war_current` on the
home clan answers its war day as before, with no matchmaking note. The
matchmaking path itself is proved by the replay tests above; the first
live roll it meets is Monday 2026-11-02.

## 2026-10-08 — form: this week beside the last four, and before and since a deck

Ladder's season home and Tuesday's Arena mail now answer "am I
improving?" with numbers only.

- **The week.** In the current season, a "This week vs your last 4"
  panel sets the running game week (Monday 10:00Z, the Arena mail's
  week) beside the four whole game weeks before it, in the page's mode:
  win rate over decided battles, three-crown rate over head-to-head
  battles, and net trophies in Trophy Road and Path of Legends, each with
  its count. One `battles_performance` read with `compare_from`/
  `compare_to`.
- **The deck.** When the season's most-played deck in the mode
  (`battles_decks`' first row, by deck hash) first appears after the
  season opened and other decks came before it, a "Before and since
  {archetype label}" panel splits the season at its `first_used` with
  `before_after`. Both sides count every deck in the mode; the foot names
  the deck played most before the split.
- **The mail.** `build-arena.mjs` makes the same compare read for the
  primary in the featured mode (war when the week was only war), and the
  renderer adds one line under the tiles ("Trophy Road win rate 57% this
  week (14 battles), up from 34% over the previous four weeks (35
  battles).") Stored issues have no `form` and render without it.
- **One computation.** `@elixir-mcp/record/form` holds the week boundary
  (`gameWeekStartMs`, now also what `lastGameWeek` uses), the windows,
  the arguments, the minimum and the shaping; web and jobs both import
  it. No tool output changed (the compare and before/after windows
  already carried `decided_battles`, `head_to_head_battles` and
  `three_crown_rate`), so no contract bump, no `/api/v1` change and no
  acceptance family on the deploy.
- **The minimum** is `FORM_MIN_BATTLES = 10` per side, applied to each
  number's own count; a number short on either side is dropped from both,
  so a row is like for like, and a short win rate hides the panel or the
  line. Ten is a week of a few short sessions; below it one or two
  battles swing a rate by ten points.
- **Open.** Path of Legends' `trophyChange` is rating in league 7 and
  league trophies below it, so "Net trophies" there mixes the two units
  across a promotion, as the season tile already does.
- **Live** 2026-10-08 21:51 CDT (deploy of `a8ebbc9b`, no acceptance
  family: no tool output changed). Read back with reads only: the live
  Ladder chunk carries both panels, and `/updates` and the docs anchors
  serve. No own player of Jamie's has 10 battles in a mode this game
  week yet, so his strip is hidden for now; a followed player's Path of
  Legends reads 75% (12) beside 73% (15), three-crown 50% beside 27%,
  +270 beside +330. thingles' Season 136 Trophy Road splits at the
  first Hog Rider control battle: 88.5% (87) before, 92% (25) since.


## 2026-10-08 — the clan report sets its week beside the weeks before

The Monday clan report described one week alone. It now carries `trend`
(`build-clan.mjs`, rendered by `packages/mail`):

- **War decks:** decks used of those possible for the race that closed,
  beside the races that closed in the four weeks before, each with its
  share, and the pooled share of those before. Used is the sum of the
  game's weekly `decksUsed` (`war_history`'s exact week), so training
  days never count and nothing is split by day; no fame, and no member is
  named. Possible is four decks a war day up to `finish_war_day` (four in
  Colosseum) for each member on the roster at the close. `warDaysAsked`
  moved from `clan-engine/week.mjs` into `record/war-clock.mjs`, which
  both now read; `clan-engine` depends on `@elixir-mcp/record` for it
  (war-clock imports nothing, so the browser bundles are unchanged).
  `war_history` is read three seasons back (was two) so a season's first
  week reaches the races before it.
- **Activity:** battles and members who battled by `battle_time` (boat
  defenses excluded), against the average of the four weeks before, in
  the clan's-week row. Comprehensive clans only. The headline's battles
  and active members now read this count, so the week shows one number.
- **Thin history:** a prior week the record lacks (no participants, a
  capped list, no roster at the close, before the recording began, no
  battle) is left out, and the words say how many weeks are compared;
  with none the comparison is left out. Issues stored before render
  without the block.
- **Read-back op:** `{clan_report_preview}` on the jobs Lambda composes
  one clan's report in a read-only session beside the issue stored for
  that week (`.claude/skills/ops/SKILL.md`).

No tool output changed: MCP 11.6.1 and JSON API 3.1.0 stand, and the
deploy needs no acceptance run.

**Open:** possible counts the roster at the close while used counts every
participant, so a week with churn can exceed 100% before the cap; the
render caps each share at 100%.

**Deployed** 2026-10-09 03:13Z (10:13 PM CT on 10-08), 3274df12 (#396),
from green `origin/main` under the `session` lease; no acceptance (no
tool output changed). `/api/public/status` healthy.

**Read back** (`{clan_report_preview}`, read-only, the home clan's
2026-W40 report): the stored issue renders unchanged with no `trend`;
composed now, the same week shows War decks "191 of 768 possible war
decks used (25%), 577 not played. Over the four races before: 36%",
with S136 weeks 3, 2 and 1 (finished on war day 3, so three days asked)
and S135 week 5 (Colosseum) in the table, and the clan's-week row "The 3
recorded weeks before averaged 2,821 battles a week, by 44 members."
The headline reads 2,484 battles by 44 (the stored issue's 2,481 was
counted by when the battles were learned). The week of 08-31 is left out
of the activity comparison: it starts before the clan's active recording
row's `created_at`.

## 2026-10-08 — round 6 approvals, recorded

Jamie's approvals for the round 6 changes, verbatim (the PRs that built
them left the wording to this entry):

- #395, the form strip on Ladder and the Arena mail line: "Approved: round
  6 primary, "am I improving" trend on Ladder and in the Arena mail in
  elixir-mcp, PR and deploy".
- #396, the Monday clan report trend: "Approved: round 6 backup, 4-week
  trend and decks-used-of-possible in the Monday clan report in
  elixir-mcp, PR and deploy".
- #397 (11.6.1), the matchmaking race read: "Approved: fix the rollover
  live race read during matchmaking in elixir-mcp, PR and deploy".
- #394 (11.6.0), what you faced ordered by losses: approved in the
  2026-10-08 open-questions review ("5. agree"), as a reader's choice,
  never the default, with a battle floor and the level gap and no label.

## 2026-10-09 — one dashboard, no new metrics

Jamie's call: "Approved: add the elixir-mcp CloudWatch dashboard to
infra/template.yaml and amend the no-dashboard decision". The 2026-09-24
rule had two halves. The cost half stands: a custom metric still exists
only to back an alarm. The other half, no dashboard because no one opens
the console, is lifted.

`OpsDashboard` (`elixir-mcp`) is stack-owned and reads, top to bottom:
the alarm states (all but the conditional certificate alarm), the three
doors (requests, errors with the handled-failure count, p95 against each
alarm line), CloudFront, recording (scheduler ticks, jobs, the ledger
gauges, submit ingest errors), the database (CPU with the credit
balance, which has no alarm on the micro; memory, connections, EBS byte
balance, IOPS, storage) and mail. Tool detail comes from Logs Insights
over the MCP door's `tool`/`status`/`ms` line, and fleet pace from the
scheduler's EMF properties (`FetchesHour`, `QueuedJobs`,
`CollectorsActive`), so neither needs a metric.

It is the account's third custom dashboard (Drop and YVN are the
others) and references 33 metrics; the free tier is three dashboards of
50. Whether the alarm widget counts toward the 50 is unconfirmed; if it
does, the dashboard is $3 a month. A day's MCP log query scans about
3 MB.

## 2026-10-10 — 11.7.0: an empty timeline poll skips the build

Jamie's call: "Approved: empty-poll fast path for elixir_timeline in
elixir-mcp". The census for 2026-10-09 10:12Z to 10-10 10:12Z: 864
elixir_timeline calls, 89% of 974 MCP calls (the three Discord agents at
5 minutes), avg 542 ms, 379 ms in the DB, 24 queries; about 96% returned
no items. Every one built every subject's entry and items before the
kinds filter or compact verbosity applied.

`skip_empty: true` (opt-in; the bots' carry-release turn reads entries
from an empty window, so the default is unchanged) runs `timelineNews`
first: one statement with a column per item source in buildTimeline
(player battles, player moments, the player's clan moves, the player's
quiet rung, the clan ledger, member moments, member battles for standouts,
sessions and returns, the clan's quiet rungs, account events, attested
facts), each a superset of what its builder serves, asked only when the
read's kinds keep one of its kinds. Quiet rungs are clock, not rows: the
check asks for a battle a rung before the window with none after it until
the rung. All false: the read answers with empty timeline, entries and
quiet, `entries_skipped: true`, and moves the pointer, next_cursor and
meta exactly as the full read (same code below the build).

`timeline-skip-empty.test.mjs` seeds one moment per source and sweeps
5-minute and hour windows over them: any window the build serves an item
in must answer the check, under no kinds and under each served kind
alone. Disabling each source in turn fails that assertion for all ten.
On the scratch database an empty poll was 9 queries against a full
read's 51.

**Deployed** 2026-10-10 about 11:03-11:12Z (06:03-06:12 CT), platform
lane, from 86806590 under the session lease, `--acceptance=elixir`: smoke
green; 187 cases, 1 failed, 12 skipped. Live: `tools.json` serves 11.7.0
with `skip_empty`; `elixir_changelog` since 11.6.1 answers the entry.

- **FAIL `catalogue/elixir_data_insights#0`**, 6,209 ms against a 4,022
  ceiling (the week's one call, 2,348 ms); 5,644 ms alone, so not a
  flake. `{profile_tool}`: four sequential scans of
  `player_snapshot_daily`, whose heap is 8,926 pages (73 MB) for 12,186
  live rows after the 2026-10-07 purge (443,521 deleted), read cold.
  Verdict: fix forward, 11.7.1 reads it once. The heap itself only
  shrinks with a rewrite, which `{rewrite_table}` does not offer for this
  table and is Jamie's window if wanted.

**Live measurement** (`{profile_tool}`, acceptance principal, reads
only). An empty roster-kinds window: skip_empty 7 queries, 8-27 ms in
the DB (25-60 ms total) against the full read's 27 queries, 262 ms (520
ms total). With the bots' editor kinds, six 5-minute windows 10:14-10:44Z
skipped four, but the check itself cost ~530 ms: `quiet_crossed` asked
the quiet-rung column, which joined the tag set to `battle_participant`
with the rung's bounds and the planner scanned all of it (512 ms of 526,
temp spilled). Every other source took milliseconds.

## 2026-10-10 — 11.7.1: the quiet check and the corpus count read less

The quiet-rung check goes lateral per tag and rung, so each pair is a
range on `battle_participant_player_time_cover` (player_tag, battle_time
desc); semantics exact, no limit, since a window may span 30 days. The
sweep test holds, and a check that never answers quiet fails it.
`elixir_data_insights` reads the snapshot count, both profile counts and
the newest date in one scan; the badge count stays its own read.

**Deployed** 2026-10-10, finished 11:31Z (06:31 CT), from 980e50f8 (PR
#404) under the session lease, `--acceptance=elixir`: smoke green; 187
cases, 1 failed, 12 skipped. The one failure was again
`catalogue/elixir_data_insights#0`, now 4,597 ms (from 6,209). Its DB time
is 512 ms (one scan, 367 ms cold; four scans took ~1.65 s), and the rest
is the fresh Lambda. Alone: 4,507 ms (first call), then 1,806 and 790 ms.
Verdict: fixed by 11.7.1; the residual was the post-deploy cold start.
Lease released 11:32Z.

**Live, the bots' editor kinds** (wake plus carry, 20 kinds), six
5-minute windows 10:31-10:57Z through `{profile_tool}`: the check is
13-15 ms warm (97 and 253 ms on the first, cold calls), and a skipped poll
21-25 ms in the DB and 7 queries, against the full read's 252-283 ms and
27 queries warm. Three of the six windows skipped. A window with any
member battle answers yes, because a battle can make a `session_standout`
or a `returned`, and those six windows held battles in half of them. So
the bots' skip rate will be below the 96% of polls that served no item.
Measure the agents' `elixir_timeline` calls with `{audit_census}` a day
after they adopt `skip_empty`. If the yes-without-item rate matters, a
tighter `clan_member_battles` (the standout rule and the return gap
in SQL) is the next step. It must still never answer no wrongly.


## 2026-10-10 — Actions in the clan's Discord

Jamie asked for a Clan setting that shares Actions to Discord through a
webhook, each as a short title and a link with no preview, with the
message edited when the Action is completed, naming who; and a nudge on
the Actions page for leaders until it is set up. Jamie's answers: titles
name the member, removals included (Settings advises a leaders-only
channel); no clan name; Actions already open are posted on setup;
leader and elder Actions only, never a member's own away prompt.

The VPC side has no egress, so posts and edits go through the outbox
bucket to the relay under `clan-discord/`, sealed like the model bridge.
The relay claims a request before calling Discord; only a 429 is
retried, and a post whose outcome is unknown is never made again (a
duplicate message is worse than a missing one). Edits need the message
id, which arrives in the relay's reply; `share` collects replies and
posts or edits at most ten Actions a sweep, after every locked Clan
request and after the morning run. A reply to a morning-run post is
collected by the next request or the next morning, so a close in
between edits late.

The jobs function now holds `clan_sealing_secret` too (the morning run
opens the clan's webhook to post); it already held `SESSION_SECRET`.

## 2026-10-10 — the timeline cross-posted to Discord

Jamie asked for a person's timeline (all their watched players, not
filtered) and an agent's (its clan and tracked players) to syndicate to
a Discord webhook, set on the Timeline page and shown in Settings.
Jamie's answers: post once and edit the message as the item grows;
plain lines with `<link>`-wrapped links back to Elixir, so nothing
unfurls; event driven when items arrive, not polling. Defaults taken and
stated: owner-only and console-only (never MCP or `/api/v1`), no
backfill, leaders-only items never post, the sync keeps its own pointer,
only Discord webhook addresses are accepted and saving sends a first
line, the URL is shown shortened and never logged, a gone webhook turns
it off and the page says why. Judgment call, told to Jamie: the
account's own administration lines (section `account`) stay in the
console.

Shape: `packages/syndication` and an eighth Lambda,
`services/timeline-sync` (VPC). A collector admission that wrote facts
calls `wakeSyndication`, which writes one `timeline-sync/` object per
woken account per minute (written once); its queue holds it 60 s, so a
burst is one sync. The sync locks the account's `timeline_discord` row
(0213), reads its timeline non-interactively from `synced_to`, narrows a
window the 150-item cap cut and wakes itself for the rest, re-reads open
sittings from their start so an edit tells the whole sitting, and writes
up to 20 lines an object to `timeline-discord/`. A post's revision is
`revision * 2 + (closed ? 1 : 0)`, so a sitting that closes with no new
battle is edited once to drop "still going".

Delivery converged on Clan's Actions to Discord, built the same day:
one relay (the email relay), one webhook parser (contracts
`parseDiscordWebhook`, which Clan's `parseWebhook` now calls), Clan's
Discord client, and Clan's rule that a post whose outcome is unknown is
never made again (a 429, a dead webhook or a 400 frees the claim; an
edit is retried). The webhook is sealed with Clan's box under its own
purpose (`timeline discord webhook v1`, AAD bound to the account): the
web API seals it on save, the sync copies the sealed box without the
secret, and only the relay opens it. No new secret holder. So it needs
`ClanInternal=true`; without the secret the save answers
`discord_unavailable`.

Differences from Clan's path, on purpose: the relay keeps each post's
message id beside the outbox (`timeline-discord-state/<account>/<webhook
fp>/<item>.json`, conditional writes claim before the call) instead of
replying to the VPC side, because the sync has nothing to collect a
reply with; a missing state key reads as AccessDenied without ListBucket,
so the relay lists the exact key under an `s3:prefix` condition. The
first line on save is asynchronous and its outcome shows on the panel
(Clan's save waits on its reply). A line deleted in the channel is
marked and stays deleted. The relay status (`ok`, `gone`, `failing`) is
what the sync reads to turn a gone webhook off.

The timeline's lines have their own queue (`TimelineDiscordQueue`, batch
1, concurrency 2) into the email relay, a 35 s budget per run and 20
lines per object, so a busy channel never delays sign-in mail on the
email queue or runs past the relay's 60 s timeout. DLQ alarms on both new
queues.

**Deployed** 2026-10-10, finished ~12:58Z (07:58 CT), from 1a3a101c (PR
#407) under the session lease, no acceptance family (no tool changed):
0213 applied, smoke green. Read back without a write: the
`elixir-mcp-timeline-sync` function (VPC, 512 MB, 60 s) and its queue
and DLQ; the outbox notifies `timeline-sync/` and `timeline-discord/`;
the email relay maps the timeline-discord queue at batch 1, concurrency
2; signed out, `GET /api/me/timeline/discord` is 401; no collector or
relay errors in the first minutes of admissions. No account has it on
yet, so the first real post is the first owner's save (its hello line
and the panel's status). Lease released.

## 2026-10-10 — a kick is never told as a leave

Jamie, while scoping Clan's activity posts to Discord: "Kicks can be
narrated but they should be shown as 'was removed' as opposed to 'left'.
This same rule should apply to how any syndication approaches this."
The game's roster cannot tell the two apart, so `member_left` and
`clan_left` now say the member *departed* (the word `clan-engine`'s week
already used for the same reason), and `departure_classified` says
*was removed from* for a kick. Item text is shared by MCP, the console,
the tracking mail and the Discord cross-post, so one change reaches all
of them. Contract 11.7.2 (wording only).


## 2026-10-10 — Clan's model list really refreshes; spend and a monthly cap

Jamie, from Settings: the model list was frozen at the day the key was
added (no Claude Haiku 5.5 or Sonnet 5.5), and asked for the month's
approximate spend beside its tokens and an editable monthly spend cap.

- **The refresh never ran.** `updateKeyItem` compared the stored sealed
  key by object identity (`current.sealed !== sealed`). Postgres parses a
  fresh object for every read, so every refresh decided the key had
  changed and returned `key_changed` before it called Anthropic. The web
  API log showed three refreshes for POAP KINGS that morning (11:49,
  12:05, 12:26Z), each 200 with three `clan_state.get` and no write. The
  tests passed because the memory ledger handed back the same object.
  Fixed by comparing the sealed bytes (`sameSealed`), and the memory
  ledger now returns a copy on every read, as Postgres does. With the
  old comparison back, six refresh tests now fail.
- **Spend** (`packages/clan/src/manage/prices.mjs`): a use's recorded
  tokens at Anthropic's first-party list rates as of 2026-10-10 (from
  platform.claude.com pricing; Haiku 5.5's higher rates over a 100,000
  token prompt included). A model missing from the table is priced at the
  dearest of its family, or the dearest of all, and marked estimated, so
  a cap is never passed for want of a price. Settings shows each use's
  cost and the month's.
- **Cap**: `spend_cap_usd` on the key item, $0.01 to $1,000 to the cent,
  set or removed by the leader or a co-leader (as the model choice is),
  kept when the key is replaced. `write` refuses `model_spend_cap` (429)
  before reserving a use once the UTC month's estimate reaches it; a
  capped draft is not a use. The 20 uses a day stays. `spendNow` is the
  check any other path that spends the key must call.
- No MCP contract or JSON API change.

## 2026-10-10 — the clan's activity in its own Discord channel

Jamie asked for a third way between the timeline cross-post and the
elixir-mcp-discord agent: "a Discord social setting in Elixir Clan…
the easiest, simplest, but still very powerful way for a clan to see
their activity in Discord", a NEW webhook (not Actions', not timeline
sharing), sourced from the timeline as the agent is, event driven,
plain text with `<link>` links, no backfill, and optionally the clan's
own key making the posts "materially better and not template driven"
in a voice the leaders write.

- **Where:** migration 0214 (`clan_activity_discord`, `_told`), private
  Clan state beside the timeline cross-post's tables. Settings and sync
  live in `packages/syndication` (`clan-settings.mjs`, `clan-sync.mjs`);
  the rules in `clan-engine/activity.mjs`; the leaders' service in
  `clan/src/manage/activity.mjs`; the page in clan-web
  (`ActivityDiscord.jsx`, Social ▸ Discord in the rail; first shipped
  as a section of Settings, and moved the same day, Jamie: "this should
  be a new top level feature in the “Social” section of the left hand
  nav").
- **Pipeline:** the cross-post's own. A wake `{v:1, clan_tag}` under
  `timeline-sync/clan-<tag>.<minute>` from the collector's admissions and,
  new, after an attested fact (Clan's session writes and the family-app
  API), which also wakes account cross-posts. The timeline-sync reads the
  clan's timeline as a member does (`buildTimeline` `clanMember`),
  writes `timeline-discord/` objects of kind `clan_activity`
  (`clan_hello` for the connection's first line), and the relay opens
  the webhook with the clan's seal (`clan activity webhook v1`, bound to
  a random channel id per webhook).
- **Policy:** members and milestones default on; Clan Wars on for
  `participating`, off for unspecified, ruled out for
  `not_participating`. A leader's switch is stored only where made.
- **Departures:** `member_left` posts "departed"; `departure_classified`
  edits that message (key of the departure, revision above 1000), or
  replaces it when both land in one run. With no told departure (the
  join predates the connection) nothing is posted.
- **The rewrite:** `writeUnattended` in the model service, the one
  purpose sent unread (`discord_activity`). The timeline-sync asks
  through Clan's model bridge with `CLAN_MODEL_SECRET` (now in its
  env) and a pg connection of its own so the use record commits. Lines
  carry the sentence and public facts, never a tag; the engine refuses
  a changed name, an invented number or a long line, and that line
  keeps Elixir's words. The first 20 lines of a run are rewritten.
  50 runs a day, counted apart from the leaders' drafts, and stopped
  by the leaders' monthly cap (`spendNow`) as their drafts are.
- **Time:** a clan run that would start with under 40 s left goes back
  to the queue (`clan_activity_later`); its pointer means a wake that
  never runs only delays a post. The model's wait is at most 25 s.

## 2026-10-10 — privacy.md names timeline cross-posting

Jamie approved the proposed Discord paragraph for privacy.md ("Approved:
add the Discord paragraph to privacy.md in elixir-mcp"), so the queued
ask is closed. It covers the timeline's cross-post only; Clan's Actions
and activity posts to a clan's Discord are not named on the page.

