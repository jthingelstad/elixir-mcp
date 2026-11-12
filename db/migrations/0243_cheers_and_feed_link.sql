-- 0243: cheers on timeline items, and the private RSS link to your own
-- timeline (social slice 7, #765; 2026-11-12).
--
-- Jamie, 2026-11-12, asked "Slice 7, Home: one feed with chips Everyone,
-- Friends, Clan and You, session sparklines, a new top bar and phone tabs
-- (Home, Find, Clan, You, bell) replacing Home's three tabs, and
-- reactions. Which reactions?", answered "Yes, six cheers (Recommended)".
-- DECISIONS "Reactions, not comments": a signed-in person reacts to a
-- timeline item with one of a fixed set; there are no comments.
-- "Your timeline is an RSS feed": one feed per person, their own
-- timeline, read through a private token link.
--
-- timeline_cheer: one row is one person's cheer on one timeline item,
-- one per person per item; cheering again changes it, and taking it back
-- deletes the row. item_id is the timeline's story id ("tl_" and 20 hex,
-- entries.mjs storyId), which names the happening and never the reader,
-- so every reader of an item counts the same cheers. The web API checks
-- the item is in the person's own feed before it stores a cheer; nothing
-- here can. Readers see counts only, never who; the person sees their
-- own. Agents never cheer.
--
-- timeline_feed_link: an account's one RSS link, holding only the token's
-- SHA-256 (64 hex); the token itself is shown once, when the link is made
-- or reset, and never stored. Resetting replaces the hash, so the old
-- link stops at once; turning the link off deletes the row.
--
-- New, empty tables. Their foreign keys take a SHARE ROW EXCLUSIVE lock on
-- account for an instant (nothing to validate): fail fast rather than
-- queue sign-ins behind a long read, and let the deploy be retried. The
-- account foreign keys do not cascade: {account_remove} deletes both
-- tables' rows with the account's others.

set local lock_timeout = '5s';

create table timeline_cheer (
  account_id uuid not null references account,
  item_id    text not null check (item_id ~ '^tl_[0-9a-f]{20}$'),
  cheer      text not null
             check (cheer in ('well_played', 'on_fire', 'royal', 'wow', 'ha', 'grind')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, item_id)
);

-- The feed counts an item's cheers by id.
create index timeline_cheer_item on timeline_cheer (item_id);

comment on table timeline_cheer is
  '0243: one person''s cheer on one timeline item (#765): one per person per item, changed or taken back by cheering again. Counted per item; who cheered is never shown to anyone else.';
comment on column timeline_cheer.item_id is
  '0243: the timeline''s story id (tl_ and 20 hex), the same for every reader of the item.';
comment on column timeline_cheer.cheer is
  '0243: one of the six cheers: well_played, on_fire, royal, wow, ha, grind.';

create table timeline_feed_link (
  account_id uuid primary key references account,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

comment on table timeline_feed_link is
  '0243: an account''s private RSS link to its own timeline (#765). Only the token''s SHA-256 is kept; the token is shown once. Reset replaces it; off deletes the row.';
comment on column timeline_feed_link.created_at is
  '0243: when this link was made or last reset.';
