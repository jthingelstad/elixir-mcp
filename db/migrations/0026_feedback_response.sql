-- Close the feedback loop (Jamie, 2026-09-05, on the FIRST real agent
-- feedback): the maintainer can reply, and the requester - human on the
-- dashboard or agent via elixir_my_feedback - sees status and response.
-- Feedback must never be actioned invisibly.
alter table feedback add column response text
  check (response is null or length(response) <= 4000);
alter table feedback add column responded_at timestamptz;
