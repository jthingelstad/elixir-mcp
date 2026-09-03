/**
 * The planning tick — DESIGN §5.1-§5.3, elixir-bot's polling.py pattern
 * re-expressed for Postgres + a ~1-minute serverless tick.
 *
 * Order within a tick (the ordering IS the design):
 *   1. settle the global token bucket (budget_state singleton row);
 *   2. seed poll_state rows for new subjects (warm, heat=2);
 *   3. decay heat — epoch-anchored (one tier per DECAY_EPOCH without
 *      activity), BEFORE planning (elixir-bot's ordering lesson);
 *   4. select eligible work: due (past tier cadence) OR starved (past the
 *      fairness floor). Sort: starved FIRST (floors strictly dominate
 *      heat), then heat, then overdue, then endpoint/tag for determinism;
 *   5. take at most the bulk share of available tokens, stamp
 *      last_planned_at, decrement tokens, return jobs.
 *
 * The live lane never goes through this planner — its reserve is the
 * budget the planner deliberately does not spend (live_reserve fraction).
 */

import { inPreResetWindow, preResetWindowStart } from '@elixir-mcp/contracts';

const MINUTE = 60_000;

// Cadence table (minutes) — §5.3. Data, not code.
export const CADENCE = {
  player_battlelog: { hot: 15, warm: 60, cold: 360, floor: 1440 },
  player: { hot: 120, warm: 480, cold: 1440, floor: 4320 },
  clan: { hot: 15, warm: 15, cold: 15, floor: 60 },
  // Fixed 30m; the warDay/training cadence split can come later.
  currentriverrace: { hot: 30, warm: 30, cold: 30, floor: 120 },
  // Daily log poll: backfill at enrollment IS the first poll; thereafter
  // it heals gaps and delivers final standings (rank/trophyChange).
  riverracelog: { hot: 1440, warm: 1440, cold: 1440, floor: 2880 },
};

export const DECAY_EPOCH_MINUTES = 60;
const IN_FLIGHT_SUPPRESSION_MINUTES = 15;
const BUCKET_CAP_SECONDS = 300; // small carryover; never a quota multiplier

function tier(heat) {
  return heat >= 3 ? 'hot' : heat >= 1 ? 'warm' : 'cold';
}

export async function settleBudget(db, now) {
  const {
    rows: [b],
  } = await db.query('select tokens, rate_per_sec, live_reserve, settled_at from budget_state');
  const elapsedSec = Math.max(0, (now.getTime() - b.settled_at.getTime()) / 1000);
  const cap = Number(b.rate_per_sec) * BUCKET_CAP_SECONDS;
  const tokens = Math.min(cap, Number(b.tokens) + Number(b.rate_per_sec) * elapsedSec);
  await db.query('update budget_state set tokens = $1, settled_at = $2', [tokens, now]);
  return { tokens, liveReserve: Number(b.live_reserve) };
}

