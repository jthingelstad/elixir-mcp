/** Compare the same observation interval on both sides of the estimate.
 * Read canonical battles at query time so late arrivals repair the answer.
 * Calendar dates alone cannot bracket battles: old snapshots without an
 * observed_at remain unknown rather than acquiring invented midnight times.
 */
export async function captureCoverage(db, playerTag) {
  const { rows } = await db.query(
    `with snapshots as (
       select observed_at as observed_to,
              lag(observed_at) over w as observed_from,
              (lifetime->>'battleCount')::int -
                lag((lifetime->>'battleCount')::int) over w as expected_battles
       from player_snapshot_daily
       where player_tag = $1 and snapshot_kind = 'daily'
       window w as (order by snapshot_date)
     )
     select observed_from, observed_to, expected_battles,
            (select count(*)::int from battle_participant bp
             where bp.player_tag = $1 and bp.battle_time > observed_from
               and bp.battle_time <= observed_to) as captured_battles
     from snapshots
     where observed_from is not null and observed_to > observed_from
       and observed_to > now() - interval '7 days'
     order by observed_to desc`,
    [playerTag],
  );
  const intervals = rows.map((r) => {
    const comparable =
      r.expected_battles !== null &&
      r.expected_battles >= 0 &&
      r.captured_battles <= r.expected_battles;
    return {
      observed_from: r.observed_from.toISOString(),
      observed_to: r.observed_to.toISOString(),
      expected_battles: r.expected_battles,
      captured_battles: r.captured_battles,
      is_complete: comparable
        ? r.captured_battles === r.expected_battles
        : null,
      ratio: comparable
        ? r.expected_battles === 0
          ? 1
          : Number((r.captured_battles / r.expected_battles).toFixed(3))
        : null,
      ...(comparable
        ? {}
        : {
            note: "The lifetime counter and recorded battles are not comparable in this interval; no completeness estimate is asserted.",
          }),
    };
  });
  const known = intervals.filter((r) => r.ratio !== null);
  const expected = known.reduce((n, r) => n + r.expected_battles, 0);
  const captured = known.reduce((n, r) => n + r.captured_battles, 0);
  return {
    observation_intervals: intervals,
    completeness_last_7_days: {
      average_ratio: known.length
        ? expected === 0
          ? "1.000"
          : (captured / expected).toFixed(3)
        : null,
      // Retained for older clients. An interval may span several days, so a
      // count of incomplete DAYS is no longer a supported inference.
      incomplete_days: null,
      incomplete_intervals: known.length
        ? known.filter((r) => !r.is_complete).length
        : null,
      measured_intervals: known.length,
      unknown_intervals: intervals.length - known.length,
      note: "Estimate over observation intervals ending in the last seven days; an interval can begin earlier. Battles are counted in (observed_from, observed_to]. average_ratio is weighted by expected battles. This does not measure unbracketed history or the tail after the latest profile; incomplete_days is deprecated and always null.",
    },
  };
}
