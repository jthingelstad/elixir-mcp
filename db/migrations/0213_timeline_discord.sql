-- 0213: an account's timeline, cross-posted to a Discord webhook.
-- Jamie, 2026-10-10: a person syndicates THEIR timeline (every player and
-- clan they track, watched players included, "not filtered") to a
-- Discord webhook of their choice, and an agent its clan's. Turned on and
-- edited on the console's Timeline page. Event driven, never polled: an
-- admission that wrote new facts wakes the accounts that track its
-- subject, and the timeline-sync Lambda posts what is new. A sitting that
-- grows is edited in place, not posted again.
--   timeline_discord: the switch, the webhook and the sync pointer. One
--     row per account (a person or an agent), made the first time it is
--     turned on. The webhook is a credential to post in someone's
--     channel, so it is kept SEALED, as Clan keeps its Discord webhook:
--     only the web API (which seals it) and the relay (which opens it)
--     hold the key. Beside it, its fingerprint and the shortened form the
--     owner's console shows; never MCP or /api/v1, never logged.
--   timeline_discord_told: what has been posted, by item id and the
--     revision it was posted at, so a story is posted once and edited
--     when it grows. open_player/open_from name a sitting still open when
--     it was told, so the next sync reads from its start and the edit
--     carries the whole sitting. Rows older than the timeline's 30-day
--     reach are deleted by the sync.
-- The Discord message ids live with the non-VPC relay (outbox
-- timeline-discord-state/), which alone can talk to Discord; this
-- database never holds them. The rules are in packages/syndication and the public docs
-- (timeline.md, "Cross-posting to Discord").
-- Locks: new tables only.

create table timeline_discord (
  account_id      uuid primary key references account on delete cascade,
  webhook_sealed  jsonb not null,
  webhook_fp      text not null check (webhook_fp ~ '^[a-f0-9]{16}$'),
  webhook_display text not null,
  enabled         boolean not null default true,
  enabled_at      timestamptz not null default now(),
  synced_to       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  disabled_reason text check (disabled_reason in ('owner', 'webhook_gone')),
  disabled_at     timestamptz
);
comment on table timeline_discord is
  '0213: the account''s timeline cross-posted to a Discord webhook (console Timeline page). One row per account once turned on; the sync wakes on new facts for the account''s subjects.';
comment on column timeline_discord.webhook_sealed is
  '0213: the Discord webhook (https://discord.com/api/webhooks/<id>/<token>), sealed (AES-256-GCM, bound to the account). The sync copies it into the outbox as it is; only the relay opens it.';
comment on column timeline_discord.webhook_fp is
  '0213: the first 16 hex of the webhook''s sha256: names it in the relay''s records and logs, and tells a changed webhook from the same one.';
comment on column timeline_discord.webhook_display is
  '0213: the webhook as the owner''s console shows it: its id and the token''s last four characters.';
comment on column timeline_discord.enabled_at is
  '0213: when it was last turned on. Nothing observed before it is posted: turning it on never backfills.';
comment on column timeline_discord.synced_to is
  '0213: the sync''s own read pointer (an observed_at instant). Not a timeline_reader: it never moves a connection''s pointer or meta.timeline_pending.';
comment on column timeline_discord.disabled_reason is
  '0213: why it is off: owner (turned off in the console) or webhook_gone (Discord answered that the webhook no longer exists). Null while on.';

create table timeline_discord_told (
  account_id  uuid not null references account on delete cascade,
  item_id     text not null check (item_id ~ '^tl_[a-f0-9]{20}$'),
  revision    integer not null,
  told_at     timestamptz not null default now(),
  open_player text,
  open_from   timestamptz,
  primary key (account_id, item_id)
);
comment on table timeline_discord_told is
  '0213: the timeline items posted to an account''s Discord webhook, at the revision posted. A higher revision later is an edit of the same message.';
comment on column timeline_discord_told.open_from is
  '0213: the start of a sitting that was still open when told (open_player is its player): the next sync reads from here so the edit tells the whole sitting. Null once it closed, and for every other item.';
