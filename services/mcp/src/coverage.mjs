/** Compare the same observation interval on both sides of the estimate.
 * Read canonical battles at query time so late arrivals repair the answer.
 * Calendar dates alone cannot bracket battles: old snapshots without an
 * observed_at remain unknown rather than acquiring invented midnight times.
 */
export async function captureCoverage(db, playerTag) {
  const { rows: latestRows } = await db.query(
    `select max(profile_observed_at) as latest_observed_at
     from player_snapshot_daily
     where player_tag = $1 and snapshot_kind = 'daily'`,
    [playerTag],
  );
  const { rows } = await db.query(
    `with snapshots as (
       -- Profile observations only: battle_count is the profile's, and a
       -- roster-written row (2026-09-17) carries neither it nor its stamp.
       select profile_observed_at as observed_to,
              lag(profile_observed_at) over w as observed_from,
              battle_count - lag(battle_count) over w as expected_battles
       from player_snapshot_daily
       where player_tag = $1 and snapshot_kind = 'daily' and profile_observed_at is not null
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
  const latestObservedAt = latestRows[0]?.latest_observed_at ?? null;
  const unmeasuredTailHours = latestObservedAt
    ? Number(
        Math.max(
          0,
          (Date.now() - latestObservedAt.getTime()) / 3600_000,
        ).toFixed(2),
      )
    : null;
  return {
    observation_intervals: intervals,
    completeness_last_7_days: {
      // A number, three decimals (4.0.0; a string before, the one ratio
      // on the wire that was). incomplete_days, always null since an
      // interval may span several days, is gone.
      average_ratio: known.length
        ? expected === 0
          ? 1
          : Number((captured / expected).toFixed(3))
        : null,
      incomplete_intervals: known.length
        ? known.filter((r) => !r.is_complete).length
        : null,
      measured_intervals: known.length,
      measured_span: measuredSpan,
      measured_hours: known.length ? Number(measuredHours.toFixed(2)) : null,
      unmeasured_tail_hours: unmeasuredTailHours,
      unknown_intervals: intervals.length - known.length,
      note: "Estimate over observation intervals ending in the last seven days; an interval can begin earlier. Battles are counted in (observed_from, observed_to]. average_ratio is weighted by expected battles. IT DOES NOT MEAN THE WEEK WAS FULLY OBSERVED: measured_span is the first-to-last extent of the intervals behind it and measured_hours is their summed duration, so a high ratio over a few hours describes only those hours - compare measured_hours against 168 before reading average_ratio as a week. unmeasured_tail_hours is the unbracketed time since the latest profile snapshot.",
    },
  };
}

/** The cheap read behind meta.completeness_note (review 2026-09-19,
 *  defect 13): the two newest profile rows and the recorded battles
 *  between their stamps, one query, nothing cached. `ratio` is null when
 *  the two are not comparable (one row, a null counter, a counter that
 *  went backwards, more battles recorded than counted); `tail_hours` is
 *  the unbracketed time since the newest profile poll, null with no
 *  profile row at all. The full seven-day picture is captureCoverage. */
export async function recentCompleteness(db, playerTag) {
  const {
    rows: [r],
  } = await db.query(
    `with r as (
       select profile_observed_at as at, battle_count
       from player_snapshot_daily
       where player_tag = $1 and snapshot_kind = 'daily' and profile_observed_at is not null
       order by snapshot_date desc limit 2),
     b as (
       select max(at) as observed_to, min(at) as observed_from, count(*)::int as n,
              (select battle_count from r order by at desc limit 1)
                - (select battle_count from r order by at asc limit 1) as expected
       from r)
     select b.observed_from, b.observed_to, b.n, b.expected,
            case when b.n = 2 then
              (select count(*)::int from battle_participant bp
               where bp.player_tag = $1
                 and bp.battle_time > b.observed_from and bp.battle_time <= b.observed_to)
            end as captured
     from b`,
    [playerTag],
  );
  const comparable =
    r.n === 2 &&
    r.expected !== null &&
    r.expected >= 0 &&
    r.captured !== null &&
    r.captured <= r.expected;
  return {
    observed_from: r.n === 2 ? r.observed_from.toISOString() : null,
    observed_to: r.observed_to ? r.observed_to.toISOString() : null,
    expected_battles: comparable ? r.expected : null,
    captured_battles: comparable ? r.captured : null,
    ratio: comparable
      ? r.expected === 0
        ? 1
        : Number((r.captured / r.expected).toFixed(3))
      : null,
    tail_hours: r.observed_to
      ? Number(
          Math.max(
            0,
            (Date.now() - r.observed_to.getTime()) / 3600_000,
          ).toFixed(1),
        )
      : null,
  };
}

/** The sentence, or null: a measured gap (ratio under 0.9) or an unknown
 *  one (no comparable interval and more than 48 hours since the last
 *  profile poll). */
export function completenessNote(playerTag, recent) {
  if (recent.ratio !== null && recent.ratio < 0.9)
    return `Capture is incomplete for ${playerTag}: ${recent.captured_battles} of the ${recent.expected_battles} battles the profile counted between ${recent.observed_from} and ${recent.observed_to} are recorded (${recent.ratio}); battle-derived numbers in that span undercount. elixir_coverage({ player_tag: "${playerTag}" }) has the intervals.`;
  if (
    recent.ratio === null &&
    recent.tail_hours !== null &&
    recent.tail_hours > 48
  )
    return `Completeness is unknown for ${playerTag}: no comparable profile interval, and ${recent.tail_hours} hours have passed since the last profile poll (${recent.observed_to}); battle-derived numbers since then may undercount. elixir_coverage({ player_tag: "${playerTag}" }) has the intervals.`;
  return null;
}

/** captureCoverage's seven-day estimate for many players in one query
 *  (Gym #196): per player, the profile battle counter's rise over the
 *  profile intervals ending in the last seven days against the battles
 *  recorded inside them, comparable intervals only. A member at "0
 *  battles this week" whose counter rose by 38 is a capture gap, not
 *  inactivity, and the clan reads must say which members that is. */
export async function captureByPlayer(
  db,
  playerTags,
  { fromMs = Date.now() - 7 * 86_400_000, toMs = Date.now() } = {},
) {
  if (!playerTags.length || toMs <= fromMs) return new Map();
  const { rows } = await db.query(
    `with snapshots as (
       select player_tag, profile_observed_at as observed_to,
              lag(profile_observed_at) over w as observed_from,
              battle_count - lag(battle_count) over w as expected_battles
         from player_snapshot_daily
        where player_tag = any($1::text[]) and snapshot_kind = 'daily'
          and profile_observed_at is not null
          and snapshot_date > ($2::timestamptz - interval '2 days')::date
          and snapshot_date <= ($3::timestamptz + interval '1 day')::date
       window w as (partition by player_tag order by snapshot_date)
     ), intervals as (
       select s.player_tag, s.expected_battles,
              (select count(*)::int from battle_participant bp
                where bp.player_tag = s.player_tag
                  and bp.battle_time > s.observed_from
                  and bp.battle_time <= s.observed_to) as captured_battles
         from snapshots s
        where s.observed_from is not null and s.observed_to > s.observed_from
          and s.observed_to > $2::timestamptz and s.observed_to <= $3::timestamptz
          and s.expected_battles is not null and s.expected_battles >= 0
     )
     select player_tag, sum(expected_battles)::int as expected,
            sum(captured_battles)::int as captured
       from intervals
      where captured_battles <= expected_battles
      group by player_tag`,
    [playerTags, new Date(fromMs).toISOString(), new Date(toMs).toISOString()],
  );
  return new Map(
    rows.map((r) => [
      r.player_tag,
      {
        expected: r.expected,
        captured: r.captured,
        ratio: r.expected > 0 ? r.captured / r.expected : 1,
      },
    ]),
  );
}

/** The note a clan read carries when members' battles are mostly not
 *  captured (#196): below 80% of at least 5 battles the counter says
 *  were played in the last seven days. null when every member is fine. */
export function underCaptureNote(
  capture,
  nameOf,
  span = "the last seven days",
) {
  const low = [...capture.entries()]
    .filter(([, c]) => c.expected >= 5 && c.ratio < 0.8)
    .sort((a, b) => a[1].ratio - b[1].ratio);
  if (!low.length) return null;
  const list = low
    .slice(0, 8)
    .map(
      ([tag, c]) =>
        `${nameOf(tag) ?? tag} ${tag} (${c.captured} of ${c.expected}, ${Math.round(c.ratio * 100)}%)`,
    )
    .join(", ");
  return `Battle capture is incomplete for ${low.length} member${low.length === 1 ? "" : "s"} over ${span}, so their recorded battles and last-battle times undercount real play: ${list}${low.length > 8 ? ` and ${low.length - 8} more` : ""}. The profile's battle counter rose by the second number while the record captured the first; a low count here is a capture gap, not inactivity (elixir_coverage per tag).`;
}
