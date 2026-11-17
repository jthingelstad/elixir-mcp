-- 0283: web push, the bell's second channel away from the app.
--
-- Jamie, 2026-11-16: "should we be sending push notifications via the
-- web?" A person turns notifications on per device (Settings ›
-- Notifications); the jobs Lambda writes what to tell them as notices and
-- the relay, the one function with internet, sends each to the person's
-- devices (docs/notes/2026-11-16-web-push.md).
--
-- push_subscription: one row per device. The endpoint is a capability
-- URL (whoever holds it can push to the device, with the keys), so it is
-- private account machinery: it never leaves the account's own reads and
-- the relay, and it goes with the account.
--
-- account_push_pref: one row per (account, kind) only when the person
-- moved that switch; no row is on.
--
-- push_notice: what was told, one row per notice (never per device).
-- `through` is the instant the notice covers activity up to; `opened_at`
-- is set when the person taps it, so the activity mail does not tell it
-- again. Counts and the item's own text only, never who. A notice is
-- 'sending' while `pending` still lists devices whose relay object is not
-- yet written; each run writes those first, so a failed write or a run
-- cut short is retried, and it turns 'sent' once none is left.
--
-- New tables only: nothing existing is locked or rewritten.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table push_subscription (
  subscription_id  bigint generated always as identity primary key,
  account_id       uuid not null references account on delete cascade,
  endpoint         text not null unique
                     check (endpoint ~ '^https://' and length(endpoint) <= 1024),
  p256dh           text not null check (length(p256dh) between 80 and 100),
  auth             text not null check (length(auth) between 16 and 32),
  device_label     text not null default ''
                     check (length(device_label) <= 60),
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz
);
create index push_subscription_account on push_subscription (account_id);

comment on table push_subscription is
  '0283: a device that takes web push for an account. The endpoint is a capability URL: private account machinery, read only by the account and the relay. Gone (404, 410) rows are deleted from the relay''s receipts.';

create table account_push_pref (
  account_id  uuid not null references account on delete cascade,
  kind        text not null
                check (kind in ('cheers', 'followers', 'clan_actions', 'answers')),
  enabled     boolean not null,
  changed_at  timestamptz not null default now(),
  primary key (account_id, kind)
);

comment on table account_push_pref is
  '0283: a push kind a person switched; no row is on.';

create table push_notice (
  notice_id    uuid primary key default gen_random_uuid(),
  account_id   uuid not null references account on delete cascade,
  kind         text not null
                 check (kind in ('cheers', 'followers', 'clan_actions', 'answers')),
  title        text not null check (length(title) <= 120),
  body         text not null default '' check (length(body) <= 200),
  url          text not null check (url ~ '^/' and length(url) <= 300),
  through      timestamptz not null,
  dedupe_key   text unique,
  status       text not null default 'owed'
                 check (status in ('owed', 'sending', 'sent', 'dropped')),
  devices      int not null default 0,
  pending      bigint[] not null default '{}',
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  opened_at    timestamptz
);
create index push_notice_account on push_notice (account_id, created_at desc);
create index push_notice_owed on push_notice (created_at)
  where status in ('owed', 'sending');

comment on table push_notice is
  '0283: one push told to an account (never per device): counts and the item''s own text, never who. through: activity covered up to; opened_at: tapped, so the activity mail does not tell it again. sending: pending lists the devices whose relay object is still to write.';
