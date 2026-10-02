> Historical engineering record. Editorial generation and sends retired 2026-10-02.

# Weekly email — the report kinds and the written ones

**Design, ratified 2026-09-18 (Jamie, in session); BUILT AND DEPLOYED the
same night** (`docs/notes/2026-W38.md`, 2026-09-18, "Product email
shipped"). There are **eight kinds** (`PRODUCT_EMAIL_KINDS` in
`packages/contracts/src/queue.ts` is the list): the milestone mail joined
during the design, and `card_of_week` was designed and built 2026-09-22
and has its own section below. The public description is `/docs/email`; this file is the
design and the engineering shape. Palette: dark for all of them
(Jamie, from the gallery). Collector Activity is
one mail per ACCOUNT, every collector it runs pooled.

## What is decided

- **Eight kinds**, all bulk under the mail policy (`docs/ENGINEERING.md`,
  "Mail is transactional until a kind says otherwise"): six weekly
  (`clan_report`, `arena_week`, `tracking_report`, `top_100`,
  `card_of_week`, `collector_activity`), the event-driven `milestone`,
  and `clan_actions_waiting` (2026-09-25), a family app's own mail:
  Elixir Clan composes it and sends it through `POST
  /api/v1/clans/{tag}/mail` (`services/web-api/src/clan-mail.mjs`), and
  Elixir resolves, checks, renders, records and sends it (`/docs/integrations`).
- **Every kind is a switch on the account page. All default ON (opt-out),**
  the beta stance from 0051: taking part in the beta includes the product
  email, and every issue carries one-click unsubscribe. Unlike the removed
  Buttondown toggle, these switches are honest — Elixir decides the send,
  so the flag is the whole truth.
- **Five of the seven are structured reports with no LLM** (`clan_report`,
  `arena_week`, `tracking_report`, `collector_activity`, `milestone`). elixir-bot's
  recap and Arena Dispatch narrate with a model; the cost of a generated
  email per user per week is why they are being replaced, not carried.
  Every number comes from the readers the tools use, rendered into a fixed
  structure. ("Bring your own API key" for a narrated version was considered
  and is not near-term.)
- **Two of the seven are WRITTEN by a model** (`top_100`, and
  `card_of_week` since 2026-09-22); they share one pipeline in
  `services/jobs/src/email/issue-pipeline.mjs`.
- **Top 100 was the first LLM email**: the same issue for everyone, content
  first (a shareable read of the global top 100 with a call to action).
  Generated once a week by a multi-pass job with an editor cycle
  (Jamie's bundle, archived; the decisions under `top_100` below). No human approval gate: the first readers are the beta users
  and their feedback is the review.
- **Buttondown stays** as Jamie's own channel to users (product
  announcements). It is not one of the seven and none of the seven goes
  through it.
- **One mail per kind and subject per day.** An account tracking several
  clans gets one Clan Report per tracked clan on Monday. Nobody runs a
  clan family today; a combined report is a later question.
- **Arena skips a week with no battles** across the account's own tags. The
  other kinds always have something to say (Tracking is built from added
  subjects; Clan has a roster; Collector's silence is itself the report;
  Top 100 is one issue for all).

## Cadence

At most one mail per kind and subject per day, and each weekly kind has
its own day, so a person gets one weekly kind a day (one Clan Report per
tracked clan on Monday); the milestone mail is exempt. 14:00Z is 09:00 CDT / 08:00
CST — a morning read for the (US Central) audience, year-round, without
DST bookkeeping.

