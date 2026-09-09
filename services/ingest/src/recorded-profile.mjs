/** Shared recorded profile facts; no transport, identity or live-fetch policy. */
export async function readRecordedProfile(db, tag) {
  const { rows } = await db.query(
    `select p.player_tag, p.name, p.last_known_clan_tag, cl.name as clan_name,
                cl.badge_id as clan_badge_id, p.last_known_clan_role,
                p.years_played, p.account_age_days,
                s.snapshot_date, s.snapshot_kind, s.trophies, s.pol, s.league_stats,
                s.donations, s.donations_received, s.lifetime, s.created_at as snapshot_at,
                s.arena_id, s.best_trophies, s.favorite_card_id,
                (select coalesce(jsonb_agg(jsonb_build_object(
                    'name', b.name, 'level', b.level, 'max_level', b.max_level,
                    'progress', b.progress, 'target', b.target)
                  order by b.name), '[]'::jsonb)
                 from player_badge b where b.player_tag = p.player_tag) as badges
         from player p
         left join clan cl on cl.clan_tag = p.last_known_clan_tag
         left join lateral (
           select * from player_snapshot_daily where player_tag = p.player_tag
           order by snapshot_date desc, snapshot_kind desc limit 1
         ) s on true
         where p.player_tag = $1`,
    [tag],
  );
  return rows[0] ?? null;
}
