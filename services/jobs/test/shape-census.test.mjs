/**
 * The nightly shape census over a scratch database and an in-memory
 * archive: a correct manifest files nothing; a field the API added is
 * filed once and stays filed while open; a manifest field absent for
 * seven days is filed with its last sighting; the report counts.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { archiveKey } from "../../../packages/ingest/src/pipeline.mjs";
import { payloadHash } from "../../../packages/ingest/src/hash.mjs";
import { shapeCensus } from "../src/shape-census.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_shape_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
const archive = new Map();
const NOW = "2026-09-18T05:05:00Z";

async function archived(endpoint, entityKey, payload, fetchedAt) {
  const hash = payloadHash(payload);
  await db.query(
    `insert into api_payload (endpoint, entity_key, payload_hash, first_fetched_at, last_fetched_at)
     values ($1, $2, $3, $4, $4)
     on conflict (endpoint, entity_key, payload_hash) do update set last_fetched_at = excluded.last_fetched_at`,
    [endpoint, entityKey, hash, fetchedAt],
  );
  archive.set(
    archiveKey(endpoint, entityKey, new Date(fetchedAt).toISOString(), hash),
    gzipSync(Buffer.from(JSON.stringify(payload))),
  );
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(
    `insert into account (email_hash, status, is_owner, role) values ('shape-owner', 'approved', true, 'owner')`,
  );
});
after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

const deps = () => ({
  getObject: async (key) => {
    const body = archive.get(key);
    if (!body) throw new Error(`no object ${key}`);
    return body;
  },
  now: NOW,
});

test("a correct manifest files nothing; an added field is filed once; an absent one after seven days", async () => {
  const profile = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/player/profile.json"), "utf8"),
  );
  const roster = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/clan/roster.json"), "utf8"),
  );
  await archived("player", "#JYRQ8U92C", profile, "2026-09-17T14:40:34Z");
  await archived("clan", "#J2RGCRVG", roster, "2026-09-17T14:40:34Z");

  const d1 = deps();
  const first = await shapeCensus(DB_URL, d1);
  assert.equal(first.endpoints.player.read, 1);
  assert.equal(first.endpoints.clan.read, 1);
  assert.equal(
    first.endpoints.riverracelog.sampled,
    0,
    "nothing fetched today: no sample, no finding",
  );
  assert.deepEqual(first.findings, []);
  assert.equal(first.filed, 0);
  const {
    rows: [{ n }],
  } = await db.query(
    `select count(*)::int as n from payload_shape_seen where endpoint = 'player'`,
  );
  assert.ok(n > 90, `the memory holds the profile's paths (${n})`);

  // The API adds a field to the profile (kingTowerLevel, 2026-09-02,
  // was exactly this): filed once, with the sample count in context.
  const grown = structuredClone(profile);
  grown.towerTroopLevel = 12;
  await archived("player", "#JYRQ8U92C", grown, "2026-09-17T22:40:34Z");
  const d2 = deps();
  const second = await shapeCensus(DB_URL, d2);
  assert.deepEqual(
    second.findings.map((f) => [
      f.endpoint,
      f.path,
      f.sample_type,
      f.seen_in,
      f.sampled,
    ]),
    [["player", "towerTroopLevel", "new_field", 1, 2]],
  );
  assert.equal(second.filed, 1);
  assert.equal(second.findings.length, 1);
  const { rows: filed } = await db.query(
    `select surface, category, status, context, message from feedback where surface = 'recorder'`,
  );
  assert.equal(filed.length, 1);
  assert.equal(filed[0].category, "data_quality");
  assert.equal(filed[0].status, "new");
  assert.deepEqual(filed[0].context, {
    endpoint: "player",
    sample_type: "new_field",
    paths: ["towerTroopLevel"],
    first_seen: new Date(NOW).toISOString(),
    sampled: 2,
    seen_in: { towerTroopLevel: 1 },
  });
  assert.match(filed[0].message, /payload-keys\.mjs/);

  // The next night: still there, still open, not filed again; the
  // report still counts it.
  const d3 = deps();
  const third = await shapeCensus(DB_URL, d3);
  assert.equal(third.filed, 0);
  assert.equal(third.already_open, 1);
  assert.equal(third.findings.length, 1);
  const {
    rows: [{ c }],
  } = await db.query(
    `select count(*)::int as c from feedback where surface = 'recorder'`,
  );
  assert.equal(c, 1);

  // Closed by Close the Loop: a recurrence files again.
  await db.query(
    `update feedback set status = 'done' where surface = 'recorder'`,
  );
  const fourth = await shapeCensus(DB_URL, deps());
  assert.equal(fourth.filed, 1);

  // The API retires a field: the manifest still names kingTowerLevel,
  // the sample no longer carries it. Not a finding until seven days
  // past its last sighting.
  const shrunk = structuredClone(profile);
  delete shrunk.kingTowerLevel;
  await db.query(`delete from api_payload where endpoint = 'player'`);
  await archived("player", "#JYRQ8U92C", shrunk, "2026-09-17T23:40:34Z");
  const soon = await shapeCensus(DB_URL, deps());
  assert.deepEqual(soon.endpoints.player.absent_fields, []);
  await db.query(
    `update payload_shape_seen set last_seen_at = $1::timestamptz - interval '8 days'
     where endpoint = 'player' and path = 'kingTowerLevel'`,
    [NOW],
  );
  const later = await shapeCensus(DB_URL, deps());
  assert.deepEqual(
    later.endpoints.player.absent_fields.map((f) => f.path),
    ["kingTowerLevel"],
  );
  const absent = later.findings.find((f) => f.sample_type === "absent_field");
  assert.equal(absent.path, "kingTowerLevel");
  assert.match(absent.message, /absent from every sampled payload for 7 days/);
  const {
    rows: [open],
  } = await db.query(
    `select context from feedback where surface = 'recorder' and context->'paths' ? 'kingTowerLevel'`,
  );
  assert.equal(open.context.sample_type, "absent_field");
});

test("one shape change is one item listing its fields, and a field an open item lists is not filed again (feedback #378)", async () => {
  await db.query(`delete from feedback where surface = 'recorder'`);
  await db.query(`delete from api_payload`);
  const profile = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/player/profile.json"), "utf8"),
  );
  // An item filed before 11.10.0 names one field in context.path.
  const {
    rows: [owner],
  } = await db.query(
    `select account_id from account where is_owner order by created_at limit 1`,
  );
  await db.query(
    `insert into feedback (account_id, surface, area, category, message, context)
     values ($1, 'recorder', 'recorder', 'data_quality', 'old', $2::jsonb)`,
    [
      owner.account_id,
      JSON.stringify({ endpoint: "player", path: "alreadyOpen" }),
    ],
  );
  const grown = structuredClone(profile);
  grown.towerTroopLevel = 12;
  grown.towerTroopName = "Dagger Duchess";
  grown.towerTroopRarity = "legendary";
  grown.alreadyOpen = true;
  await archived("player", "#JYRQ8U92C", grown, "2026-09-17T22:40:34Z");
  const run = await shapeCensus(DB_URL, deps());
  const newFields = run.findings.filter(
    (f) => f.endpoint === "player" && f.sample_type === "new_field",
  );
  assert.equal(newFields.length, 4, "the report still counts every field");
  assert.equal(run.filed, 1, "one item for one cause");
  assert.equal(run.fields_filed, 3);
  assert.equal(run.already_open, 1, "the field the old item names");
  const { rows } = await db.query(
    `select message, context from feedback
      where surface = 'recorder' and context ? 'paths'`,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].context.paths, [
    "towerTroopLevel",
    "towerTroopName",
    "towerTroopRarity",
  ]);
  assert.match(
    rows[0].message,
    /3 fields payload-keys\.mjs has no disposition for/,
  );
  assert.match(
    rows[0].message,
    /- towerTroopName \(in 1 of 1 sampled payloads\)/,
  );

  // The next night files nothing: every field is on an open item.
  const again = await shapeCensus(DB_URL, deps());
  assert.equal(again.filed, 0);
  assert.equal(again.already_open, 4);
});
