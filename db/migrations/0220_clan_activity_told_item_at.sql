-- 0220: each post a clan's activity channel told keeps when its item
-- happened (2026-10-11, the clan-model context plan Jamie approved).
-- A leader's word on a departure ("was removed", "left on their own")
-- edits the departure's own post. It was found by the player's tag
-- alone, latest first, so a member who left twice inside the told rows'
-- 31 days could have the later departure's post relabelled by a word
-- about the earlier one (Codex review on #411). The sync now matches the
-- departure nearest the word's left_at (or the word itself, for a
-- removal), within a day, by item_at. Rows told before this have no
-- item_at; one of them is used only when it is the player's only
-- departure on record.
--
-- Nullable, no default: catalog-only. The table holds a few rows per
-- clan. Locks: clan_activity_discord_told for an instant; fail fast
-- behind a reader.

set local lock_timeout = '5s';

alter table clan_activity_discord_told add column item_at timestamptz;

comment on column clan_activity_discord_told.item_at is
  'When the told item happened (its timeline at), 0220: a leader''s word on a departure edits the departure nearest it in time. Null on rows told before 0220.';
