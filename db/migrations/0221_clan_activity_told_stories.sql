-- 0221: a clan's activity channel tells stories, not lines (Jamie,
-- 2026-10-11: "it can't just be syndication of the timeline ... it can
-- either use AI or it can use some code to figure out a better way to
-- frame up what's happening"). The sync now groups the clan's timeline
-- into stories (one member and one battle; same-kind milestones across
-- members; a sitting), holds each a few minutes, skips some by rule, and
-- edits a story in place only when it truly grows. Each told row now
-- says which story it went into and what that story last told:
--   story_key:   the story (its first item's id) this item was told in;
--                null on rows told before 0221, each its own story.
--   battle_id:   the battle the item names (a promotion, a crossing):
--                a later item about the same member's same battle is
--                already told.
--   told_value:  what the item reached (an arena, a league, a band):
--                the same member reaching the same one again within a
--                week is already told.
--   digest:      what the story's post last said, as its notable facts
--                (a sitting's best win and run): a story whose digest
--                does not change only grew, and is not edited.
--   skipped:     the item was never posted, by a rule; skip_reason says
--                which, and a story's growth skipped is recorded once.
-- What the rules are lives in packages/clan-engine/src/stories.mjs and
-- the public docs (clan-policy.md, "The clan's activity in Discord").
--
-- Nullable columns and a constant default: catalog-only. The table
-- holds a few rows per clan (31 days). Locks:
-- clan_activity_discord_told for an instant; fail fast behind a reader.

set local lock_timeout = '5s';

alter table clan_activity_discord_told
  add column story_key text,
  add column battle_id text,
  add column told_value text,
  add column digest text,
  add column skipped boolean not null default false,
  add column skip_reason text;

comment on column clan_activity_discord_told.story_key is
  'The story this item was told in (its first item''s id, the post''s key), 0221. Null on rows told before 0221: each was its own post.';
comment on column clan_activity_discord_told.battle_id is
  'The battle the item names (a promotion''s, a crossing''s), 0221: a later item about the same member''s same battle is already told.';
comment on column clan_activity_discord_told.told_value is
  'What the item reached (an arena, a league, a trophy band, a badge level), 0221: the same member reaching the same one again within a week is already told.';
comment on column clan_activity_discord_told.digest is
  'The notable facts the story''s post last told, 0221 (a sitting''s best win and run): a story whose digest is unchanged only grew and is not edited.';
comment on column clan_activity_discord_told.skipped is
  'The item was never posted, by one of the channel''s rules (skip_reason), 0221.';
comment on column clan_activity_discord_told.skip_reason is
  'The last rule that skipped this item or its story''s growth, 0221: a skip is recorded in the delivery history once per reason.';
