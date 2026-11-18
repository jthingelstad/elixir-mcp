-- 0297: an author can mark a question answered, reversibly (Jamie and
-- Codex, 2026-11-17). Null means unanswered; replies stay open. The
-- writer treats state changes as edits (revision/updated_at), while
-- preserving words, creation time and display order.
-- account_post: 1 page, estimated 8 live rows, 8 KiB heap in the production
-- read-only tables preflight (2026-11-18). The nullable column is catalog-only.
-- timeline_comment: 4 estimated rows, 8 KiB heap. Correct only owner stamps
-- proven different by the canonical post. No IDs, words, dates, status or
-- settings change. The trigger normalizes old-Lambda writes between this
-- migration and cutover too; game-item ownership stays as it was.
-- vacuum after: timeline_comment
set local lock_timeout = '5s';
alter table account_post add column answered_at timestamptz;
comment on column account_post.answered_at is
  'When its author last marked this question answered (0297); null means unanswered. Replies stay open.';
comment on column account_post.revision is
  '0297: 1 when posted, one more when authored words or question answer state change. No-op writes and replies leave it unchanged. The timeline item''s revision.';
comment on column account_post.updated_at is
  '0297: when authored words or question answer state last changed; null before the first edit. No-op writes and replies leave it unchanged.';

create function timeline_comment_post_owner() returns trigger language plpgsql as $$
declare post_author uuid;
begin
  select account_id into post_author from account_post where item_id = new.item_id;
  if found then new.owner_account_id := post_author; end if;
  return new;
end;
$$;
create trigger timeline_comment_post_owner
  before insert or update of item_id, owner_account_id on timeline_comment
  for each row execute function timeline_comment_post_owner();

update timeline_comment tc set owner_account_id = p.account_id
  from account_post p where p.item_id = tc.item_id
    and tc.owner_account_id is distinct from p.account_id;
