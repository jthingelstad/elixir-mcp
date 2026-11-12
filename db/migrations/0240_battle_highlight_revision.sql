-- 0240: a highlight's revision, and its index by when its words last changed.
--
-- Codex review of #773 (social slice 4, #762; 2026-11-11): editing a
-- highlight's words moved only updated_at, but the timeline selected it
-- by created_at and served it at revision 1 for ever. A reader polling by
-- observation never saw the correction, and a timeline cross-posted to
-- Discord kept the first words, since the sync edits a message only at a
-- higher revision. From here an edit that changes the words counts up
-- `revision` (the web API's update stamps it with updated_at), the
-- timeline serves the item at that revision under the same id and
-- posting time, and an observed window selects it by updated_at, which is
-- when the record last learned it (as a crossing's late proof moves its
-- observed column).
--
-- Every existing row is revision 1, so a constant default suffices:
-- catalog-only, nothing rewritten. The index replaces no other: the
-- created_at one still serves a read by when a post was made (basis
-- occurred). battle_highlight is a day old and holds a handful of rows,
-- so the index builds in the ladder; fail fast behind a writer.
set local lock_timeout = '5s';

alter table battle_highlight
  add column revision integer not null default 1;

create index battle_highlight_player_updated
  on battle_highlight (player_tag, updated_at);

comment on column battle_highlight.revision is
  '0240: how many times the words were written: 1 when posted, one more for each edit that changed them. The timeline item''s revision; its id and posting time stay.';
comment on index battle_highlight_player_updated is
  '0240: a player''s highlights by when their words last changed, for the timeline''s observed window.';
