-- 0211: a race in matchmaking is its own admission, neither admitted nor
-- rejected.
--
-- For a minute or two after a season roll's 404, currentriverrace answers
-- 200 with only periodIndex, sectionIndex and state "matchmaking": the
-- race exists and its bracket is not drawn yet (cr-agent-api-docs
-- models/river-race.md, observed 2026-10-05). It is the API's state, not a
-- bad payload, so its receipt says so: admission 'matchmaking', no
-- admission_errors. Nothing is projected and freshness holds, as for a
-- rejection; nothing charges it to the collector; the live lane answers it
-- as "no race yet". Readers of a usable race keep `admission = 'admitted'`.
--
-- No row changes: no recorded receipt is a matchmaking body (the payload
-- archive holds none; the 2026-10-05 roll was observed only by crprobe,
-- while the 404 hold kept the recorder off the race). The checks only
-- widen, so the old code serving during the flip still satisfies them.
--   api_receipt: drop and add NOT VALID (an instant); 0212 validates.
--   live_fetch_result: small (an hour of fetch-only results), so its check
--     is added and validated here.
set local lock_timeout = '5s';

alter table api_receipt drop constraint api_receipt_admission_check;
alter table api_receipt add constraint api_receipt_admission_check
  check (admission in ('admitted', 'rejected', 'matchmaking')) not valid;

alter table live_fetch_result drop constraint live_fetch_result_admission_check;
alter table live_fetch_result add constraint live_fetch_result_admission_check
  check (admission in ('admitted', 'rejected', 'matchmaking'));

comment on column api_receipt.admission is
  'admitted (projected; freshness advances), rejected (refused: nothing projected, charged to the collector) or matchmaking (a currentriverrace body with state matchmaking and no clan: the API''s state between the season-roll 404 and the drawn bracket; nothing projected, freshness holds, never charged). 0211.';
