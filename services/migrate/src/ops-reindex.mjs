/**
 * {reindex}: read a table's indexes for bloat, and rebuild one index at a
 * time with REINDEX INDEX CONCURRENTLY. REINDEX CONCURRENTLY and DROP
 * INDEX CONCURRENTLY refuse a transaction block, and the migrate runner
 * wraps every migration in one, so this is an op, as `{vacuum}` is.
 * Added 2026-10-21 (#630), the memory lever after RDS warned it would
 * lower shared_buffers: `battle`'s indexes held about 118 MB for about
 * 92,000 rows after the bulk deletions (battle_pkey 78 MB,
 * battle_time_idx 21 MB, battle_cursor_key 19 MB). Jamie approved the
 * op and the rebuild on 2026-10-21.
 *
 *   {"reindex": {"table": "battle"}}
 *     Read (a read-only session). Every index on the table: its size,
 *     scans since the statistics reset, validity, the constraint it backs
 *     and the foreign keys that use it, and an estimate of its size when
 *     freshly built (below); the table's heap size and row estimate; and
 *     every invalid index on the table, flagged when its name marks a
 *     leftover of a cancelled REINDEX CONCURRENTLY (`_ccnew`, `_ccold`).
 *
 *   {"reindex": {"table": "battle", "index": "<name>", "apply": true}}
 *     WRITE (maintenance, no row changes). REINDEX INDEX CONCURRENTLY of
 *     exactly that index, which must be one of the table's. Refused while
 *     any index on the table is invalid. Returns the size before and
 *     after, the time it took and the index's validity after. Reads and
 *     writes go on throughout: the rebuild holds SHARE UPDATE EXCLUSIVE,
 *     which blocks only DDL, VACUUM and ANALYZE on the table.
 *
 *   {"reindex": {"table": "battle", "drop_invalid": "<name>"}}
 *     WRITE. DROP INDEX CONCURRENTLY of one INVALID index on the table;
 *     refused for a valid index and for one a constraint needs.
 *
 * A cancelled or failed REINDEX CONCURRENTLY (the statement or lock
 * timeout below, a lost connection) leaves the half-built copy behind as
 * an INVALID index named `<index>_ccnew` (`_ccnew1` and on when the name
 * is taken), or, if it failed after the swap, the old index as
 * `<index>_ccold`. Once a leftover is ready, every write to the table
 * maintains it. The op answers a failure with the table's invalid
 * indexes; drop each with `drop_invalid`, then rebuild again.
 *
 * The bloat estimate needs no extension (pgstattuple is not installed):
 * from the table's reltuples and each column's pg_stats width it sizes a
 * btree built at its leaf fillfactor (90 by default). It is an estimate:
 * btree deduplication makes an index on repeated keys smaller than it,
 * and stale statistics move it either way.
 */

import pg from "pg";

/** Tables whose indexes the op may rebuild: the one Jamie approved
 *  (2026-10-21). A closed list, as `{vacuum}`'s is; widening it is a
 *  change of its own. */
const REINDEXABLE = new Set(["battle"]);

/** The migrate Lambda times out at 300 s (MigrateFunction in
 *  infra/template.yaml). The statement stops at 240 s, so the function
 *  outlives it, reads the leftovers and answers; a statement the Lambda
 *  outlived would keep running in Postgres after the Lambda died. The
 *  lock timeout bounds each wait inside the rebuild (for the table's
 *  lock, and for the transactions it must outlast at each phase): 60 s
 *  is above every door's, the scheduler's and the timeline sync's
 *  statement timeout (18 to 50 s), so an ordinary read in flight never
 *  ends it, and a long jobs transaction ends it early instead of taking
 *  the whole budget. */
export const REINDEX_TIMEOUTS = Object.freeze({
  statementMs: 240_000,
  lockMs: 60_000,
});

const SPEC_KEYS = new Set(["table", "index", "apply", "drop_invalid"]);
const LEFTOVER = /_cc(new|old)\d*$/;

