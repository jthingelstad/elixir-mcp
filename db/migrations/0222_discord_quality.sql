-- 0222: the quality ledger of what Elixir posts to Discord.
--
-- Jamie, 2026-10-11: "The Discord features in Elixir - we need to make
-- sure we can judge the quality of those without having any access or
-- visibility to the client discord server. Please make sure we are setup
-- to do that when other folks start using this." Until now the only
-- record was the relay's rolling history in S3 (the last 20, or 40 for a
-- clan's channel), shown to its owner or the clan's leaders alone: nothing
-- durable, nothing an operator could read across clans, and none of the
-- clan model's inputs, so a bad post could be neither explained nor
-- replayed.
--   discord_post: one row per post, edit or skip Elixir decided on, for
--     each of the three features (a timeline's cross-post, Clan's Actions,
--     a clan's activity channel): who (the account, or the clan), which
--     webhook (its fingerprint, never the webhook), what it told (the
--     timeline items or the Action, by id and kind), how it was written
--     (line, code or model), the text as handed to the relay, and when.
--     The relay's answer (Discord's status and words) arrives later as a
--     receipt and fills outcome*; checked_at, present, reactions and
--     thread are what a read of the message found (an edit that found
--     it deleted fills present already). Discord's message ids
--     stay with the relay (0213), except Actions', which Clan's own
--     ledger already holds.
--   discord_run: one row per run of a clan's model as the activity
--     channel's editor: rounds, lookups, about what it cost, the posts it
--     wrote and merged, and every post the engine's checks refused, with
--     the reason and the refused text. The run's raw inputs and answers
--     (packets, lookups, the model's turns) are an S3 object of their own
--     in the archive bucket (discord-runs/, 30 days), named by raw_key.
-- Not the record: no game fact lives here, and both tables are kept 90
-- days (the jobs Lambda's hourly sweep deletes older rows), as the
-- privacy and limits pages say. Never MCP, /api/v1 or a public tool;
-- Elixir's operators read it to judge and fix the posts' quality.
-- Locks: new tables only.

create table discord_post (
  post_id      uuid primary key,
  feature      text not null
               check (feature in ('timeline', 'clan_actions', 'clan_activity')),
  account_id   uuid,
  clan_tag     text,
  destination  text not null,
  webhook_fp   text not null check (webhook_fp ~ '^[a-f0-9]{16}$'),
  post_key     text not null,
  revision     integer not null,
  action       text not null check (action in ('post', 'edit', 'skip')),
  mode         text not null check (mode in ('line', 'code', 'model')),
  items        jsonb not null default '[]'::jsonb,
  content      text,
  skip_reason  text,
  event_at     timestamptz,
  observed_at  timestamptz,
  handed_at    timestamptz not null,
  outcome      text check (outcome in
                 ('posted', 'edited', 'refused', 'unknown', 'not_delivered',
                  'skipped', 'unchanged')),
  outcome_at   timestamptz,
  http_status  integer,
  reason       text,
  run_id       text,
  checked_at   timestamptz,
  present      boolean,
  reactions    jsonb,
  thread       boolean,
  created_at   timestamptz not null default now()
);
comment on table discord_post is
  '0222: one post, edit or skip Elixir decided on for a Discord webhook (the timeline cross-post, Clan''s Actions, a clan''s activity channel) and what came of it. Kept 90 days; operators read it to judge quality.';
comment on column discord_post.destination is
  '0222: the id the relay files the webhook''s records under: the account (timeline), the clan''s channel_id (activity) or the clan tag (Actions).';
comment on column discord_post.webhook_fp is
  '0222: the webhook''s fingerprint (contracts webhookFingerprint), never the webhook.';
comment on column discord_post.post_key is
  '0222: the post''s key: a timeline item''s id, a story''s first item''s id, or an Action''s card id.';
comment on column discord_post.mode is
  '0222: how the text was written: line (the timeline''s one line per item), code (Elixir''s own render) or model (the clan''s model, as the editor).';
comment on column discord_post.items is
  '0222: what the post tells, [{id, kind}]: timeline items, or the Action''s card. Never a player tag.';
comment on column discord_post.content is
  '0222: the text as handed to the relay; for a skip, what it would have said.';
comment on column discord_post.observed_at is
  '0222: when Elixir first saw the newest thing the post tells: outcome_at less this is Elixir''s own latency.';
comment on column discord_post.outcome is
  '0222: the relay''s answer: posted, edited, refused (Discord''s reason in reason), unknown (sent, no answer: never sent again), not_delivered, skipped (never sent, by a rule or the editor), unchanged (already told at this revision). Null until the receipt arrives.';
comment on column discord_post.run_id is
  '0222: the clan model''s run (discord_run) the post or skip came from; set for a story the run fell back to Elixir''s words for, too.';
comment on column discord_post.present is
  '0222: the one read-back a day after posting: true still in the channel, false deleted there; null not read back.';
comment on column discord_post.reactions is
  '0222: the reactions at the read-back, [{emoji, count}]; null when Discord returned none to read.';
comment on column discord_post.thread is
  '0222: at the read-back, whether a thread had been started from the post.';

create index discord_post_handed on discord_post (handed_at);
create index discord_post_clan on discord_post (clan_tag, handed_at)
  where clan_tag is not null;
create index discord_post_account on discord_post (account_id, handed_at)
  where account_id is not null;
create index discord_post_run on discord_post (run_id) where run_id is not null;
-- The read-back's candidates: a webhook's posts not yet read back.
create index discord_post_unchecked on discord_post (webhook_fp, outcome_at)
  where action = 'post' and outcome = 'posted' and checked_at is null;

create table discord_run (
  run_id         text primary key,
  clan_tag       text not null,
  at             timestamptz not null,
  model          text,
  outcome        text not null,
  rounds         integer not null default 0,
  lookups        integer not null default 0,
  stories        integer not null default 0,
  posts          integer not null default 0,
  merged         integer not null default 0,
  model_skips    integer not null default 0,
  fallbacks      integer not null default 0,
  refusals       jsonb not null default '[]'::jsonb,
  cost_usd       numeric(10, 4),
  cost_estimated boolean not null default false,
  raw_key        text,
  created_at     timestamptz not null default now()
);
comment on table discord_run is
  '0222: one run of a clan''s model as its activity channel''s editor. Kept 90 days; its raw inputs and answers are raw_key in the archive bucket, kept 30.';
comment on column discord_run.outcome is
  '0222: ok when the model answered, else why not (deadline, no_answer, model_daily_limit, model_spend_cap, ...): every story was then Elixir''s own.';
comment on column discord_run.fallbacks is
  '0222: stories the run handed the model that were posted in Elixir''s words (not told, or refused by the checks).';
comment on column discord_run.refusals is
  '0222: each post or skip the engine''s checks refused: [{keys, why, text}], the text as the model wrote it.';
comment on column discord_run.cost_usd is
  '0222: about what the run''s rounds cost at list prices, from the reported tokens; cost_estimated when a round reported none.';
create index discord_run_clan on discord_run (clan_tag, at);
create index discord_run_at on discord_run (at);
