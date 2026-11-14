import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";
import { migrate } from "../../../services/migrate/src/migrate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";

export async function fixture(rel) {
  return JSON.parse(
    await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
  );
}

export async function fixtureMeta() {
  return JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/meta.json"), "utf8"),
  );
}

const MIGRATIONS_DIR = path.join(repoRoot, "db/migrations");
const MIGRATE_SRC = path.join(repoRoot, "services/migrate/src/migrate.mjs");
// Two advisory locks, taken on the admin database. BUILD is per
// template, so a checkout building its migration set never holds up
// another's. PRUNE is held exclusively only while stale templates are
// dropped, and shared while a run stamps and clones one, so a template
// is never dropped between the stamp and the clone.
const PRUNE_LOCK_KEY = 0x656c7470; // "eltp"
// A template no run has cloned for this long belongs to a checkout that
// has moved on, and is dropped the next time a template is built.
const TEMPLATE_IDLE_MS = 3 * 24 * 3600 * 1000;
// The last-used stamp is rewritten at most this often: every clone
// writing the same catalog row would queue them all behind each other.
const STAMP_EVERY_MS = 3600 * 1000;

/** The template's name and build lock: a hash of every migration and the
 *  runner itself, so a changed migration builds a new template and never
 *  reuses a stale one, and two checkouts on different migrations keep
 *  their own. */
async function template() {
  const hash = createHash("sha256");
  for (const file of (await readdir(MIGRATIONS_DIR)).sort()) {
    hash.update(file);
    hash.update(await readFile(path.join(MIGRATIONS_DIR, file)));
  }
  hash.update(await readFile(MIGRATE_SRC));
  const hex = hash.digest("hex");
  return {
    name: `elixir_mcp_tpl_${hex.slice(0, 16)}`,
    buildKey: Number.parseInt(hex.slice(0, 8), 16) | 0,
  };
}

/** The template's last-used stamp, or null when it does not exist. */
async function templateStamp(admin, name) {
  const { rows } = await admin.query(
    `select coalesce(shobj_description(oid, 'pg_database'), '0') as used
       from pg_database where datname = $1`,
    [name],
  );
  return rows.length ? Number(rows[0].used) : null;
}

/** Build the migrated template if it is missing: under its build lock,
 *  under another name, then renamed, so no run ever clones a
 *  half-migrated database. */
async function buildTemplate(admin, { name, buildKey }) {
  await admin.query("select pg_advisory_lock($1)", [buildKey]);
  try {
    if ((await templateStamp(admin, name)) !== null) return;
    // Not under the template prefix, so pruning never drops a build in
    // progress.
    const building = `elixir_mcp_tplbuild_${process.pid}`;
    await admin.query(`drop database if exists ${building} with (force)`);
    await admin.query(`create database ${building}`);
    await migrate({
      databaseUrl: ADMIN_URL.replace(/\/postgres$/, `/${building}`),
      migrationsDir: MIGRATIONS_DIR,
    });
    // Configured and stamped before the rename, so it enters the
    // template prefix whole: another checkout's pruning never sees it
    // unstamped. A template takes no connections, so nothing (autovacuum
    // included) is ever in it when a run clones it.
    await admin.query(
      `alter database ${building} with is_template true allow_connections false`,
    );
    await admin.query(`comment on database ${building} is '${Date.now()}'`);
    await admin.query(`alter database ${building} rename to ${name}`);
  } finally {
    await admin.query("select pg_advisory_unlock($1)", [buildKey]);
  }
  await pruneTemplates(admin, name);
}

async function pruneTemplates(admin, keep) {
  await admin.query("select pg_advisory_lock($1)", [PRUNE_LOCK_KEY]);
  try {
    const { rows } = await admin.query(
      `select datname, shobj_description(oid, 'pg_database') as used
         from pg_database
        where starts_with(datname, 'elixir_mcp_tpl_') and datname <> $1`,
      [keep],
    );
    for (const { datname, used } of rows) {
      if (Date.now() - Number(used ?? 0) < TEMPLATE_IDLE_MS) continue;
      await admin.query(`alter database ${datname} is_template false`);
      await admin.query(`drop database if exists ${datname} with (force)`);
    }
  } finally {
    await admin.query("select pg_advisory_unlock($1)", [PRUNE_LOCK_KEY]);
  }
}

/** One of the run's scratch-database slots, held by this process until
 *  its last scratch database is dropped (or it exits).
 *
 *  Several verify runs share one local PostgreSQL (max_connections 100),
 *  and every test file that holds a scratch database also holds its
 *  connections. `infra/scripts/test.mjs` hands each run a slot
 *  directory and a count (ELIXIR_TEST_DB_SLOTS_DIR, ELIXIR_TEST_DB_SLOTS),
 *  so a run holds at most that many scratch databases at once, whatever
 *  the units and node --test's file concurrency would otherwise start
 *  (2026-11-13: "sorry, too many clients already" in suites the change
 *  never touched). A slot is a directory made with mkdir, which is
 *  atomic; a holder that died without letting go is found by its pid.
 *  Outside test.mjs (a focused `node --test`) there is no cap. */
