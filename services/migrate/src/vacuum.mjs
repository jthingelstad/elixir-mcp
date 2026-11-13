/**
 * Plain VACUUM (ANALYZE), and the read that says which tables need one.
 *
 * Why this exists: an index-only scan reads the heap for every page the
 * visibility map does not mark all-visible, and only VACUUM sets the map.
 * Three things leave it empty or nearly so while autovacuum looks away:
 *
 *  - a bulk UPDATE whose versions HOT pruning cleans as it goes, so the
 *    dead-tuple trigger never fires (2026-09-16, 0103);
 *  - VACUUM FULL ({rewrite_table}), which writes a new heap with an empty
 *    map and does not count as a vacuum for the insert trigger
 *    (2026-11-13: battle_participant and battle at relallvisible = 0 after
 *    the data layer refactor, clans_participation at 10 to 22 s cold
 *    until {vacuum} made it 387 ms);
 *  - a new table filled in one go, which has no map and no statistics
 *    (relpages 0, reltuples -1) until its first vacuum or analyze.
 *
 * So the ladder vacuums what a migration declares (`-- vacuum after:`,
 * migrate.mjs), the write ops vacuum what they rewrote, and the deploy
 * reads {visibility_check} and names any table still behind.
 *
 * Which tables may be vacuumed: any ordinary table in the public schema,
 * read from the catalog, whose name is a plain lower-case identifier; the
 * name is quoted into SQL. VACUUM (ANALYZE) changes no row and takes a
 * SHARE UPDATE EXCLUSIVE lock, which reads and writes do not wait on, so
 * no table needs keeping out. The hand-kept VACUUMABLE list it replaces
 * (2026-11-13) lagged the tables a check could name.
 */

import pg from "pg";

/** A name the vacuum may take: what our migrations create. */
const PLAIN_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/** Below this many heap pages (8 KB each, so 4 MB) a missing map costs a
 *  read too few pages to matter, and churny small tables would warn on
 *  every deploy. battle_participant was 11,735 pages on 2026-11-13. */
export const VISIBILITY_FLOOR_PAGES = 500;

/** Under half of the heap all-visible, an index-only scan fetches the
 *  heap for most of what it reads, and the planner prices index-only out.
 *  A table under 0253's insert-driven vacuum sits near 98; all-zero is
 *  the trap itself. Half leaves room for a busy table between vacuums. */
export const VISIBILITY_MIN_SHARE = 0.5;

/** A table never analyzed (reltuples -1) is planned on a guess. Ten
 *  pages: a one-page lookup table that autovacuum's 50-row analyze
 *  threshold never reaches is not worth a warning. */
const UNANALYZED_FLOOR_PAGES = 10;

/** The op payload, and the command that runs it, for one table. */
function vacuumPayload(table) {
  return JSON.stringify({ vacuum: { table } });
}
export function vacuumCommand(table) {
  return `npm run op -- '${vacuumPayload(table)}'`;
}

/** Whether `table` is an ordinary table in the public schema with a
 *  plain name: the only tables vacuumAnalyze will name. */
async function isVacuumable(db, table) {
  if (typeof table !== "string" || !PLAIN_IDENTIFIER.test(table)) return false;
  const { rows } = await db.query(
    `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1 and c.relkind in ('r', 'm')`,
    [table],
  );
  return rows.length === 1;
}

async function mapOf(db, table) {
  const { rows } = await db.query(
    `select c.relpages, c.relallvisible, c.reltuples::bigint as reltuples
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1`,
    [table],
  );
  return rows[0] ?? null;
}

/**
 * VACUUM (ANALYZE) one table on an open client that is not inside a
 * transaction (VACUUM refuses one). Never throws for the vacuum itself:
 * a refusal or a timeout is an answer, because the callers (the ladder
 * after its commits, an op after its writes) have already done their
 * work and must not fail for this. A cancelled plain VACUUM leaves the
 * table as it was; whatever it marked stays marked.
 *
 * @param {pg.Client} db
 * @param {string} table
 * @param {{statementMs?: number, lockMs?: number}} [bounds]
 */
