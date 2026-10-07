import { json } from "../http.mjs";
import { normalizeTag, InvalidTagError } from "@elixir-mcp/contracts";
import { battleCapture } from "@elixir-mcp/record/capture-state";

/** The claimed player's year of UTC days. Canonical battles and comparable
 * profile intervals are read in one database snapshot. Poll success, tracking
 * dates and cached nightly gap marks never establish a quiet day. */
const DAY_MS = 86_400_000;
const utcDay = (at) => new Date(at).toISOString().slice(0, 10);

export function shapeDays(
  row,
  intervals = [],
  { windowDays = row?.window_days ?? 365 } = {},
) {
  if (!row) return [];
  const asOf = new Date(row.as_of ?? row.computed_at).getTime();
  const end = Date.parse(utcDay(asOf) + "T00:00:00Z");
  const out = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const from = end - i * DAY_MS;
    const day = utcDay(from);
    const v = row.days?.[day];
    const [battles, wins, losses] = Array.isArray(v) ? v : [v ?? 0];
    const capture = battleCapture({
      from,
      to: from + DAY_MS,
      intervals,
      recordedBattles: battles,
      readComplete: from + DAY_MS <= asOf,
    });
    out.push({
      day,
      battles,
      ...(battles > 0 && wins !== undefined ? { wins, losses } : {}),
      coverage: capture.coverage,
      status:
        capture.has_battles || capture.quiet ? "recorded" : "not_recorded",
      ...(battles > 0 && capture.coverage !== "complete"
        ? { partial: true }
        : {}),
    });
  }
  return out;
}

/** One query is essential: late canonical arrivals must repair the interval
 * and daily counts together, never turn an earlier empty projection into zero.
 * The player's time index bounds the year and each observation interval. */
async function readEvidence(db, tag, from, asOf) {
  const {
    rows: [row],
  } = await db.query(
    `with snapshots as (
       select profile_observed_at as observed_to,
              lag(profile_observed_at) over w as observed_from,
              battle_count - lag(battle_count) over w as expected_battles
       from player_snapshot_daily
       where player_tag = $1 and snapshot_kind = 'daily'
         and profile_observed_at is not null and profile_observed_at <= $3::timestamptz
       window w as (order by snapshot_date)
     ), measured as (
       select observed_from, observed_to, expected_battles,
              (select count(*)::int from battle_participant bp
               where bp.player_tag = $1 and bp.battle_time > observed_from
                 and bp.battle_time <= observed_to) as captured_battles
       from snapshots where observed_from is not null
         and observed_to > observed_from and observed_to > $2::timestamptz
     ), daily as (
       select to_char(battle_time at time zone 'UTC', 'YYYY-MM-DD') as day,
              count(*)::int as battles,
              count(*) filter (where outcome = 'win')::int as wins,
              count(*) filter (where outcome = 'loss')::int as losses
       from battle_participant
       where player_tag = $1 and battle_time >= $2::timestamptz
         and battle_time <= $3::timestamptz group by 1
     )
     select (select coalesce(jsonb_agg(to_jsonb(daily)), '[]'::jsonb) from daily) as days,
            (select coalesce(jsonb_agg(jsonb_build_object(
              'observed_from', observed_from, 'observed_to', observed_to,
              'expected_battles', expected_battles, 'captured_battles', captured_battles,
              'is_complete', case when expected_battles is not null and expected_battles >= 0
                 and captured_battles <= expected_battles then captured_battles = expected_battles
                 else null end)), '[]'::jsonb) from measured) as intervals`,
    [tag, from, asOf],
  );
  return row;
}

export function battleActivityRoutes({ resolveAccount }) {
  return {
    "GET /api/me/battle-activity/*": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      let tag;
      try {
        tag = normalizeTag(
          `#${decodeURIComponent(event.rawPath.split("/").pop() ?? "").replace(/^#/, "")}`,
        );
      } catch (err) {
        if (err instanceof InvalidTagError || err instanceof URIError)
          return json(400, { error: "invalid_tag" });
        throw err;
      }
      const { rows: claims } = await db.query(
        `select c.player_tag, p.name from claim c join player p on p.player_tag = c.player_tag
         where c.account_id = $1 and c.player_tag = $2`,
        [account.accountId, tag],
      );
      if (!claims.length) return json(404, { error: "not_yours" });
      const {
        rows: [row],
      } = await db.query(
        `select computed_at, recorded_from, first_battle_at, last_battle_at, battles_28d
         from player_activity where player_tag = $1`,
        [tag],
      );
      const asOf = new Date();
      const windowDays = 365;
      const from = new Date(
        Date.parse(utcDay(asOf) + "T00:00:00Z") - (windowDays - 1) * DAY_MS,
      );
      const evidence = await readEvidence(db, tag, from, asOf);
      const days = shapeDays(
        {
          as_of: asOf,
          window_days: windowDays,
          days: Object.fromEntries(
            evidence.days.map((d) => [d.day, [d.battles, d.wins, d.losses]]),
          ),
        },
        evidence.intervals,
      );
      const { rows: rec } = await db.query(
        `select min(created_at) as recorded_from from recording
         where subject_type = 'player' and subject_tag = $1`,
        [tag],
      );
      return json(200, {
        player_tag: tag,
        name: claims[0].name ?? null,
        as_of: asOf.toISOString(),
        // Nightly metadata stays dated separately from the live evidence read.
        computed_at: row?.computed_at?.toISOString() ?? null,
        recorded_from:
          row?.recorded_from?.toISOString() ??
          rec[0]?.recorded_from?.toISOString() ??
          null,
        window_days: windowDays,
        battles_28d: row?.battles_28d ?? null,
        first_battle_at: row?.first_battle_at?.toISOString() ?? null,
        last_battle_at: row?.last_battle_at?.toISOString() ?? null,
        not_recorded_days: days.filter((d) => d.status === "not_recorded")
          .length,
        days,
      });
    },
  };
}
