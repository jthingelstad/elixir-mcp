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
  // HOW MUCH of the week this ratio actually describes. average_ratio
  // "1.000" over three intervals spanning two and a half days reads as a
  // fully captured week, and a tester cited it as licence to trust every
  // other number it had (playtest round, 2026-09-09). The field name says
  // seven days; only these fields say what was really watched.
  // span = first observation to last, which INCLUDES any gaps between
  // intervals; measured_hours sums the intervals themselves, so
  // measured_hours < the span means unobserved time inside it.
  const measuredSpan = known.length
    ? {
        from: known.reduce(
          (m, r) => (r.observed_from < m ? r.observed_from : m),
          known[0].observed_from,
        ),
        to: known.reduce(
          (m, r) => (r.observed_to > m ? r.observed_to : m),
          known[0].observed_to,
        ),
      }
    : null;
  const measuredHours = known.reduce(
    (n, r) =>
      n + (Date.parse(r.observed_to) - Date.parse(r.observed_from)) / 3600_000,
    0,
  );
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
      measured_span: measuredSpan,
      measured_hours: known.length ? Number(measuredHours.toFixed(2)) : null,
      unknown_intervals: intervals.length - known.length,
      note: "Estimate over observation intervals ending in the last seven days; an interval can begin earlier. Battles are counted in (observed_from, observed_to]. average_ratio is weighted by expected battles. IT DOES NOT MEAN THE WEEK WAS FULLY OBSERVED: measured_span is the first-to-last extent of the intervals behind it and measured_hours is their summed duration, so a high ratio over a few hours describes only those hours - compare measured_hours against 168 before reading average_ratio as a week. This does not measure unbracketed history or the tail after the latest profile; incomplete_days is deprecated and always null.",
    },
  };
}
