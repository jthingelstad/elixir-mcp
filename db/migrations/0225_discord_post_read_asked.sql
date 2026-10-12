-- 0225: a Discord post is asked to be read back once (2026-10-11).
--
-- The read-back (0222) reads each post about a day after it was posted,
-- riding the next delivery to its webhook. A post stayed a candidate
-- until the read's answer came back as a receipt, so two deliveries
-- queued before that answer both asked for it: two reads of one message,
-- where the privacy page promises one (Codex on #513). read_asked_at is
-- set as the candidate is taken, in the delivery's own transaction, and
-- a post asked once is never asked again, answered or not: a read never
-- retries.
--
-- A nullable column with no default. Locks: discord_post for an instant;
-- fail fast behind a reader.

set local lock_timeout = '5s';

alter table discord_post add column read_asked_at timestamptz;

comment on column discord_post.read_asked_at is
  '0225: when a delivery took the post to read back. Set once; a post asked is never asked again, whatever the answer.';
