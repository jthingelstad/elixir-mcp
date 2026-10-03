# Recorder email engineering

The current kinds and delivery behavior are documented at `/docs/email`.
Active composition is structured from recorded facts, without model generation.
`top_100` and `card_of_week` are retired: historical ledger rows and
archived sent message bodies remain readable, but old generation/accept payloads and
send requests refuse before I/O. Their prior engineering record is archived
in `docs/archive/2026-10-02-EMAIL-BEFORE-RETIREMENT.md`.

The personal week, friends, clan and collector reports keep their existing
EventBridge slots, the hourly milestone path, preferences, and deduplication.
Clan's action mail uses the consolidated runtime and its existing contract.

## The shared foundation

Built once, used by every kind. In build order.

### 1. One-click unsubscribe (step zero)

The validator refuses a bulk message without `unsubscribe.url`, so no
kind can ship before this exists.

- `POST /email/unsubscribe?t=<token>`: the RFC 8058 one-click path. Gmail
  and Yahoo POST it with no cookie, so the token is the credential:
  HMAC over `(account_id, kind, issued_at)`; long-lived (the header is
  read weeks later), revoked only by rotation.
- The footer link is a **GET to a page with a button** that POSTs. Link
  scanners pre-fetch GETs; a GET that changed state would unsubscribe
  people who never clicked. The page also offers "turn it back on" and
  "manage all" (the latter needs a session).
- `all` is a valid kind in the token: one click off everything.
- Complaints already reach the ops queue through the configuration set,
  and SES's account-level suppression list (on) stops future sends to a
  complainer regardless of our flag. No cross-system write-back needed.

### 2. Preferences

`account_email_pref (account_id, kind, enabled, changed_at, via)` with
`via ∈ {profile, one_click, ops}`; absent row means enabled (the default
is ON and a backfill is not needed). Every change writes an
`account_event`. Person principals only: agents and integrations have no
inbox. Profile → Email shows the switches (the "send me this one
now" button beside each was removed 2026-09-19; the ops op is the test
path). The Collector switch is shown to every account and can be flipped
only by one with a collector (`applies`). `PUT /api/me/email` takes kind
`"all"` for the page's Every email switch, the same `setPref` an "all"
unsubscribe token makes.

### 3. Ledger and idempotency

`email_issue (kind, period_key, subject_key, status, composed_at)` and
`email_send (issue_id, account_id, enqueued_at)`. `subject_key` is the
clan tag for `clan_report` (one issue per clan per week, N sends), null
otherwise (one issue per account).

A run enumerates recipients, composes, writes each message to the outbox,
and inserts the send row **after** a successful write — elixir-bot's
write-after-send rule (2026-08-03 double send), moved one hop earlier
because the outbox object is our durable point (2026-09-24; it was an SQS
message before). A re-run, a manual invoke, or a rule firing twice sends
only what the ledger lacks. S3 notifications and SQS can both redeliver;
the relay deletes each object once sent, so a redelivery finds nothing,
and the rare duplicate (a redelivery racing the delete) is accepted
rather than giving the relay a database.

### 4. Composition and rendering

