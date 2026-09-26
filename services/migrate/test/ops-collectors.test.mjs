import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { collectorReleaseOp } from "../src/ops-collectors.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_collectors_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
// A refusal returns before connecting; this URL proves it.
const NOWHERE = "postgres://nobody@127.0.0.1:1/none";

const BASE =
  "https://github.com/jthingelstad/elixir-mcp-collector/releases/download";
const GOOD = {
  platform: "go-linux-arm",
  version: "v3.0.1",
  sha256: "a".repeat(64),
  url: `${BASE}/v3.0.1/collector_linux_armv7`,
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
});

after(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("collector_release refuses what a collector would refuse, before touching the database", async () => {
  const refused = [
    { ...GOOD, version: "3.0.1", url: `${BASE}/3.0.1/collector_linux_armv7` },
    { ...GOOD, version: "py-v2.0.19" },
    { ...GOOD, sha256: "A".repeat(64) },
    { ...GOOD, sha256: "a".repeat(63) },
    { ...GOOD, platform: "py-linux" },
    // Another tag's asset, another repo, another host, plain http.
    { ...GOOD, url: `${BASE}/v3.0.0/collector_linux_armv7` },
    {
      ...GOOD,
      url: "https://github.com/someone/elixir-mcp-collector/releases/download/v3.0.1/collector_linux_armv7",
    },
    { ...GOOD, url: "https://example.com/v3.0.1/collector_linux_armv7" },
    { ...GOOD, url: GOOD.url.replace("https:", "http:") },
    { ...GOOD, url: `${BASE}/v3.0.1/../v3.0.0/collector_linux_armv7` },
    { ...GOOD, url: `${BASE}/v3.0.1/SHA256SUMS` },
    {},
  ];
  for (const spec of refused) {
    const r = await collectorReleaseOp(NOWHERE, spec);
    assert.ok(r.error, `refused: ${JSON.stringify(spec)}`);
  }
});

test("collector_release writes a well-formed release row", async () => {
  assert.deepEqual(await collectorReleaseOp(SCRATCH_URL, GOOD), {
    ok: true,
    platform: GOOD.platform,
    version: GOOD.version,
  });
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const { rows } = await db.query(
    `select platform, version, sha256, url from collector_release`,
  );
  const { rows: history } = await db.query(
    `select platform, version, sha256, url from collector_release_history`,
  );
  await db.end();
  assert.deepEqual(rows, [GOOD]);
  assert.deepEqual(history, [GOOD]);
});

test("collector_release keeps every named release in history, the current one per platform", async () => {
  const next = {
    ...GOOD,
    version: "v3.0.2",
    sha256: "b".repeat(64),
    url: `${BASE}/v3.0.2/collector_linux_armv7`,
  };
  assert.equal((await collectorReleaseOp(SCRATCH_URL, next)).ok, true);
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const { rows } = await db.query(
    `select version from collector_release where platform = $1`,
    [GOOD.platform],
  );
  const { rows: history } = await db.query(
    `select version, sha256 from collector_release_history
     where platform = $1 order by version`,
    [GOOD.platform],
  );
  await db.end();
  assert.deepEqual(rows, [{ version: "v3.0.2" }]);
  assert.deepEqual(history, [
    { version: "v3.0.1", sha256: GOOD.sha256 },
    { version: "v3.0.2", sha256: next.sha256 },
  ]);
});
