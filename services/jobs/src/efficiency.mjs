/**
 * What the battlelog schedule costs and what it loses, per UTC day
 * ({capture_efficiency: true}, nightly at 05:20Z; 0145). Jamie,
 * 2026-09-19: the breakage belongs on the collector pages, "otherwise we
 * are tuning blind". The measurement is the one the session clock was
 * chosen on (NOTES that day): the profile's lifetime battleCount is the
 * API's one ground truth, so every snapshot interval ending on the day
 * is read as expected (the counter's delta) against captured (the
 * battle_participant rows inside it), split by whether a capture-audit
 * gap fell inside. Intervals without a gap that still come up short
 * measure the modes the battle log never shows; that rate, taken off the
 * gapped intervals, is the loss. The last three days are rewritten each
 * night, since a snapshot interval can close a day or two after the
 * battles it covers.
 *
 * Also emitted as one EMF line per run (ElixirMCP/Record): yesterday's
 * LostBattles, BattlelogPolls and NothingNewShare, for the dashboard.
 */

import pg from "pg";

const NAMESPACE = "ElixirMCP/Record";
const DAY = 86_400_000;

/** UTC day string of an instant. */
function utcDay(at) {
  return new Date(at).toISOString().slice(0, 10);
}

/** The counts for one UTC day, from the receipts, the audit and the
 *  snapshot intervals. Read-only; `db` is one client. */
export async function efficiencyForDay(db, day) {
  const from = `${day}T00:00:00Z`;
  const to = new Date(Date.parse(from) + DAY).toISOString();
  const {
    rows: [polls],
  } = await db.query(
    `select count(*)::int as battlelog_polls,
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
        and r.fetched_at >= $1::timestamptz and r.fetched_at < $2::timestamptz`,
    [from, to],
  );
  const { rows: intervals } = await db.query(
    `with s as (
       select player_tag, profile_observed_at as observed_at,
              lag(profile_observed_at) over w as observed_from,
              battle_count - lag(battle_count) over w as expected
         from player_snapshot_daily
        where profile_observed_at is not null and battle_count is not null
          and snapshot_date >= ($1::timestamptz - interval '3 days')::date
          and snapshot_date <= ($2::timestamptz)::date
        window w as (partition by player_tag order by profile_observed_at)
     )
     select s.player_tag, s.expected,
            (select count(*)::int from battle_participant bp
              where bp.player_tag = s.player_tag
                and bp.battle_time > s.observed_from
                and bp.battle_time <= s.observed_at) as captured,
            exists (select 1 from capture_audit ca
                     where ca.subject_tag = s.player_tag and ca.gap
                       and ca.fetched_at > s.observed_from
                       and ca.fetched_at <= s.observed_at) as has_gap
       from s
      where s.observed_from is not null
        and s.observed_at >= $1::timestamptz and s.observed_at < $2::timestamptz
        and s.expected is not null and s.expected >= 0`,
    [from, to],
  );
  const gap = { intervals: 0, expected: 0, captured: 0, shortfall: 0 };
  const noGap = { intervals: 0, expected: 0, captured: 0, shortfall: 0 };
  const gapPlayers = new Set();
  for (const r of intervals) {
    const side = r.has_gap ? gap : noGap;
    const expected = Number(r.expected);
    const captured = Number(r.captured);
    side.intervals += 1;
    side.expected += expected;
    side.captured += captured;
    side.shortfall += Math.max(0, expected - captured);
    if (r.has_gap) gapPlayers.add(r.player_tag);
  }
  const noiseRate = noGap.expected > 0 ? noGap.shortfall / noGap.expected : 0;
  const lost = Math.max(
    0,
    Math.round(gap.shortfall - noiseRate * gap.expected),
  );
  return {
    day,
    ...polls,
    intervals: intervals.length,
    gap_intervals: gap.intervals,
    expected_gap: gap.expected,
    captured_gap: gap.captured,
    shortfall_gap: gap.shortfall,
    expected_no_gap: noGap.expected,
    captured_no_gap: noGap.captured,
    shortfall_no_gap: noGap.shortfall,
    noise_rate: Math.round(noiseRate * 10000) / 10000,
    lost_battles: lost,
    players_with_gaps: gapPlayers.size,
  };
}

