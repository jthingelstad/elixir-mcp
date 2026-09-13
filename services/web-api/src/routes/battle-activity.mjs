import { json } from "../http.mjs";
import { normalizeTag, InvalidTagError } from "@elixir-mcp/contracts";

/**
 * Battle activity (0084): the nightly histogram for one of the account's
 * own players, shaped for the console graphic - a year of UTC days and a
 * 24x7 rhythm. One route, read-only; the row is the jobs Lambda's.
 *
 * The one rule that matters here: zero means "recorded, and nothing was
 * played". A day outside coverage (before the recording began, or one
 * the recorder marked incomplete) is `not_recorded` when the record holds
 * nothing for it, and `seen` when it holds battles anyway - history
 * imported before tracking, or appearances in other players' logs (King
 * Thing has 262 recorded battles since May against a recording that
 * began in September; the first cut hatched all of them, 2026-09-13).
 * The difference between "we were not looking" and "they did not play"
 * is the whole reason the record exists (docs/activity).
 */
const DAY_MS = 86_400_000;

function utcDay(at) {
  return new Date(at).toISOString().slice(0, 10);
}

/** The year of days ending on the histogram's own day: each with its
 *  count and status. Exported for the route test and the docs example. */
export function shapeDays(row, { windowDays = row?.window_days ?? 365 } = {}) {
  if (!row) return [];
  const end = Date.parse(utcDay(row.computed_at) + "T00:00:00Z");
  const from = row.recorded_from ? utcDay(row.recorded_from) : null;
  const marked = new Set(row.not_recorded_days ?? []);
  const counts = row.days ?? {};
  const out = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const day = utcDay(end - i * DAY_MS);
    const battles = counts[day] ?? 0;
    const covered = from !== null && day >= from && !marked.has(day);
    // recorded: Elixir was watching, the count is the whole day.
    // seen: battles are in the record for a day Elixir was NOT watching
    // (an appearance in another log, or history imported before the
    // recording began); the count is real, its completeness unknown.
    // not_recorded: nothing recorded and nobody was watching - unknown,
    // never zero.
    out.push({
      day,
      battles,
      status: covered ? "recorded" : battles > 0 ? "seen" : "not_recorded",
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
      // and a friend's or a stranger's rhythm is theirs.
      const { rows: claims } = await db.query(
        `select c.player_tag, p.name from claim c
           join player p on p.player_tag = c.player_tag
          where c.account_id = $1 and c.player_tag = $2`,
        [account.accountId, tag],
      );
      if (claims.length === 0) return json(404, { error: "not_yours" });
      const { rows } = await db.query(
        `select player_tag, computed_at, window_days, half_life_days, rhythm,
                rhythm_weight, rhythm_battles, days, not_recorded_days,
                recorded_from, first_battle_at, last_battle_at, battles_28d
           from player_activity where player_tag = $1`,
        [tag],
      );
      const row = rows[0] ?? null;
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
        half_life_days: row?.half_life_days ?? null,
        rhythm: row?.rhythm ?? null,
        rhythm_weight: row ? Number(row.rhythm_weight) : null,
        rhythm_battles: row?.rhythm_battles ?? null,
        battles_28d: row?.battles_28d ?? null,
        first_battle_at: row?.first_battle_at?.toISOString() ?? null,
        last_battle_at: row?.last_battle_at?.toISOString() ?? null,
        not_recorded_days: row ? (row.not_recorded_days?.length ?? 0) : null,
        days: shapeDays(row),
      });
    },
  };
}
