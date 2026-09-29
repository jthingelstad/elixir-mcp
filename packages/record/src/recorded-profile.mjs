import { snapshotObjects } from "./snapshot-columns.mjs";

/** Shared recorded profile facts; no transport, identity or live-fetch policy. */
export async function readRecordedProfile(db, tag) {
  const { rows } = await db.query(
    `select p.player_tag, p.name, p.game_last_seen_at,
            p.last_known_clan_tag, cl.name as clan_name,
                cl.badge_id as clan_badge_id, p.last_known_clan_role,
                p.years_played, p.account_age_days,
                p.war_day_wins, p.clan_cards_collected, p.legacy_trophy_road_high_score,
                s.snapshot_date, s.snapshot_kind, s.trophies,
                s.donations, s.donations_received, s.created_at as snapshot_at,
                s.arena_id, s.best_trophies, s.favorite_card_id,
                s.battle_count, s.wins, s.losses, s.three_crown_wins, s.star_points,
                s.exp_points, s.collection_level, s.king_tower_level, s.total_donations,
                s.pol_league, s.pol_trophies, s.pol_rank,
                s.pol_best_league, s.pol_best_trophies, s.pol_best_rank,
                s.season_trophies, s.season_best_trophies,
                s.prev_season_month, s.prev_season_rank, s.prev_season_trophies,
                s.prev_season_best_trophies,
                s.best_season_month, s.best_season_trophies, s.best_season_rank,
                (select coalesce(jsonb_agg(jsonb_build_object(
                    'name', b.name, 'level', b.level, 'max_level', b.max_level,
                    'progress', b.progress, 'target', b.target)
                  order by b.name), '[]'::jsonb)
                 from player_badge b where b.player_tag = p.player_tag) as badges,
                (select coalesce(jsonb_agg(jsonb_build_object(
                    'season_month', f.season_month, 'league', f.league,
                    'trophies', f.trophies, 'rank', f.rank)
                  order by f.season_month desc), '[]'::jsonb)
                 from (select season_month, league, trophies, rank from player_pol_season
                        where player_tag = p.player_tag
                        order by season_month desc limit 12) f) as pol_seasons
         from player p
         left join clan cl on cl.clan_tag = p.last_known_clan_tag
         left join lateral (
           -- The latest PROFILE observation: since 2026-09-17 the roster
           -- writes rows too, and a roster-only row has no lifetime block.
           select * from player_snapshot_daily where player_tag = p.player_tag
             and profile_observed_at is not null
           order by snapshot_date desc, snapshot_kind desc limit 1
         ) s on true
         where p.player_tag = $1`,
    [tag],
  );
  const row = rows[0];
  if (!row) return null;
  // The contract's objects from the typed columns (0123): the shapes
  // players_profile has always served, now rendered rather than stored.
  const objects = snapshotObjects(row.snapshot_date ? row : null);
  return {
    ...row,
    pol: objects.pol,
    league_stats: objects.league_stats,
    lifetime: objects.lifetime,
  };
}
