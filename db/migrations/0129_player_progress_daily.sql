-- 0129: player_progress_daily (time-series review 4.3): the values of
-- the profile's `progress` buckets (trophies, bestTrophies, arena) per
-- key per game day, which projectModeSeasons read the keys of and
-- dropped. Named for what the API calls the bucket. The primary key is
-- the only index. Jamie 2026-09-17, decision 3 ("no record for no
-- activity"): a bucket reading trophies 0 and bestTrophies 0 writes no
-- row; the key's existence is still on mode_season. The "" key (the
-- Merge Tactics pre-season arena, cr-agent-api-docs 8339a89) becomes a
-- real mode_season row from here on; the projector admits it.
create table player_progress_daily (
  player_tag     text not null references player,
  progress_key   text not null references mode_season,
  day            date not null,
  snapshot_kind  text not null default 'daily'
                 check (snapshot_kind in ('daily', 'season_roll')),
  observed_at    timestamptz not null,
  trophies       integer,
  best_trophies  integer,
  arena_id       integer,
  primary key (player_tag, progress_key, day, snapshot_kind)
);
comment on table player_progress_daily is
  'Player.progress[key] per game day: trophies, bestTrophies, arena.id, last observation of the day wins. No pre_reset kind (nothing in a bucket is weekly); season_roll is the hour before the season rolls. A zero bucket (trophies 0, bestTrophies 0) writes no row.';
