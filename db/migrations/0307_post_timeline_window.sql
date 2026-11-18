-- The member Timeline looks up posts by player or author and when the
-- post last changed. An author's own hidden posts are eligible too.
-- Production census: eight estimated live rows, one 8 KiB heap page.
-- Both indexes take a SHARE lock on that page while they build.
set local lock_timeout = '5s';
set local statement_timeout = '15s';

create index account_post_player_visible_changed
  on account_post (player_tag, (coalesce(updated_at, created_at)))
  where status = 'visible';
create index account_post_author_changed
  on account_post (account_id, (coalesce(updated_at, created_at)));