const SLOTS_DIR = process.env.ELIXIR_TEST_DB_SLOTS_DIR ?? null;
const SLOTS = Number(process.env.ELIXIR_TEST_DB_SLOTS ?? 0);
let slotHeld = null;
let slotUsers = 0;

function slotIsStale(dir) {
  let pid;
  try {
    pid = Number(readFileSync(path.join(dir, "pid"), "utf8"));
  } catch {
    // Made but not yet stamped: live unless it has stayed unstamped.
    try {
      return Date.now() - statSync(dir).mtimeMs > 30_000;
    } catch {
      return false;
    }
  }
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return err.code === "ESRCH";
  }
}

function releaseSlotNow() {
  if (!slotHeld) return;
  rmSync(slotHeld, { recursive: true, force: true });
  slotHeld = null;
}

async function takeSlot() {
  slotUsers += 1;
  if (!SLOTS_DIR || !(SLOTS > 0) || slotHeld) return;
  // A parent took the slot for this process (holdSlot, below).
  const held = process.env.ELIXIR_TEST_DB_SLOT_HELD;
  if (held && held !== String(process.pid)) return;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const dir = path.join(SLOTS_DIR, `slot-${i}`);
      try {
        mkdirSync(dir);
      } catch (err) {
        if (err.code === "ENOENT") return; // the run has ended: no cap
        if (err.code !== "EEXIST") throw err;
        if (slotIsStale(dir)) rmSync(dir, { recursive: true, force: true });
        continue;
      }
      writeFileSync(path.join(dir, "pid"), String(process.pid));
      slotHeld = dir;
      process.once("exit", releaseSlotNow);
      return;
    }
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 50));
  }
}

function giveSlot() {
  slotUsers = Math.max(0, slotUsers - 1);
  if (slotUsers === 0) releaseSlotNow();
}

/** Take a slot for this process and every process it starts after, and
 *  return the function that gives it back. For a runner whose setup has
 *  a timeout (vitest's hooks): its globalSetup waits for the slot, which
 *  has no timeout, so a queue for slots is never read as a slow hook
 *  (2026-11-13: the journeys' 60 s beforeAll timed out waiting for one).
 *  The workers inherit ELIXIR_TEST_DB_SLOT_HELD and take none of their
 *  own. */
export async function holdSlot() {
  await takeSlot();
  process.env.ELIXIR_TEST_DB_SLOT_HELD = String(process.pid);
  return () => {
    delete process.env.ELIXIR_TEST_DB_SLOT_HELD;
    giveSlot();
  };
}

/** Create the database `name` (dropping any leftover of that name first)
 *  with every migration applied, cloned from a template that ran them
 *  once. Running 244 migrations per test file took 9 s at load ~40 and
 *  timed out a 60 s setup under a full verify (2026-11-12); a clone takes
 *  about a second under the same verify. Takes one of the run's slots
 *  (above); `dropScratch(name)` gives it back. */
export async function createScratch(name) {
  await takeSlot();
  try {
    await cloneTemplate(name);
  } catch (err) {
    giveSlot();
    throw err;
  }
}

/** Drop a database createScratch made, ending any connection still in
 *  it, and give back the run's slot. */
export async function dropScratch(name) {
  try {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`drop database if exists ${name} with (force)`);
    } finally {
      await admin.end();
    }
  } finally {
    giveSlot();
  }
}

