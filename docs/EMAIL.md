# Recorder email engineering

The kinds and delivery behavior are documented publicly at `/docs/email`;
this file is the design, not the description (AGENTS.md). Composition is
structured from recorded facts, without model generation.

Seven product kinds are active (`ACTIVE_PRODUCT_EMAIL_KINDS` in
`packages/contracts/src/queue.ts`): four weekly (`clan_report`,
`arena_week`, `tracking_report`, `collector_activity`) and three that come
when something happens (`milestone`, `clan_actions_waiting`,
`feedback_answer`). The
collector upgrade notice is part of `collector_activity`. `top_100` and
`card_of_week` are retired: they stay in `PRODUCT_EMAIL_KINDS` so sent
records and old unsubscribe links still resolve, and their generation
and send requests refuse before I/O.

## The shared foundation

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
- `all` is a valid kind in the token: one click off everything.
- Complaints reach the ops queue through the configuration set, and SES's
  account-level suppression list stops future sends to a complainer
  regardless of our flag. No cross-system write-back.

### Preferences

`account_email_pref (account_id, kind, enabled, changed_at, via)` with
`via ∈ {profile, one_click, ops}`; absent row means enabled. Every change
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
clan tag for `clan_report` (one issue per clan per week, N sends), null
otherwise (one issue per account).

A run asks the ledger first: one query drops the recipients (and, for
`clan_report`, the clans) already sent for the period, and an issue some
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
resumes from the ledger and the jobs errors alarm says a run has outgrown
one invocation. `JobsInvokeConfig` allows two retries inside an hour.

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
`battles_decks`, `clans_timeline`, `clans_members_timeline`,
`clans_roster`, `war_history`, `elixir_collectors`, `elixir_coverage`).
Every report carries the coverage caveat; the numbers are honest only
with the note.

Links go to the paths that serve the page: the console under `/console`
(`/console/explore/player/<tag>`, `/console/explore/clan/<tag>`,
`/console/account/...`), Ladder at `/ladder?player=<tag>`, battles at
`/battle/<short id>`, cards at `/cards/<id>`. The manage link is
`/console/account/profile/email`. A bulk mail never carries a magic link.

### Schedule and plumbing

EventBridge rules invoke the jobs Lambda (reserved concurrency one): the
four weekly kinds at 14:00 UTC (`MAIL_SCHEDULE` in
`packages/mail/src/shell.mjs`, pinned to the crons by test), `milestone`
hourly, and the collector upgrade drain every minute. `clan_actions_waiting`
is sent from Clan's morning run. Composers write to the email outbox; the
relay sends over SES. No editorial queue, model or brief-build rule exists.

## Per kind

### `clan_report`: Monday

`clans_timeline` + `clans_members_timeline` + `clans_roster` +
`war_history` for the week, at the clan's recording scope (the widest
active tracker requested). **Activity** gives roster, trophies,
donations, joins and leaves, war; **comprehensive** adds per-member
battle performance. The war section appears only when a war week
completed. Composed once per clan, sent to every person account tracking
that clan. Since 2026-10-08 an account made after 0205 tracks its primary
player's clan automatically at activity scope when a slot is free
(`followPrimaryClan` in packages/claims), which is what makes the welcome
mail's "Monday: your clan's week" true for a new member. Days are carried as instants (`membership[].at`,
`{{day:<instant>}}` in a standout's text) and named in the recipient's
`account.timezone` (`links.timezone`, set by `deliver`).

### `arena_week`: Tuesday ("Your week in the Arena")

`battles_performance` + `battles_opponents` + `battles_decks` for the
primary and each alt, sectioned by mode family. Who you battled, how the
week went, the deck used most. The headline is per mode family, never one
win rate pooled across modes (`docs/DECISIONS.md`, mode discipline).
Skipped when zero battles across all the account's own tags.

### `tracking_report`: Wednesday ("Your friends this week")

`elixir_timeline` for the week, ordered by relationship depth. Friends,
then the busiest watched players, ten in all (`CARD_CAP`): a card each
with a record per mode family, two moments and the most-played deck.
Other watchers: one line each. Never empty for an account with a claim.

**Tracking is state and progress; Arena is battles.** Neither shows the
other's numbers.

### `collector_activity`: Sunday, plus upgrade notices

Only accounts with a collector. The weekly report reads the collector
ledger: fetches, bytes, check-ins and quiet stretches, breaker trips,
points and credits. Credits are points ÷ 10, where a point is a fetch
that added to the record (`new_facts > 0`), the rule the quota applies;
raw fetches never earn credit. Never empty: a silent collector is the
report. It reads `RELEASE_SIGNED_SQL` and `signatureState` from the
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

**Answers to feedback** (`feedback_answer`,
`services/jobs/src/email/feedback-answers.mjs`, migration 0204) ride the
same minute rule (`{collector_upgrades:true, feedback_answers:true}`),
after the upgrade drain. The journal is the item: `response_mailed_at`
is the `responded_at` whose answer was handled, sent or skipped, so a
revised answer is owed a mail again and a status-only change never is.
An answer settles ten minutes first; it sends only when it has words,
is still unread (`response_seen_at` null: reading it where it was filed
is the delivery), the `feedback_answer` preference is on, and the filer
is an approved person with an address who is not the owner. Each answer
is its own issue (`feedback-answer/<id>/<responded_at>`), so a retry
after an unmarked enqueue finds it sent and only marks it. The update
compares `responded_at` as text: a JS Date drops the microseconds.

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

