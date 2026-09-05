-- Feedback #8: an agent filed with category 'other' and got an opaque
-- refusal. 'other' is a legitimate bucket; the tool schema, this
-- constraint, and the handler's friendly error stay in lockstep.
alter table feedback drop constraint feedback_category_check;
alter table feedback add constraint feedback_category_check
  check (category in ('general', 'bug', 'data_quality', 'feature', 'praise', 'other'));