const leftoverOf = (name) => LEFTOVER.exec(name)?.[0]?.replace(/^_|\d+$/g, "");

/**
 * @param {string} databaseUrl
 * @param {object} spec the op's payload
 * @param {{statementMs: number, lockMs: number}} [timeouts] tests only
 */
export async function reindex(databaseUrl, spec, timeouts = REINDEX_TIMEOUTS) {
  const refused = refuseSpec(spec);
  if (refused) return refused;
  const table = spec.table;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    if (spec.apply === true)
      return await rebuild(db, table, spec.index, timeouts, databaseUrl);
    if (spec.drop_invalid !== undefined)
      return await dropInvalid(db, table, spec.drop_invalid, timeouts);
    await db.query("set default_transaction_read_only = on");
    return await report(db, table, timeouts);
  } finally {
    await db.end().catch(() => {});
  }
}

/** Every refusal that needs no database, before connecting. */
function refuseSpec(spec) {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec))
    return { error: "unknown_table", allowed: [...REINDEXABLE] };
  const unknown = Object.keys(spec).filter((k) => !SPEC_KEYS.has(k));
  if (unknown.length)
    return {
      error: "unknown_keys",
      keys: unknown,
      allowed_keys: [...SPEC_KEYS],
    };
  if (!REINDEXABLE.has(spec.table))
    return { error: "unknown_table", allowed: [...REINDEXABLE] };
  const hasIndex = Object.hasOwn(spec, "index");
  const hasApply = Object.hasOwn(spec, "apply");
  const hasDrop = Object.hasOwn(spec, "drop_invalid");
  if (hasDrop && (hasIndex || hasApply))
    return {
      error: "one_action",
      message:
        "Pass index with apply: true to rebuild, or drop_invalid alone to drop a leftover; not both.",
    };
  if (hasDrop && (typeof spec.drop_invalid !== "string" || !spec.drop_invalid))
    return {
      error: "index_required",
      message: "drop_invalid names one index.",
    };
  if (hasApply && spec.apply !== true) return { error: "apply_must_be_true" };
  if (spec.apply === true && (typeof spec.index !== "string" || !spec.index))
    return {
      error: "index_required",
      message: "A rebuild names exactly one index of the table.",
    };
  if (hasIndex && spec.apply !== true)
    return {
      error: "apply_required",
      message:
        'A rebuild needs "apply": true; {"table"} alone reports every index.',
    };
  return null;
}

