-- 0018: the self-improvement loop's write path (Jamie, 2026-09-04).
-- Feedback arrives from the web form or the MCP send_feedback tool;
-- agent feedback is attributed to the account behind the agent.
create table feedback (
  feedback_id bigint generated always as identity primary key,
  account_id  uuid not null references account,
  surface     text not null check (surface in ('web', 'mcp')),
  category    text not null default 'general'
              check (category in ('general', 'bug', 'data_quality', 'feature', 'praise')),
  message     text not null check (length(message) between 1 and 4000),
  context     jsonb,                          -- tool/page the feedback came from
  status      text not null default 'new'
              check (status in ('new', 'seen', 'planned', 'done', 'declined')),
  created_at  timestamptz not null default now()
);
create index feedback_status on feedback (status, feedback_id desc);
