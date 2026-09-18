-- 0137: product email (docs/EMAIL.md, ratified 2026-09-18). Three
-- tables, all additive, all empty at birth.
--
-- account_email_pref: one row per (account, kind) ONLY when a person
-- has changed the default. Absent means ON: every kind defaults on
-- (the 0051 beta stance), so no backfill and no row for the common
-- case. `via` says who flipped it: the account page, the one-click
-- header, an ops op.
--
-- email_issue / email_send: the ledger that makes a run idempotent. An
-- issue is one composed thing: a clan's week (subject_key = clan tag),
-- an account's week (subject_key = account id), the one Top 100 issue
-- for everyone (subject_key ''), an account's milestone bundle for a
-- day. A send row is written AFTER the enqueue succeeds (elixir-bot's
-- 2026-08-03 double send: record after, never before), so a re-run
-- sends only what the ledger lacks.
--
-- email_milestone: which moments have already been congratulated, keyed
-- by the moment's own identity, so a re-poll of the same arena never
-- mails twice and a season's re-climb is told apart from a first.

create table account_email_pref (
  account_id  uuid not null references account on delete cascade,
  kind        text not null check (kind ~ '^[a-z_]{3,32}$'),
  enabled     boolean not null,
  changed_at  timestamptz not null default now(),
  via         text not null check (via in ('profile', 'one_click', 'ops')),
  primary key (account_id, kind)
);
comment on table account_email_pref is
  'A person''s switch for one product email kind; absent means on (docs/EMAIL.md).';

create table email_issue (
  issue_id     bigserial primary key,
  kind         text not null check (kind ~ '^[a-z_]{3,32}$'),
  period_key   text not null,
  subject_key  text not null default '',
  status       text not null default 'composed'
               check (status in ('composed', 'queued', 'skipped', 'failed')),
  facts        jsonb,
  subject_line text,
  note         text,
  composed_at  timestamptz not null default now(),
  unique (kind, period_key, subject_key)
);
comment on table email_issue is
  'One composed product email: the facts it was rendered from and its outcome. Sends hang off it.';

create table email_send (
  issue_id     bigint not null references email_issue on delete cascade,
  account_id   uuid not null references account on delete cascade,
  enqueued_at  timestamptz not null default now(),
  primary key (issue_id, account_id)
);
create index email_send_account on email_send (account_id, enqueued_at desc);

create table email_milestone (
  account_id   uuid not null references account on delete cascade,
  subject_tag  text not null,
  kind         text not null,
  moment_key   text not null,
  sent_at      timestamptz not null default now(),
  primary key (account_id, subject_tag, kind, moment_key)
);
comment on table email_milestone is
  'Moments already congratulated by mail, by the moment''s own identity (arena id, league, band, badge...).';