/** The table's identity and size; null when it does not exist. */
async function tableFacts(db, table) {
  const { rows } = await db.query(
    `select c.oid, n.nspname as schema,
            pg_relation_size(c.oid)::bigint as heap_bytes,
            pg_indexes_size(c.oid)::bigint as index_bytes,
            c.reltuples::bigint as row_estimate,
            s.n_live_tup::bigint as live_rows, s.n_dead_tup::bigint as dead_rows,
            greatest(s.last_analyze, s.last_autoanalyze) as last_analyzed
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
    [table],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    ...r,
    heap_bytes: Number(r.heap_bytes),
    index_bytes: Number(r.index_bytes),
    row_estimate: Number(r.row_estimate),
    live_rows: r.live_rows === null ? null : Number(r.live_rows),
    dead_rows: r.dead_rows === null ? null : Number(r.dead_rows),
  };
}

/** Every index on the table, from the catalog. */
async function indexesOf(db, tableOid) {
  const { rows } = await db.query(
    `select c.oid, c.relname as name, n.nspname as schema,
            pg_relation_size(c.oid)::bigint as bytes, c.relpages as pages,
            i.indisvalid as valid, i.indisready as ready,
            i.indpred is not null as partial, am.amname as method,
            pg_get_indexdef(c.oid) as definition,
            s.idx_scan as scans, s.last_idx_scan as last_scan,
            coalesce((select substring(o from '^fillfactor=([0-9]+)$')::int
                        from unnest(c.reloptions) o
                       where o like 'fillfactor=%'), 90) as fillfactor,
            (select json_build_object('name', k.conname, 'type',
                      case k.contype when 'p' then 'primary_key'
                                     when 'u' then 'unique'
                                     when 'x' then 'exclusion'
                                     else k.contype::text end)
               from pg_constraint k
              where k.conindid = c.oid and k.conrelid = i.indrelid
                and k.contype in ('p', 'u', 'x')
              limit 1) as backs_constraint,
            coalesce((select json_agg(k.conname order by k.conname)
                        from pg_constraint k
                       where k.conindid = c.oid and k.contype = 'f'), '[]'::json)
              as foreign_keys
       from pg_index i
       join pg_class c on c.oid = i.indexrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_am am on am.oid = c.relam
       left join pg_stat_user_indexes s on s.indexrelid = c.oid
      where i.indrelid = $1
      order by pg_relation_size(c.oid) desc, c.relname`,
    [tableOid],
  );
  return rows.map((r) => ({
    ...r,
    bytes: Number(r.bytes),
    scans: r.scans === null ? null : Number(r.scans),
  }));
}

/** Each index's key and INCLUDE columns, in order, with their stored
 *  width and alignment and their statistics, for the estimate. */
async function indexColumns(db, tableOid, schema, table) {
  const { rows } = await db.query(
    `select i.indexrelid as oid, k.ord, k.attnum, a.attname,
            t.typlen, t.typalign, s.avg_width, s.null_frac
       from pg_index i
       cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
       left join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
                               and k.attnum > 0
       left join pg_type t on t.oid = a.atttypid
       left join pg_stats s on s.schemaname = $2 and s.tablename = $3
                           and s.attname = a.attname and not s.inherited
      where i.indrelid = $1
      order by i.indexrelid, k.ord`,
    [tableOid, schema, table],
  );
  const byIndex = new Map();
  for (const r of rows) {
    if (!byIndex.has(r.oid)) byIndex.set(r.oid, []);
    byIndex.get(r.oid).push(r);
  }
  return byIndex;
}

const ALIGN = { c: 1, s: 2, i: 4, d: 8 };
const alignUp = (n, to) => Math.ceil(n / to) * to;

/**
 * The size, in bytes, a btree on these columns would have if built now
 * over `rows` rows: each leaf tuple is the 8-byte IndexTupleData (with a
 * null bitmap when a column has nulls), its columns at their average
 * stored width and alignment, MAXALIGNed, plus a 4-byte line pointer;
 * leaves fill to the fillfactor of the page past its 24-byte header and
 * 16-byte btree special space, the levels above at 70%, plus the
 * metapage. Exported for its test.
 */
export function estimateBtreeBytes({ rows, columns, fillfactor, blockSize }) {
  if (!(rows >= 0)) return { bytes: null, reason: "never_analyzed" };
  if (columns.some((c) => c.attname === null))
    return { bytes: null, reason: "expression_column" };
  if (columns.some((c) => c.avg_width === null))
    return { bytes: null, reason: "no_statistics" };
  const nullable = columns.some((c) => Number(c.null_frac) > 0);
  let offset = alignUp(8 + (nullable ? 4 : 0), 8);
  for (const c of columns) {
    const present = 1 - Number(c.null_frac ?? 0);
    if (c.typlen > 0) {
      offset = alignUp(offset, ALIGN[c.typalign] ?? 8);
      offset += c.typlen * present;
    } else {
      // A short varlena (under 127 bytes, the usual key) is stored
      // unaligned with its 1-byte header, which avg_width includes.
      offset += Number(c.avg_width) * present;
    }
  }
  const perTuple = alignUp(offset, 8) + 4;
  const usable = blockSize - 24 - 16;
  const leafPerPage = Math.max(
    1,
    Math.floor((usable * fillfactor) / 100 / perTuple),
  );
  const upperPerPage = Math.max(2, Math.floor((usable * 0.7) / perTuple));
  let level = Math.max(1, Math.ceil(rows / leafPerPage));
  let pages = level;
  while (level > 1) {
    level = Math.ceil(level / upperPerPage);
    pages += level;
  }
  return { bytes: (pages + 1) * blockSize };
}

function withEstimate(index, columns, table, blockSize) {
  let estimate;
  if (index.method !== "btree") estimate = { bytes: null, reason: "not_btree" };
  else if (index.partial) estimate = { bytes: null, reason: "partial_index" };
  else
    estimate = estimateBtreeBytes({
      rows: table.row_estimate,
      columns: columns ?? [],
      fillfactor: index.fillfactor,
      blockSize,
    });
  const bloat =
    estimate.bytes === null
      ? null
      : {
          estimated_fresh_bytes: estimate.bytes,
          excess_bytes: Math.max(0, index.bytes - estimate.bytes),
          excess_pct:
            index.bytes > 0
              ? Math.round(
                  (1000 * Math.max(0, index.bytes - estimate.bytes)) /
                    index.bytes,
                ) / 10
              : 0,
        };
  return {
    name: index.name,
    definition: index.definition,
    bytes: index.bytes,
    pages: index.pages,
    scans: index.scans,
    last_scan: index.last_scan,
    valid: index.valid,
    ready: index.ready,
    backs_constraint: index.backs_constraint,
    foreign_keys: index.foreign_keys,
    leftover: leftoverOf(index.name) ?? null,
    bloat_estimate: bloat ?? { unavailable: estimate.reason },
  };
}

const invalidOf = (indexes) =>
  indexes
    .filter((i) => !i.valid)
    .map((i) => ({
      name: i.name,
      bytes: i.bytes,
      ready: i.ready,
      leftover: leftoverOf(i.name) ?? null,
    }));

async function report(db, table, timeouts) {
  const facts = await tableFacts(db, table);
  if (!facts) return { error: "table_missing", table };
  const indexes = await indexesOf(db, facts.oid);
  const columns = await indexColumns(db, facts.oid, facts.schema, table);
  const {
    rows: [settings],
  } = await db.query(
    `select current_setting('block_size')::int as block_size,
            (select stats_reset from pg_stat_database
              where datname = current_database()) as stats_since`,
  );
  return {
    table,
    heap_bytes: facts.heap_bytes,
    index_bytes: facts.index_bytes,
    row_estimate: facts.row_estimate,
    live_rows: facts.live_rows,
    dead_rows: facts.dead_rows,
    last_analyzed: facts.last_analyzed,
    stats_since: settings.stats_since,
    indexes: indexes.map((i) =>
      withEstimate(i, columns.get(i.oid), facts, settings.block_size),
    ),
    invalid_indexes: invalidOf(indexes),
    estimate_basis:
      "A btree built now over row_estimate rows at each column's pg_stats average width and the index's leaf fillfactor; deduplication of repeated keys makes a real build smaller, and stale statistics move it either way.",
    rebuild: {
      payload: { reindex: { table, index: "<name>", apply: true } },
      statement_timeout_ms: timeouts.statementMs,
      lock_timeout_ms: timeouts.lockMs,
    },
  };
}

/** The table's index named `name`, or the refusal for it. */
async function findIndex(db, table, name) {
  const facts = await tableFacts(db, table);
  if (!facts) return { refused: { error: "table_missing", table } };
  const indexes = await indexesOf(db, facts.oid);
  const index = indexes.find((i) => i.name === name);
  if (index) return { facts, indexes, index };
  const { rows } = await db.query(
    `select t.relname as on_table
       from pg_class c
       join pg_index i on i.indexrelid = c.oid
       join pg_class t on t.oid = i.indrelid
      where c.relname = $1 and c.relkind = 'i'`,
    [name],
  );
  return {
    refused: rows[0]
      ? {
          error: "index_not_on_table",
          index: name,
          table,
          indexes: indexes.map((i) => i.name),
        }
      : {
          error: "unknown_index",
          index: name,
          table,
          indexes: indexes.map((i) => i.name),
        },
  };
}

async function setTimeouts(db, timeouts) {
  await db.query(`set statement_timeout = ${Number(timeouts.statementMs)}`);
  await db.query(`set lock_timeout = ${Number(timeouts.lockMs)}`);
}

/** The table's invalid indexes now, on a fresh connection when the
 *  rebuild's own is gone. */
async function invalidNow(db, table, databaseUrl) {
  const read = async (client) => {
    const facts = await tableFacts(client, table);
    return facts ? invalidOf(await indexesOf(client, facts.oid)) : [];
  };
  try {
    return await read(db);
  } catch {
    const fresh = new pg.Client({ connectionString: databaseUrl });
    try {
      await fresh.connect();
      return await read(fresh);
    } catch (error) {
      return { unreadable: error.message };
    } finally {
      await fresh.end().catch(() => {});
    }
  }
}

async function rebuild(db, table, name, timeouts, databaseUrl) {
  const found = await findIndex(db, table, name);
  if (found.refused) return found.refused;
  const { index, indexes } = found;
  const invalid = invalidOf(indexes);
  if (invalid.length)
    return {
      error: "invalid_index_present",
      table,
      invalid_indexes: invalid,
      message:
        "Drop each invalid index first with drop_invalid; a rebuild beside a leftover would leave another.",
    };
  const target = `${pg.escapeIdentifier(index.schema)}.${pg.escapeIdentifier(index.name)}`;
  await setTimeouts(db, timeouts);
  const started = Date.now();
  try {
    await db.query(`reindex index concurrently ${target}`);
  } catch (error) {
    return {
      error: "reindex_failed",
      table,
      index: name,
      code: error.code ?? null,
      message: error.message,
      ms: Date.now() - started,
      before: { bytes: index.bytes },
      invalid_indexes: await invalidNow(db, table, databaseUrl),
      next: "A cancelled REINDEX CONCURRENTLY leaves an invalid <index>_ccnew (or _ccold) behind: drop each with drop_invalid, then rebuild again.",
    };
  }
  const ms = Date.now() - started;
  const after = (await findIndex(db, table, name)).index;
  return {
    table,
    index: name,
    action: "reindex_concurrently",
    ms,
    before: { bytes: index.bytes, scans: index.scans },
    after: after
      ? { bytes: after.bytes, valid: after.valid, ready: after.ready }
      : null,
    freed_bytes: after ? index.bytes - after.bytes : null,
    invalid_indexes: await invalidNow(db, table, databaseUrl),
    timeouts: {
      statement_timeout_ms: timeouts.statementMs,
      lock_timeout_ms: timeouts.lockMs,
    },
  };
}

async function dropInvalid(db, table, name, timeouts) {
  const found = await findIndex(db, table, name);
  if (found.refused) return found.refused;
  const { index } = found;
  if (index.valid)
    return {
      error: "index_valid",
      index: name,
      message: "drop_invalid drops only an INVALID index; this one is valid.",
    };
  if (index.backs_constraint)
    return {
      error: "backs_constraint",
      index: name,
      constraint: index.backs_constraint,
    };
  const target = `${pg.escapeIdentifier(index.schema)}.${pg.escapeIdentifier(index.name)}`;
  await setTimeouts(db, timeouts);
  const started = Date.now();
  await db.query(`drop index concurrently ${target}`);
  const facts = await tableFacts(db, table);
  return {
    table,
    dropped: name,
    action: "drop_index_concurrently",
    bytes: index.bytes,
    ms: Date.now() - started,
    invalid_indexes: invalidOf(await indexesOf(db, facts.oid)),
  };
}
