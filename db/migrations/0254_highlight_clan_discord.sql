-- 0254: when a shared highlight was posted in its player's clan's Discord.
--
-- Social slice 9 (#767), its Discord half. Jamie, 2026-11-12: "a shared
-- post can post to the clan's Discord through Clan's webhook". The owner
-- of a shared highlight posts it, by its own act, to the activity channel
-- of the clan its player is in, when that clan's leaders have turned
-- shared highlights on. A highlight is posted there once: these columns
-- say when and to which clan, so a second press sends nothing and the
-- battle page says it is done. The message itself goes through the
-- relay as every clan activity post does (its row in discord_post).
--
-- Two nullable columns with no default: catalog-only, nothing rewritten.
-- battle_highlight is two days old and small; fail fast behind a writer.
set local lock_timeout = '5s';

alter table battle_highlight
  add column clan_discord_at timestamptz,
  add column clan_discord_clan text;

comment on column battle_highlight.clan_discord_at is
  '0254: when its owner posted this shared highlight in its player''s clan''s Discord (the clan''s activity channel); null until then. Once only.';
comment on column battle_highlight.clan_discord_clan is
  '0254: the clan whose Discord it was posted in, as clan_discord_at says.';
