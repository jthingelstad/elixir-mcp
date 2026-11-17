-- 0280: a cheer remembers whose item it was on.
--
-- Jamie, 2026-11-16: "we need a way to let members know about activity
-- on their games without them logging in". The activity mail (and, next,
-- web push) asks which accounts had cheers on their own players' items
-- lately. A cheer's item id names a happening, not a player, so each new
-- cheer now stores the player tags its item is about (the item's subject
-- tags, as the cheer route found it in the cheerer's feed). The mail reads
-- these only to find whom to ask; what it says comes from the bell's own
-- read. Older cheers keep null and are never a reason to mail.
--
-- Adding a nullable column with no default rewrites no rows; the table is
-- small, so the index builds inside the lock budget.
--
-- vacuum after: account_email_pref
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table timeline_cheer add column subject_tags text[];

create index timeline_cheer_recent on timeline_cheer (updated_at);

comment on column timeline_cheer.subject_tags is
  '0280: the player tags the cheered item is about, stamped when the cheer is given; null on cheers before 0280. Read only to find the accounts whose items had cheers lately (the activity mail).';

-- A person who turned every email off before the activity mail existed
-- keeps every email off: "Every email" stored a row per kind active then,
-- so the new kind gets its off row too (Codex on #1071). Only accounts
-- with all four of those kinds off; a person who left any on is asked
-- nothing new and takes the kind's default.
insert into account_email_pref (account_id, kind, enabled, via, changed_at)
select p.account_id, 'activity_today', false, 'ops', now()
  from account_email_pref p
 where p.kind in ('tracking_report', 'collector_activity',
                  'clan_actions_waiting', 'feedback_answer')
   and not p.enabled
 group by p.account_id
having count(*) = 4
on conflict (account_id, kind) do nothing;
