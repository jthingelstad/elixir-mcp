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

test("export + sweep: history lands in S3 keys; only twinned superseded rows leave Postgres", async () => {
  process.env.DATABASE_URL = SCRATCH_URL;
  process.env.ARCHIVE_BUCKET = "test-archive";
  const { exportPayloads } = await import("../src/lambda.mjs");
  const { sweepPayloads } = await import("../../jobs/src/index.mjs");

  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  // Two versions of one entity: v1 superseded, v2 latest.
  await db.query(
    `insert into api_payload (endpoint, entity_key, payload_hash, payload_json, first_fetched_at, last_fetched_at)
     values ('player', '#SWEEP1', 'hash-v1', '{"v":1}', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z'),
            ('player', '#SWEEP1', 'hash-v2', '{"v":2}', '2026-09-02T10:00:00Z', '2026-09-02T10:00:00Z')`,
  );
  await db.end();

  const stored = new Map();
  const fakeS3 = {
    async send(cmd) {
      const name = cmd.constructor.name;
      if (name === "PutObjectCommand") {
        stored.set(cmd.input.Key, cmd.input.Body);
        return {};
      }
      if (name === "HeadObjectCommand") {
        if (!stored.has(cmd.input.Key)) throw new Error("NotFound");
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };

  // Sweep BEFORE export: superseded row has no twin -> stays.
  const dry = await sweepPayloads(SCRATCH_URL, fakeS3);
  assert.equal(dry.swept, 0);
  assert.ok(dry.missing >= 1, "untwinned rows are never deleted");

  // Export everything (cursor loop).
  let cursor = 0;
  let total = 0;
  for (;;) {
    const r = await exportPayloads(
      SCRATCH_URL,
      { after_id: cursor, limit: 2 },
      fakeS3,
    );
    total += r.exported;
    cursor = r.last_id;
    if (r.done) break;
  }
  assert.ok(total >= 2, "both versions exported");
  const keys = [...stored.keys()];
  assert.ok(
    keys.some((k) =>
      /^payloads\/endpoint=player\/entity=SWEEP1\/dt=2026-09-01\/20260901T100000Z-hash-v1/.test(
        k,
      ),
    ),
    `ingest key scheme, got: ${keys.join(", ")}`,
  );

  // Sweep again: v1 (superseded, twinned) leaves; v2 (latest) stays.
  const swept = await sweepPayloads(SCRATCH_URL, fakeS3);
  assert.ok(swept.swept >= 1);
  const check = new pg.Client({ connectionString: SCRATCH_URL });
  await check.connect();
  const left = await check.query(
    `select payload_hash from api_payload where entity_key = '#SWEEP1' order by payload_hash`,
  );
  assert.deepEqual(
    left.rows.map((r) => r.payload_hash),
    ["hash-v2"],
    "latest content stays hot in Postgres",
  );
  await check.end();
});

test("operational sweep: dead weight leaves, live rows and replay-memory stay", async () => {
  process.env.DATABASE_URL = SCRATCH_URL;
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  await db.query(
    `insert into rate_limit (bucket, window_start, count)
     values ('b-old', now() - interval '8 days', 1),
            ('b-live', now() - interval '1 hour', 1)`,
  );
  await db.query(
    `insert into magic_login (token_hash, email_hash, code_hash, expires_at)
     values ('t-old', 'e', 'c', now() - interval '31 days'),
            ('t-live', 'e', 'c', now() + interval '15 minutes')`,
  );
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status) values ('sweep-op', 'approved') returning account_id`,
  );
  await db.query(
    `insert into session (session_id, account_id, sliding_expires_at, absolute_expires_at)
     values ('s-old', $1, now() - interval '31 days', now() - interval '1 day'),
            ('s-live', $1, now() + interval '5 days', now() + interval '80 days')`,
    [acct.account_id],
  );
  await db.query(
    `insert into mcp_call_audit (account_id, tool, args, created_at)
     values ($1, 'old_tool', '{"x":1}', now() - interval '91 days'),
            ($1, 'new_tool', '{"x":2}', now())`,
    [acct.account_id],
  );
  await db.end();

  // The operational sweep moved to the jobs Lambda (review item 5).
  const { handler: jobsHandler } = await import("../../jobs/src/index.mjs");
  const result = await jobsHandler({ sweep_operational: true });
  assert.equal(result.rate_limit, 1);
  assert.equal(result.magic_login, 1);
  assert.equal(result.session, 1);
  assert.equal(result.audit_args_nulled, 1);

  const check = new pg.Client({ connectionString: SCRATCH_URL });
  await check.connect();
  const rl = await check.query(`select bucket from rate_limit`);
  assert.deepEqual(
    rl.rows.map((r) => r.bucket).filter((b) => b.startsWith("b-")),
    ["b-live"],
  );
  const sess = await check.query(
    `select session_id from session where session_id like 's-%'`,
  );
  assert.deepEqual(
    sess.rows.map((r) => r.session_id),
    ["s-live"],
  );
  const audit = await check.query(
    `select tool, args from mcp_call_audit where tool in ('old_tool','new_tool') order by tool desc`,
  );
  assert.equal(audit.rows[0].args, null, "old args nulled, row kept");
  assert.ok(audit.rows[1].args, "recent args untouched");
  await check.end();
});
