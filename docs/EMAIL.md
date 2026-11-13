# Recorder email engineering

The kinds and delivery behavior are documented publicly at `/docs/email`;
this file is the design, not the description (AGENTS.md). Composition is
structured from recorded facts, without model generation.

Four product kinds are active (`ACTIVE_PRODUCT_EMAIL_KINDS` in
`packages/contracts/src/queue.ts`): two scheduled (`tracking_report`,
the one digest, weekly or daily by the reader's choice, and
`collector_activity` weekly, only for collector operators) and two that
come when something happens (`clan_actions_waiting`, `feedback_answer`).
The collector upgrade notice is part of `collector_activity`. The digest
is the one scheduled mail to members; `collector_activity` (to the
people running a collector) and `clan_actions_waiting` (to leaders with
an Action waiting, at most once a day per clan) are operational mail to
a role and stand outside it (DECISIONS "The digest is the one scheduled
mail; leaders' Actions mail stays apart"). Sign-in codes, the welcome
and staff notices are transactional, from the relay.

Retired (`RETIRED_EMAIL_KINDS`): `top_100`, `card_of_week`, and since
2026-11-12 `clan_report`, `arena_week` and `milestone`, folded into the
digest (Jamie: "One digest email and merging clan and those you follow
is really needed"; `docs/notes/2026-11-12-one-email.md`). They stay in
`PRODUCT_EMAIL_KINDS` so sent records and old unsubscribe links still
resolve; generation, `deliver`, the relay and `PUT /api/me/email`
(enabling one answers 410) refuse them before I/O, and Settings no
longer lists them.

## The shared foundation

### Newsletter enrollment

Website and OAuth sign-in mail for an opted-in account, and a verified
signup's welcome, carry `ip_address` through the outbox to Buttondown's
`POST /v1/subscribers`. The address comes from `viewerIp(event)`, after
the door's origin check: CloudFront's viewer header without its port,
never the socket peer, forwarded-for header or request body. The relay
includes only a valid IPv4 or IPv6 address. It is enrollment metadata,
never rendered in mail or logged.

Imports (`newsletter_sync`), operator welcomes and older queued messages
have no live viewer address; they omit the field. Enrollment remains
best-effort and an existing address, including an unsubscribe, is left
alone. See [Buttondown's subscriber API](https://docs.buttondown.com/api-subscribers-create).

### Turnstile on sign-in mail

The two doors that mail an address someone typed (`POST /api/auth` and
the OAuth door's email step) take a Cloudflare Turnstile token, against
subscription bombing (Jamie, 2026-10-14). The other mail is safe without
it: welcome goes only after a proved code, and every report goes to an
account's own verified address. The doors cannot reach Cloudflare from the
NAT-free VPC, so a login message carries `turnstile: { surface, token }`
(`packages/contracts/src/queue.ts`) and the relay, the one function with
internet, calls siteverify before it sends.

- **Modes** (`packages/auth/src/turnstile.mjs`, `TURNSTILE_MODE` from
  the `TurnstileMode` parameter on all three functions): `observe`
  records and refuses nothing; `enforce` refuses a missing token at the
  door (403 `turnstile_failed`, before the mail ceilings count it) and
  drops a `fail` at the relay (acknowledged as sent, so never retried);
  `off`. `error` and `unconfigured` always send.
- **One token, one address, five minutes, three sends.** Tokens are
  single-use at Cloudflare and "Send another email" resends with the
  token the page holds, so the first verdict is kept at
  `mail-delivery/turnstile/<sha256 of token>.json` in the outbox bucket
  with the address's hash and its sends (conditional writes; a lost
  race takes the first verdict). A queue retry of one outbox object is
  the same send. A store failure is logged and never blocks.
- **Pages.** The website's form loads Cloudflare's script on the email
  field's first focus or input (`apps/web/src/turnstile.js`); the OAuth
  page does the same from one inline script allowed by its hash in that
  page's own CSP. Both render explicitly, `interaction-only`, wait five
  seconds for a token (two minutes while a challenge shows) and send
  without one when Cloudflare cannot be had. The edge CSP allows
  `challenges.cloudflare.com` in `script-src` and `frame-src`.
- **The record** is `turnstile_checked` in the relay's log, one line per
  sign-in mail; reading it is in docs/OPERATIONS.md, "Sign-in
  Turnstile". The secret is `turnstile_secret_key` (docs/SECRETS.md).
- **Tests** never load Cloudflare: vitest's `test/setup-turnstile.js`
  and Playwright's `stubTurnstile` (in `mockApi`) answer for it.

### One-click unsubscribe

The validator refuses a bulk message without `unsubscribe.url`.

- `POST /api/email/unsubscribe?t=<token>`: the RFC 8058 one-click path.
  Gmail and Yahoo POST it with no cookie, so the token is the credential:
  HMAC over `(account_id, kind, issued_at)` (`packages/mail/src/unsubscribe.mjs`);
  long-lived (the header is read weeks later), revoked only by rotation.
  A `u1.` token is signed with the unsubscribe key of its own
  (`UNSUBSCRIBE_SECRET`); a token with no key id is the older kind,
  checked against the session secrets.
- The footer link is a **GET to `/api/email/unsubscribe?t=` that shows a
  page with a button** that POSTs. Link scanners pre-fetch GETs; a GET
  that changed state would unsubscribe people who never clicked.
- The page is the site's `email-page.html` with the step written into its
  `data-email-page` section (`services/web-api/src/routes/email.mjs`); a
  plain inline page when the bucket cannot be read. The POST answers a
  bare `ok` only to the RFC 8058 body (`List-Unsubscribe=One-Click`); the
  button sends no body and gets the page. Never key this on `Accept`: the
  edge does not forward it to `/api/*`.
- `all` is a valid kind in the token: one click off everything.
- Complaints and bounces reach the ops queue through the configuration
  set, and SES's account-level suppression list takes a complainer or a
  hard bounce regardless of our flag. The relay reads that list
  (`ses:ListSuppressedDestinations`, once per environment every five
  minutes) and skips a listed address with `mail_suppressed <kind>
  <send_id> <issue_key> <reason>` in its log, never the address. A
  failed read keeps the last list; with none, the mail sends as before.
  No cross-system write-back: the account's switches are untouched, and
  the address is mailed again once it leaves the list.

### Preferences

`account_email_pref (account_id, kind, enabled, changed_at, via, cadence)` with
`via ∈ {profile, one_click, ops}`; absent row means enabled. `cadence`
(0242) is the digest's how-often, `weekly` or `daily`, null meaning
weekly and on no other kind; off is still `enabled = false`, so choosing
a cadence never turns the digest on, and turning it off keeps the
cadence. `PUT /api/me/email` takes `{kind: "tracking_report", cadence}`
with or without `enabled`. Every change
writes an `account_event`. Person principals only: agents and
integrations have no inbox. The ops op is the test path; there is no
"send me this now" button. `collector_activity` can be flipped only by an
account with a collector, and `clan_actions_waiting` only by one with a
verified player in a clan (`applies`). `PUT /api/me/email` takes kind
`"all"` for the page's Every email switch, the same `setPref` an "all"
unsubscribe token makes.

### Ledger and idempotency

`email_issue (kind, period_key, subject_key, status, composed_at)` and
`email_send (issue_id, account_id, enqueued_at)`. `subject_key` is the
account id (one issue per account); the retired `clan_report` keyed by
clan tag (one issue per clan per week, N sends), and its rows remain.

A run asks the ledger first: one query drops the recipients already
sent for the period, and an issue some
recipients already have is sent as stored, never recomposed. It then
composes, writes each message to the outbox, and inserts the send row
**after** a successful write (the outbox object is the durable point). A
re-run, a manual invoke, or a rule firing twice sends only what the
ledger lacks. S3 notifications and SQS can both redeliver; the relay
deletes each object once sent, and the rare duplicate (a redelivery
racing the delete) is accepted rather than giving the relay a database.

The run logs `{sent, already_sent, remaining, ms}` on its `{email: ...}`
line. With 90 s left (`STOP_MARGIN_MS`) it stops taking recipients and
the handler fails the invocation (`email_run_incomplete`), so the retry
resumes from the ledger, and the jobs Lambda's `Errors` metric says a run
has outgrown one invocation. `JobsInvokeConfig` allows two retries inside an hour.

### Composition and rendering

`packages/mail` takes a facts object and returns `{subject, text, html}`:
table layout, inline styles from the design tokens, a plain-text
alternative always, **a Tinylytics pixel whose path names the mail and
`utm_` tags on links into the site** (counts per mail, never per reader;
SES's own tracking stays off, no redirector). The jobs Lambda renders;
the message carries the rendered body; the relay's `templates.mjs` owns
transactional mail. The message is an object in the outbox, so SQS's
256 KB cap does not bound it: the queue carries only S3's notification.

Facts come from the readers the tools use, never re-derived
(`elixir_timeline`, `battles_performance`, `battles_opponents`,
`battles_decks`, `clans_series`, `clans_members_series`,
`clans_roster`, `war_history`, `elixir_collectors`, `elixir_coverage`).
Every report carries the coverage caveat; the numbers are honest only
with the note.

Links go to the paths that serve the page: a player's page at
`/home/player/<tag>` for every reader, a clan at `/clan/<tag>/feed` (Clan
for a reader in the clan; Clan sends anyone else to the clan
directory), Settings
under `/settings`, battles at
`/battle/<short id>`, cards at `/cards/<id>`. The manage link is
`/settings/emails`. A bulk mail never carries a magic link.

### Schedule and plumbing

EventBridge rules invoke the jobs Lambda (reserved concurrency one):
`collector_activity` on Sundays at 14:00 UTC and the digest every day at
11:00 UTC (`MAIL_SCHEDULE` in `packages/mail/src/shell.mjs`, pinned to
the crons by test), and the collector upgrade and feedback-answer drain
every minute. The clan report, Arena week and milestone rules were
removed on 2026-11-12. `clan_actions_waiting`
is sent from Clan's morning run. Composers write to the email outbox; the
relay sends over SES. No editorial queue, model or brief-build rule exists.

## Per kind

### Retired 2026-11-12: `clan_report`, `arena_week`, `milestone`

The Monday clan report, Tuesday "Your week in the Arena" and the hourly
milestone note have no rule and no send path in `services/jobs/src/email/index.mjs`.
What they told that the digest keeps: a clan's finished race, joins,
departures and role changes (its clan part), the big firsts of the
reader and their alts, and card and badge counts (the reader's part).
What it does not: the war decks-used trend, per-member performance, the
Arena form line, opponents and decks; those are on Clan and Stats.
`build-clan.mjs`, `build-arena.mjs`, `build-milestone.mjs` and the
`clan_report_preview` op remain for their tests and the read-only
preview; removing them, the `email_milestone*` tables and the kind names
is later cleanup.

### `tracking_report`: the digest, Monday or daily ("Your digest")

The digest of the people you follow replaced the friends mail on
2026-11-12 (social slice 9, #767; Jamie's ruling is quoted in
`docs/DECISIONS.md`, "The digest is the one scheduled mail; leaders'
Actions mail stays apart"). It keeps the kind key, so
the switch, every opt-out and every old unsubscribe link carry over; the
HMAC covers the kind.

**When.** One rule, every day at 11:00 UTC (`MAIL_SCHEDULE`,
`daily: true`), an hour after the game's 10:00 UTC reset (Jamie,
2026-11-13: "right after the weekly reset"; a river race closes about
09:40 UTC, before it). A scheduled run takes readers whose cadence is
weekly only on a UTC Monday (`DIGEST_WEEKLY_DAY`), and daily readers every
day; an ops run for one account, or a forced one, ignores the day. The
period key is the UTC date, so the ledger allows one digest a day per
account (`~m<ms>` on a manual send, as elsewhere).

**The window** (`digestWindow` in `services/jobs/src/email/build-digest.mjs`)
is the week or the day before the run, starting no earlier than the last
scheduled digest (`email_send.enqueued_at`, manual sends excluded), so a
switch from daily to weekly never tells an item twice.

**What it reads.** `buildTimeline` in-process over the reader's subjects
(`subjectsFor`: claims and clans with notify on), basis `observed` (what
the record learned since the last digest, so a battle captured late is
told once, never skipped), filtered before the cap to `DIGEST_KINDS`:
`battle_highlight`, the big firsts (`MILESTONE_MAIL_KINDS`), clan moves
and returns. Card unlocks and badges stay a count (`progress`), as the
friends mail counted them. Attested facts never enter
(`services/jobs/test/digest-mail.test.mjs`).

**What it says.**
- **From people you follow:** friends first, then whoever has the most
  to tell, then the busiest, at most twelve (`PEOPLE_CAP`), the rest
  counted. Each has their sittings, battles and record, their trophies,
  and up to three items (`ITEMS_PER_PERSON`), highlights first: a
  highlight is the timeline's sentence with the words carried apart and
  drawn as a quote; each item links the battle's public page when the
  record knows the battle. A highlight's share link is never carried.
- **Each player once (2026-11-12).** Following a whole clan is common,
  so people are told only under themselves: a followed clanmate carries
  `clanmate: {tag, name}` ("In <clan>"), and a `clan_joined`/`clan_left`
  item whose clan has a clan part is told there, not again under the
  person.
- **Your clan:** each tracked clan with news of its own (`clanNews`): a
  resolved race (place and fame, Colosseum named), joins, departures and
  role changes, as a headline and three bullets with the rest counted.
  A clan's battle count and gone-quiet are members' play and are not
  repeated here. An account made after 0205 tracks its primary player's
  clan automatically (`followPrimaryClan`), so a new member gets it.
- **You:** your items and progress, and each alt that played or has a
  first, with its items and progress.
- **Never empty:** null (no mail) when no one followed played or posted,
  the reader has nothing, and no clan part would send. A clan part alone
  sends a weekly digest; a daily one only when a race finished.
- **The fold (`foldedOff`).** A reader who had turned `clan_report` off
  never gets a digest for clan news alone; one who had turned
  `arena_week` off gets alts as a name and battle count, as before. No
  one gets more mail than before the merge; digest off stays off.
- Names link to the player page (`playerDoor`, `/home/player/<tag>`),
  for every reader.
- Everything a person typed (names, nicknames, words) is escaped at the
  render (`packages/mail/test/hostile-names.test.mjs`).

The subject names no one: "Your week in Elixir: 3 people you follow, 41
battles"; with only clan news it names the first clan. The preheader leads with the first highlight's words.

`packages/tools/src/friends-week.mjs` still builds Home's Friends; the
mail no longer reads it.

### `collector_activity`: Sunday, plus upgrade notices

Only accounts with a collector. The week is `lastCollectorWeek`
(`services/jobs/src/email/week.mjs`): Saturday 00:00Z to Saturday 00:00Z,
sent Sunday 14:00Z (`MAIL_SCHEDULE`); key `<ISO week of the Saturday>c`;
label Saturday to Friday (`docs/notes/2026-10-12-w3-collector-week.md`).
`buildCollector` reads the collector ledger for it: fetches, bytes,
check-ins and quiet stretches, the fetches that added to the record
(`adding_fetches`, `new_facts > 0`) and the tier (#539; points and
credits are retired). Never empty: a silent collector is the report. It reads `RELEASE_SIGNED_SQL` and `signatureState` from the
collector-door package for each collector's release and signature state.

**Upgrade notices** (`services/jobs/src/email/collector-upgrades.mjs`,
migration 0200) ride `collector_activity`'s preference and unsubscribe
token. The door's one statement locks the gateway, updates a door-only
version baseline and journals a changed version atomically; the first
reported version sets the baseline without an event. The minute job
`{collector_upgrades:true}` drains at most 100 pending events. Only a
strictly higher released version (`vX.Y.Z`, `isUpgrade`) sends;
downgrades and unknown or dev transitions are terminal skips, and a
re-upgrade after a rollback is a new event. Approval, person kind,
current ownership, revocation and preference are checked before
composing. An available release is never announced as installed.

**Answers to feedback** (`feedback_answer`; what the filer gets is
`/docs/email`): `runFeedbackAnswers` in
`services/jobs/src/email/feedback-answers.mjs`, on the minute rule
(`{collector_upgrades:true, feedback_answers:true}`) after the upgrade
drain. Facts: the `account_feedback_responded` item (`answerItem`,
`mailFacts`) through `accountWindowItems` and `digest`
(`services/jobs/src/email/digest.mjs`; #536 stage 2,
`docs/notes/2026-10-13-w3-feedback-item.md`). Journal:
`feedback.response_mailed_at` (0204), `markHandled`. Settle:
`SETTLE_MINUTES`. Gates: `response_seen_at`, the response's words, the
`account_email_pref` row, the account's kind, status and owner flag.
Issue key `feedback-answer/<id>/<responded_at>`. Fixture:
`feedbackFixture` (`services/jobs/test/digest-fixture.mjs`).

`collector_release_note` stores the GitHub notes and URL from the
verifying naming script, plus an optional maintainer `--reason=`. It
describes the release's purpose, never a host's installation mechanism.

Each event keeps one send UUID. Enqueue conditionally creates that UUID's
outbox object, so an accepted enqueue followed by a failed send-ledger
write retries safely. The relay claims
`mail-delivery/collector-upgrade/<send_id>.json` before SES; a completed
receipt suppresses duplicates even when deleting the outbox fails.
Definitive SES 4xx rejections release the claim for queue retries;
ambiguous transport failures and crashes leave a pending claim and fail
closed. Only these sends make one SES SDK attempt (no hidden SDK retry
after uncertain acceptance). An uncertain claim reaches queue failure/DLQ
handling: inspect `mail_sent` by send UUID and SES events before deciding;
never blindly delete a pending claim and resend. Receipts hold only state
and the SES message ID.

The IAM-only jobs replay payload is
`{collector_upgrades:{account_email,replay:[{gateway_id|gateway_name,from_version,to_version,observed_at,evidence,release?}],apply:false}}`.
It accepts 1–10 proven historical transitions of that owner's
non-revoked collectors. Dry-run validates ownership; `apply:true` creates
labelled historical-test events without changing live collector versions,
deduplicated by collector/from/to. Optional `release` needs an exact
collector GitHub release or compare URL and stays on the test event.
Subject and body say historical test. No force bypass exists.

### `clan_actions_waiting`: on demand, after Clan's morning run

Never on a fixed day: Clan's engine (`packages/clan-engine/src/mail.mjs`)
composes "actions waiting for you" for each person who can act on an
open action, only when something became theirs since their last email
(nothing waiting, nothing sent), listing everything
waiting newest first with the new ones marked (at most 10 lines, the rest
counted). `sendClanMail` (`packages/mail/src/clan-mail.mjs`) finds the
account whose verified claim is that player, checks the player is in the
clan today and the switch is on, and sends at most one per clan per
account per UTC day under a lock. The jobs Lambda calls it in process;
`POST /api/v1/clans/{tag}/mail` (`mail:send`) is the same door for an
integration. The lines are plain text the renderer escapes; the link must
lead to a family app.

## Send ids and the record

- `email_send.send_id` is the row's identity, minted in `deliver` before
  the render so the footer carries it ("Mail <first 6>", the whole id in the link); the relay
  logs one `mail_sent <kind> <send_id> <issue_key> <ses message id>` line
  per product send, never the recipient.
- The rendered mail is archived under
  `mail/sent/dt=<day>/send_id=<id>.json.gz` (`archive.mjs`) before the
  enqueue; a failed write logs and sends anyway.
- Web: `GET /api/me/email/sends` and `/api/me/email/sends/<id>` (own sends
  only; the pixel stripped, so reading a record never counts as an open). The
  record is at `/settings/emails/<id>` in a sandboxed no-script
  frame, with "Report a problem with this email" filing feedback with
  an `email` ref (`feedback_ref`, 0204; `feedback.send_id` is still
  written for one release).
- The footer links the record by id and, with `?report=1`, straight into
  feedback. Those links carry the mail's `utm_` tags: a send id is a
  product identifier, not a tracking identifier (`docs/DECISIONS.md`).
  `apps/web/src/analytics.js` reports a record page without its id.
- Maintainer side: `GET /api/admin/email/sends` and `/<id>`; Settings ▸
  Admin ▸ Emails (`send-record.mjs`, shared with the person's routes).
  Opens stay in Tinylytics.
- Badge names: `packages/record/src/badge-names.mjs` serves the badge as a
  player says it beside the identifier (timeline `badge_label`, tool
  `label`, the mails' text).

## One shell for every mail

`packages/mail/src/shell.mjs` wraps every mail Elixir sends, the relay's
sign-in code, welcome and operator notices included:

- **Masthead:** the logo PNG (`apps/site/src/assets/mail/elixir-48.png`
  and `-96.png`) and the wordmark "Elixir", with a plain label naming the
  product (`MAIL_SOURCE`: Home · Digest, Collectors · Sunday,
  Clan · Actions, Account · Feedback, and the retired kinds' labels for
  their old records, Account · Sign in and Welcome, Console · Notice). The
  logo has `alt=""`.
- **Images:** https PNGs on elixir.poapkings.com only, never a data URI
  and never Supercell's CDN. Every content image carries alt text, which
  is what the text part prints. `packages/mail/src/cards.mjs`'s
  `cardAsset(id, form)` names the mirror's one file for the card and
  form, a byte-identical copy of Supercell's icon (never resized or
  altered; the image's width and height size it), and an Evo or Hero the
  mirror lacks draws the base card, decided at compose time
  (`resolveCardArt`, from the jobs Lambda's look at the site bucket);
  `deckStrip` draws a deck as one row of
  eight in fixed-share cells, the tower troop as text under it. Every
  image has its width and height set.
- **Footer:** why the mail came and when the next one does, in the
  reader's own zone (`MAIL_SCHEDULE`); on a bulk kind the manage link
  and the turn-off; the send id with its record and feedback links; the
  disclaimer. Transactional mail has no turn-off.
- **Palette:** `#0b0920` ground, `#120f2a` panel; wins blue and losses
  rose; gold is the brand and the button, never a figure.
- **One preheader:** each renderer hands the shell the preheader it
  returns.
- **Size:** the retired clan report's stored form links the roster
  rather than tabling it; a test renders a 50-member week under 95,000 bytes (Gmail clips at
  ~102 KB).
- **Layout:** one content panel, normal-case section headings, at most
  two open headline figures across, and fluid rows. The war bracket
  uses rank, clan and fame; finish status sits below fame. Coverage is
  an unboxed note with a left rule. The footer separates its reason,
  preferences, record links and wrap-safe send id. HTML has one primary
  button without a duplicate printed URL; the text alternative carries
  its destination.
- **Preview:** `node packages/mail/scripts/preview.mjs` renders every
  specimen in `scripts/preview-cases.mjs` into `packages/mail/.preview/`
  (gitignored), pixel stripped. `--out <dir>` chooses another output
  directory. Product text is derived from the HTML; service text is the
  relay's actual returned text, never a substitute derived for preview.
  Specimens include all active kinds, collector upgrades and historical
  tests, the retired kinds' stored forms, sparse/partial reports, questions and
  every operator-notice category. `apps/web/e2e/mail-layout.spec.ts`
  checks them at phone, tablet, desktop and landscape widths with images
  blocked, without sending or loading a tracking pixel.

Every figure a mail shows is one a tool returned; what a board drew that
no tool returns is left out, not estimated.

## The Settings page

Settings › Emails (`apps/web/src/views/account/EmailPage.jsx`):
the two scheduled kinds (the digest with its cadence, and collector
activity) as rows showing the day each arrives in the account's zone,
the two event kinds below them, the last
four sends beside them, and an Every email switch at the top. The page
computes no schedule of its own: `GET /api/me/email` returns, per active
kind, `product` (`MAIL_SOURCE`), `sends` (`{weekday, time, zone}` from
`mailSendTime`, the footer's function; null for the event kinds),
`last_send_id` and `applies`. Every email is on only when all four are,
and writes `"all"`.

## Not built

- Local-morning delivery: the digest sends at 11:00 UTC and collector
  activity at 14:00 UTC.
