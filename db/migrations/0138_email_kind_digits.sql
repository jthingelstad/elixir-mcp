-- 0138: the kind check on the two product-email tables allowed letters
-- and underscores only; top_100 carries digits, and the first Top 100
-- brief failed on the constraint (2026-09-18). Same shape, digits allowed.
alter table email_issue drop constraint email_issue_kind_check;
alter table email_issue add constraint email_issue_kind_check check (kind ~ '^[a-z0-9_]{3,32}$');
alter table account_email_pref drop constraint account_email_pref_kind_check;
alter table account_email_pref add constraint account_email_pref_kind_check check (kind ~ '^[a-z0-9_]{3,32}$');
