import { json } from "../http.mjs";
import { normalizeTag, InvalidTagError } from "@elixir-mcp/contracts";

/**
 * Battle activity (0084): the nightly activity row for one of the
 * account's own players, shaped for the console graphic - a year of UTC
 * days. One route, read-only; the row is the jobs Lambda's. The 24x7
 * rhythm it carried retired 2026-09-19.
 *
 * The one rule that matters here: zero means "we were reading this
 * player's log at the time, and nothing was played". Coverage is read
 * from the DATA, not from the recording row (Jamie, 2026-09-13: "rely on
 * the data being present"): a UTC day is covered when a battle-log read
 * for this player was admitted on that day or within the two days after
 * it (a log holds ~25 battles, so a read that soon still saw the day),
 * and not marked by the recorder (a capture-audit gap or an incomplete
 * coverage interval). A day WITH battles is always drawn with them,
 * however they arrived - imported history, appearances in other logs;
 * on a marked day they are flagged partial. The hatched cell is only a
 * day with nothing recorded that no log read covers: unknown, never
 * zero. The recording row's date is a footnote ("tracked since"), never
 * a colour. The first cut anchored on the row and hatched King Thing's
 * history from July; the second labelled it "outside coverage"; a
 * first-battle anchor would have painted a stray May appearance's seven
 * empty weeks as zeros. The log reads are the record of watching.
 */
const DAY_MS = 86_400_000;

function utcDay(at) {
  return new Date(at).toISOString().slice(0, 10);
}

/** The year of days ending on the activity row's own day: each with its
 *  count and status. Exported for the route test and the docs example. */
/** How many days after a UTC day a battle-log read still covers it. */
const READ_REACH_DAYS = 2;

/** The UTC days a set of battle-log read days covers. */
export function coveredDays(readDays) {
  const out = new Set();
  for (const d of readDays) {
    const t = Date.parse(d + "T00:00:00Z");
    for (let k = 0; k <= READ_REACH_DAYS; k += 1)
      out.add(utcDay(t - k * DAY_MS));
  }
  return out;
}

export function shapeDays(
  row,
  readDays = [],
  { windowDays = row?.window_days ?? 365 } = {},
) {
  if (!row) return [];
  const end = Date.parse(utcDay(row.computed_at) + "T00:00:00Z");
  const covered = coveredDays(readDays);
  const marked = new Set(row.not_recorded_days ?? []);
  const counts = row.days ?? {};
  const out = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const day = utcDay(end - i * DAY_MS);
    // A day is [battles, wins, losses] since 2026-09-15; a row the nightly
    // job has not rebuilt yet still holds the bare count, with no result
    // tallies to give.
    const v = counts[day];
    const [battles, wins, losses] = Array.isArray(v) ? v : [v ?? 0];
    const watched = covered.has(day) && !marked.has(day);
    out.push({
      day,
      battles,
      ...(battles > 0 && wins !== undefined ? { wins, losses } : {}),
      status: battles > 0 || watched ? "recorded" : "not_recorded",
      ...(battles > 0 && marked.has(day) ? { partial: true } : {}),
    });
  }
  return out;
}

export function battleActivityRoutes({ resolveAccount }) {
  return {
    "GET /api/me/battle-activity/*": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const segment = event.rawPath.split("/").pop();
      let tag;
      try {
        tag = normalizeTag(
          `#${decodeURIComponent(segment ?? "").replace(/^#/, "")}`,
        );
      } catch (err) {
        if (err instanceof InvalidTagError)
          return json(400, { error: "invalid_tag" });
        throw err;
      }
      // Your own players only: the graphic sits on the tracked record,
      // and a friend's or a stranger's year is theirs.
      const { rows: claims } = await db.query(
        `select c.player_tag, p.name from claim c
           join player p on p.player_tag = c.player_tag
          where c.account_id = $1 and c.player_tag = $2`,
        [account.accountId, tag],
      );
      if (claims.length === 0) return json(404, { error: "not_yours" });
      const { rows } = await db.query(
        `select player_tag, computed_at, window_days,
                array(select to_char(d, 'YYYY-MM-DD') from unnest(not_recorded_days) as d) as not_recorded_days,
                recorded_from, first_battle_at, last_battle_at, battles_28d
           from player_activity where player_tag = $1`,
        [tag],
      );
      const row = rows[0] ?? null;
      // The year's daily counts are the daily rollup summed over mode
      // (0123: player_activity.days retired - it was a nightly copy of
      // this), so today reads live rather than as of last night.
      if (row) {
        const { rows: daily } = await db.query(
          `select to_char(day, 'YYYY-MM-DD') as day,
                  sum(battles_captured)::int as battles,
                  sum(wins)::int as wins, sum(losses)::int as losses
             from player_daily_battle_rollup
            where player_tag = $1
              and day > ($2::timestamptz - make_interval(days => $3))::date
            group by day`,
          [tag, row.computed_at, row.window_days],
        );
        row.days = Object.fromEntries(
          daily.map((d) => [d.day, [d.battles, d.wins, d.losses]]),
        );
      }
      // The record of watching: every admitted battle-log read for this
      // player in the window, by UTC day. Import-era receipts carry the
      // export's own fetch time, so replayed history is covered by the
      // reads that produced it.
      const { rows: reads } = row
        ? await db.query(
            `select distinct to_char(fetched_at at time zone 'UTC', 'YYYY-MM-DD') as day
               from api_receipt
              where endpoint = 'player_battlelog' and entity_key = $1
                and admission = 'admitted'
                and fetched_at > $2::timestamptz - make_interval(days => $3)`,
            [tag, row.computed_at, row.window_days + READ_REACH_DAYS],
          )
        : { rows: [] };
      const readDays = reads.map((r) => r.day);
      const { rows: rec } = await db.query(
        `select min(created_at) as recorded_from from recording
          where subject_type = 'player' and subject_tag = $1`,
        [tag],
      );
      return json(200, {
        player_tag: tag,
        name: claims[0].name ?? null,
        // null until the nightly job has run for this player: the page
        // says "not computed yet", never an empty year.
        computed_at: row?.computed_at?.toISOString() ?? null,
        recorded_from:
          row?.recorded_from?.toISOString() ??
          rec[0]?.recorded_from?.toISOString() ??
          null,
        window_days: row?.window_days ?? 365,
        battles_28d: row?.battles_28d ?? null,
        first_battle_at: row?.first_battle_at?.toISOString() ?? null,
        last_battle_at: row?.last_battle_at?.toISOString() ?? null,
        not_recorded_days: row ? (row.not_recorded_days?.length ?? 0) : null,
        // The first and last UTC day a log read covered: what the legend
        // calls "log read since".
        log_reads_from: readDays.length ? readDays.sort()[0] : null,
        log_read_days: readDays.length,
        days: shapeDays(row, readDays),
      });
    },
  };
}
