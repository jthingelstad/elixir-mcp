# 2026-11-12 — The digest replaces the friends mail

Social slice 9 (#767), the digest half. Jamie's ruling is quoted on the
"Seven product kinds" line in `docs/DECISIONS.md`.

## What changed

- **One kind, carried over.** The digest is `tracking_report` under a
  new label, "Your digest" (product Home). The kind key, its
  `account_email_pref` rows and the unsubscribe HMAC are unchanged, so
  every opt-out stays an opt-out, nobody is resubscribed, and an old
  turn-off link still works. Still seven kinds.
- **Cadence.** Migration **0242** adds `account_email_pref.cadence`
  (nullable text, `weekly` or `daily`, a `not valid` check; catalog-only,
  expand only). Null means weekly. Off is still `enabled = false`.
  `PUT /api/me/email` takes `{kind: "tracking_report", cadence}`, with or
  without `enabled`; a choice never turns the digest on, and turning it
  off keeps the choice. `GET /api/me/email` returns `cadence` on the
  digest's row and null on the others. Each choice is an `email_pref`
  account event. Settings › Emails shows Weekly / Daily while the digest
  is on.
- **Schedule.** `EmailTrackingReportRule` now fires every day at 14:30
  UTC. A scheduled run sends weekly readers only on a UTC Wednesday and
  daily readers every day; an ops run for one account ignores the day.
  The period key is the UTC date, so the ledger allows one digest a day
  per account. One scheduler, the per-day caps, one-click unsubscribe,
  the Tinylytics pixel per mail and send records are as before.
- **Composer.** `services/jobs/src/email/build-digest.mjs` replaces
  `build-tracking.mjs`: `buildTimeline` in-process, basis `observed`,
  filtered to `DIGEST_KINDS` before the cap; the window is the week or
  day before the run, starting no earlier than the last scheduled
  digest. Null when no one followed played or posted and neither did the
  reader: no mail. A followed player whose only news is a highlight
  (of an older battle, posted or edited in the window) stands with no
  battles, and an alt that played makes the reader's line when the
  primary was quiet (both from Codex on #783). The renderer (`digest` in `packages/mail/src/render.mjs`)
  draws people, a highlight's words as a quote, "See the battle" links,
  clans as a headline and three bullets, and you. Everything a person
  typed is escaped at the render (hostile-name tests).
- **Names** link to the current player door (`playerDoor`): slice 6's
  player page has not landed on main. Switch the door when it does.
- **No contract change.** `/api/me/email` is the web app's own route;
  MCP 11.20.1 and JSON API unchanged.

## Defaults taken [engineering, 2026-11-12]

- Weekly on Wednesday (the friends mail's day), 14:30 UTC, outside the
  14:00 run of the other weekly mail and outside 6 to 9 am Pacific.
- Windows of 7 days and 1 day, bounded below by the last scheduled
  digest; basis `observed`.
- Up to 12 people (friends first, then most to tell, then busiest), 3
  items each (highlights first); clans as headline and 3 bullets.
- A clan's week alone never sends a digest; it is context.
- The label "Your digest", the product Home; the subject names no one.
- Your Ladder link opens the current season (the digest is not a game
  week).
- No quiet list: the digest tells who played or posted.

## Not in this change: a shared post in the clan's Discord

The ruling's "Also: a shared post can post to the clan's Discord through
Clan's webhook" is the follow-up. Clan's relay posts links without
previews by design, the clan's Discord has two webhooks (activity and
actions) and choosing one is a who-sees-what call, and a member's post
reaching a channel the leaders set up raises whether leaders opt in. It
ships as its own change once those are answered.
