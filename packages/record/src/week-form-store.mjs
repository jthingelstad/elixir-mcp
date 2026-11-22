/**
 * week_form, stored (0311, 2026-11-22): the one reading a player's closed
 * game week gives, written once a week by the jobs Lambda and read by the
 * Timeline by key. Computed on every Timeline read it cost about 30,000
 * shared buffers on the signed-in budget's record; stored, the read is a
 * primary-key lookup (docs/notes/2026-11-22-week-form.md).
 *
 * The reading is Stats' "This week vs your last 4" (`weekFormRise`, the
 * minimum and the rise, @elixir-mcp/record/form), counted with
 * battles_performance's own SQL (@elixir-mcp/record/win-rate-sql): the
 * mode filter's rule, boat defenses never, a battle with no outcome never.
 * One mode at a time, never pooled; of the modes that rose, the one with
 * the most decided battles in the week (ties in Stats' chip order). Only a
 * qualifying week has a row.
 *
 * Battles count when the record had learned them by the week's end plus
 * WEEK_FORM_GRACE_MS (`battle.created_at`): a battle learned later never
 * changes the reading, and a second run for the same week writes the same
 * rows. Until then (no late battles) the numbers equal battles_performance's
 * for the same two windows.
 */
import {
  FORM_MIN_BATTLES,
  FORM_PREVIOUS_WEEKS,
  weekFormRise,
} from "./form.mjs";
import { notBoatDefenseOf } from "./boat-defense-sql.mjs";
import {
  decidedLossesSql,
  decidedWinsSql,
  modeCaseSql,
  winRate,
} from "./win-rate-sql.mjs";

const HOUR_MS = 3_600_000;
export const WEEK_MS = 7 * 24 * HOUR_MS;

/** How long after a game week ends (Monday 10:00Z) its battles may still
 *  arrive and count: a battle log polled late still lands. Six hours is a
 *  few of the slowest poll cycles; a battle learned after it never changes
 *  the item. The weekly run fires once it has passed. [engineering
 *  default, 2026-11-22] */
export const WEEK_FORM_GRACE_MS = 6 * HOUR_MS;

/** The modes week_form reads, one at a time and never pooled: Stats'
 *  chips (apps/web/src/stats/stats.js MODES), in their order. */
export const WEEK_FORM_MODES = ["ladder", "ranked", "war", "event", "casual"];

/** Players per counting statement: bounded, so a run never reads every
 *  player's five weeks in one go. */
export const WEEK_FORM_BATCH = 50;

const ts = (ms) => `to_timestamp(${Math.floor(ms)} / 1000.0)`;
const iso = (ms) => new Date(ms).toISOString();

/** The start of the latest game week whose end plus the grace is at or
 *  before `nowMs`: the week a run at `nowMs` writes. */
export function weekFormDue(nowMs) {
  const d = new Date(nowMs - WEEK_FORM_GRACE_MS);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  let end = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - dow,
    10,
  );
  if (end > nowMs - WEEK_FORM_GRACE_MS) end -= WEEK_MS;
  return end - WEEK_MS;
}

/** A boat row's side, by key: the covering index has no side, and only
 *  boat rows ask, so the participant scan stays index-only. */
const SIDE = `(select sp.side from battle_participant sp
   where sp.battle_id = bp.battle_id and sp.player_tag = bp.player_tag)`;

/** Whether the player could have a reading: an index-only count of their
 *  decided battles (`type_class` is the battle's own, denormalized, 0095)
 *  in the week and in the four before it. A mode's decided battles are a
 *  part of each, so under FORM_MIN_BATTLES on either side no mode can
 *  qualify, and the player's battles are never looked up by key. */
const gateSql = (tagSql, start) => {
  const lo = start - FORM_PREVIOUS_WEEKS * WEEK_MS;
  const side = (from, to) =>
    `count(*) filter (where gp.battle_time >= ${ts(from)} and gp.battle_time < ${ts(to)}) >= ${FORM_MIN_BATTLES}`;
  return `(select ${side(start, start + WEEK_MS)} and ${side(lo, start)}
     from battle_participant gp
    where gp.player_tag = ${tagSql}
      and gp.battle_time >= ${ts(lo)} and gp.battle_time < ${ts(start + WEEK_MS)}
      and gp.type_class = 'pvp' and gp.outcome in ('win', 'loss'))`;
};

