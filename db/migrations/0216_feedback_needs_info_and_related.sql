-- 0216: a maintainer's question back to the filer, and a filer's link
-- between their own items (11.10.0, feedback #378 items 3 and 6).
--
-- status gains needs_info: the answer is a question, and the filer
-- replies with follows_id. It is an answer like any other (responded_at,
-- feedback_responses_pending, the answer mail), so nothing else moves.
--
-- feedback_ref gains kind feedback: a feedback_id of the filer's own that
-- this item belongs with (four facets of one review, say), checked against
-- the filer when written. follows_id stays the reply.
--
-- Replacing a CHECK is a drop and an add NOT VALID (0175); 0217 validates.
-- feedback is about 380 rows and feedback_ref a few hundred, but the shape
-- holds whatever the size. Locks: both tables for an instant; fail fast
-- behind a reader.

set local lock_timeout = '5s';

alter table feedback drop constraint feedback_status_check;
alter table feedback add constraint feedback_status_check
  check (status in ('new', 'seen', 'planned', 'needs_info', 'done', 'declined')) not valid;

alter table feedback_ref drop constraint feedback_ref_kind_check;
alter table feedback_ref add constraint feedback_ref_kind_check
  check (kind in ('call', 'email', 'feedback', 'player', 'clan', 'clan_action', 'award', 'policy')) not valid;

comment on column feedback.status is
  'new (the filing''s own), seen, planned, needs_info (0216: the answer is a question; the filer replies with follows_id), done, declined.';
