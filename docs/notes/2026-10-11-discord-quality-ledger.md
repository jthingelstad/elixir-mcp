# 2026-10-11 — The Discord quality ledger (0222)

Jamie, 2026-10-11: "The Discord features in Elixir - we need to make sure
we can judge the quality of those without having any access or
visibility to the client discord server. Please make sure we are setup
to do that when other folks start using this." Until now the only
record of a Discord post was the relay's rolling S3 history (the last 20,
or 40 for a clan's channel), shown only to its owner or the clan's
leaders. This is the first of four changes; it records, and the next
ones read posts back, rate them, show them in Admin and review them.

- **Migration 0222**, new tables only. `discord_post`: one row per post,
  edit or skip of the three features (`timeline`, `clan_actions`,
  `clan_activity`), written in the same transaction as the hand-off to
  the relay (inside a savepoint: a failed ledger write is logged as
  `discord_quality_failed` and never aborts a delivery). It holds the
  account or clan, the destination, the webhook's fingerprint, the
  post's key and revision, the mode (`line`, `code`, `model`), the
  items told (`[{id, kind}]`), the text, a skip's reason, and the event,
  observed and handed times. `discord_run`: one row per run of a clan's
  model as the activity channel's editor, with rounds, lookups,
  stories, posts, merges, skips, fallbacks to Elixir's words, every
  refusal `{keys, why, text}` and about what it cost (`cost_estimated`
  when a round reported no tokens).
- **Receipts.** Each post handed to the relay carries a `ledger_id`. The
  relay writes what Discord answered (posted, edited, refused with its
  words, unknown, not delivered, unchanged) as `discord-receipt/<uuid>.json`
  in the outbox; S3 notifies the timeline-sync queue, which reads it into
  the row and deletes the object. A duplicate's `unchanged` never
  overwrites a delivery's answer. An edit that found its message deleted
  marks the post `present = false`. A failed receipt write is logged
  (`timeline_discord_receipt_failed`) and never holds up delivery; the
  row then keeps a null outcome. Clan's Actions settle on the VPC side,
  so their answers go straight to the ledger from `settleAll`; the
  delivery history shown to leaders carries the `ledger_id` too, for the
  ratings to come.
- **Raw editor runs** are `discord-runs/YYYY-MM-DD/<run_id>.json` in the
  archive bucket: the context, the stories, each round's answer, calls
  and lookup results, the messages, the engine's checks and what was
  sent and skipped. Expired at 30 days (lifecycle `discord-runs-expire`,
  noncurrent versions a day later). `discord_run.raw_key` names it; a
  failed capture leaves it null (`clan_activity_capture_failed`).
- **Kept 90 days**: the jobs Lambda's hourly sweep deletes older rows
  (`discord_quality` in its output).
- **Never stored:** the webhook, the clan's Anthropic key, or a player
  tag beyond the items the record already holds. The rows never reach
  MCP, `/api/v1` or a public page.
- **IAM, in the stack:** timeline-sync may read and delete
  `discord-receipt/*` and write `discord-runs/*`; the relay may write
  `discord-receipt/*` (with the internal-clan condition its other Clan
  grants carry).
- **Privacy and limits** pages say what is kept and for how long, and
  that operators read it. `docs/OPERATIONS.md`'s third-party line no
  longer claims what reaches Anthropic matches the privacy page: the SES
  half and the Discord records match, the Anthropic half is a known gap
  until Jamie decides its wording.

MCP and JSON API unchanged.
