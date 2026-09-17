-- 0110: poll_state.hint carried two vocabularies (schema review 1.5):
-- ours (active / idle / asleep, the clan liveliness the roster projector
-- stamps) and the API's periodType (training / warDay / colosseum) on
-- the currentriverrace rows. Split: hint keeps ours, period_type takes
-- the API's, no check on the API's enum (the game may add a value and
-- ingest must never fail on it). 4,637 rows, instant. The CHECK on hint
-- lands in 0115 after the enum census has read the live values.
alter table poll_state add column period_type text;
update poll_state set period_type = hint, hint = null
 where endpoint = 'currentriverrace' and hint is not null;
comment on column poll_state.period_type is
  'The API''s periodType from the last currentriverrace admission (training / warDay / colosseum, open enum); the cadence hint for that endpoint.';
comment on column poll_state.hint is
  'Our own cadence hint: clan liveliness (active / idle / asleep) from the roster projector.';
