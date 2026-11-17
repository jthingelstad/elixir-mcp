-- 0293: bound onboarding's live-clan request history read.
--
-- Engineering, 2026-11-17: the first-day onboarding progress read needs
-- the earliest live clan request after its primary claim, so later profile
-- receipts cannot repeatedly extend the three-minute opportunity. Without
-- this index it scans the operational ledger on every poll. A synthetic
-- 200,000 retained jobs (2,000 live-clan rows) measured 2,667 buffers and
-- 21.157 ms before, three buffers and 0.036 ms after; index build 40.2 ms.
-- These are local measurements, not a production timing guarantee.
--
-- Only the live clan slice is indexed. No row or recording changes. Plain
-- CREATE INDEX holds SHARE: reads continue, writes briefly wait. Both
-- acquisition and build are capped at five seconds, so a busy or larger
-- live ledger refuses the migration rather than queueing a long write pause.
set local lock_timeout = '5s';
set local statement_timeout = '5s';

create index job_live_clan_history on job (entity_key, created_at)
  where endpoint = 'clan' and lane = 'live';

comment on index job_live_clan_history is
  '0293: the earliest live clan request after a primary claim, for the bounded onboarding roster opportunity; operational jobs only, with their existing retention.';
