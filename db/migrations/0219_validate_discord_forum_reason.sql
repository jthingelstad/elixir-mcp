-- 0219: validate 0218's widened disabled_reason checks on
-- timeline_discord and clan_activity_discord without the drop-and-add
-- lock. No row changes (0217 is the precedent).
set local lock_timeout = '5s';
alter table timeline_discord validate constraint timeline_discord_disabled_reason_check;
alter table clan_activity_discord validate constraint clan_activity_discord_disabled_reason_check;