async function cloneTemplate(name) {
  const tpl = await template();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${name} with (force)`);
    for (;;) {
      if ((await templateStamp(admin, tpl.name)) === null)
        await buildTemplate(admin, tpl);
      await admin.query("select pg_advisory_lock_shared($1)", [PRUNE_LOCK_KEY]);
      try {
        // Pruned before the shared lock was granted: build it again.
        const used = await templateStamp(admin, tpl.name);
        if (used === null) continue;
        // Last used, for pruning: a comment, since a database records
        // no times.
        if (Date.now() - used > STAMP_EVERY_MS)
          await admin.query(
            `comment on database ${tpl.name} is '${Date.now()}'`,
          );
        await admin.query(`create database ${name} template ${tpl.name}`);
        break;
      } finally {
        await admin.query("select pg_advisory_unlock_shared($1)", [
          PRUNE_LOCK_KEY,
        ]);
      }
    }
    // ALTER DATABASE ... SET (the migrations set the time zone and the
    // connection check) belongs to the database, and a clone does not
    // copy it.
    const { rows } = await admin.query(
      `select unnest(s.setconfig) as setting
         from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase
        where d.datname = $1 and s.setrole = 0`,
      [tpl.name],
    );
    for (const { setting } of rows) {
      const at = setting.indexOf("=");
      await admin.query(
        `alter database ${name} set ${setting.slice(0, at)} to ${admin.escapeLiteral(setting.slice(at + 1))}`,
      );
    }
  } finally {
    await admin.end();
  }
}

/** A fresh migrated database (createScratch) and one client on it. */
export async function scratchDb(suffix) {
  const name = `elixir_mcp_test_${suffix}_${process.pid}`;
  await createScratch(name);
  const url = ADMIN_URL.replace(/\/postgres$/, `/${name}`);
  const db = new pg.Client({ connectionString: url });
  try {
    await db.connect();
  } catch (err) {
    await dropScratch(name);
    throw err;
  }
  return {
    db,
    url,
    async drop() {
      await db.end();
      await dropScratch(name);
    },
  };
}

/** A receipt needs an account + gateway; battles need a receipt. */
export async function seedReceipt(
  db,
  { endpoint = "player_battlelog", entityKey = "#TEST" } = {},
) {
  const {
    rows: [account],
  } = await db.query(
    `insert into account (email_hash, status, is_owner, role) values ('test-owner', 'approved', true, 'owner')
     on conflict (email_hash) do update set status = 'approved' returning account_id`,
  );
  const {
    rows: [gateway],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'test-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  const {
    rows: [receipt],
  } = await db.query(
    `insert into api_receipt (endpoint, entity_key, payload_hash, gateway_id, admission)
     values ($1, $2, 'test-hash', $3, 'admitted') returning receipt_id`,
    [endpoint, entityKey, gateway.gateway_id],
  );
  return receipt.receipt_id;
}

/** Who `waitUntilBlocked` waits for, as a condition on a pg_locks row
 *  `l` and its parameter. */
const BLOCKED = {
  // Any backend queued behind this one (a row lock, an advisory lock, a
  // unique-index insert waiting on the holder's transaction).
  blockedBy: "$1::int = any(pg_blocking_pids(l.pid))",
  // These backends.
  pids: "l.pid = any($1::int[])",
  // A waiter for pg_advisory_[xact_]lock(hashtext($1)) in this database.
  advisoryKey: `l.locktype = 'advisory'
      and l.database = (select oid from pg_database where datname = current_database())
      and l.objid = (hashtext($1)::bigint & 4294967295) and l.objsubid = 1`,
  // Backends that connected with this application_name.
  applicationName:
    "l.pid in (select pid from pg_stat_activity where application_name = $1)",
};

/** Wait until PostgreSQL says a backend is queued behind a lock, rather
 *  than sleeping a fixed time and assuming it got there: on a loaded host
 *  a sleep ends before the other connection has sent its statement, and
 *  the test takes a path it never meant to (the 2026-11-14 assessment).
 *  `target` names exactly one of `blockedBy` (a holder's pid), `pids`,
 *  `advisoryKey` (the text hashed into an advisory lock) or
 *  `applicationName`; `count` is how many must be waiting. Reads pg_locks,
 *  which is live, so `db` may be inside a transaction, even the holder's
 *  own (pg_stat_activity is a snapshot held for the reader's whole
 *  transaction). Fails after `timeoutMs`, naming what never queued. */
export async function waitUntilBlocked(
  db,
  target,
  { count = 1, timeoutMs = 30_000 } = {},
) {
  const keys = Object.keys(target);
  if (keys.length !== 1 || !(keys[0] in BLOCKED))
    throw new Error(
      `waitUntilBlocked takes one of ${Object.keys(BLOCKED).join(", ")}`,
    );
  const [key] = keys;
  const sql = `select count(distinct l.pid)::int as n from pg_locks l
    where not l.granted and ${BLOCKED[key]}`;
  const until = Date.now() + timeoutMs;
  for (;;) {
    const {
      rows: [{ n }],
    } = await db.query(sql, [target[key]]);
    if (n >= count) return n;
    if (Date.now() > until)
      throw new Error(
        `waitUntilBlocked: ${n} of ${count} waiting (${key} ${JSON.stringify(target[key])}) after ${timeoutMs} ms`,
      );
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Record clans so their rosters write every member (rosterRecords). */
export async function trackClans(db, tags) {
  const {
    rows: [account],
  } = await db.query(
    `insert into account (email_hash, status, role)
     values ('test-clan-tracker', 'approved', 'member')
     on conflict (email_hash) do update set status = excluded.status
     returning account_id`,
  );
  for (const tag of tags)
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, status, scope)
       values ('clan', $1, $2, 'active', 'comprehensive')`,
      [tag, account.account_id],
    );
}
