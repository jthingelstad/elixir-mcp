/**
 * The read facts (0259): what a year-long reader needs to know about the
 * record's own reads, kept apart from api_receipt, which is an
 * operational log kept 28 days (Jamie, 2026-11-13: "Operational logs i
 * would keep for 28 days"; the record keeps "a 1 year data retention").
 *
 *  - admitted_read_day: every admitted read of a clan roster ('clan') and
 *    of the events list ('events'), its instant, one row per subject and
 *    UTC day, and the day's first read by a live collector (not the
 *    elixir-bot import). Role history, each member's place at a war
 *    finish, war award absence evidence and the game_events calendar
 *    read it.
 *  - battlelog_read_gap: the stretches of a day or more in which a
 *    player's battle log went unread, and the time before its first read.
 *    A quiet member's days_since_poll reads it.
 *
 * Ingest writes both as it admits a read (recordReadFacts, in the
 * receipt's transaction); backfillReadFacts fills them from the receipts
 * still held, once, before the receipt trim runs. No reader outside this
 * file and the retention trim reads api_receipt for anything older than
 * 28 days (services/jobs/test/receipt-readers.test.mjs).
 */

/** Endpoints whose admitted reads admitted_read_day keeps. */
export const READ_DAY_ENDPOINTS = Object.freeze(["clan", "events"]);

/** The collector whose receipts are the elixir-bot history import: its
 *  roster reads count as reads, but role history starts after them. */
export const IMPORT_GATEWAY = "backfill-elixir-bot";

const DAY_MS = 86_400_000;

/**
 * Record one admitted read's facts. Called by ingest inside the receipt's
 * transaction, after the receipt insert and before poll_state moves.
 * `db` is the transaction's client.
 */
export async function recordReadFacts(
  db,
  { endpoint, entityKey, fetchedAt, gatewayId },
) {
  if (READ_DAY_ENDPOINTS.includes(endpoint)) {
    await db.query(
      `insert into admitted_read_day as d (endpoint, entity_key, day, read_at, first_live_at)
       select $1, $2, ($3::timestamptz at time zone 'UTC')::date, array[$3::timestamptz],
              case when exists (select 1 from gateway g
                                 where g.gateway_id::text = $4 and g.name <> '${IMPORT_GATEWAY}')
                   then $3::timestamptz end
       on conflict (endpoint, entity_key, day) do update
         set read_at = case when excluded.read_at[1] = any(d.read_at) then d.read_at
                            else d.read_at || excluded.read_at end,
             first_live_at = least(d.first_live_at, excluded.first_live_at)`,
      [endpoint, entityKey, fetchedAt, String(gatewayId)],
    );
    return;
  }
  if (endpoint !== "player_battlelog") return;
  const at = new Date(fetchedAt);
  // The read before this one is poll_state's, which this transaction
  // moves next; the row lock keeps two submissions for one player in
  // order.
  const {
    rows: [ps],
  } = await db.query(
    `select last_admitted_at from poll_state
      where subject_tag = $1 and endpoint = 'player_battlelog' for update`,
    [entityKey],
  );
  const prev = ps?.last_admitted_at ?? null;
  const gap = (from, to) =>
    db.query(
      `insert into battlelog_read_gap (player_tag, read_at, next_read_at)
       values ($1, $2, $3) on conflict (player_tag, next_read_at) do nothing`,
      [entityKey, from, to],
    );
  if (prev === null) {
    await gap(null, at);
    return;
  }
  if (prev.getTime() <= at.getTime()) {
    if (at.getTime() - prev.getTime() >= DAY_MS) await gap(prev, at);
    return;
  }
  // A read admitted late, inside a stretch already recorded: split it.
  const {
    rows: [open],
  } = await db.query(
    `delete from battlelog_read_gap
      where (player_tag, next_read_at) = (
        select player_tag, next_read_at from battlelog_read_gap
         where player_tag = $1 and next_read_at > $2
           and (read_at is null or read_at < $2)
         order by next_read_at limit 1)
      returning read_at, next_read_at`,
    [entityKey, at],
  );
  if (!open) return;
  if (open.read_at === null || at.getTime() - open.read_at.getTime() >= DAY_MS)
    await gap(open.read_at, at);
  if (open.next_read_at.getTime() - at.getTime() >= DAY_MS)
    await gap(at, open.next_read_at);
}

/** SQL: a clan's last admitted roster read at or before `at` (both SQL
 *  expressions), or null. */
export const rosterReadAtOrBefore = (clan, at) =>
  `(select x from admitted_read_day d cross join lateral unnest(d.read_at) as x
     where d.endpoint = 'clan' and d.entity_key = ${clan}
       and d.day <= (${at} at time zone 'UTC')::date and x <= ${at}
     order by d.day desc, x desc limit 1)`;