async function upsert(db, row) {
  await db.query(
    `insert into capture_efficiency_daily
       (day, computed_at, battlelog_polls, productive_polls, nothing_new_polls,
        battles_captured, audited_polls, gaps, intervals, gap_intervals,
        expected_gap, captured_gap, shortfall_gap, expected_no_gap,
        captured_no_gap, shortfall_no_gap, noise_rate, lost_battles,
        players_with_gaps)
     values ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18)
     on conflict (day) do update set
       computed_at = now(),
       battlelog_polls = excluded.battlelog_polls,
       productive_polls = excluded.productive_polls,
       nothing_new_polls = excluded.nothing_new_polls,
       battles_captured = excluded.battles_captured,
       audited_polls = excluded.audited_polls,
       gaps = excluded.gaps,
       intervals = excluded.intervals,
       gap_intervals = excluded.gap_intervals,
       expected_gap = excluded.expected_gap,
       captured_gap = excluded.captured_gap,
       shortfall_gap = excluded.shortfall_gap,
       expected_no_gap = excluded.expected_no_gap,
       captured_no_gap = excluded.captured_no_gap,
       shortfall_no_gap = excluded.shortfall_no_gap,
       noise_rate = excluded.noise_rate,
       lost_battles = excluded.lost_battles,
       players_with_gaps = excluded.players_with_gaps`,
    [
      row.day,
      row.battlelog_polls,
      row.productive_polls,
      row.nothing_new_polls,
      row.battles_captured,
      row.audited_polls,
      row.gaps,
      row.intervals,
      row.gap_intervals,
      row.expected_gap,
      row.captured_gap,
      row.shortfall_gap,
      row.expected_no_gap,
      row.captured_no_gap,
      row.shortfall_no_gap,
      row.noise_rate,
      row.lost_battles,
      row.players_with_gaps,
    ],
  );
}

export function efficiencyEmf(row, now = Date.now()) {
  const polls = row.battlelog_polls ?? 0;
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [[]],
          Metrics: [
            { Name: "LostBattles", Unit: "Count" },
            { Name: "BattlelogPolls", Unit: "Count" },
            { Name: "NothingNewShare", Unit: "Percent" },
            { Name: "CaptureGaps", Unit: "Count" },
          ],
        },
      ],
    },
    LostBattles: row.lost_battles ?? 0,
    BattlelogPolls: polls,
    NothingNewShare:
      polls > 0
        ? Math.round(((row.nothing_new_polls ?? 0) / polls) * 1000) / 10
        : 0,
    CaptureGaps: row.gaps ?? 0,
    day: row.day ?? null,
  });
}

/** Rewrite the last `days` closed UTC days (yesterday and the two before
 *  it by default) and emit yesterday's line. `now` and `write` are
 *  injectable for tests. */
export async function captureEfficiency(
  databaseUrl,
  { now = new Date(), days = 3, write = (l) => process.stdout.write(l) } = {},
) {
  const started = Date.now();
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const out = { days: [], ms: 0 };
    const today = Date.parse(utcDay(now) + "T00:00:00Z");
    for (let i = days; i >= 1; i--) {
      const day = utcDay(today - i * DAY);
      const row = await efficiencyForDay(db, day);
      await upsert(db, row);
      out.days.push(row);
    }
    const yesterday = out.days.at(-1);
    if (yesterday) write(`${efficiencyEmf(yesterday, now.getTime())}\n`);
    out.ms = Date.now() - started;
    return out;
  } finally {
    await db.end();
  }
}