A workspace package, `packages/mail`, takes a facts object and returns
`{subject, text, html}`: table layout, inline styles from the design
tokens, plain-text alternative always, **a Tinylytics pixel whose path
names the mail and `utm_` tags on links into the site** (Jamie,
2026-09-18, revising the pixel-free stance for Elixir's own mail: counts
per mail, never per reader; SES's own tracking stays off, no redirector). The jobs Lambda
renders; the message carries the rendered body; the relay's
`templates.mjs` keeps owning transactional mail. The message is an
object in the outbox, so SQS's 256 KB cap does not bound it: the queue
carries only S3's notification (2026-09-24).

Facts come from the readers the tools use, never re-derived
(`elixir_timeline`, `battles_performance`, `battles_opponents`,
`battles_decks`, `clans_timeline`, `clans_members_timeline`,
`clans_roster`, `war_history`, `elixir_collectors`, `elixir_coverage`).
Emails are a consumer surface and will find the same unserved columns the
2026-09-19 interface review did; that is a feature. Pin a rendered example
against a scratch-database run, as the pulse example is (2026-09-12).

Every report carries the coverage caveat: "41 battles recorded, ~80% of
your week." The numbers are honest only with the note.

Links deep-link into the console (`/app.html`) — the account page, the
subject's explore page. Enrolled accounts that have never signed in get
the ordinary `/login`; a bulk mail never carries a magic link.

### 5. Schedule and plumbing

EventBridge rules invoke jobs for the active kinds, with reserved concurrency
one. Composers write to the email outbox; the relay sends over SES. No editorial
queue, model or brief-build rule remains.

### 6. Public docs

`/docs/email`: the active kinds, what each contains, cadence, how to turn
one off. A line on `/docs/privacy`. The repo does not describe product
behaviour (AGENTS.md); this file is the design, not the description.

## Per kind

### `tracking_report` — Wed ("Your friends this week")

Named "Your friends this week" since 2026-10-01 (Jamie approved the
rename; the kind id stays `tracking_report`, so preferences, ledger rows
and unsubscribe tokens carry over untouched).

`elixir_timeline` for the week, ordered by relationship depth. Primary:
full (trophies / Path of Legends delta, arena, level, card unlocks and
upgrades, badges, clan changes, moments). Alts: the same, shorter.
Friends, then the busiest watched players, ten in all: a card each with
a record per mode family, two moments and the most-played deck (since
2026-10-02). Other watchers: one line each (trophies delta, clan, active
or quiet). Unique per account by construction; never empty for an
account with a claim.

The seam with Arena is sharp: **Tracking is state and progress; Arena is
battles.** Neither shows the other's numbers.

### `arena_week` — Tue

`battles_performance` + `battles_opponents` + `battles_decks` for the
primary and each alt, sectioned by mode family as the Dispatch does
(Trophy Road / Ranked / River Race / 2v2 / special events split). Who you
battled: opponents faced, repeat opponents, clanmates met. How the week
went: W/L, streaks, best battle, the deck used most. The headline is per
mode family too, never one win rate pooled across modes (`docs/DECISIONS.md`,
mode discipline). Skipped when zero battles across all the account's own
tags.

### `clan_report` — Mon

`clans_timeline` + `clans_members_timeline` + `clans_roster` +
`war_history` for the week. Two depths by watch scope: **activity** gives
roster, trophies, donations, joins and leaves, war; **comprehensive** adds
per-member battle performance (the "full roster with play performance"
needs comprehensive; true for POAP KINGS today). The war section appears
only when a war week completed. Composed once per clan, sent to every
person account tracking that clan: one Clan Report per tracked clan.

### `collector_activity` — Sun

Only accounts with a collector. Facts are in the collector ledger: fetches,
bytes, `api_bytes` saved by edge filtering, check-ins and quiet stretches,
breaker trips, credits earned and the collector slot bonus in force, share
of the fleet's week. Credits are points ÷ 10, where a point is a fetch that
added to the record (`new_facts > 0`), the same rule the quota applies;
raw fetches never earn credit. Never empty: a silent
collector is the report ("your collector went quiet Wednesday"). The
thank-you is concrete, in the operator's own numbers.

### `milestone` — as it happens

Congratulations for a FIRST on the recipient's primary or alts, from the
same named moments the timeline serves (`buildPlayerEntry` items):
`arena_changed` up, `ranked_promotion` up, `best_trophies_band`,
`career_wins_step`, `collection_level_step`, `card_unlocked`,
`badge_earned`, `legendary_badge_earned`. Each moment's own identity
(`arena:<id>`, `league:<id>`, `band:<n>`, `badge:<name>:<level>`…) mails
once per account and subject, ever (`email_milestone`), so a season's
re-climb is silent and a higher rung is news; a move down never keys.
Hourly, reading 26 hours back from the account's last clean look
(`email_milestone_look`, 0194; capped at seven days, so a failed run
leaves no gap), everything new bundled with the biggest moment
as the subject. Friends' and watchers' moments are Your friends this week's.

## Send ids and the record (2026-09-19)

Jamie, from the first milestone mail: "is there an email identifier we
could put into the footer so we can match a sent email in our logs; it
would be cool to see a list of emails sent to me like my MCP calls and
submit feedback from one." Built the same day, contract 4.2.0:

- `email_send.send_id` (0139) is the row's identity, minted in
  `deliver` BEFORE the render so the footer carries it ("This email is
  <id>"); the queue message carries `send_id` and the relay logs one
  `mail_sent <kind> <send_id> <issue_key> <ses message id>` line per
  product send, never the recipient. A force re-send is its own row.
- The rendered mail is archived to the bucket under
  `mail/sent/dt=<day>/send_id=<id>.json.gz` (`archive.mjs`, the calls/
  split: S3 the body, `archived` the pointer), written before the
  enqueue; a failed write logs and sends anyway.
- Web: `GET /api/me/email/sends` and `/api/me/email/sends/<id>` (own
  sends only; the body comes back with the pixel stripped, so the
  console never counts as an open). Console: Activity → Emails, the
  record at `/console/account/activity/e/<id>` in a sandboxed no-script frame,
  and "Report a problem with this email" which files feedback with
  `feedback.send_id` (a column, like `request_id`; the queue shows the
  kind and subject beside the report).
- The footer links the record by id and, with `?report=1`, straight
  into feedback with the email attached ("Something not right? Send
  feedback about this email", Jamie's second pass the same morning).
  Those links carry the mail's `utm_` tags like every other link into the
  site: a send id is a product identifier its holder can open, not a
  tracking identifier (`docs/DECISIONS.md`, which superseded the first
  footer pass's "no campaign tag"), and
  `apps/web/src/analytics.js` reports a record page without its id: the
  bridge normalizes `/console/account/activity/{c,e}/<id>` and
  `/console/admin/emails/<id>`
  to the page, and a document that LANDS on one skips the embed's raw
  hit and beacons the normalized page instead.
- Maintainer side: `GET /api/admin/email/sends` (every send, recipient
  by primary player, reports counted) and `/api/admin/email/sends/<id>`
  (the body); Admin → Emails sent, and the feedback queue's attached
  email shows the mail itself (`send-record.mjs`, shared with the
  person's routes the way `call-record.mjs` is).
- Badge names: the API's identifiers read as code in mail
  (`MasterySkeletonWarriors`), so `packages/record/src/badge-names.mjs`
  serves the badge as a player says it beside the identifier everywhere
  (timeline `badge_label`, tool `label`, the mails' text).
- Incident, same day: the 09-18 pixel commit passed `period` to
  `deliver` without destructuring it, so every product send from that
  deploy until this one threw `period is not defined` (milestone hourly,
  the Friday sends; `email_compose_failed` in the jobs log, no alarm
  because the run itself succeeded). The deliver test now renders a
  real send.

## The run asks the ledger first (2026-09-27, review §6.7, #67)

Four send bugs, one fix each:

- **Ledger before compose.** `runEmail` used to compose every recipient
  and only then ask `deliver` whether the mail had gone. On a jobs
  Lambda with a 900 s timeout, reserved concurrency 1 and default async
  retries, a run past 900 s would restart from the oldest account on
  every retry and die at the same place, so the newest accounts never
  got mail, and each retry rewrote `email_issue.facts` on issues already
  sent. Now one ledger query per run drops the recipients (and, for
  `clan_report`, the clans) already sent for the period, and an issue
  some trackers already have is sent as stored, never recomposed. The
  run logs `{sent, already_sent, remaining, ms}` on its `{email: ...}`
  line; with 90 s left (`STOP_MARGIN_MS`) it stops taking recipients,
  and the handler fails the invocation (`email_run_incomplete`) so the
  retry resumes from the ledger and the jobs errors alarm says a run has
  outgrown one invocation. `JobsInvokeConfig` states the retries: two,
  inside an hour. An outbox continuation and a per-run subject memo wait
  until a logged run passes about 450 s.
- **Milestones as they happen.** The period key was the UTC date, so a
  second moment later the same day read as already sent and waited for
  the first pass after midnight (and a ~2 h outage then lost it to the
  26 h lookback). The key is now the date plus a hash of the moments it
  congratulates (`milestonePeriodKey`): new moments are a new mail, a
  retry of the same moments is the same mail. The campaign period on
  links and the pixel stays the date. `email_milestone` is still the
  once-ever guard; a mail found sent whose moments were never recorded
  records them.
- **The clan report is the clan's.** It was composed as `members[0]`,
  with that account's own `account_clan.scope` and timezone. It now uses
  the clan's recording scope (the widest active tracker requested), carries days as instants (`membership[].at`, `{{day:<instant>}}`
  in a standout's text), and the renderer names each day in the
  recipient's `account.timezone` (`links.timezone`, set by `deliver`).
  Issues stored before this carry `when` labels and still render.

## One shell for every mail (2026-10-01, the redesign)

The redesign boards (EmailClan … EmailAccount, ConsoleEmails) put every
mail Elixir sends in one shell, `packages/mail/src/shell.mjs`, which the
relay's sign-in code, welcome and operator notices now wear too:

- **Masthead:** Jamie's logo as a PNG (`apps/site/src/assets/mail/
  elixir-48.png` and `-96.png`, drawn at 44 from the 96 file) and the
  wordmark "Elixir" (never "Elixir MCP"), with a pill naming the product
  and the day (`MAIL_SOURCE`: Clan · Monday, Ladder · Tuesday, Friends ·
  Wednesday, Cards · Thursday and Friday, Collectors · Sunday, Ladder ·
  Milestone, Clan · Actions, Account · Sign in and Welcome). The logo has
  `alt=""`: it stands beside the word it would say.
- **Images:** https PNGs on elixir.poapkings.com only, never a data URI and
  never Supercell's CDN. The logo ships with the site (an Eleventy
  passthrough); card art is the mirror. Every content image carries alt
  text, which is what the text part prints.
- **Footer:** why the mail came and when the next one does, in the
  reader's own zone (`MAIL_SCHEDULE`, pinned to the crons by test: "You
  get this on Mondays at 9:00 am Central, for each clan you track"); on a
  bulk kind the manage link and the turn-off; the send id with its record
  and feedback links; the sponsor line; the disclaimer. Transactional
  mail has no turn-off, ever, and the sign-in code still leads its subject
  and preheader.
- **Palette:** the relay's (`#0b0920` ground, `#120f2a` panel), which the
  boards drew every mail in; wins blue and losses rose; gold is the brand
  and the button, never a figure.
- **One preheader:** each renderer hands the shell the same preheader it
  returns. Before this, five kinds put a shorter or empty string in the
  hidden span than the one they returned.
- **Preview:** `node packages/mail/scripts/preview.mjs` renders every
  fixture and the relay's three kinds into `packages/mail/.preview/`
  (gitignored), pixel stripped and images pointed at this checkout, for
  a browser or Playwright to compare with the boards.

The kinds as the boards draw them (2026-10-02). Every figure is one a
tool returned; what a board drew that no tool returns is left out, not
estimated, and listed in `docs/NOTES.md` for the week.

- **Card art, one rule.** `packages/mail/src/cards.mjs`: `cardAsset(id,
  form, displayWidth)` (moved here from the Card of the Week builder,
  which imports it) picks the smallest mirrored file at least twice the
  drawn width, so 36 -> 128, 55 -> 128, 104 -> 285; `deckStrip` draws a
  deck as the game does, one row of eight in fixed-share table cells
  (a phone narrows it, never wraps it), the tower troop as text under
  it; `cardTiles` draws up to three cards with a name and a line. Every
  image has its width and height set (Outlook ignores `height:auto`).
- **Clan report:** the war tiles (place, fame with the finish instant,
  war trophies going in and out, `war_history`'s value being the one
  going into the week), the race, who raced (the top five and the
  reader's own players), comings and goings with their instants, gone
  quiet, the week. The roster is a link, not a table: a 50-member roster
  pushed a full clan's report past Gmail's ~102 KB clip, and a test
  renders a 50-member week under 95,000 bytes. The *you* chip comes from
  `links.mine` (the account's tags, passed by `deliver`), so the facts
  stay one issue for every reader.
- **Your week in the Arena:** a tile per mode family, the most-played
  deck as a strip (`featuredDeck`), opponents with repeats, a line per
  alt. Its button opens the primary's season on Ladder
  (`/ladder?player=<tag>`) and the deck links Ladder › Decks (since
  2026-10-02; Ladder reads only the reader's own players, so the
  friends report keeps the console's record pages).
- **Your friends this week:** a card per friend, then the busiest
  watched players, ten in all (`CARD_CAP`): `battles_performance` per
  mode family, two moments, the most-played deck from `battles_decks`.
  The rest are lines, as before.
- **Collectors:** each collector by its card (`elixir_collectors`'
  `card_id`), what it is doing now (`silentSince`, the tool's states;
  `draining` reads "stopped on purpose"), the week's fetches and points
  to date. An issue stored before 2026-10-02 has no card or state and
  renders from its enrolment status.
- **Milestone:** the arena or league large, with the battle that did it
  from the moment's own `promoted_by`; cards unlocked as tiles of their
  art linking `/cards/<id>`. `instant` rides beside the old `at` label
  so the subtitle names the day and date in the reader's zone. Since
  2026-10-02 the battle carries `url`, its `/battle/<short id>` page
  from `battleLinks` (`@elixir-mcp/record/battle-links`, the read
  `battles_query` uses), shown as "See the battle"; the button opens the
  player on Ladder. The empty "Next:" line (the builder always wrote
  `next: null`) is gone.
- **Clan actions waiting:** one box per line the app wrote, its "(new)"
  a chip, the app's "And N more." counted into the title.
- **Card of the Week:** the form's art at 130 beside the base card, from
  the 285 files.

### The console page (2026-10-02)

Profile → Email is drawn from the ConsoleEmails board as *Emails from
Elixir*: the six weekly kinds laid on a Monday-to-Sunday week by the day
each arrives in the account's zone, the two event kinds below it, the
last four sends beside them, and an Every email switch at the top. The
page computes no schedule of its own: `GET /api/me/email` returns, per
kind, `product` (the mail's own pill, `MAIL_SOURCE`), `sends`
(`{weekday, time, zone}` from `sendTime`, the footer's function; null
for the event kinds) and `last_send_id` (the account's most recent send
of that kind, which "The last one" opens; there is no preview route for
a kind). Every email is on only when all eight are, and writes `"all"`.
Recipients, schedules, defaults and the unsubscribe path are unchanged.

## Open

- Multi-clan Clan Report for a family account (no such account yet).
- Local-morning delivery (see Cadence).

## Collector security and upgrade notices (2026-10-03)

The weekly composer reads `RELEASE_SIGNED_SQL` and `signatureState` from the
collector-door package, preserving full reported versions and the dashboard's
self-report caveat. Old stored issues without security fields still render.

Upgrade notices use `collector_activity` and its existing preference and
unsubscribe token. The door's one statement locks the gateway, updates a
separate door-only baseline and journals a changed version atomically. The first
reported version establishes the baseline without an event. The minute job
`{collector_upgrades:true}` drains at most 100 pending events; only strict higher
released versions send. Downgrades and unknown/dev transitions are terminal
skips. A re-upgrade following rollback is a new event. Approval, person kind,
current ownership, revocation and preference checks happen before composing.
No available-release announcement is mistaken for installation.

`collector_release_note` stores GitHub notes/URL from the verifying naming
script, plus an optional `--reason=` supplied by the maintainer. It describes
release purpose, never a host's installation mechanism. Promotion preserves the
original release body. Missing details are explicit in the rendered notice.

Every event retains one send UUID. Enqueue conditionally creates that UUID's
outbox object, so an accepted enqueue followed by a failed send-ledger write
can retry safely. The relay separately claims
`mail-delivery/collector-upgrade/<send_id>.json` before SES. A completed receipt
suppresses duplicate notifications, even when deleting the outbox fails.
Definitive SES 4xx rejections release the claim for queue retries; ambiguous
transport failures and crashes leave a pending claim and fail closed. Only guarded upgrade sends make one SES SDK attempt, preventing a hidden SDK
retry after uncertain acceptance. Other email kinds retain their existing SDK
retry behavior.
An uncertain claim reaches queue failure/DLQ handling; inspect `mail_sent` by send
UUID and SES events before deciding its disposition. Never blindly delete a
pending claim and resend. Receipt objects contain only state and SES message ID,
never recipient or message bodies.

The IAM-only jobs replay payload is
`{collector_upgrades:{account_email,replay:[{gateway_id|gateway_name,from_version,to_version,observed_at,evidence,release?}],apply:false}}`.
It accepts 1–10 proven historical transitions of that approved owner account's
non-revoked collectors. Dry-run validates ownership and returns collector IDs;
`apply:true` creates labelled historical-test events without changing live
collector versions. Replays deduplicate by collector/from/to even when repeated
with a different observation timestamp. Optional changes require an exact
collector GitHub release or compare source URL and stay on the test event,
never in normal release metadata. Historical security that was not captured is
labelled not recorded. Both subject and body say historical test, and the body
explicitly says no new upgrade occurred. No force bypass exists.