| Slot | Kind | Why here |
|---|---|---|
| Mon 14:00Z | `clan_report` | The war result is Monday's news; roster and donation facts settle at the 10:00Z week close. The slot members know from the recap. |
| Tue 14:00Z | `arena_week` | A day for late battlelog pickups to land (a 25-battle log on an adaptive cadence records Sunday-night play on Monday afternoon); keeps "your week" apart from "the clan's week". |
| Wed 14:00Z | `tracking_report` | Its own day; state and progress across every subject you track reads differently after the battle report, not beside it. |
| Thu 14:00Z | `top_100` | Mid-week, standalone, shareable. |
| Fri 14:00Z | `card_of_week` | One card, read in full; the brief builds 06:00Z after the nightly rollup. Friday was quiet and a forwardable piece earns it. |
| Sun 14:00Z | `collector_activity` | The operator's week closes Sun→Sun; the thank-you goes out as it closes, on a day operators are around. Saturday stays quiet. |
| Hourly (:20) | `milestone` | Firsts on the recipient's own tags since the last look, bundled; exempt from the one-a-day rule because it is the one people most want and holding it makes it late. |

**Content windows.** The four game reports cover the same **game week,
Monday 10:00Z → Monday 10:00Z** (the policy grid every clan shares;
`clocks.md`), whichever day they send, so a member can lay Tuesday's and
Wednesday's mail side by side and the numbers agree. Collector Activity
covers Sun 14:00Z → Sun 14:00Z. Period keys name the game week, not the
ISO week. Windows are UTC; display is in `account.timezone` (0002).

Later, not v1: local-morning delivery per `account.timezone` (an hourly
rule, send when the account's clock reaches 08:00, the ledger keeping it
safe). Worth it when the audience is multi-timezone; today it is
complexity nobody would notice.

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
otherwise (one issue per account, or one for all on `top_100`).

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

Nine EventBridge cron rules → the jobs Lambda: one per kind with
`{"email": "<kind>"}` (seven), plus the two written kinds' brief builds
(Top 100 Thu 10:30Z, Card of the Week Fri 06:00Z).
Reserved concurrency 1 serializes them, harmless days apart. The jobs
Lambda writes mail to the outbox (`OUTBOX_BUCKET`, `s3:PutObject` on
`email/*`; the editor's brief goes to `editor/*`). SES is production, 14/s and 50k/day; 20 or 500
mails at one instant is a non-event.

### 6. Public docs

`/docs/email`: the seven kinds, what each contains, cadence, how to turn
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

### `top_100` — Thu

One issue for everyone, and the first LLM email (`card_of_week` is the
second). Jamie's starting bundle was a spec and handoff notes, archived
2026-09-25 as `docs/archive/TOP100-SPEC.md` and
`docs/archive/TOP100-README.md` because this file holds the reviewed
design; the writer prompt stays at `docs/top100/generator-prompt.md`,
which the editor loads at runtime, and `services/editor/fixtures/` holds
the brief schema, a real brief from 2026-09-18 and the hand-written gold
issue. The review that reconciled the bundle with the record is in
`docs/notes/2026-W38.md` (2026-09-18, "Top 100 bundle reviewed"). Decided:

- **The brief builder computes, the model writes.** ("Collector" in the
  bundle means this builder; in this repo a collector is the fetch
  client.) Every delta, threshold, novelty score, deep-cut choice and the
  drought-mode decision is code in the jobs Lambda, calling the readers
  directly. The brief is stored on the issue row: it is the audit trail,
  the fixture generator, and what any regeneration starts from.
- **Model: the Anthropic API directly**, from a small non-VPC "editor"
  Lambda on the relay's pattern (brief lands in the archive bucket, the
  Lambda calls the API, writes the issue back; the jobs Lambda lints and
  queues). Bedrock is out: the account lists Claude Opus 5 and reports it
  authorized, but an invoke returns AccessDenied "not available for this
  account" (checked 2026-09-18). Start on `claude-opus-5`; a stored brief
  makes trying `claude-fable-5-1` on the same input a free comparison.
- **Two model passes, three code passes.** Writer (one tool,
  `brief_value(path)`: any number printed must have been fetched through
  it, so `numbers_used` is the tool log, not a self-report) → lint (every
  path re-resolved, every integer in the body present in the brief, no
  `!`, no tags, ≤700 words, rank and rating cells paired on every table
  row) → editor (revises against the lint findings and the voice rules,
  picks the subject) → lint again → queue. A failing issue does not send;
  `owner_notify` fires and the week is skipped.
