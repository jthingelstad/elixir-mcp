-- 0141: feedback messages may run to 8,000 characters (2026-09-19).
-- Agents write long, specific feedback (#65 and #66 were trimmed blind
-- against the 4,000 cap, and #64 asked that the refusal at least say
-- the length). The response column keeps its 4,000.
alter table feedback drop constraint feedback_message_check;
alter table feedback add constraint feedback_message_check
  check (length(message) between 1 and 8000);
