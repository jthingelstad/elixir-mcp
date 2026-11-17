-- 0292: a post may carry a battle, and every highlight becomes one.
--
-- Jamie, 2026-11-17: "now that we have added posting we should refactor
-- highlighting a battle to really just be a post with a battle
-- attached." One thing, a post, and not two (docs/notes/
-- 2026-11-17-battle-posts.md). A post about a battle is what a highlight
-- was: one per player per battle, written as a Verified player who
-- played it, words optional, editable, shareable as /h/<share id> and
-- postable once in its player's clan's Discord. A battle excludes a deck
-- or cards: the battle already carries both decks.
--
-- account_post gains the battle (battle_id, its foreign key with the
-- post's player proving the player played it, cascading as the
-- highlight's did so a battle the record drops takes its post), the
-- share link (share_id, shared_at), the clan Discord stamp
-- (clan_discord_at, clan_discord_clan), and the edit count (revision,
-- updated_at). Words may be empty only on a post with a battle, as a
-- highlight's could be. comment_check.kind gains 'battle_post', so the
-- words of a battle post have their own limits (posts.mjs).
--
-- Every battle_highlight row is copied into account_post (migrate, not
-- grandfather): its author, player, battle, words, times, revision,
-- share link and Discord stamp. Its item id is the one the timeline
-- served for it, storyId('battle_highlight', highlight_id) in
-- @elixir-mcp/tools (the first 20 hex characters of the sha256 of
-- "battle_highlight|<uuid>"), so every cheer, comment, Discord line and
-- told row keyed by that id still names it. A highlight's words never
-- passed a check; they are reportable from here as any post's are.
--
-- The code serving while this commits is the old code, which still
-- writes battle_highlight: a trigger refuses its inserts and updates from
-- here, so nothing written in the minutes before the flip is lost (the
-- write fails and is made again after it). A delete goes through and
-- takes the post the row became with it, so a highlight deleted in those
-- minutes, a person removed, or a battle the record drops (by cascade)
-- leaves no post behind; and a post's own delete takes its frozen row
-- (below). The table is dropped by the contract migration
-- in a later deploy, once no deployed code reads it.
--
-- account_post is a day old and battle_highlight a week old, both small
-- (hundreds of rows): the copy, the checks and the foreign key read
-- them in milliseconds. The foreign key takes SHARE ROW EXCLUSIVE on
-- battle_participant for that instant: fail fast rather than queue
-- ingest behind a long read, and let the deploy be retried.
-- vacuum after: account_post

set local lock_timeout = '5s';

alter table account_post
  add column battle_id         text,
  add column share_id          text unique
                               check (share_id ~ '^[a-z2-7]{15}$'),
  add column shared_at         timestamptz,
  add column clan_discord_at   timestamptz,
  add column clan_discord_clan text,
  add column revision          integer not null default 1,
  add column updated_at        timestamptz;

alter table account_post drop constraint account_post_body_check;
alter table account_post
  add constraint account_post_body_check
    check (char_length(body) <= 500
           and (char_length(body) >= 1 or battle_id is not null)),
  add constraint account_post_battle_alone
    check (battle_id is null or (deck is null and cardinality(cards) = 0)),
  add constraint account_post_share_battle
    check ((share_id is null) = (shared_at is null)
           and (share_id is null or battle_id is not null)),
  add constraint account_post_battle_fkey
    foreign key (battle_id, player_tag)
    references battle_participant (battle_id, player_tag) on delete cascade;

-- One post per player per battle, as one highlight was.
create unique index account_post_player_battle
  on account_post (player_tag, battle_id) where battle_id is not null;
-- The battle page asks for this battle's posts.
create index account_post_battle
  on account_post (battle_id) where battle_id is not null;
-- The timeline's observed window: a player's battle posts by when their
-- words last changed.
create index account_post_player_changed
  on account_post (player_tag, (coalesce(updated_at, created_at)))
  where battle_id is not null;

insert into account_post
  (item_id, account_id, player_tag, body, battle_id, share_id, shared_at,
   clan_discord_at, clan_discord_clan, revision, created_at, updated_at)
select 'tl_' || substr(encode(sha256(convert_to(
          'battle_highlight|' || h.highlight_id::text, 'UTF8')), 'hex'), 1, 20),
       h.account_id, h.player_tag, h.words, h.battle_id, h.share_id,
       h.shared_at, h.clan_discord_at, h.clan_discord_clan, h.revision,
       h.created_at, h.updated_at
  from battle_highlight h
 order by h.created_at, h.highlight_id;

alter table comment_check drop constraint comment_check_kind_check;
alter table comment_check
  add constraint comment_check_kind_check
    check (kind in ('comment', 'post', 'battle_post'));

create function battle_highlight_moved() returns trigger
language plpgsql as $$
begin
  -- A delete takes the post this row became (its item id, as copied
  -- above): the old code's delete, an account's removal, or a battle's
  -- cascade, which takes the post by its own foreign key as well.
  if tg_op = 'DELETE' then
    delete from account_post
     where item_id = 'tl_' || substr(encode(sha256(convert_to(
             'battle_highlight|' || old.highlight_id::text, 'UTF8')), 'hex'),
             1, 20);
    return old;
  end if;
  raise exception 'battle_highlight moved to account_post (0292)'
    using errcode = 'read_only_sql_transaction';
end $$;

create trigger battle_highlight_moved
  before insert or update or delete on battle_highlight
  for each row execute function battle_highlight_moved();

-- And the other way: a post about a battle that was a highlight takes the
-- frozen row with it when it goes (its author's delete, the purge of a
-- removed one, retention), so the words never outlive the post (Codex on
-- #1117). Only on a delete made directly (trigger depth 1): one the frozen
-- row's own trigger makes is already taking that row, and a battle's
-- cascade takes the frozen row by its own foreign key.
create function account_post_battle_gone() returns trigger
language plpgsql as $$
begin
  delete from battle_highlight
   where battle_id = old.battle_id
     and player_tag = old.player_tag
     and 'tl_' || substr(encode(sha256(convert_to(
           'battle_highlight|' || highlight_id::text, 'UTF8')), 'hex'), 1, 20)
         = old.item_id;
  return old;
end $$;

create trigger account_post_battle_gone
  after delete on account_post
  for each row when (old.battle_id is not null and pg_trigger_depth() < 1)
  execute function account_post_battle_gone();

comment on column account_post.battle_id is
  '0292: the battle the post is about, played by its player (the foreign key proves it); null for a post about nothing in the record. One per player per battle.';
comment on column account_post.share_id is
  '0292: the post''s public link, /h/<share_id>, once its author shares it (a post with a battle only): 15 base32 characters, random. Null: not shared.';
comment on column account_post.shared_at is
  '0292: when the author first shared the post. Null with share_id.';
comment on column account_post.clan_discord_at is
  '0292: when its author posted this shared battle post in its player''s clan''s Discord; null until then. Once only.';
comment on column account_post.clan_discord_clan is
  '0292: the clan whose Discord it was posted in, as clan_discord_at says.';
comment on column account_post.revision is
  '0292: how many times the words were written: 1 when posted, one more for each edit that changed them. The timeline item''s revision.';
comment on column account_post.updated_at is
  '0292: when the words last changed by an edit; null when never edited (created_at stands).';