- **Subjects are generated** (writer proposes, editor picks; alternates
  stored for the feedback loop). The masthead name is a string, chosen
  separately; repo paths and the kind stay `top100` / `top_100`.
- **Names are links.** Every named player links to their page in Browse.
  Every recipient is an account holder, so the sign-in is one code and
  the link works. There is no public issue page (Jamie, 2026-09-18:
  "sharing means forwarding the email"); a forwarded issue's links send a
  non-member through the same sign-in door, which is the call to action.
  A "players in this issue"
  appendix in the footer carries name and tag in small type for anyone
  who needs to search elsewhere; tags appear nowhere else.
- **Window Thu 10:00Z → Thu 10:00Z** (the one kind off the game-week
  grid: freshness matters more than alignment), generated ~10:30Z after
  the daily snapshot lands, sent 14:00Z. The season-reset special is that
  week's Thursday issue, from the `pol_final` board fetched Tuesday.
- **No per-recipient personalization** (one render, N sends, page equals
  email). `level_gap` leaves the deep-cut rotation for this audience: the
  top 100 is maxed, the gap is ~0.
- The CTA says what is true: a hand-approved beta, request access; "your
  history starts the day you track your tag" is the argument.

What the record gives the builder that the bundle did not assume: the
global board hourly (the deep cut gets hour resolution; the 10:00Z rows
are the week's boundaries), the whole field above the floor (movers
diff the full board; floor, summit and field size come from
`rankings_timeline`), every top-200 player recorded at comprehensive
scope for the season (the meta section is over ~100 of 100; the honest
caveat is battle coverage, a segment-level number we lack), and season
finals back to 2022-10. Reader gaps to add as tools: `rankings_movers`,
`segment: {player_tags}`, segment-level battle coverage, set-wise
head-to-head.

### `card_of_week` — Fri (2026-09-22)

The second WRITTEN kind, on the Top 100's pipeline rather than beside
it: `issue-pipeline.mjs` is the shared spine (archive key, editor hand-off through the outbox,
lint gate, owner notice, ledger row) and each kind supplies its brief
builder, its names and its facts. Decided with Jamie in session,
2026-09-22.