### `milestone`: hourly

Congratulations for a FIRST on the recipient's primary or alts, from the
named moments the timeline serves (`services/jobs/src/email/build-milestone.mjs`):
`arena_changed` up, `ranked_promotion` up, `best_trophies_band`,
`career_wins_step`, `collection_level_step`, `card_unlocked`,
`card_form_unlocked` (an Evolution and a Hero of one card are two
firsts), `badge_earned`, `legendary_badge_earned`. Each moment's own
identity (`arena:<id>`, `league:<id>`, `form:<card>:<form>`,
`badge:<name>:<level>`…) mails once per account and subject, ever
(`email_milestone`), so a season's re-climb is silent; a move down never
keys. Hourly, reading 26 hours back from the account's last clean look
(`email_milestone_look`, capped at seven days). The period key is the
date plus a hash of the moments (`milestonePeriodKey`): new moments are a
new mail, a retry of the same moments is the same mail. Friends' and
watchers' moments are the friends report's.

### `clan_actions_waiting`: after Clan's morning run

Clan's engine (`packages/clan-engine/src/mail.mjs`) composes "actions
waiting for you" for each person who can act on an open action, only when
something became theirs since their last email, listing everything
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
  the render so the footer carries it ("This email is <id>"); the relay
  logs one `mail_sent <kind> <send_id> <issue_key> <ses message id>` line
  per product send, never the recipient.
- The rendered mail is archived under
  `mail/sent/dt=<day>/send_id=<id>.json.gz` (`archive.mjs`) before the
  enqueue; a failed write logs and sends anyway.
- Web: `GET /api/me/email/sends` and `/api/me/email/sends/<id>` (own sends
  only; the pixel stripped, so the console never counts as an open). The
  record is at `/console/account/activity/e/<id>` in a sandboxed no-script
  frame, with "Report a problem with this email" filing feedback with
  an `email` ref (`feedback_ref`, 0204; `feedback.send_id` is still
  written for one release).
- The footer links the record by id and, with `?report=1`, straight into
  feedback. Those links carry the mail's `utm_` tags: a send id is a
  product identifier, not a tracking identifier (`docs/DECISIONS.md`).
  `apps/web/src/analytics.js` reports a record page without its id.
- Maintainer side: `GET /api/admin/email/sends` and `/<id>`; Admin →
  Emails sent (`send-record.mjs`, shared with the person's routes).
- Badge names: `packages/record/src/badge-names.mjs` serves the badge as a
  player says it beside the identifier (timeline `badge_label`, tool
  `label`, the mails' text).

## One shell for every mail

`packages/mail/src/shell.mjs` wraps every mail Elixir sends, the relay's
sign-in code, welcome and operator notices included:

- **Masthead:** the logo PNG (`apps/site/src/assets/mail/elixir-48.png`
  and `-96.png`) and the wordmark "Elixir", with a pill naming the
  product and the day (`MAIL_SOURCE`: Clan · Monday, Ladder · Tuesday,
  Friends · Wednesday, Collectors · Sunday, Ladder · Milestone,
  Clan · Actions, Account · Sign in and Welcome, Console · Notice). The
  logo has `alt=""`.
- **Images:** https PNGs on elixir.poapkings.com only, never a data URI
  and never Supercell's CDN. Every content image carries alt text, which
  is what the text part prints. `packages/mail/src/cards.mjs`'s
  `cardAsset(id, form, displayWidth)` picks the smallest mirrored file at
  least twice the drawn width; `deckStrip` draws a deck as one row of
  eight in fixed-share cells, the tower troop as text under it. Every
  image has its width and height set.
- **Footer:** why the mail came and when the next one does, in the
  reader's own zone (`MAIL_SCHEDULE`); on a bulk kind the manage link
  and the turn-off; the send id with its record and feedback links; the
  sponsor line; the disclaimer. Transactional mail has no turn-off.
- **Palette:** `#0b0920` ground, `#120f2a` panel; wins blue and losses
  rose; gold is the brand and the button, never a figure.
- **One preheader:** each renderer hands the shell the preheader it
  returns.
- **Size:** the clan report links the roster rather than tabling it; a
  test renders a 50-member week under 95,000 bytes (Gmail clips at
  ~102 KB).
- **Preview:** `node packages/mail/scripts/preview.mjs` renders every
  fixture and the relay's kinds into `packages/mail/.preview/`
  (gitignored), pixel stripped.

Every figure a mail shows is one a tool returned; what a board drew that
no tool returns is left out, not estimated.

## The console page

Account › Emails from Elixir (`apps/web/src/views/account/EmailPage.jsx`):
the four weekly kinds laid on a Monday-to-Sunday week by the day each
arrives in the account's zone, the two event kinds below it, the last
four sends beside them, and an Every email switch at the top. The page
computes no schedule of its own: `GET /api/me/email` returns, per active
kind, `product` (`MAIL_SOURCE`), `sends` (`{weekday, time, zone}` from
`mailSendTime`, the footer's function; null for the event kinds),
`last_send_id` and `applies`. Every email is on only when all six are,
and writes `"all"`.

## Not built

- A multi-clan Clan Report for one account (one mail per tracked clan
  today).
- Local-morning delivery: every weekly kind sends at 14:00 UTC.
