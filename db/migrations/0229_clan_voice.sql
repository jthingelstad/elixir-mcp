-- 0229: the clan's voice becomes one setting the drafts and the Discord editor share.
--
-- Until now only the Discord editor had a voice: clan_activity_discord.voice
-- (0214), the leaders' words for how the clan's Discord posts sound, set
-- on Social > Discord. "Draft in our voice" had none. Jamie, 2026-10-20:
-- "Approved: build the Draft in our voice redesign in elixir-mcp (bug
-- fixes, new prompt, full member record, product calls 1-6 as
-- recommended)". Call 5 is one "how our messages sound" setting that both
-- read, edited by leaders and co-leaders in Settings.
--
-- The setting is a Clan ledger item, voice#<clan> in clan_state, in the
-- clan's partition beside its other settings (social#<clan>). This copies
-- each clan's non-empty editor voice into it as written, marked
-- copied_from '0229' with copied_at. It sets no set_by: the row's set_by
-- is whoever last changed any Discord setting, not necessarily who wrote
-- the voice. An item already there wins (on conflict do nothing), so a
-- re-run copies nothing.
--
-- Expand and contract: from this deploy no code reads or writes
-- clan_activity_discord.voice. The code serving while this commits is the
-- old code, so a voice saved on Social > Discord between this migration
-- and the flip reaches only the old column. The contract migration that
-- drops the column first carries over any row changed after copied_at
-- (as 0170 did), then drops it; dropping it is Jamie's call.
--
-- Locks: reads clan_activity_discord (one row per connected clan) and
-- inserts a few clan_state items; fail fast behind a writer.

set local lock_timeout = '5s';

insert into clan_state (pk, body)
select 'voice#' || d.clan_tag,
       jsonb_build_object(
         'pk', 'voice#' || d.clan_tag,
         'gsi1pk', 'clan#' || d.clan_tag,
         'gsi1sk', 'voice',
         'clan_tag', d.clan_tag,
         'voice', d.voice,
         'copied_from', '0229',
         'copied_at', now()
       )
  from clan_activity_discord d
 where d.voice <> ''
on conflict (pk) do nothing;

comment on column clan_activity_discord.voice is
  '0214: the leaders'' words for how the posts should sound, at most 400 characters, without links or mentions. 0229: copied to the clan''s voice#<clan> item in clan_state, which the drafts and the Discord editor read; no code reads or writes this column now, and a later contract migration drops it.';
