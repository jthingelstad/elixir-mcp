import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";

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

export async function scratchDb(suffix) {
  const name = `elixir_mcp_test_${suffix}_${process.pid}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/postgres$/, `/${name}`);
  await migrate({
    databaseUrl: url,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  return {
    db,
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