/**
 * A player's battles in the game week starting at `start` (`side` 'week')
 * and the four before it ('previous'), counted per mode as
 * battles_performance's window counts them, over the battles learned by
 * the week's end plus the grace. The participant scan stays on its
 * covering index; each battle is read by key once, on
 * battle_timeline_cover, for its type, event tag, boat side and when it
 * was learned.
 */
export const weekFormCountsSql = (tagSql, start) => {
  const lo = start - FORM_PREVIOUS_WEEKS * WEEK_MS;
  const hi = start + WEEK_MS;
  return `select g.mode,
          case when bp.battle_time >= ${ts(start)} then 'week' else 'previous' end as side,
          count(*)::int as battles,
          count(*) filter (where bp.outcome = 'win')::int as wins,
          count(*) filter (where bp.outcome = 'loss')::int as losses,
          ${decidedWinsSql("bp.outcome", "bp.type_class")}::int as decided_wins,
          ${decidedLossesSql("bp.outcome", "bp.type_class")}::int as decided_losses
     from battle_participant bp
     cross join lateral (
       select b.type, b.event_tag, b.boat_battle_side, b.created_at from battle b
        where b.battle_id = bp.battle_id limit 1) b
     cross join lateral (select ${modeCaseSql(WEEK_FORM_MODES)} as mode) g
    where bp.player_tag = ${tagSql} and bp.outcome is not null
      and bp.battle_time >= ${ts(lo)} and bp.battle_time < ${ts(hi)}
      and b.created_at < ${ts(hi + WEEK_FORM_GRACE_MS)}
      and ${notBoatDefenseOf("bp", "b", SIDE)}
      and g.mode is not null
      and ${gateSql(tagSql, start)}
    group by 1, 2`;
};

/** The reading one player's counts give (weekFormCountsSql's rows), or
 *  null: the mode that rose at least WEEK_FORM_RISE with both sides at
 *  the minimum, the one with the most decided battles in the week. */
export function weekFormReading(rows, start) {
  const sideOf = (mode, side) => {
    const r = rows.find((x) => x.mode === mode && x.side === side);
    const dw = r?.decided_wins ?? 0;
    const decided = dw + (r?.decided_losses ?? 0);
    return {
      battles: r?.battles ?? 0,
      wins: r?.wins ?? 0,
      losses: r?.losses ?? 0,
      decided_battles: decided,
      win_rate: winRate(dw, decided),
    };
  };
  let best = null;
  for (const mode of WEEK_FORM_MODES) {
    const week = sideOf(mode, "week");
    const previous = sideOf(mode, "previous");
    if (!weekFormRise({ window: week, compare_window: previous }, mode))
      continue;
    if (!best || week.decided_battles > best.week.decided_battles)
      best = { mode, week, previous };
  }
  return best && { week_start: iso(start), ...best };
}

/** The claimed players after `after` (in tag order), `limit` of them:
 *  a player reaches a Timeline only through a claim (subjectsFor). */
const PLAYERS_SQL = `select distinct player_tag from claim
   where player_tag > $1 order by player_tag limit $2`;

/** The batch's readings for the week, one statement. */
const countsBatchSql = (start) =>
  `select t.tag as batch_tag, x.*
     from unnest($1::text[]) as t(tag)
     cross join lateral (${weekFormCountsSql("t.tag", start)} offset 0) x`;

/** Write the batch: a reading that changed or is new is upserted (its
 *  computed_at moves only then), and a stored reading the week no longer
 *  gives goes. Unchanged rows are left alone, so a second run is a no-op. */
