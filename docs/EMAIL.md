# Weekly email — the five report kinds

**Design, ratified 2026-09-18 (Jamie, in session). Nothing built yet.**
The first product email Elixir sends, and the reason mail moved to SES.
Decisions are recorded here and in `NOTES.md`; the public description of
what each email contains belongs at `/docs/email` when it ships, not here.

## What is decided

- **Five weekly kinds**, all bulk under the mail policy
  (`docs/ENGINEERING.md`, "Mail is transactional until a kind says
  otherwise"): `tracking_report`, `arena_week`, `clan_report`, `top_100`,
  `collector_activity`.
- **Every kind is a switch on the account page. All default ON (opt-out),**
  the beta stance from 0051: taking part in the beta includes the product
  email, and every issue carries one-click unsubscribe. Unlike the removed
  Buttondown toggle, these switches are honest — Elixir decides the send,
  so the flag is the whole truth.
- **Four of the five are structured reports with no LLM.** elixir-bot's
  recap and Arena Dispatch narrate with a model; the cost of a generated
  email per user per week is why they are being replaced, not carried.
  Every number comes from the readers the tools use, rendered into a fixed
  structure. ("Bring your own API key" for a narrated version was considered
  and is not near-term.)
- **Top 100 is the one LLM email**: the same issue for everyone, content
  first (a shareable read of the global top 100 with a call to action).
  Generated once a week by a multi-pass job with an editor cycle
  (Jamie's bundle in `docs/top100/`, the decisions under `top_100`
  below). No human approval gate: the first readers are the beta users
  and their feedback is the review.
- **Buttondown stays** as Jamie's own channel to users (product
  announcements). It is not one of the five and none of the five goes
  through it.
- **One report per clan.** An account tracking several clans gets several
  Clan Reports. Nobody runs a clan family today; a combined report is a
  later question.
- **Arena skips a week with no battles** across the account's own tags. The
  other kinds always have something to say (Tracking is built from added
  subjects; Clan has a roster; Collector's silence is itself the report;
  Top 100 is one issue for all).

## Cadence

At most one Elixir email per person per day. 14:00Z is 09:00 CDT / 08:00
CST — a morning read for the (US Central) audience, year-round, without
DST bookkeeping.

| Slot | Kind | Why here |
|---|---|---|
| Mon 14:00Z | `clan_report` | The war result is Monday's news; roster and donation facts settle at the 10:00Z week close. The slot members know from the recap. |
| Tue 14:00Z | `arena_week` | A day for late battlelog pickups to land (a 25-battle log on an adaptive cadence records Sunday-night play on Monday afternoon); keeps "your week" apart from "the clan's week". |
| Wed 14:00Z | `tracking_report` | Its own day; state and progress across every subject you track reads differently after the battle report, not beside it. |
| Thu 14:00Z | `top_100` | Mid-week, standalone, shareable. |
| Sun 14:00Z | `collector_activity` | The operator's week closes Sun→Sun; the thank-you goes out as it closes, on a day operators are around. Friday and Saturday stay quiet. |

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

Built once, used five times. In build order.

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
inbox. The account page shows the five switches and a **"send me this one
now"** per kind — the product's preview and our test path in one. The
Collector switch appears only for an account with a collector.

### 3. Ledger and idempotency

`email_issue (kind, period_key, subject_key, status, composed_at)` and
`email_send (issue_id, account_id, enqueued_at)`. `subject_key` is the
clan tag for `clan_report` (one issue per clan per week, N sends), null
otherwise (one issue per account, or one for all on `top_100`).

A run enumerates recipients, composes, enqueues, and inserts the send row
**after** a successful enqueue — elixir-bot's write-after-send rule
(2026-08-03 double send), moved one hop earlier because SQS is our durable
point. A re-run, a manual invoke, or a rule firing twice sends only what
the ledger lacks. SQS standard can redeliver; the relay stays dumb and the
rare duplicate is accepted rather than giving the relay a database.

### 4. Composition and rendering

A workspace package, `packages/mail`, takes a facts object and returns
`{subject, text, html}`: table layout, inline styles from the design
tokens, plain-text alternative always, **pixel-free and links unwrapped**
(policy; the configuration set has no open/click events). The jobs Lambda
renders; the message carries the rendered body; the relay's
`templates.mjs` keeps owning transactional mail. Mind the 256 KB SQS cap:
a 50-row roster in text+HTML is ~40–60 KB. If a kind ever exceeds it, a
pointer into the archive bucket is the escape hatch, not a bigger message.

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

Five EventBridge cron rules → the jobs Lambda with `{"email": "<kind>"}`.
Reserved concurrency 1 serializes them, harmless days apart. The jobs
Lambda gains `EMAIL_QUEUE_URL` and `sqs:SendMessage` on the email queue
(it has neither today). SES is production, 14/s and 50k/day; 20 or 500
mails at one instant is a non-event.

### 6. Public docs

`/docs/email`: the five kinds, what each contains, cadence, how to turn
one off. A line on `/docs/privacy`. The repo does not describe product
behaviour (AGENTS.md); this file is the design, not the description.

## Per kind

### `tracking_report` — Wed

`elixir_timeline` for the week, ordered by relationship depth. Primary:
full (trophies / Path of Legends delta, arena, level, card unlocks and
upgrades, badges, clan changes, moments). Alts: the same, shorter.
Friends: trophies, clan, activity, notable moments. Watchers: one line
each (trophies delta, clan, active or quiet). Unique per account by
construction; never empty for an account with a claim.

The seam with Arena is sharp: **Tracking is state and progress; Arena is
battles.** Neither shows the other's numbers.

### `arena_week` — Tue

`battles_performance` + `battles_opponents` + `battles_decks` for the
primary and each alt, sectioned by mode family as the Dispatch does
(Trophy Road / Ranked / River Race / 2v2 / special events split). Who you
battled: opponents faced, repeat opponents, clanmates met. How the week
went: W/L, streaks, best battle, the deck used most. Skipped when zero
battles across all the account's own tags.

### `clan_report` — Mon

`clans_timeline` + `clans_members_timeline` + `clans_roster` +
`war_history` for the week. Two depths by watch scope: **activity** gives
roster, trophies, donations, joins and leaves, war; **comprehensive** adds
per-member battle performance (the "full roster with play performance"
needs comprehensive; true for POAP KINGS today). The war section appears
only when a war week completed. Composed once per clan, sent to every
person account tracking that clan.

### `top_100` — Thu

One issue for everyone, the platform's one LLM email. Jamie's starting
bundle is in `docs/top100/` (spec, generator prompt, handoff notes) and
`fixtures/top100/` (brief schema, a real brief from 2026-09-18, the
hand-written gold issue); the review that reconciled it with the record
is in `NOTES.md` (2026-09-18, "Top 100 bundle reviewed"). Decided:

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
  the link works; the public share page sends non-members through the
  same door, which is the call to action. A "players in this issue"
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

### `collector_activity` — Sun

Only accounts with a collector. Facts are in the collector ledger: fetches,
bytes, `api_bytes` saved by edge filtering, check-ins and quiet stretches,
breaker trips, credits earned and the +2/+1 slot bonus in force, share of
the fleet's week (the status page already has it). Never empty: a silent
collector is the report ("your collector went quiet Wednesday"). The
thank-you is concrete, in the operator's own numbers.

## Open

- The Top 100 masthead name (subjects are generated; the name is a string).
- Multi-clan Clan Report for a family account (no such account yet).
- Local-morning delivery (see Cadence).
