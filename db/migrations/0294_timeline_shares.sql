-- 0294: opaque links for individual public-safe Timeline items.
-- Jamie, 2026-11-17: any member may share a public-safe item they can
-- see, including another person's post. Anonymous reads show that item
-- alone. Previous public links may return 404. No record or post is
-- copied or rewritten: the capability names its canonical source, and
-- reads recheck publication and moderation. No sender or opener is kept.
-- This creates an empty table; existing record tables are unchanged.
set local lock_timeout = '5s';

create table timeline_share (
  share_id text primary key check (share_id ~ '^[a-z2-7]{24}$'),
  item_id text not null unique check (item_id ~ '^tl_[0-9a-f]{20}$'),
  item_kind text not null,
  source text not null check (source in ('game', 'people', 'post', 'battle')),
  subject_kind text check (subject_kind in ('player', 'clan')),
  subject_tag text,
  account_page_id text references account_passport(passport_id) on delete cascade,
  post_id bigint references account_post(post_id) on delete cascade,
  battle_id text references battle(battle_id) on delete cascade,
  anchor_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    (source = 'post' and post_id is not null and battle_id is null and subject_tag is null
      and subject_kind is null and account_page_id is null)
    or (source = 'game' and post_id is null and battle_id is null and subject_kind is not null
      and subject_tag is not null and account_page_id is null)
    or (source = 'people' and post_id is null and battle_id is null and account_page_id is not null
      and subject_kind is null and subject_tag is null)
    or (source = 'battle' and battle_id is not null and post_id is null
      and subject_kind is null and subject_tag is null and account_page_id is null)
  )
);
create index timeline_share_post on timeline_share(post_id) where post_id is not null;
create index timeline_share_battle on timeline_share(battle_id) where battle_id is not null;
create index timeline_share_account_page on timeline_share(account_page_id) where account_page_id is not null;
create index timeline_share_created_at on timeline_share(created_at);
comment on table timeline_share is
  '0294: non-enumerable single-item public capabilities. Canonical sources and current visibility remain authoritative; no rendered snapshot, sender, recipient or opener is stored.';
comment on column timeline_share.share_id is
  '0294: 120 random bits, base32, shared by every member sharing the same item; not a referral or account identifier.';
comment on column timeline_share.anchor_at is
  '0294: canonical story time used to bound a source read; never a client-provided replacement for the source facts.';
