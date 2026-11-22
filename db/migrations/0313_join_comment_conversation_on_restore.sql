-- 0313: a comment made visible again joins its conversation then
-- (2026-11-22).
--
-- 0303's join_comment_conversation trigger, which 0312 taught to join the
-- item's owner, fires on insert only and only for a visible comment. A
-- comment hidden by reports and later restored (comments.mjs
-- dismissReports) therefore joined nobody: before 0312 its owner never
-- joined, and the bell (which counts a comment with no owner
-- conversation as unread) would show it new for good, since a thread read
-- records nothing without a conversation row. Codex, on #1183.
--
-- The same function now also runs when a comment's status becomes
-- visible: the author joins at their comment, and the owner (someone
-- else's receipt-allowed comment) one microsecond before it, as at insert.
-- Existing rows are unchanged; creating the trigger takes a brief lock on
-- timeline_comment (a few dozen rows), bounded by lock_timeout.

set local lock_timeout = '5s';

create trigger join_comment_conversation_restored
  after update of status on timeline_comment
  for each row
  when (old.status is distinct from 'visible' and new.status = 'visible')
  execute function join_comment_conversation();
