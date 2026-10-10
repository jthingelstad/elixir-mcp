-- 0214: a clan's activity, posted to a Discord channel of its own.
-- Jamie, 2026-10-10: Elixir Clan's Social section gets a Discord item, a
-- lighter, in-Elixir version of the elixir-mcp-discord agent. A leader
-- connects a webhook (a NEW one: not the Actions webhook, not a person's
-- timeline cross-post) and chooses which of the clan's timeline is
-- posted there (members, milestones, Clan Wars), the clan's policy
-- setting the defaults and ruling a category out. Optionally the clan's
-- own model rewrites each line in a voice the leaders describe. Event
-- driven: an admission (or a leader's attested fact) about the clan
-- wakes the timeline-sync Lambda, which posts what is new. No backfill.
--   clan_activity_discord: the connection. One row per clan, made the
--     first time a webhook is connected. The webhook is sealed (as the
--     timeline's is) and bound to channel_id, a random id per connection
--     that also names the relay's records of it, so a new webhook starts
--     over. categories holds only what a leader switched (the policy
--     gives the rest); voice is the leaders' words for how posts sound.
--   clan_activity_discord_told: what has been posted, by timeline item
--     and revision, so an item is posted once and edited when it grows.
--     kind and player_tag let a leader's word on a departure find the
--     departure's post and edit it to say "was removed" or "left on
--     their own". Rows past the timeline's reach are deleted by the sync.
-- Private Clan state: never MCP, /api/v1 or any public tool. The rules
-- are in packages/clan-engine (activity.mjs), packages/syndication
-- (clan-sync.mjs) and the public docs (clan-settings.md, "Discord").
-- Locks: new tables only.

create table clan_activity_discord (
  clan_tag        text primary key references clan on delete cascade,
  channel_id      uuid not null unique,
  webhook_sealed  jsonb not null,
  webhook_fp      text not null check (webhook_fp ~ '^[a-f0-9]{16}$'),
  webhook_display text not null,
  enabled         boolean not null default true,
  enabled_at      timestamptz not null default now(),
  synced_to       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  disabled_reason text check (disabled_reason in ('leader', 'webhook_gone')),
  disabled_at     timestamptz,
  categories      jsonb not null default '{}'::jsonb,
  rewrite         boolean not null default false,
  voice           text not null default '' check (length(voice) <= 400),
  set_by          text not null,
  set_by_name     text
);
comment on table clan_activity_discord is
  '0214: the clan''s activity posted to a Discord webhook of its own (Clan Settings, Social). Private Clan state; one row per clan once connected.';
comment on column clan_activity_discord.channel_id is
  '0214: a random id per connected webhook: binds the sealed webhook and names the relay''s records (timeline-discord-state/<channel_id>/).';
comment on column clan_activity_discord.webhook_sealed is
  '0214: the Discord webhook, sealed (AES-256-GCM, bound to channel_id). The sync copies it into the outbox as it is; only the relay opens it.';
comment on column clan_activity_discord.categories is
  '0214: the categories a leader switched ({"members": true, ...}); a category not here takes the clan policy''s default.';
comment on column clan_activity_discord.rewrite is
  '0214: whether the clan''s own model rewrites each line before it is posted (in the voice below). Off, or without a usable key, Elixir''s own line is posted.';
comment on column clan_activity_discord.voice is
  '0214: the leaders'' words for how the posts should sound, at most 400 characters, without links or mentions.';
comment on column clan_activity_discord.set_by is
  '0214: the player tag of the leader or co-leader who last changed it.';

create table clan_activity_discord_told (
  clan_tag   text not null references clan_activity_discord on delete cascade,
  item_id    text not null check (item_id ~ '^tl_[a-f0-9]{20}$'),
  revision   integer not null,
  kind       text not null,
  player_tag text,
  told_at    timestamptz not null default now(),
  primary key (clan_tag, item_id)
);
comment on table clan_activity_discord_told is
  '0214: the clan timeline items posted to the clan''s Discord webhook, at the revision posted. A higher revision later is an edit of the same message.';
create index clan_activity_discord_told_departures
  on clan_activity_discord_told (clan_tag, player_tag, told_at)
  where kind = 'member_left';
