-- 0223: a feedback item may point at a Discord post (2026-10-11).
--
-- Jamie, 2026-10-11, on the Discord features: "we need to make sure we
-- can judge the quality of those without having any access or
-- visibility to the client discord server." The people who can see the
-- channel can say: the owner of a timeline's cross-post and a clan's
-- leaders rate each post on its delivery history, thumbs up or down with
-- an optional note. A rating is a feedback item like any other (one
-- system, 0204) whose feedback_ref is kind discord_post: the post_id of
-- the quality ledger's row (0222). The page checks the post is the
-- filer's to rate before it is written; no MCP or /api/v1 door files
-- this kind.
--
-- Replacing a CHECK is a drop and an add NOT VALID (0175, 0216); 0224
-- validates. feedback_ref is a few hundred rows. Locks: the table for an
-- instant; fail fast behind a reader.

set local lock_timeout = '5s';

alter table feedback_ref drop constraint feedback_ref_kind_check;
alter table feedback_ref add constraint feedback_ref_kind_check
  check (kind in ('call', 'email', 'feedback', 'player', 'clan', 'clan_action',
                  'award', 'policy', 'discord_post')) not valid;

comment on column feedback_ref.kind is
  'call, email, feedback (checked against the filer), player, clan, clan_action, award, policy (pointers), discord_post (0223: a discord_post row, rated from its delivery history; checked by the page).';
