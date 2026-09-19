-- 0139: every sent product email has its own id (Jamie, 2026-09-19: an
-- identifier in the footer that matches one send in the logs; a list of
-- the emails sent to me in Activity; feedback filed about one of them).
--
-- email_send was keyed (issue_id, account_id): one row per recipient per
-- issue, which is the idempotency question ("did this issue reach this
-- account?") and stays the index that answers it. The send id is the
-- row's identity now, so a re-send under force (the account page's
-- "send me this now" on an issue already sent) is its own row with its
-- own footer id rather than a silent on-conflict no-op. The old rows get
-- ids too; they have no archived body and no subject of their own (the
-- issue's subject_line is the fallback the reader uses).
--
-- The body itself is in the archive bucket under mail/sent/, keyed by
-- send id (services/jobs/src/email/archive.mjs); `archived` is the hot
-- pointer, the same split as calls/ and mcp_call_audit.captured.
--
-- feedback.send_id: the email a report is about, a column not a sentence
-- (0066's argument for request_id, again). Not a foreign key: a report
-- outlives whatever it is about.

alter table email_send add column send_id uuid not null default gen_random_uuid();
alter table email_send add column subject text;
alter table email_send add column archived boolean not null default false;

alter table email_send drop constraint email_send_pkey;
alter table email_send add primary key (send_id);
create index email_send_issue_account on email_send (issue_id, account_id);

comment on column email_send.send_id is
  'The send''s own id: in the mail''s footer, in the relay''s log line beside the SES message id, and the key of the archived body under mail/sent/.';
comment on column email_send.archived is
  'The rendered mail landed in the archive bucket (mail/sent/dt=<day>/send_id=<id>.json.gz).';

alter table feedback add column send_id uuid;
create index feedback_send on feedback (send_id) where send_id is not null;
comment on column feedback.send_id is
  'The email_send.send_id this feedback is about, from the console''s email record. Not a foreign key.';