/** SQL: a clan's first admitted roster read at or after `at`, or null. */
export const rosterReadAtOrAfter = (clan, at) =>
  `(select x from admitted_read_day d cross join lateral unnest(d.read_at) as x
     where d.endpoint = 'clan' and d.entity_key = ${clan}
       and d.day >= (${at} at time zone 'UTC')::date and x >= ${at}
     order by d.day, x limit 1)`;

/** SQL: where a clan's role history begins, its first admitted roster read
 *  by a live collector (role changes are events only from there: the
 *  imported history wrote tenure and no events). */
export const roleHistorySinceSql = (clan) =>
  `select min(first_live_at) as role_history_since
     from admitted_read_day
    where endpoint = 'clan' and entity_key = ${clan}`;

/**
 * SQL: whole days from a player's last admitted battle-log read before
 * `before` to `at` (`before` is `at` plus a millisecond: a read at `at`
 * counts), or null when no read came before it.
 *
 * The latest read is poll_state's. Before it, a read before `before`
 * either opened a stretch of a day or more that `at` sits in (a
 * battlelog_read_gap row), or it is under a day old, which counts 0. The
 * null-opened row stands for the time before the first read.
 */
export const daysSincePollSql = (tag, at, before) =>
  `(select nullif(case
      when l.last is null then -99
      when l.last < ${before}
        then floor(extract(epoch from (${at} - l.last)) / 86400)::int
      else coalesce(
        (select case when g.read_at is null then -99
                     else floor(extract(epoch from (${at} - g.read_at)) / 86400)::int end
           from battlelog_read_gap g
          where g.player_tag = ${tag} and g.next_read_at >= ${before}
            and (g.read_at is null or g.read_at < ${before})
          order by g.next_read_at limit 1),
        0)
      end, -99)
     from (select (select ps.last_admitted_at from poll_state ps
                    where ps.subject_tag = ${tag} and ps.endpoint = 'player_battlelog') as last) l)`;

/** The order the backfill walks: the read-day endpoints, then battle logs. */
const PHASES = Object.freeze([...READ_DAY_ENDPOINTS, "player_battlelog"]);

const FILL_DAYS = `insert into admitted_read_day as d (endpoint, entity_key, day, read_at, first_live_at)
  select r.endpoint, r.entity_key, (r.fetched_at at time zone 'UTC')::date,
         array_agg(distinct r.fetched_at),
         min(r.fetched_at) filter (where g.name <> '${IMPORT_GATEWAY}')
    from api_receipt r left join gateway g on g.gateway_id = r.gateway_id
   where r.endpoint = $1 and r.entity_key = $2 and r.admission = 'admitted'
   group by 1, 2, 3
  on conflict (endpoint, entity_key, day) do update
    set read_at = array(select distinct u from unnest(d.read_at || excluded.read_at) as u order by u),
        first_live_at = least(d.first_live_at, excluded.first_live_at)
    where not (excluded.read_at <@ d.read_at)
       or d.first_live_at is distinct from least(d.first_live_at, excluded.first_live_at)
  returning 1`;

const FILL_GAPS = `insert into battlelog_read_gap (player_tag, read_at, next_read_at)
  select $2, w.prev, w.at from (
    select s.at, lag(s.at) over (order by s.at) as prev
      from (select distinct r.fetched_at as at from api_receipt r
             where r.endpoint = $1 and r.entity_key = $2 and r.admission = 'admitted') s) w
   where w.prev is null or w.at - w.prev >= interval '1 day'
  on conflict (player_tag, next_read_at) do nothing
  returning 1`;

/**
 * {read_facts_backfill}: fill the read facts from the receipts still
 * held, one subject at a time (each subject one statement on the
 * receipts' (endpoint, entity_key, fetched_at) index), in the order
 * clans, events, battle logs, until `budget_ms`. Returns
 * `{subjects, written, after, done, remaining, ms}`; pass `after` back
 * until `done`. Idempotent: a re-run writes nothing, and it converges
 * with what ingest writes meanwhile. Must run to done before the receipt
 * trim is switched on. `db` is a connected client.
 */
