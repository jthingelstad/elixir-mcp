-- "Report this call" deserves a column, not a sentence.
--
-- The console's call record has a Report this call button, and it worked by
-- writing `request_id:<uuid>` into the free-text context blob. That is fine
-- for a human reading the queue and useless for everything else: it cannot be
-- joined, cannot be linked, and an agent filing feedback over MCP had no way
-- to say which call it meant at all — which is the case that matters most,
-- because an agent is the thing that just saw the answer go wrong.
--
-- Nullable and unconstrained by a foreign key on purpose: mcp_call_audit rows
-- age out, and feedback about a call must outlive the call it is about.
alter table feedback add column request_id uuid;

create index feedback_request on feedback (request_id)
  where request_id is not null;

comment on column feedback.request_id is
  'The meta.request_id of the call this feedback is about, from the console record or from elixir_feedback. Not a foreign key: audit rows are pruned, the report is kept.';
