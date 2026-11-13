/** The session clock's cost and loss, per day (0145; Jamie, 2026-09-19:
 *  the breakage belongs on the collector pages). Staff only since
 *  2026-11-13 (`GET /api/admin/efficiency`, Settings > Admin >
 *  Efficiency): it was a public read until the pivot to the social
 *  layer, and the public route retired. Aggregates only, no player
 *  named. The closed days come from the nightly table; the current UTC
 *  day is read live from the receipts (polls, what they found, gaps) -
 *  its loss cannot be known until its snapshot intervals close, so it
 *  carries lost_battles: null. */
export async function readEfficiency(db) {
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const days = await q(
    `select day::text, computed_at, battlelog_polls, productive_polls,
            nothing_new_polls, battles_captured, audited_polls, gaps,
            intervals, gap_intervals, expected_gap, captured_gap,
            shortfall_gap, expected_no_gap, shortfall_no_gap, noise_rate,
            lost_battles, players_with_gaps
       from capture_efficiency_daily
      where day >= (now() at time zone 'UTC')::date - 28
      order by day`,
  );
  const [today] = await q(
    `select (now() at time zone 'UTC')::date::text as day,
            count(*)::int as battlelog_polls,
            count(*) filter (where r.new_facts > 0)::int as productive_polls,
            count(*) filter (where r.observed is not null and r.observed = r.filtered)::int as nothing_new_polls,
            coalesce(sum(r.new_facts), 0)::int as battles_captured,
            count(ca.receipt_id)::int as audited_polls,
            count(ca.receipt_id) filter (where ca.gap)::int as gaps
       from api_receipt r
       join gateway g on g.gateway_id = r.gateway_id
       left join capture_audit ca on ca.receipt_id = r.receipt_id
      where g.name <> 'backfill-elixir-bot'
        and r.endpoint = 'player_battlelog' and r.admission = 'admitted'
        and r.fetched_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`,
  );
  const [hour] = await q(
    `select count(*)::int as battlelog_polls,
            count(*) filter (where r.observed is not null and r.observed = r.filtered)::int as nothing_new_polls,
            count(ca.receipt_id) filter (where ca.gap)::int as gaps
       from api_receipt r
       join gateway g on g.gateway_id = r.gateway_id
       left join capture_audit ca on ca.receipt_id = r.receipt_id
      where g.name <> 'backfill-elixir-bot'
        and r.endpoint = 'player_battlelog' and r.admission = 'admitted'
        and r.fetched_at > now() - interval '1 hour'`,
  );
  return {
    as_of: new Date().toISOString(),
    rule: {
      followup_minutes: 30,
      ceiling_minutes: 120,
      profile_daily: true,
      since: "2026-09-19",
    },
    days: days.map((d) => ({
      ...d,
      noise_rate: d.noise_rate === null ? null : Number(d.noise_rate),
      computed_at: d.computed_at?.toISOString?.() ?? d.computed_at,
    })),
    today: { ...today, lost_battles: null },
    last_hour: hour,
    note: "Battles lost are measured nightly against the game's own lifetime battle counter over profile snapshot intervals; intervals without a capture gap set the noise floor (modes the battle log never shows). The current day's loss is known the morning after.",
  };
}
