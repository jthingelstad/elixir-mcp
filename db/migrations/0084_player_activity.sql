-- 0084: a nightly battle-activity histogram per recorded player (2026-09-13).
--
-- Step one of adaptive polling (NOTES 2026-09-12, "The adaptive-polling
-- direction"): the record already holds every battle timestamp, so a
-- per-player 24x7 rhythm and a year of daily counts can be rebuilt
-- nightly by the jobs Lambda. This row is that rebuild - a projection,
-- rebuildable from battle_participant at any time, never a system of
-- record. It feeds two readers: the console's activity graphic on each
-- tracked player today, and the battlelog scheduler's poll placement
-- later, once a week of histograms has been read against the capture
-- audit. The scheduler does NOT read it yet.
--
-- rhythm: 168 decayed weights indexed (isodow - 1) * 24 + utc_hour, so
-- index 0 is Monday 00:00Z and 167 is Sunday 23:00Z. Each battle adds
-- 2^(-age_days / half_life_days) to its bucket; rhythm_weight is the sum.
-- days: {"YYYY-MM-DD": battles} for UTC days with at least one recorded
-- battle inside the window; a day absent from it is zero ONLY where the
-- day was recorded - the reader decides that from recorded_from and
-- not_recorded_days, never from absence alone.
-- not_recorded_days: UTC days after recording began where the record is
-- known to be incomplete: the day of a capture-audit gap (a battle log
-- that had rolled past the high-water mark) and every day inside a
-- profile-snapshot interval whose lifetime battle counter moved more
-- than the battles captured (the coverage record's own rule).
create table player_activity (
  player_tag        text primary key references player,
  computed_at       timestamptz not null,
  window_days       integer not null,
  half_life_days    integer not null,
  rhythm            jsonb not null,
  rhythm_weight     numeric not null,
  rhythm_battles    integer not null,
  days              jsonb not null,
  not_recorded_days jsonb not null,
  recorded_from     timestamptz,
  first_battle_at   timestamptz,
  last_battle_at    timestamptz,
  battles_28d       integer not null
);
comment on table player_activity is
  'Nightly per-player battle-activity histogram (24x7 decayed rhythm + daily counts); a projection over battle_participant, rebuilt by the jobs Lambda.';
comment on column player_activity.rhythm is
  '168 decayed weights, index (isodow-1)*24 + UTC hour; each battle adds 2^(-age_days/half_life_days).';
comment on column player_activity.not_recorded_days is
  'UTC days inside the window, after recording began, that the capture audit or the coverage record marks incomplete; render as not recorded, never as zero.';
