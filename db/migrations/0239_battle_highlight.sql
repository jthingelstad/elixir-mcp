-- 0239: a player's highlight of one of their battles, and its share link
-- (social slice 4, #762; 2026-11-11).
--
-- Jamie, 2026-11-11: highlighting into the timeline is the default use,
-- and sharing a link shares that timeline post. DECISIONS "A battle has
-- its own page": a player may highlight one of their battles with their
-- own words; the highlight is stored and shows on their timeline as a
-- battle card. "Timeline shape": a highlighted battle is the one
-- single-battle item. "Everyone signs in; shared posts stay public": a
-- post its owner shares opens without an account.
--
-- One row is one highlight: the player, the battle, the words (up to 500
-- characters, as typed: a name or a word is escaped at each output,
-- never in storage), when it was posted and by which account. One per
-- player per battle. The account must hold the player's verified claim
-- when it posts (checked by the web API, not here: a claim can move
-- later and the post stays its writer's). Deleting the row deletes the
-- words; there is no soft delete.
--
-- share_id is null until the owner shares the post; then it is the
-- unguessable id in its link, /h/<share_id>: 15 characters of base32
-- (75 random bits), never sequential, naming only the post ("Invites
-- carry no referral ids": no sender or opener id). Deleting the
-- highlight makes the link a 404.
--
-- A new, empty table. Its foreign keys take a SHARE ROW EXCLUSIVE lock
-- on battle_participant and account for an instant (nothing to
-- validate), which would queue ingest behind a long read: fail fast
-- instead, and let the deploy be retried. The foreign key to
-- battle_participant proves the player played the battle; it cascades so
-- a battle the record ever drops takes its highlight with it. The account
-- foreign key does not cascade: {account_remove} deletes an account's
-- highlights with its other rows.

set local lock_timeout = '5s';

create table battle_highlight (
  highlight_id uuid primary key default gen_random_uuid(),
  player_tag   text not null,
  battle_id    text not null,
  account_id   uuid not null references account,
  words        text not null default ''
               check (char_length(words) <= 500),
  share_id     text unique
               check (share_id ~ '^[a-z2-7]{15}$'),
  shared_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (battle_id, player_tag)
    references battle_participant (battle_id, player_tag) on delete cascade,
  unique (player_tag, battle_id),
  check ((share_id is null) = (shared_at is null))
);

-- The timeline reads a player's highlights posted in a window.
create index battle_highlight_player_time
  on battle_highlight (player_tag, created_at);
-- Removing an account finds its highlights.
create index battle_highlight_account
  on battle_highlight (account_id);
-- The battle page asks for this battle's highlights by the reader's players.
create index battle_highlight_battle
  on battle_highlight (battle_id);

comment on table battle_highlight is
  '0239: a player''s highlight of one of their battles (#762): their words on their timeline, and a share link when the owner shares it. One per player per battle; deleting it deletes the words and makes the link 404.';
comment on column battle_highlight.account_id is
  '0239: the account that posted it, holding the player''s verified claim at the time. Only it edits, shares or deletes the post.';
comment on column battle_highlight.words is
  '0239: the player''s own words, up to 500 characters, stored as typed; escaped at each output, never in storage. Empty when they wrote none.';
comment on column battle_highlight.share_id is
  '0239: the post''s link, /h/<share_id>, once its owner shares it: 15 base32 characters, random, naming only the post. Null: not shared.';
comment on column battle_highlight.shared_at is
  '0239: when the owner first shared the post. Null with share_id.';
comment on column battle_highlight.updated_at is
  '0239: when the words last changed (the post was written or edited).';
