-- 0218: a Discord webhook into a forum channel turns its posting off with
-- a reason of its own (2026-10-11, the Discord delivery plan Jamie
-- approved). A forum takes no plain message, only posts of its own, so
-- every line to a forum channel's webhook was refused with a 400 and the
-- page said only that delivery was failing. The relay now writes `forum`
-- to the status, the sync turns the posting off with webhook_forum, and
-- the page says to use a text channel's webhook or one thread's
-- (?thread_id=). Both checks gain the value: timeline_discord (an
-- account's cross-post) and clan_activity_discord (a clan's activity
-- channel). Actions in Discord keep their webhook in Clan's ledger and
-- post one forum post per Action instead.
--
-- Replacing a CHECK is a drop and an add NOT VALID (0175, 0216); 0219
-- validates. Each table holds a handful of rows, but the shape holds
-- whatever the size. Locks: both tables for an instant; fail fast behind
-- a reader.

set local lock_timeout = '5s';

alter table timeline_discord drop constraint timeline_discord_disabled_reason_check;
alter table timeline_discord add constraint timeline_discord_disabled_reason_check
  check (disabled_reason in ('owner', 'webhook_gone', 'webhook_forum')) not valid;

alter table clan_activity_discord drop constraint clan_activity_discord_disabled_reason_check;
alter table clan_activity_discord add constraint clan_activity_discord_disabled_reason_check
  check (disabled_reason in ('leader', 'webhook_gone', 'webhook_forum')) not valid;

comment on column timeline_discord.disabled_reason is
  'Why it is off: owner (turned off in the console), webhook_gone (Discord answered that the webhook no longer exists) or webhook_forum (0218: the webhook posts to a forum channel, which takes no plain message). Null while on.';
comment on column clan_activity_discord.disabled_reason is
  'Why it is off: leader (switched off in Clan settings), webhook_gone (Discord answered that the webhook no longer exists) or webhook_forum (0218: the webhook posts to a forum channel, which takes no plain message). Null while on.';