export async function vacuumAnalyze(
  db,
  table,
  { statementMs = 120_000, lockMs = 10_000 } = {},
) {
  if (!(await isVacuumable(db, table)))
    return {
      table,
      error: "unknown_table",
      message:
        "not an ordinary table in the public schema with a plain lower-case name",
    };
  const before = await mapOf(db, table);
  await db.query(
    `set statement_timeout = ${Math.max(1, Math.floor(statementMs))}`,
  );
  await db.query(`set lock_timeout = ${Math.max(1, Math.floor(lockMs))}`);
  const started = Date.now();
  try {
    await db.query(`vacuum (analyze) ${pg.escapeIdentifier(table)}`);
  } catch (error) {
    return {
      table,
      error: "vacuum_failed",
      code: error.code ?? null,
      message: error.message,
      ms: Date.now() - started,
      before,
      command: vacuumCommand(table),
    };
  } finally {
    await db.query("reset statement_timeout").catch(() => {});
    await db.query("reset lock_timeout").catch(() => {});
  }
  return {
    table,
    ms: Date.now() - started,
    before,
    after: await mapOf(db, table),
  };
}

/**
 * {visibility_check}: every ordinary public table whose visibility map
 * or statistics would cost its readers, read-only.
 *
 *  - `visibility_map`: at least VISIBILITY_FLOOR_PAGES heap pages and
 *    fewer than VISIBILITY_MIN_SHARE of them all-visible;
 *  - `never_analyzed`: reltuples -1 with UNANALYZED_FLOOR_PAGES or more;
 *  - `stale_estimate`: reltuples 0 while the statistics collector counts
 *    live rows, with the same floor.
 *
 * Pages are the heap's size now (pg_relation_size), not relpages, which
 * only VACUUM and ANALYZE move: a table filled since says 0. A read-only
 * transaction with short timeouts: pg_relation_size waits behind an
 * ACCESS EXCLUSIVE lock (a VACUUM FULL), and this must not.
 */
export async function visibilityCheck(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin read only");
    await db.query("set local statement_timeout = '30s'");
    await db.query("set local lock_timeout = '5s'");
    const { rows } = await db.query(
      `select c.relname as table,
              (pg_relation_size(c.oid) / current_setting('block_size')::int)::int as pages,
              c.relpages, c.relallvisible, c.reltuples::bigint as reltuples,
              coalesce(s.n_live_tup, 0)::bigint as live_rows,
              greatest(s.last_vacuum, s.last_autovacuum) as last_vacuum,
              greatest(s.last_analyze, s.last_autoanalyze) as last_analyze
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_stat_user_tables s on s.relid = c.oid
        where n.nspname = 'public' and c.relkind in ('r', 'm')
        order by c.relname`,
    );
    const flagged = [];
    for (const r of rows) {
      const pages = Number(r.pages);
      const reltuples = Number(r.reltuples);
      const reason =
        reltuples < 0 && pages >= UNANALYZED_FLOOR_PAGES
          ? "never_analyzed"
          : reltuples === 0 &&
              Number(r.live_rows) > 0 &&
              pages >= UNANALYZED_FLOOR_PAGES
            ? "stale_estimate"
            : pages >= VISIBILITY_FLOOR_PAGES &&
                r.relallvisible < VISIBILITY_MIN_SHARE * pages
              ? "visibility_map"
              : null;
      if (!reason) continue;
      flagged.push({
        table: r.table,
        reason,
        pages,
        all_visible_pages: r.relallvisible,
        all_visible_pct:
          pages > 0
            ? Math.round((1000 * Math.min(r.relallvisible, pages)) / pages) / 10
            : null,
        reltuples,
        last_vacuum: r.last_vacuum,
        last_analyze: r.last_analyze,
        payload: vacuumPayload(r.table),
        command: vacuumCommand(r.table),
      });
    }
    return {
      floor_pages: VISIBILITY_FLOOR_PAGES,
      min_all_visible_share: VISIBILITY_MIN_SHARE,
      never_analyzed_floor_pages: UNANALYZED_FLOOR_PAGES,
      checked: rows.length,
      flagged,
    };
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
}