async function seedPollState(db) {
  // Player endpoints for actively recorded players; clan endpoint for
  // followed clans (clan auto-follow: derived from recorded players'
  // profile stamps, §4.2).
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    select r.subject_tag, e.endpoint
    from recording r cross join (values ('player_battlelog'), ('player')) e(endpoint)
    where r.subject_type = 'player' and r.status = 'active'
    on conflict do nothing`);
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    select distinct p.last_known_clan_tag, 'clan'
    from recording r
    join player p on p.player_tag = r.subject_tag
    where r.subject_type = 'player' and r.status = 'active'
      and p.last_known_clan_tag is not null
    on conflict do nothing`);
  // Clan recording (V1.5): the clan's own heartbeat + riverrace capture,
  // and player endpoints for every OPEN member. Roster-driven: joins get
  // seeded on the tick after the roster observes them; leavers fall out
  // via the eligibility clause (their poll_state rows go dormant).
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    select r.subject_tag, e.endpoint
    from recording r cross join (values ('clan'), ('currentriverrace'), ('riverracelog')) e(endpoint)
    where r.subject_type = 'clan' and r.status = 'active'
    on conflict do nothing`);
  await db.query(`
    insert into poll_state (subject_tag, endpoint)
    select cm.player_tag, e.endpoint
    from recording r
    join clan_membership cm on cm.clan_tag = r.subject_tag and cm.left_observed_at is null
    cross join (values ('player_battlelog'), ('player')) e(endpoint)
    where r.subject_type = 'clan' and r.status = 'active'
    on conflict do nothing`);
}

async function decayHeat(db, now) {
  await db.query(
    `update poll_state
     set heat = heat - 1, heat_updated_at = $1
     where heat > 0 and heat_updated_at < $1::timestamptz - make_interval(mins => $2)`,
    [now, DECAY_EPOCH_MINUTES],
  );
}

async function selectEligible(db, now) {
  // reference freshness = the later of last plan and last admission; due
  // and starved both respect a short in-flight window so a pending job
  // isn't re-enqueued every tick.
  const { rows } = await db.query(
    `
    with state as (
      select ps.subject_tag, ps.endpoint, ps.heat, ps.last_planned_at, ps.last_admitted_at,
             greatest(coalesce(ps.last_planned_at, 'epoch'), coalesce(ps.last_admitted_at, 'epoch')) as reference
      from poll_state ps
      where (ps.endpoint in ('player_battlelog', 'player') and (
               exists (
                 select 1 from recording r
                 where r.subject_type = 'player' and r.subject_tag = ps.subject_tag and r.status = 'active')
               or exists (
                 select 1 from recording r
                 join clan_membership cm on cm.clan_tag = r.subject_tag
                   and cm.player_tag = ps.subject_tag and cm.left_observed_at is null
                 where r.subject_type = 'clan' and r.status = 'active')))
         or (ps.endpoint = 'clan' and (
               exists (
                 select 1 from recording r join player p on p.player_tag = r.subject_tag
                 where r.subject_type = 'player' and r.status = 'active'
                   and p.last_known_clan_tag = ps.subject_tag)
               or exists (
                 select 1 from recording r
                 where r.subject_type = 'clan' and r.subject_tag = ps.subject_tag and r.status = 'active')))
         or (ps.endpoint in ('currentriverrace', 'riverracelog') and exists (
               select 1 from recording r
               where r.subject_type = 'clan' and r.subject_tag = ps.subject_tag and r.status = 'active'))
    )
    select subject_tag, endpoint, heat, last_planned_at, last_admitted_at, reference
    from state`,
  );

  const nowMs = now.getTime();
  // Season-roll watcher (§5.3, V1): in the hour before the Monday-00:10Z
  // donation reset, profile polls are forced for every recorded player not
  // yet captured inside the window — the counter is irrecoverable after.
  const preReset = inPreResetWindow(now);
  const windowStartMs = preReset ? preResetWindowStart(now).getTime() : 0;

  const eligible = [];
  for (const r of rows) {
    const cadence = CADENCE[r.endpoint];
    if (!cadence) continue;
    const referenceMs = r.reference.getTime();
    const dueAfter = cadence[tier(r.heat)] * MINUTE;
    const due = nowMs - referenceMs >= dueAfter;
    const admittedMs = r.last_admitted_at ? r.last_admitted_at.getTime() : 0;
    const plannedMs = r.last_planned_at ? r.last_planned_at.getTime() : 0;
    const forcedPreReset =
      preReset &&
      r.endpoint === 'player' &&
      admittedMs < windowStartMs &&
      plannedMs < windowStartMs;
    const starved =
      forcedPreReset ||
      (nowMs - admittedMs >= cadence.floor * MINUTE &&
        nowMs - plannedMs >= IN_FLIGHT_SUPPRESSION_MINUTES * MINUTE);
    if (!due && !starved) continue;
    eligible.push({
      subject_tag: r.subject_tag,
      endpoint: r.endpoint,
      heat: r.heat,
      starved,
      overdueMs: nowMs - referenceMs,
    });
  }

  // Starved first (fairness floors strictly dominate heat), then heat,
  // then most-overdue, then deterministic tie-break.
  eligible.sort(
    (a, b) =>
      Number(b.starved) - Number(a.starved) ||
      b.heat - a.heat ||
      b.overdueMs - a.overdueMs ||
      a.endpoint.localeCompare(b.endpoint) ||
      a.subject_tag.localeCompare(b.subject_tag),
  );
  return eligible;
}

/**
 * One planning tick. Returns the jobs to enqueue on the bulk lane.
 * @param {import('pg').Client} db
 * @param {Date} now injectable for tests
 */
export async function planTick(db, now = new Date()) {
  const { tokens, liveReserve } = await settleBudget(db, now);
  await seedPollState(db);
  await decayHeat(db, now);

  const bulkBudget = Math.floor(tokens * (1 - liveReserve));
  if (bulkBudget <= 0) return { jobs: [], tokens, bulkBudget };

  const eligible = await selectEligible(db, now);
  const selected = eligible.slice(0, bulkBudget);

  for (const job of selected) {
    await db.query(
      `update poll_state set last_planned_at = $3 where subject_tag = $1 and endpoint = $2`,
      [job.subject_tag, job.endpoint, now],
    );
  }
  if (selected.length > 0) {
    await db.query('update budget_state set tokens = tokens - $1', [selected.length]);
  }

  return {
    jobs: selected.map((j) => ({
      endpoint: j.endpoint,
      entity_key: j.subject_tag,
      lane: 'bulk',
    })),
    tokens,
    bulkBudget,
  };
}
