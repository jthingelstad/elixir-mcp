-- A refusal warning you have read should go away.
--
-- credential_refusal is the one thing on Connections that arrives without
-- being asked for: a credential of yours that no longer works is still being
-- presented somewhere. That is worth interrupting a reader for once. It is
-- not worth interrupting them for every time they open the page afterwards,
-- and an alert that cannot be acknowledged trains people to ignore alerts.
--
-- Dismissal is per ROW, and a row is one credential from one source on one
-- day. So dismissing says "I have seen today's"; if the thing holding the
-- dead credential is still running tomorrow, tomorrow's row is new and the
-- warning returns — which is the honest behaviour, because the situation is
-- also new information: it is STILL happening.
alter table credential_refusal add column dismissed_at timestamptz;

comment on column credential_refusal.dismissed_at is
  'Set when the account holder acknowledged this row in the console. Readers filter on it; a later day inserts a new row and surfaces again.';
