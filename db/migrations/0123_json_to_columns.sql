-- 0123: fixed-shape JSON becomes columns, the expand half (schema review
-- 1.8, plan step 15; Jamie 2026-09-17: "do it right"). Every column here
-- is nullable and additive; the fills touch the small tables inside this
-- transaction (14.8k snapshots, 128 cards, ~900 activity rows, a few
-- hundred rejected receipts, a handful of OAuth clients) and never the
-- participant heap: battle_participant.tower_hp is filled by the
-- keyset-batched {tower_hp_backfill} op in short transactions, the 0099
-- shape. The JSON columns stay until every reader has moved (the
-- projectors write both meanwhile) and drop in a later migration.
--
-- Stays JSON by decision: api_payload.payload_json (the raw cache),
-- mcp_call_audit.args, feedback.context, account_event.detail,
-- magic_login.context / started_from (free-form diagnostics), and
-- api_receipt.admission_errors becomes text[] under a new name here
-- (a rename lands with the drop; an in-place type change would rewrite
-- 160k rows under ACCESS EXCLUSIVE).

-- player_snapshot_daily: lifetime {battleCount, wins, losses,
-- threeCrownWins, starPoints, expPoints, collectionLevel}; pol {current,
-- best: {leagueNumber, trophies, rank}}; league_stats {currentSeason
-- {trophies, bestTrophies}, previousSeason {id, rank, trophies,
-- bestTrophies}, bestSeason {id, trophies, rank}} (a JSON scalar null on
-- 6,150 rows, which every walker guarded with jsonb_typeof).
alter table player_snapshot_daily
  add column battle_count integer,
  add column wins integer,
  add column losses integer,
  add column three_crown_wins integer,
  add column star_points integer,
  add column exp_points integer,
  add column collection_level integer,
  add column pol_league integer,
  add column pol_trophies integer,
  add column pol_rank integer,
  add column pol_best_league integer,
  add column pol_best_trophies integer,
  add column pol_best_rank integer,
  add column season_trophies integer,
  add column season_best_trophies integer,
  add column prev_season_month text references season (season_month),
  add column prev_season_rank integer,
  add column prev_season_trophies integer,
  add column prev_season_best_trophies integer,
  add column best_season_month text references season (season_month),
  add column best_season_trophies integer,
  add column best_season_rank integer;

update player_snapshot_daily set
  battle_count = (lifetime->>'battleCount')::int,
  wins = (lifetime->>'wins')::int,
  losses = (lifetime->>'losses')::int,
  three_crown_wins = (lifetime->>'threeCrownWins')::int,
  star_points = (lifetime->>'starPoints')::int,
  exp_points = (lifetime->>'expPoints')::int,
  collection_level = (lifetime->>'collectionLevel')::int,
  pol_league = (pol->'current'->>'leagueNumber')::int,
  pol_trophies = (pol->'current'->>'trophies')::int,
  pol_rank = (pol->'current'->>'rank')::int,
  pol_best_league = (pol->'best'->>'leagueNumber')::int,
  pol_best_trophies = (pol->'best'->>'trophies')::int,
  pol_best_rank = (pol->'best'->>'rank')::int,
  season_trophies = case when jsonb_typeof(league_stats) = 'object' then (league_stats->'currentSeason'->>'trophies')::int end,
  season_best_trophies = case when jsonb_typeof(league_stats) = 'object' then (league_stats->'currentSeason'->>'bestTrophies')::int end,
  prev_season_month = case when jsonb_typeof(league_stats) = 'object'
                        and (league_stats->'previousSeason'->>'id') ~ '^[0-9]{4}-[0-9]{2}$'
                        and exists (select 1 from season s where s.season_month = league_stats->'previousSeason'->>'id')
                       then league_stats->'previousSeason'->>'id' end,
  prev_season_rank = case when jsonb_typeof(league_stats) = 'object' then (league_stats->'previousSeason'->>'rank')::int end,
  prev_season_trophies = case when jsonb_typeof(league_stats) = 'object' then (league_stats->'previousSeason'->>'trophies')::int end,
  prev_season_best_trophies = case when jsonb_typeof(league_stats) = 'object' then (league_stats->'previousSeason'->>'bestTrophies')::int end,
  best_season_month = case when jsonb_typeof(league_stats) = 'object'
                        and (league_stats->'bestSeason'->>'id') ~ '^[0-9]{4}-[0-9]{2}$'
                        and exists (select 1 from season s where s.season_month = league_stats->'bestSeason'->>'id')
                       then league_stats->'bestSeason'->>'id' end,
  best_season_trophies = case when jsonb_typeof(league_stats) = 'object' then (league_stats->'bestSeason'->>'trophies')::int end,
  best_season_rank = case when jsonb_typeof(league_stats) = 'object' then (league_stats->'bestSeason'->>'rank')::int end;

-- card.icon_urls {medium, evolutionMedium?, heroMedium?}: the presence
-- of the evolution and hero URLs already encodes the max_evolution_level
-- bits (cr-agent-api-docs/cards.md).
alter table card
  add column icon_medium text,
  add column icon_evolution_medium text,
  add column icon_hero_medium text;
update card set
  icon_medium = icon_urls->>'medium',
  icon_evolution_medium = icon_urls->>'evolutionMedium',
  icon_hero_medium = icon_urls->>'heroMedium';

-- player_activity.rhythm (168 floats) is a typed array; not_recorded_days
-- (sorted dates) likewise. `days` retires with the JSON: it is
-- player_daily_battle_rollup summed over mode, which the graphic's route
-- reads directly now.
alter table player_activity
  add column rhythm_buckets real[],
  add column not_recorded date[];
update player_activity set
  rhythm_buckets = (select array_agg(v::real order by o) from jsonb_array_elements_text(rhythm) with ordinality as t(v, o)),
  not_recorded = coalesce((select array_agg(v::date order by v) from jsonb_array_elements_text(not_recorded_days) as t(v)), '{}');

-- oauth_client.redirect_uris: a JSON array of strings is text[]. A
-- handful of rows; the type changes in place (a USING clause cannot
-- hold a subquery, so a helper column carries the values across).
alter table oauth_client add column redirect_uri_list text[];
update oauth_client set redirect_uri_list =
  coalesce((select array_agg(v) from jsonb_array_elements_text(redirect_uris) as t(v)), '{}');
alter table oauth_client drop column redirect_uris;
alter table oauth_client rename column redirect_uri_list to redirect_uris;
alter table oauth_client alter column redirect_uris set not null;

-- api_receipt.admission_errors: text[] under a new name (see above);
-- only rejected receipts carry one.
alter table api_receipt add column admission_error_list text[];
update api_receipt set admission_error_list =
  (select array_agg(v) from jsonb_array_elements_text(admission_errors) as t(v))
where admission_errors is not null and jsonb_typeof(admission_errors) = 'array';

-- battle_participant.tower_hp {king, princess: [a, b]}: three smallints,
-- 0 = destroyed, null = the API did not carry it; the API gives no
-- left/right, so slot order is the array's. Columns only here (instant);
-- {tower_hp_backfill} fills 577k rows in 10k-row batches.
alter table battle_participant
  add column king_tower_hp smallint,
  add column princess_tower_hp_1 smallint,
  add column princess_tower_hp_2 smallint;
