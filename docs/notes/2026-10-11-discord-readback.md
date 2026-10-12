# 2026-10-11 — Discord read-back and the undelivered alarm

The second of four changes for Jamie's "judge the quality of those
without having any access or visibility to the client discord server"
(2026-10-11; the first is `2026-10-11-discord-quality-ledger.md`).

- **Read-back, once a post.** A post (`action = 'post'`, `posted`) that
  is a day to a week old and not yet read is a candidate. The next
  delivery to the same webhook names up to three of them, oldest first
  (`readback` on a timeline message, `reads` on Clan's sealed Actions
  hand-off). The relay reads each after its own sends with
  `GET /webhooks/{id}/{token}/messages/{message_id}` on a rate-limit
  bucket of its own (`<webhook id>:read`), never waits on a slow-down,
  never retries, and stops at a 429, a refused or deleted webhook, or the
  run's budget. A message Discord no longer has (10008), or one the relay
  already knows was deleted, is `present = false`. What it found goes
  back as a receipt on the `discord-receipt/` lane (the Actions' in the
  sealed reply, settled VPC-side) and fills `checked_at`, `present`,
  `reactions` and `thread`; the first read stands. No timer of its own:
  a webhook with no later delivery is never read back, and its posts
  keep `checked_at` null.
- **Reactions are counts only**, `[{emoji, count}]` (at most 20), never
  who reacted. Discord's documentation of the webhook message GET returns
  a message object whose `reactions` field is optional and does not say
  whether a webhook read fills it. So `reactions` is stored when Discord
  returns it and null when it does not: null means "none, or not
  returned", and the first production reads decide which. Present or
  deleted and the thread (`thread`, or the HAS_THREAD flag) do not
  depend on it.
- **One alarm.** Every refused, unknown or undelivered send, for all
  three features, is one relay log line
  `discord_undelivered <feature> <outcome> <fingerprint>`. A metric
  filter on the relay's log group counts them
  (`ElixirMCP/Discord Undelivered`) and `elixir-mcp-discord-undelivered`
  fires at five in an hour, to `elixir-mcp-alarms`. A slow-down (429)
  that is tried again is not counted; a post still waiting at the
  queue's last attempt is `not_delivered` and is. A connection's check
  is never counted.
- **Privacy, limits and DECISIONS** say a post is read back once, counts
  only.

MCP and JSON API unchanged.

Codex on #511, both fixed here: an editor run whose connection changed
while the model answered (turned off, replaced, or moved on) posts
nothing but is now recorded in `discord_run` with outcome `changed`
(and its raw run captured); and an edit's "deleted" receipt read before
its post's own answer now marks the post gone anyway (the post row's
null outcome no longer stops it).
