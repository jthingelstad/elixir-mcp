import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate, loadMigrations } from "../src/migrate.mjs";
import { schemaFingerprint } from "../src/fingerprint.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const MIGRATIONS_DIR = path.join(repoRoot, "db/migrations");
const FINGERPRINT_FILE = path.join(repoRoot, "db/schema.fingerprint");

// Scratch database per run — never a shared dev DB (AGENTS.md rule 9).
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
});

after(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("migrations are dense, ordered, well-named", async () => {
  const migrations = await loadMigrations(MIGRATIONS_DIR);
  assert.ok(migrations.length >= 1);
  assert.equal(migrations[0].name, "0001_recorder_core.sql");
});

test("ladder applies cleanly and is idempotent", async () => {
  const first = await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: MIGRATIONS_DIR,
  });
  assert.equal(first.applied, 0);
  assert.ok(first.ran >= 1);
  const second = await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: MIGRATIONS_DIR,
  });
  assert.equal(second.ran, 0);
});

test("schema fingerprint matches the committed pin", async () => {
  const actual = await schemaFingerprint(SCRATCH_URL);
  const pinned = (await readFile(FINGERPRINT_FILE, "utf8")).trim();
  assert.equal(
    actual,
    pinned,
    "schema drift: if this change is intentional, run `node src/cli.mjs fingerprint --update` against a freshly migrated scratch DB and commit the new pin",
  );
});

test("core invariants hold", async () => {
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    // Tag check constraint rejects non-canonical tags.
    await assert.rejects(
      db.query(`insert into player (player_tag) values ('#oops!')`),
      /check constraint/,
    );
    // budget_state is a seeded singleton.
    const { rows } = await db.query(
      "select count(*)::int as n from budget_state",
    );
    assert.equal(rows[0].n, 1);
    await assert.rejects(db.query("insert into budget_state default values"));
    // One open clan membership per player.
    await db.query(`insert into player (player_tag) values ('#2PP0V90Y')`);
    await db.query(`insert into clan (clan_tag) values ('#J2RGCRVG')`);
    await db.query(`insert into clan_membership (clan_tag, player_tag, joined_observed_at)
                    values ('#J2RGCRVG', '#2PP0V90Y', now())`);
    await assert.rejects(
      db.query(`insert into clan_membership (clan_tag, player_tag, joined_observed_at)
                values ('#J2RGCRVG', '#2PP0V90Y', now() + interval '1 hour')`),
      /duplicate key/,
    );
  } finally {
    await db.end();
  }
});

test("replay op: archive messages flow through the real pipeline in order, attributed to the backfill gateway", async () => {
  await migrate({ databaseUrl: SCRATCH_URL, migrationsDir: MIGRATIONS_DIR });
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  await db.query(
    `insert into account (email_hash, status, is_owner) values ('replay-owner', 'approved', true)
     on conflict (email_hash) do nothing`,
  );
  await db.end();

  const { gzipSync } = await import("node:zlib");
  const payload = JSON.parse(
    await readFile(
      path.join(repoRoot, "fixtures/player_battlelog/with_path_of_legend.json"),
      "utf8",
    ),
  );
  const metaJson = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/meta.json"), "utf8"),
  );
  const tag = metaJson[
    "player_battlelog/with_path_of_legend.json"
  ].entity_key.replace("#", ""); // archive keys are bare tags
  const msg = {
    v: 1,
    job: { endpoint: "player_battlelog", entity_key: tag, lane: "bulk" },
    gateway_id: "backfill",
    fetched_at: "2026-07-20T12:00:00Z",
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  };

  process.env.DATABASE_URL = SCRATCH_URL;
  const { handler } = await import("../src/lambda.mjs");
  const first = await handler({ replay: { messages: [msg] } });
  assert.equal(first.tally.admitted, 1);

  // Second run: gateway row reused, message dedupes.
  const second = await handler({ replay: { messages: [msg] } });
  assert.equal(second.gateway_id, first.gateway_id);
  assert.equal(second.tally.duplicate, 1);

  const check = new pg.Client({ connectionString: SCRATCH_URL });
  await check.connect();
  const gw = await check.query(
    `select count(*)::int n from gateway where name = 'backfill-elixir-bot'`,
  );
  assert.equal(gw.rows[0].n, 1, "exactly one backfill gateway row");
  const battles = await check.query(`select count(*)::int n from battle`);
  assert.ok(battles.rows[0].n > 0, "archive battles landed");
  const receipts = await check.query(
    `select count(*)::int n from api_receipt r
     join gateway g on g.gateway_id = r.gateway_id
     where g.name = 'backfill-elixir-bot'`,
  );
  assert.equal(
    receipts.rows[0].n,
    1,
    "receipt attributed to the backfill gateway",
  );
  await check.end();
});

test("probe op: hourly census counts live fetches, excludes the backfill gateway", async () => {
  // Runs after the replay test: the scratch DB holds backfill receipts
  // and battles. Those battles show as harvests; the backfill fetch must
  // NOT show as capture volume.
  process.env.DATABASE_URL = SCRATCH_URL;
  const { handler } = await import("../src/lambda.mjs");

  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     select account_id, 'probe-live-gw', '10.0.0.9', 'active'
     from account where email_hash = 'replay-owner'
     returning gateway_id`,
  );
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('player_battlelog', '#PROBE1', now(), 'probe-hash', $1, 'admitted')`,
    [gw.gateway_id],
  );
  await db.end();

  const result = await handler({ probe: true });
  assert.ok(Array.isArray(result.hours), "hours array");
  const totalBattlelog = result.hours.reduce((s, h) => s + h.battlelog, 0);
  const totalBattles = result.hours.reduce((s, h) => s + h.battles, 0);
  assert.equal(totalBattlelog, 1, "only the live gateway's fetch counts");
  assert.ok(totalBattles > 0, "replayed battles appear as harvests");
  assert.match(result.hours[0].hour, /^\d{2}-\d{2}T\d{2}Z$/);
});
