-- 0244: the bell's seen marker, one per account (2026-11-12).
--
-- Jamie, 2026-11-12: "Approved: build the remaining canvas pieces (bell,
-- cheers on battle and player pages, Home side panel, Find, You with
-- Stats, Clan Members follow-all and map, signed-out shell, Settings
-- slots)". The design canvas's bell holds reactions to your items, new
-- followers, actions waiting (leaders) and answers to your feedback.
-- Structure, "Rulings that stand": the seen marker is the account's own,
-- independent of any agent's reader.
--
-- bell_seen: when the account last opened the bell. A reaction or a
-- follower after it is new, and lights the dot; opening the bell moves it
-- to now. One row per account, written only by the account's own session
-- (agents never open a bell). No row means the account has never opened
-- it. Feedback answers keep their own seen marker (feedback.
-- response_seen_at), which opening the answer sets.
--
-- A new, empty table. Its foreign key takes a SHARE ROW EXCLUSIVE lock on
-- account for an instant (nothing to validate): fail fast rather than
-- queue sign-ins behind a long read, and let the deploy be retried. The
-- foreign key does not cascade: {account_remove} deletes the row with the
-- account's others.

set local lock_timeout = '5s';

create table bell_seen (
  account_id uuid primary key references account,
  seen_at    timestamptz not null default now()
);

comment on table bell_seen is
  '0244: when the account last opened the bell (2026-11-12). Reactions and followers after it are new; opening the bell moves it to now.';
