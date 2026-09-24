-- 0168: where a training-day row came from.
--
-- 'poll' is the race poll's decksUsedToday (0167, from 2026-09-24).
-- 'battlelog' is rebuilt from recorded river-race battles on the week's
-- training days (Jamie 2026-09-24: backfill from the battle logs): a 1v1
-- is one deck, a duel one per round played, capped at the four a day
-- allows. A rebuilt row is a floor where a member's log was not fully
-- captured; a poll row always wins.

alter table war_training_day
  add column source text not null default 'poll'
    check (source in ('poll', 'battlelog'));
