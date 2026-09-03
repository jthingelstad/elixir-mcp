-- 0010: user-visible account activity + recording cap.
--
-- account_event is the security/insight log for the web plane: sign-ins,
-- claims, recording toggles, connections — the events a user checks to
-- answer "is this my account doing this?" and the owner checks to see
-- the request->claim->record->connect funnel. Not blanket request
-- logging; every row is a deliberate event.
create table account_event (
  event_id   bigint generated always as identity primary key,
  account_id uuid not null references account,
  kind       text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index account_event_account on account_event (account_id, event_id desc);

-- Recordings spend the one global rate budget; cap them per account
-- (NULL = default 5, owner exempt). A row update, never a deploy.
alter table account add column max_player_recordings integer;
