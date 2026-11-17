-- 0281: comments on timeline items, the check before each, blocks and
-- reports (2026-11-16).
--
-- Jamie, 2026-11-16: "I'm open to comments and I think we could use Haiku
-- or something similar to review every comment before it is submitted to
-- avoid moderation issues. I feel like comments may need to come in… but
-- if we do that we need Block capabilities." DECISIONS "Comments, checked
-- before they post" supersedes "Reactions, not comments".
--
-- timeline_comment: one short, plain-text comment on one timeline item
-- (the story id, as a cheer names it) about a player whose owner is a
-- verified account. owner_account_id is that owner when the comment was
-- written: the account whose comment setting allowed it, and who may
-- remove it. status: visible; hidden (reported by two or more accounts,
-- waiting for an admin); removed (by the owner or an admin, its words
-- kept for admins only until the sweep deletes the row 30 days after
-- removed_at). An author deleting their own comment deletes the row.
--
-- comment_report: one account's report of one comment, with a short
-- reason. It goes with its comment. Never shown to the reported person.
--
-- comment_check: the log of every check before a comment (allow, refuse,
-- error or paused), with its model spend: the month's spend cap, the
-- per-account rate limits and the refusal cooldown all count these rows.
-- body is kept only on a refusal, for the admin queue; the sweep deletes
-- every row after 35 days, so a refusal's words last no longer.
--
-- account_block: account_id blocks blocked_account_id. Private: read by
-- the server's filters and by the blocker's own Settings, never shown to
-- anyone else and never over MCP.
--
-- comment_setting: who may comment on an account's play (followers, the
-- default with no row; following; nobody), and an admin's suspension of
-- the account's own commenting.
--
-- New, empty tables. Their foreign keys take a SHARE ROW EXCLUSIVE lock
-- on account for an instant (nothing to validate): fail fast rather than
-- queue sign-ins behind a long read. Account removal leaves a tombstone,
-- which fires no cascade, so {account_remove} deletes these rows by name;
-- the cascades below serve the comment's own children.

set local lock_timeout = '5s';

create table timeline_comment (
  comment_id       bigint generated always as identity primary key,
  item_id          text not null check (item_id ~ '^tl_[0-9a-f]{20}$'),
  account_id       uuid not null references account,
  subject_tag      text not null,
  owner_account_id uuid not null references account,
  body             text not null check (char_length(body) between 1 and 280),
  status           text not null default 'visible'
                   check (status in ('visible', 'hidden', 'removed')),
  removed_by       text check (removed_by in ('owner', 'admin')),
  removed_at       timestamptz,
  created_at       timestamptz not null default now(),
  check ((status = 'removed') = (removed_at is not null)));

create index timeline_comment_item
  on timeline_comment (item_id, created_at desc) where status = 'visible';
create index timeline_comment_author on timeline_comment (account_id);
create index timeline_comment_owner
  on timeline_comment (owner_account_id, created_at desc);
create index timeline_comment_queue
  on timeline_comment (status, created_at) where status <> 'visible';

comment on table timeline_comment is
  'A person''s short comment on a timeline item about a verified player (0281).';

create table comment_report (
  comment_id  bigint not null references timeline_comment on delete cascade,
  account_id  uuid not null references account,
  reason      text not null
              check (reason in ('bullying', 'sexual', 'hate', 'threat',
                                'self_harm', 'spam', 'personal_info', 'other')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolution  text check (resolution in ('removed', 'dismissed')),
  primary key (comment_id, account_id));

create index comment_report_open
  on comment_report (created_at) where resolved_at is null;
create index comment_report_account on comment_report (account_id);

comment on table comment_report is
  'One account''s report of one comment, for the admin queue (0281).';

create table comment_check (
  check_id    bigint generated always as identity primary key,
  account_id  uuid not null references account,
  item_id     text not null,
  verdict     text not null check (verdict in ('allow', 'refuse', 'error', 'paused')),
  stage       text not null check (stage in ('filter', 'model', 'none')),
  category    text,
  model       text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd    numeric(12, 6) not null default 0,
  body        text check (body is null or verdict = 'refuse'),
  created_at  timestamptz not null default now());

create index comment_check_account on comment_check (account_id, created_at desc);
create index comment_check_created on comment_check (created_at);

comment on table comment_check is
  'Every check before a comment: verdict, spend, and a refusal''s words for admins (0281).';

create table account_block (
  account_id         uuid not null references account,
  blocked_account_id uuid not null references account,
  created_at         timestamptz not null default now(),
  primary key (account_id, blocked_account_id),
  check (account_id <> blocked_account_id));

create index account_block_blocked on account_block (blocked_account_id);

comment on table account_block is
  'A private block between two person accounts; read by server filters only (0281).';

create table comment_setting (
  account_id      uuid primary key references account,
  who             text not null default 'followers'
                  check (who in ('followers', 'following', 'nobody')),
  suspended_until timestamptz,
  updated_at      timestamptz not null default now());

comment on table comment_setting is
  'Who may comment on an account''s play, and an admin''s commenting suspension (0281).';
