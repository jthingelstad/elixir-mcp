# 2026-10-11 — Discord delivery: a refused line skips alone, paced, threads and forums

The first of three changes from the Discord delivery plan Jamie approved
on 2026-10-11, on the relay shared by the timeline's cross-post (#407)
and a clan's activity channel (#411/#413). Actions in Discord (#406)
follow in their own pull request.

- **A 400 skips one line, not the batch.** The relay used to treat any
  refusal other than a gone webhook as the batch's end: the line and up
  to 19 after it were dropped and the status stayed `failing`. Now the
  refused line alone is recorded (`{refused, revision}` in its state, so
  the same revision is not sent again and a newer one is), the rest are
  delivered, and the status carries Discord's own words (`reason`, its
  message and the first field error of an "Invalid Form Body"). An edit
  Discord refuses keeps the message's last text.
- **Forum channels and threads.** `parseDiscordWebhook` (contracts)
  accepts `?thread_id=<snowflake>` and nothing else in a query; the
  canonical URL keeps it, so a thread is a webhook of its own (its own
  fingerprint and records), and every call carries it
  (`discordWebhookCall`). A forum channel's webhook takes no plain
  message (Discord code 220001): the relay writes status `forum`, and the
  syncs turn the posting off with the new reason `webhook_forum`
  (migrations 0218, 0219 widen the two `disabled_reason` checks). A save
  now waits up to 8 s for its hello line's first word, so a forum's
  webhook, or one Discord says is gone, is refused at once with what to
  do instead (a text channel's webhook, or `?thread_id=`); with no word in
  time the save stands and the sync hears it later.
- **Pace.** One webhook's calls are spaced 2.4 s apart (25 a minute,
  under Discord's ~30 messages a minute per channel) across every run,
  through a pace record beside its posts written with S3 conditional
  writes, since the queue runs two at once. The client also reads
  `X-RateLimit-Remaining`/`Reset-After` and waits for the bucket rather
  than spending a 429. A wait longer than the run's budget goes back to
  the queue with the wait: the relay's handler sets the record's
  visibility to it (`sqs:ChangeMessageVisibility` on the timeline lane)
  instead of the queue's 360 s.
- **Nothing vanishes.** The timeline lane's `maxReceiveCount` is 20 (a
  big batch takes several paced runs); the relay is told its last receive
  (`DISCORD_MAX_RECEIVES`), and on it records the lines still waiting as
  not delivered and finishes, rather than dead-lettering them silently.
  Infrastructure faults still dead-letter and alarm.
- **Delivery history.** The relay keeps the last 20 deliveries (posted,
  edited, refused, unknown, not delivered; when, Discord's reason, the
  line's start) and a per-day count of what was not delivered, 30 days,
  at `timeline-discord-state/<id>/history.json` (contracts
  `addDiscordDeliveries`). The pages read it in the third change.
- **#454, the edit race.** An edit is claimed (`editing: {revision, at}`)
  with a conditional write before Discord is called: a run with an older
  or equal revision skips, a newer one waits for the claim (2 minutes at
  most, then takes it over). The other half of #454 (a wake when an open
  sitting closes) is not in this change.

Unchanged by design: no embeds; the cross-post stays unfiltered; a post
whose outcome is unknown is never made again; no mentions anywhere on
these two paths. No MCP or JSON API contract moves. Migrations 0218,
0219. No acceptance run: no tool changed.

## Follow-up: the review's three findings (#483)

- **Pace by the webhook.** The pace record moved to
  `timeline-discord-state/pace/<fingerprint>.json`: a webhook saved on a
  person's timeline and on their agent's is one channel, paced once.
- **A refusal is scoped to its webhook.** A save's wait for the hello's
  word turns the setting off only while that webhook is still the saved
  one (`webhook_fp` in the update's `where`); a save that replaced it
  during the wait keeps its own.
- **A late word shows.** The timeline page reads `forum` or `gone` from
  the delivery as well as from the setting, so a refusal that arrived
  after the save's wait shows its guidance before the next sync turns
  the setting off.
