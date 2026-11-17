-- 0285: posts a person writes, and their reports (2026-11-17).
--
-- Jamie, 2026-11-17: "now that we have commenting and a moderation
-- capability it feels like a player could start a new post with just
-- text. Like a question they are asking? ... A variant would be a
-- question and they paste a deck link from the game and elixir
-- understands the deck link and renders the cards as a deck in the post.
-- In general a player could attach cards to a post."
-- (docs/notes/2026-11-17-posts.md)
--
-- account_post: one short, plain-text post by a person, as one of their
-- Verified players (player_tag, the primary one when they wrote it). It
-- is a timeline item of its own: item_id is a `tl_` id like a story's,
-- random rather than derived, so cheers and comments name it the way
-- they name any item. question marks it as a question. deck is a deck
-- read from the game's deck link, `{"cards": [8 ids], "tower_troop": id
-- or null}`, its ids checked against the card catalog; cards is up to
-- eight loose card ids, checked the same way. A post carries a deck or
-- cards, never both, and never a link: the deck link itself is not kept.
-- status: visible; hidden (reported by two or more accounts, waiting for
-- an admin); removed (by an admin, kept for admins until the sweep
-- deletes the row 30 days after removed_at). The author deleting their
-- own post deletes the row.
--
-- post_report: one account's report of one post, as comment_report is
-- for a comment. It goes with its post.
--
-- comment_check.kind: the check before a post is a comment_check row
-- too (the one spend cap, the one admin queue of refusals, the one
-- 35-day sweep); kind says which it was, so each has its own rate
-- limits. The column's default is a constant, so adding it rewrites
-- nothing; the check constraint reads the small table (35 days of
-- checks) once.
-- vacuum after: comment_check
--
-- New, empty tables. Their foreign keys take a SHARE ROW EXCLUSIVE lock
-- on account for an instant: fail fast rather than queue sign-ins behind
-- a long read. Account removal leaves a tombstone, which fires no
-- cascade, so {account_remove} deletes these rows by name.

set local lock_timeout = '5s';

create table account_post (
  post_id     bigint generated always as identity primary key,
  item_id     text not null unique check (item_id ~ '^tl_[0-9a-f]{20}$'),
  account_id  uuid not null references account,
  player_tag  text not null,
  body        text not null check (char_length(body) between 1 and 500),
  question    boolean not null default false,
  deck        jsonb check (deck is null or (jsonb_typeof(deck) = 'object'
                and jsonb_array_length(deck -> 'cards') = 8)),
  cards       integer[] not null default '{}'
              check (cardinality(cards) <= 8),
  status      text not null default 'visible'
              check (status in ('visible', 'hidden', 'removed')),
  removed_by  text check (removed_by in ('admin')),
  removed_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (deck is null or cardinality(cards) = 0),
  check ((status = 'removed') = (removed_at is not null)));

create index account_post_player
  on account_post (player_tag, created_at desc) where status = 'visible';
create index account_post_author on account_post (account_id, created_at desc);
create index account_post_queue
  on account_post (status, created_at) where status <> 'visible';

comment on table account_post is
  'A person''s short post (or question) with an optional deck or cards from the catalog (0285).';

create table post_report (
  post_id     bigint not null references account_post on delete cascade,
  account_id  uuid not null references account,
  reason      text not null
              check (reason in ('bullying', 'sexual', 'hate', 'threat',
                                'self_harm', 'spam', 'personal_info', 'other')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolution  text check (resolution in ('removed', 'dismissed')),
  primary key (post_id, account_id));

create index post_report_open
  on post_report (created_at) where resolved_at is null;
create index post_report_account on post_report (account_id);

comment on table post_report is
  'One account''s report of one post, for the admin queue (0285).';

alter table comment_check
  add column kind text not null default 'comment'
  check (kind in ('comment', 'post'));

create index comment_check_kind
  on comment_check (account_id, kind, created_at desc);
