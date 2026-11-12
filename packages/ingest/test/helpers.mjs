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
// One lock for building and pruning templates, taken on the admin
// database, so parallel test files never build the same template twice.
const TEMPLATE_LOCK_KEY = 0x656c7470; // "eltp"
// A template no run has cloned for this long belongs to a checkout that
// has moved on, and is dropped the next time a template is built.
const TEMPLATE_IDLE_MS = 3 * 24 * 3600 * 1000;

/** The template's name: a hash of every migration and the runner itself,
 *  so a changed migration builds a new template and never reuses a stale
 *  one, and two checkouts on different migrations keep their own. */
async function templateName() {
  const hash = createHash("sha256");
  for (const file of (await readdir(MIGRATIONS_DIR)).sort()) {
    hash.update(file);
    hash.update(await readFile(path.join(MIGRATIONS_DIR, file)));
  }
  hash.update(await readFile(MIGRATE_SRC));
  return `elixir_mcp_tpl_${hash.digest("hex").slice(0, 16)}`;
}

/** Make sure the migrated template exists. Built once per migration set
 *  under an advisory lock: under a different name, then renamed, so no
 *  run ever clones a half-migrated database. */
async function ensureTemplate(admin, tpl) {
  const exists = async () =>
    (await admin.query("select 1 from pg_database where datname = $1", [tpl]))
      .rowCount > 0;
  if (!(await exists())) {
    await admin.query("select pg_advisory_lock($1)", [TEMPLATE_LOCK_KEY]);
    try {
      if (!(await exists())) {
        const building = `${tpl}_b${process.pid}`;
        await admin.query(`drop database if exists ${building} with (force)`);
        await admin.query(`create database ${building}`);
        await migrate({
          databaseUrl: ADMIN_URL.replace(/\/postgres$/, `/${building}`),
          migrationsDir: MIGRATIONS_DIR,
        });
        await admin.query(`alter database ${building} rename to ${tpl}`);
        // A template takes no connections, so nothing (autovacuum
        // included) is ever in it when a run clones it.
        await admin.query(
          `alter database ${tpl} with is_template true allow_connections false`,
        );
        await pruneTemplates(admin, tpl);
      }
    } finally {
      await admin.query("select pg_advisory_unlock($1)", [TEMPLATE_LOCK_KEY]);
    }
  }
  // Last used, for pruning: a comment, since a database records no times.
  await admin.query(`comment on database ${tpl} is '${Date.now()}'`);
}

async function pruneTemplates(admin, keep) {
  const { rows } = await admin.query(
    `select datname, shobj_description(oid, 'pg_database') as used
       from pg_database
      where datname like 'elixir_mcp_tpl_%' and datname <> $1`,
    [keep],
  );
  for (const { datname, used } of rows) {
    // An unfinished build (a run killed mid-migration) has no stamp.
    if (Date.now() - Number(used ?? 0) < TEMPLATE_IDLE_MS) continue;
    await admin.query(`alter database ${datname} is_template false`);
    await admin.query(`drop database if exists ${datname} with (force)`);
  }
}

/** A fresh database with every migration applied, cloned from a template
 *  that ran them once. Running 244 migrations per test file took 9 s at
 *  load ~40 and timed out a 60 s setup under a full verify (2026-11-12);
 *  a clone takes well under a second. */
export async function scratchDb(suffix) {
  const name = `elixir_mcp_test_${suffix}_${process.pid}`;
  const tpl = await templateName();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await ensureTemplate(admin, tpl);
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name} template ${tpl}`);
    // ALTER DATABASE ... SET (the migrations set the time zone and the
    // connection check) belongs to the database, and a clone does not
    // copy it.
    const { rows } = await admin.query(
      `select unnest(s.setconfig) as setting
         from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase
        where d.datname = $1 and s.setrole = 0`,
      [tpl],
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
