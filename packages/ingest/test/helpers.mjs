import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
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
    await admin.query(`alter database ${building} rename to ${name}`);
    // A template takes no connections, so nothing (autovacuum included)
    // is ever in it when a run clones it.
    await admin.query(
      `alter database ${name} with is_template true allow_connections false`,
    );
    // Stamped at once, or another checkout's pruning would read it as
    // unused before its first clone.
    await admin.query(`comment on database ${name} is '${Date.now()}'`);
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

/** A fresh database with every migration applied, cloned from a template
 *  that ran them once. Running 244 migrations per test file took 9 s at
 *  load ~40 and timed out a 60 s setup under a full verify (2026-11-12);
 *  a clone takes about a second under the same verify. */
export async function scratchDb(suffix) {
  const name = `elixir_mcp_test_${suffix}_${process.pid}`;
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
  const url = ADMIN_URL.replace(/\/postgres$/, `/${name}`);
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  return {
    db,
    url,
    async drop() {
      await db.end();
      const admin2 = new pg.Client({ connectionString: ADMIN_URL });
      await admin2.connect();
      await admin2.query(`drop database if exists ${name} with (force)`);
      await admin2.end();
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