async function writeBatch(db, start, tags, readings) {
  const rows = readings.map((r) => [
    r.player_tag,
    r.mode,
    r.week.battles,
    r.week.decided_battles,
    r.week.wins,
    r.week.losses,
    r.week.win_rate,
    r.previous.decided_battles,
    r.previous.win_rate,
  ]);
  const col = (i) => rows.map((r) => r[i]);
  const { rows: out } = await db.query(
    `with fresh as (
       select * from unnest($3::text[], $4::text[], $5::int[], $6::int[], $7::int[],
                            $8::int[], $9::numeric[], $10::int[], $11::numeric[])
         as f(player_tag, mode, week_battles, week_decided, week_wins, week_losses,
              week_win_rate, prev_decided, prev_win_rate)
     ), gone as (
       delete from player_week_form w
        where w.week_start = $2 and w.player_tag = any($1::text[])
          and w.player_tag not in (select player_tag from fresh)
       returning 1
     ), put as (
       insert into player_week_form as w
         (player_tag, week_start, mode, week_battles, week_decided, week_wins,
          week_losses, week_win_rate, prev_decided, prev_win_rate)
       select player_tag, $2, mode, week_battles, week_decided, week_wins,
              week_losses, week_win_rate, prev_decided, prev_win_rate
         from fresh
       on conflict (player_tag, week_start) do update set
         mode = excluded.mode, week_battles = excluded.week_battles,
         week_decided = excluded.week_decided, week_wins = excluded.week_wins,
         week_losses = excluded.week_losses, week_win_rate = excluded.week_win_rate,
         prev_decided = excluded.prev_decided, prev_win_rate = excluded.prev_win_rate,
         computed_at = now()
       where (w.mode, w.week_battles, w.week_decided, w.week_wins, w.week_losses,
              w.week_win_rate, w.prev_decided, w.prev_win_rate)
             is distinct from
             (excluded.mode, excluded.week_battles, excluded.week_decided,
              excluded.week_wins, excluded.week_losses, excluded.week_win_rate,
              excluded.prev_decided, excluded.prev_win_rate)
       returning 1
     )
     select (select count(*) from gone)::int as removed,
            (select count(*) from put)::int as written`,
    [tags, iso(start), ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(col)],
  );
  return out[0];
}

/**
 * Store the week's readings (`weekStartMs`, a Monday 10:00Z) for every
 * claimed player, WEEK_FORM_BATCH at a time in tag order: one statement
 * for the players, one to count, one to write, per batch. Idempotent:
 * the counts read only battles learned by the week's end plus the grace,
 * and an unchanged reading is not rewritten. `remainingMs` (a function)
 * stops the run between batches once under `reserveMs`; the answer says
 * `incomplete` and where it stopped (`after`), and a run from there, or
 * from the start, finishes it.
 */
export async function storeWeekForms(
  db,
  weekStartMs,
  {
    batch = WEEK_FORM_BATCH,
    after = "",
    remainingMs = null,
    reserveMs = 60_000,
  } = {},
) {
  const out = {
    week_start: iso(weekStartMs),
    players: 0,
    readings: 0,
    written: 0,
    removed: 0,
    incomplete: false,
    after,
  };
  for (;;) {
    const left = remainingMs?.() ?? null;
    if (left !== null && left < reserveMs) {
      out.incomplete = true;
      return out;
    }
    const { rows: players } = await db.query(PLAYERS_SQL, [out.after, batch]);
    if (!players.length) return out;
    const tags = players.map((p) => p.player_tag);
    const { rows } = await db.query(countsBatchSql(weekStartMs), [tags]);
    const readings = [];
    for (const tag of tags) {
      const r = weekFormReading(
        rows.filter((x) => x.batch_tag === tag),
        weekStartMs,
      );
      if (r) readings.push({ player_tag: tag, ...r });
    }
    const w = await writeBatch(db, weekStartMs, tags, readings);
    out.players += tags.length;
    out.readings += readings.length;
    out.written += w.written;
    out.removed += w.removed;
    out.after = tags.at(-1);
    if (players.length < batch) return out;
  }
}

/** The stored reading as the Timeline tells it: the item's facts' `week`
 *  and `previous` and its mode (a player_week_form row). */
export function weekFormFacts(row) {
  const start = new Date(row.week_start).getTime();
  const num = (v) => (v == null ? null : Number(v));
  return {
    mode: row.mode,
    week: {
      from: iso(start),
      to: iso(start + WEEK_MS),
      battles: row.week_battles,
      decided_battles: row.week_decided,
      wins: row.week_wins,
      losses: row.week_losses,
      win_rate: num(row.week_win_rate),
    },
    previous: {
      from: iso(start - FORM_PREVIOUS_WEEKS * WEEK_MS),
      to: iso(start),
      weeks: FORM_PREVIOUS_WEEKS,
      decided_battles: row.prev_decided,
      win_rate: num(row.prev_win_rate),
    },
  };
}