- **Selection is the ten most-played cards of the season we have not
  featured inside a year, with one DRAWN from those ten.** The first
  design scored a trailing 28-day usage jump against the 28 days before
  it, and it cannot be served: `seasonRollup` answers a corpus read only
  when the window is exactly one season, so any other window is a raw
  scan of the participant heap, and a SEVEN-day corpus `battles_meta_cards`
  already exceeds the tool time budget (`query_timeout`, request
  eb9fcaf0, 2026-09-22, at 692k decided battles against August's 74k).
  A season read is one indexed pass over ~130 rows. Jamie authorised
  direct SQL for the selector, and it needs it for a second reason:
  `battles_meta_cards` returns one row per (card, form) and never merges
  them, so ranking its rows ranks Ice Wizard by its hero form alone.
  The selector reads `card_meta_season` at `form = -1`.
- **The draw is seeded on the period key**, not `Math.random`: random
  across weeks, fixed within one. A dry run picks what the real send
  will pick, a retry does not switch cards mid-week, and the choice
  reproduces from the week plus the candidate log. A recorded pick is
  returned as-is on a re-run, because sending removes the card from the
  field and a naive re-selection would switch it.
- **A card is consumed by a SEND** (`email_featured_card.sent_at`,
  0153), never by a selection: a dry run or an issue that failed its
  verifier leaves the card due its turn. The ten it was drawn from are
  kept on the row, so a pick is auditable a year later without
  re-reading a season that has since moved.
- **The new-card queue jump is dropped.** It keyed on
  `first_seen_in_catalog`, which is 2026-09-10 for EVERY card - the day
  Elixir seeded its catalog, not a release date; Knight reads the same
  instant as Barbarian Barrel - so it would have matched the whole
  catalog every week. `first_played` per form is no better: Knight's
  hero form reads 2026-01-03 and its base form 2026-02-20.
- **Two windows, both named in the footer.** The headline is the closed
  game week; modes, bands, partners and decks are season to date,
  because `cards_card` answers those only on a corpus season read.
- **The writer places a deck and never spells it.** It emits
  `{{deck:N}}` and the renderer prints the cards from the brief, so
  "every card name matches the brief exactly, in order" holds by
  construction. Two different card sets share the label "Minion Giant
  cycle" among this card's own top five decks; a model trusting the
  label would print the wrong deck.
- **Card art is mirrored, not hotlinked** (`infra/scripts/mirror-card-art.mjs`
  and its own PNG codec): a mail client proxies or blocks a third-party
  image. The output is gitignored - 540 thumbnails are 15 MB and this
  repo is public - and uploaded by deploy. Re-run it when the catalog's
  `as_of` moves.
- **Schedule:** brief Friday 06:00Z, after the 04:40Z nightly rollup it
  reads (both at reserved concurrency 1); send 14:00Z.
- `/cards/<id>` is the public landing page, ids not slugs (Jamie), on
  the `/data/now` pattern: catalog facts baked, season numbers filled by
  `cards-live.js` from `/api/public/cards/<id>`.

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

## As built (2026-09-18)

- `packages/mail`: `renderMail(kind, facts, links)`, `htmlToText`, the
  signed one-click token, the Top 100 lint. Fixtures per kind are the
  gallery's real week.
- `services/jobs/src/email/`: `runEmail` (the op `{email: kind,
  account_id | account_email, force}`), builders per kind calling tool
  handlers in-process (`ctx.mjs`) and the timeline's own entries, the
  ledger, `deliver`. Top 100: `top100.mjs` builds the brief, writes it to
  `mail/top100/<date>/brief.json` (`mail/top_100/<date>/` since #68,
  2026-09-27) and hands `{brief_key}` to the editor
  through the outbox (one object under `editor/`, whose S3 notification
  wakes the editor; the NAT-free VPC has no Lambda endpoint, and until
  2026-09-24 this was a message on `EditorQueue`); `top100_accept` lints
  and stores the issue.
- `services/editor`: the non-VPC Lambda on the Anthropic API
  (`claude-opus-5`, the `EditorModel` parameter): writer with the
  `brief_value` tool, editor pass with the lint's findings, issue back to
  S3, `{top100_accept}` invoked on jobs. Its key is
  `anthropic_api_key` in the app secret behind the preserved parameter
  `AnthropicKeyInSecret` (false until the key is added by hand).
- Web API: `/api/me/email` (GET/PUT), `/api/me/email/send` (REMOVED
  2026-09-19: "send me this now" made no sense to a user; the operator's
  test path is the jobs op with `account_email`),
  `/api/email/unsubscribe` (GET page, POST flip; the RFC 8058 form body
  tolerated). No anonymous page for an issue (Jamie, 2026-09-18): sharing
  a Top 100 is forwarding the mail.
- Console: the Email panel on Profile (one switch per kind, the Collector
  switch only for an account with a collector; recent sends; the
  send-me-this-now button was removed 2026-09-19). Names link to the
  Explore record pages (`/console/explore/player/<tag>`,
  `/console/explore/clan/<tag>`),
  and a card links to its public page, `/cards/<id>` (see
  `card_of_week`).
- EventBridge rules and migrations 0137 + 0138 (nine rules since
  `card_of_week`; see "Schedule and plumbing").

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

## The lint bug the second written kind found (2026-09-22)

`numberSet` canonicalised every brief number as an integer, so a rate
became `"1"` (`Math.round(0.511)`) and no percentage printed from it
could trace. The Top 100 brief carries rates TODAY - `meta.cards[].usage_share`
and `meta.decks[].win_rate` are the meta section's whole point - so
every percentage the writer fetched through `brief_value` and printed
was reported unsourced, and the editor pass, told to remove a number
that does not trace, deleted a correct one. The second lint then passed
over the thinner body and the issue sent: it failed QUIET, with no
alarm and no failed issue, which is why it went unnoticed. Numbers now
canonicalise at every spelling a writer would use, including a rate's
percentage, and the body is scanned for whole decimals rather than
their integer parts. `lintIssue` takes a kind: the length rules and the
rank-and-rating pairing are the kind's, and `card_of_week` adds a word
FLOOR, because an issue an editor pass cut to nothing satisfies every
other rule.

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
- **Written issues are tied to their period.** `top_100` sends the
  issue for today's date, `card_of_week` the one for
  `lastGameWeek(now).key`. With none accepted, nothing sends and the
  owner gets one `owner_notify`; last week's issue is never sent as new.
  The send no longer upserts the issue row, so its status and `issue
  <key>` note stay as the pipeline wrote them. The operator's forced
  send still takes the newest accepted issue. A late accept sending on
  its own is A7 (#68), below.
- **The clan report is the clan's.** It was composed as `members[0]`,
  with that account's own `account_clan.scope` and timezone. It now uses
  the clan's recording scope (the widest any tracker or collection asked
  for), carries days as instants (`membership[].at`, `{{day:<instant>}}`
  in a standout's text), and the renderer names each day in the
  recipient's `account.timezone` (`links.timezone`, set by `deliver`).
  Issues stored before this carry `when` labels and still render.

## The written-issue pipeline hardened (2026-09-27, review §6.7, #68)

- **One spine.** The Top 100 now runs on `issue-pipeline.mjs` like Card
  of the Week: `generateIssue` stores the brief at
  `mail/top_100/<date>/brief.json` (issues before 2026-10-01 stay under
  `mail/top100/`) and hands the editor `{brief_key, kind}`;
  `acceptIssue` repairs names with `packages/mail`'s `briefNames(brief,
  kind)`, lints, and stores `top100Facts`. `{top100_generate: {force:
  true}}` is the operator's regenerate: the brief says `ops`, a failure
  is noted `[ops]` and mails nobody.
- **A late accept sends.** An issue accepted after its kind's send slot
  (Thursday or Friday 14:00Z), for the period that slot sent, runs
  `runEmail(kind)` from the `issue_accept` handler (`late_send` in the
  log). The ledger skips everyone the scheduled run reached. An accept
  for an older period, after the period rolled, or from an ops brief
  never sends on its own. `WRITTEN_SEND_SLOT` is pinned to the
  EventBridge crons by a test.
- **The editor classifies its errors.** A refusal, `max_tokens`, the
  context window, the 12-turn limit, an answer that is not JSON, or a
  4xx from the API is final: `issue.json` is written as
  `{_pipeline: {error: {kind, message}}}`, jobs is invoked so the row
  says failed and the owner hears "was not written", the hand-off is
  deleted and the invocation succeeds. Only a 429, a 5xx (408 and 409
  too, the SDK's own retry class) or a connection error rethrows for SQS.
- **The brief is cached.** It is the first content block of each pass,
  with its own `cache_control` breakpoint beside the system prompt's, so
  every `brief_value` turn after the first reads it from the cache. The
  per-turn `{editor: {pass, turn, stop, usage}}` log line shows it as
  `cache_read_input_tokens`.
- **The lint binds numbers to names.** A number in a sentence that names
  someone must belong to that name's brief object (an object whose own
  strings carry the name owns every number inside it), unless no named
  object holds it or it is one of the small structural numbers; and a
  `numbers_used` claim must print the value at its `brief_path`. The
  repo's sample podium with its three ratings rotated passed with zero
  findings; it is now `services/editor/test/lint-binding.test.mjs`, and
  fails. Placeholders (`{{v:path}}`) were out of scope.

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

- The Top 100 masthead name (subjects are generated; the name is a string;
  "Ultimate Champions" is the placeholder in code).
- Multi-clan Clan Report for a family account (no such account yet).
- Local-morning delivery (see Cadence).