export async function backfillReadFacts(db, spec = {}) {
  const budgetMs = Math.min(
    Math.max(Number(spec.budget_ms ?? 45_000), 1_000),
    60_000,
  );
  const limit = Math.max(Number(spec.subjects ?? Infinity), 1);
  const after = spec.after ?? {};
  let phase = PHASES.includes(after.endpoint) ? after.endpoint : PHASES[0];
  let key = typeof after.key === "string" ? after.key : "";
  const started = Date.now();
  let subjects = 0;
  let written = 0;
  let done = false;
  while (Date.now() - started < budgetMs && subjects < limit) {
    const {
      rows: [next],
    } = await db.query(
      `select min(entity_key) as k from api_receipt where endpoint = $1 and entity_key > $2`,
      [phase, key],
    );
    if (next.k === null) {
      const i = PHASES.indexOf(phase);
      if (i === PHASES.length - 1) {
        done = true;
        break;
      }
      phase = PHASES[i + 1];
      key = "";
      continue;
    }
    key = next.k;
    const r = await db.query(
      phase === "player_battlelog" ? FILL_GAPS : FILL_DAYS,
      [phase, key],
    );
    written += r.rowCount;
    subjects += 1;
  }
  // A real remaining: subjects left in this phase and every later one,
  // by a loose scan of the receipts' index.
  let remaining = 0;
  if (!done)
    for (const p of PHASES.slice(PHASES.indexOf(phase))) {
      const {
        rows: [c],
      } = await db.query(
        `with recursive k(v) as (
           (select entity_key from api_receipt where endpoint = $1 and entity_key > $2
             order by entity_key limit 1)
           union all
           select (select entity_key from api_receipt
                    where endpoint = $1 and entity_key > k.v order by entity_key limit 1)
             from k where k.v is not null)
         select count(v)::int as n from k`,
        [p, p === phase ? key : ""],
      );
      remaining += c.n;
    }
  return {
    subjects,
    written,
    after: done ? null : { endpoint: phase, key },
    done,
    remaining,
    ms: Date.now() - started,
  };
}

/**
 * {read_facts_check}: how far the read facts cover the receipts still
 * held, read only. Each `missing_*` is 0 once {read_facts_backfill} is
 * done (ingest keeps them at 0 after): admitted roster and events reads
 * with no instant in admitted_read_day, players with admitted battle-log
 * reads and no row for the time before their first, and stretches of a
 * day or more between two held reads with no gap row. Plus each fact
 * table's rows and bytes. `db` is a connected client; the caller opens
 * the read-only transaction.
 */
export async function checkReadFacts(db) {
  const one = async (sql) => (await db.query(sql)).rows[0];
  const days = await one(
    `select count(*)::int as receipts,
            count(*) filter (where not exists (
              select 1 from admitted_read_day d
               where d.endpoint = r.endpoint and d.entity_key = r.entity_key
                 and d.day = (r.fetched_at at time zone 'UTC')::date
                 and r.fetched_at = any(d.read_at)))::int as missing_reads
       from api_receipt r
      where r.endpoint = any(array['clan', 'events']) and r.admission = 'admitted'`,
  );
  const live = await one(
    `select count(*)::int as missing_first_live from (
       select r.endpoint, r.entity_key, (r.fetched_at at time zone 'UTC')::date as day,
              min(r.fetched_at) as first_live
         from api_receipt r join gateway g on g.gateway_id = r.gateway_id
        where r.endpoint = any(array['clan', 'events']) and r.admission = 'admitted'
          and g.name <> '${IMPORT_GATEWAY}'
        group by 1, 2, 3) x
      where not exists (select 1 from admitted_read_day d
                         where d.endpoint = x.endpoint and d.entity_key = x.entity_key
                           and d.day = x.day and d.first_live_at <= x.first_live)`,
  );
  const first = await one(
    `select count(*)::int as missing_first_read from (
       select distinct entity_key from api_receipt
        where endpoint = 'player_battlelog' and admission = 'admitted') r
      where not exists (select 1 from battlelog_read_gap g
                         where g.player_tag = r.entity_key and g.read_at is null)`,
  );
  const gaps = await one(
    `select count(*)::int as missing_gaps from (
       select entity_key, fetched_at as at,
              lag(fetched_at) over (partition by entity_key order by fetched_at) as prev
         from api_receipt
        where endpoint = 'player_battlelog' and admission = 'admitted') w
      where w.at - w.prev >= interval '1 day'
        and not exists (select 1 from battlelog_read_gap g
                         where g.player_tag = w.entity_key and g.next_read_at = w.at)`,
  );
  const size = async (table) =>
    one(
      `select (select count(*) from ${table})::int as rows,
              pg_total_relation_size('${table}'::regclass)::bigint as total_bytes`,
    );
  return {
    admitted_read_day: {
      ...(await size("admitted_read_day")),
      receipts: days.receipts,
      missing_reads: days.missing_reads,
      missing_first_live: live.missing_first_live,
    },
    battlelog_read_gap: {
      ...(await size("battlelog_read_gap")),
      missing_first_read: first.missing_first_read,
      missing_gaps: gaps.missing_gaps,
    },
  };
}
