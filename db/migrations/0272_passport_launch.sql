-- 0272: The passport's launch line, one row, and a column on
-- account_passport (2026-11-14, #1015).
--
-- Stamps are earned from the deploy that applies this migration on: the
-- hooks and the owner's reconciliation shipped with it. An account that
-- existed before then has history (a verified player, a picture, follows,
-- highlights, friendlies) that the first hook or reconciliation would
-- otherwise grant as ordinary Stamps, each a "New Stamp" line in the bell
-- for something done months ago. The spec (docs/plans/stamps-build.md,
-- Backfill) wants those marked "Earned before <launch day>" and no bell
-- flood (docs/notes/2026-11-14-passport-backfill.md).
--
-- passport_launch.launched_at: the instant the earning code went live,
-- written by this migration as the deploy applies it (the deploy migrates
-- before it flips, so no earning code runs before this row exists). A
-- level whose evidence predates it is a legacy grant (0269's
-- legacy_before, legacy_source_to), never a bell notice, whichever runs
-- first: the account's first hook, its reconciliation, or the operator's
-- {passport_backfill}. One row, by the only_row check.
--
-- account_passport.legacy_settled_at: when the account's setup Stamps were
-- settled as they stood at launch. Null means not yet: the next settle
-- does it first. Only accounts made before launch ever need it.
--
-- A new one-row table and a nullable column with no default on a small
-- table: catalog-only. The ALTER takes an ACCESS EXCLUSIVE lock on
-- account_passport for an instant: fail fast rather than queue passport
-- reads behind it.

set local lock_timeout = '5s';

create table passport_launch (
  only_row     boolean primary key default true check (only_row),
  launched_at  timestamptz not null default now()
);

insert into passport_launch default values;

comment on table passport_launch is
  '0272: one row, the instant the passport''s earning went live (the deploy that applied 0272). A Stamp level whose evidence predates it is a legacy grant, never a bell notice.';

alter table account_passport add column legacy_settled_at timestamptz;

comment on column account_passport.legacy_settled_at is
  '0272: when the account''s setup Stamps were settled as they stood at launch (legacy grants). Null means not yet; accounts made after launch never need it.';
