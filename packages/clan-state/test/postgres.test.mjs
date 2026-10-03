import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import { schemaFingerprint } from "../../../services/migrate/src/fingerprint.mjs";
import { createPostgresStore, createPostgresLedger } from "../src/postgres.mjs";
import { warMembershipEvidence } from "../../record/src/war-membership.mjs";
import {
  inspectSnapshot,
  importSnapshot,
  compareSnapshot,
} from "../src/import.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_clan_state_test_${process.pid}`;
const url = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, other;
before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl: url,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  if (process.env.UPDATE_CLAN_SCHEMA_PIN === "1")
    await writeFile(
      new URL("../../../db/schema.fingerprint", import.meta.url),
      (await schemaFingerprint(url)) + "\n",
    );
  db = new pg.Client({ connectionString: url });
  other = new pg.Client({ connectionString: url });
  await db.connect();
  await other.connect();
});
after(async () => {
  await db?.end();
  await other?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});
beforeEach(async () => {
  await db.query("truncate clan_state, clan_state_import");
});
const snapshot = (items) => {
  const bytes = Buffer.from(JSON.stringify({ version: 1, items }));
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
};
const durable = [
  { pk: "policy##P0LYQ", version: 3 },
  {
    pk: "policy##P0LYQ#v3",
    gsi1pk: "clan##P0LYQ",
    gsi1sk: "policy#v000003",
    version: 3,
    values: { free_text: "old exact words" },
  },
  { pk: "action_seq##P0LYQ", n: 37 },
  {
    pk: "card##P0LYQ#stable-id",
    gsi1pk: "clan##P0LYQ",
    gsi1sk: "card#2026-10-01#stable-id",
    card_id: "stable-id",
    number: 37,
    frozen: { evidence: [1, 2] },
    unknown_future: { kept: true },
  },
  {
    pk: "mailed##P0LYQ##P2LQ0",
    gsi1pk: "clan##P0LYQ",
    gsi1sk: "mailed##P2LQ0",
    player_tag: "#P2LQ0",
    at: "2026-10-01T09:00:00Z",
  },
  { pk: "pref##P2LQ0", clan_tag: "#P0LYQ" },
  {
    pk: "model_key##P0LYQ",
    sealed: {
      v: 1,
      iv: "AAAAAAAAAAAAAAAA",
      tag: "AAAAAAAAAAAAAAAAAAAAAA==",
      ct: "c2VhbGVk",
    },
    set_by: "#P2LQ0",
  },
];
test("award plans and grant receipts survive duplicate writes without changing provenance", async () => {
  const ledger = createPostgresLedger(db);
  const grant = {
    season_id: 136,
    award_id: "champ",
    player_tag: "#P2LQ0",
    player_name: "Fixture",
    rank: 1,
    metric_value: 5000,
    manual: false,
    granted_at: "2026-10-05T10:00:00Z",
  };
  const plan = {
    season_id: 136,
    award_id: "champ",
    grants: [grant],
    planned_at: grant.granted_at,
  };
  assert.deepEqual(await ledger.saveAwardPlan("#P0LYQ", plan), plan);
  assert.deepEqual(
    await ledger.saveAwardPlan("#P0LYQ", { ...plan, grants: [] }),
    plan,
  );
  assert.deepEqual(await ledger.putGrant("#P0LYQ", grant), grant);
  assert.deepEqual(
    await ledger.putGrant("#P0LYQ", { ...grant, metric_value: 0 }),
    grant,
  );
  assert.deepEqual(await ledger.grants("#P0LYQ"), [grant]);
  await ledger.completeAwardPlan("#P0LYQ", plan, "2026-10-05T10:01:00Z");
  const saved = (await ledger.awardPlans("#P0LYQ"))[0];
  assert.deepEqual(saved.grants, [grant]);
  assert.equal(saved.completed_at, "2026-10-05T10:01:00Z");
  await ledger.deleteClan("#P0LYQ");
  assert.deepEqual(await ledger.awardPlans("#P0LYQ"), []);
});
test("canonical membership SQL keeps race absence separate from full donation-week absence", async () => {
  await db.query("begin");
  try {
    await db.query(
      "insert into player (player_tag,name) values ('#P2LQ0','Fixture')",
    );
    await db.query(
      "insert into clan (clan_tag,name) values ('#P0LYQ','Fixture Clan')",
    );
    await db.query(`insert into clan_membership (clan_tag,player_tag,joined_observed_at,left_observed_at)
      values ('#P0LYQ','#P2LQ0','2026-08-01','2026-09-08T13:00:00Z'),
      ('#P0LYQ','#P2LQ0','2026-09-29',null)`);
    const {
      rows: [account],
    } = await db.query(`insert into account (email_hash)
      values ('membership-fixture') returning account_id`);
    const {
      rows: [gateway],
    } = await db.query(
      `insert into gateway (owner_account_id,name,status)
      values ($1,'Fixture gateway','active') returning gateway_id`,
      [account.account_id],
    );
    await db.query(
      `insert into api_receipt (endpoint,entity_key,fetched_at,payload_hash,gateway_id,admission)
      select 'clan','#P0LYQ',t,'fixture',$1,'admitted'
      from unnest($2::timestamptz[]) t`,
      [
        gateway.gateway_id,
        [
          "2026-09-07T09:55:00Z",
          "2026-09-09T09:55:00Z",
          "2026-09-14T10:05:00Z",
        ],
      ],
    );
    const participation = {
      recording_active_since: "2026-08-01",
      first_roster_observed_at: "2026-08-01",
      members: [{ player_tag: "#P2LQ0" }],
      war_weeks: [
        {
          started_observed_at: "2026-09-09T10:00:00Z",
          finished_observed_at: "2026-09-14T10:00:00Z",
        },
      ],
      weeks: [{ from: "2026-09-07", to: "2026-09-14" }],
    };
    assert.deepEqual(await warMembershipEvidence(db, "#P0LYQ", participation), {
      war: { "#P2LQ0": [true] },
      donations: { "#P2LQ0": [false] },
    });
    await db.query(`delete from api_receipt where entity_key='#P0LYQ'
      and fetched_at >= '2026-09-14T10:00:00Z'`);
    assert.deepEqual(await warMembershipEvidence(db, "#P0LYQ", participation), {
      war: { "#P2LQ0": [null] },
      donations: { "#P2LQ0": [null] },
    });
  } finally {
    await db.query("rollback");
  }
});
test("scratch migration pins the full schema", async () => {
  const pinned = (
    await readFile(
      new URL("../../../db/schema.fingerprint", import.meta.url),
      "utf8",
    )
  ).trim();
  assert.equal(await schemaFingerprint(url), pinned);
});
test("digest-bound import is lossless, private, idempotent and cannot overwrite subsequent changes", async () => {
  const { bytes, digest } = snapshot(durable);
  const preview = await importSnapshot(db, bytes, digest);
  assert.equal(preview.item_count, 7);
  assert.equal(preview.applied, false);
  assert.ok(!JSON.stringify(preview).includes("stable-id"));
  assert.equal(
    (await db.query("select count(*)::int as n from clan_state")).rows[0].n,
    0,
  );
  const result = await importSnapshot(db, bytes, digest, { apply: true });
  assert.equal(result.applied, true);
  const comparison = await compareSnapshot(db, bytes, digest);
  assert.equal(comparison.equal, true);
  assert.equal(comparison.matching, 7);
  assert.equal(JSON.stringify(comparison).includes("stable-id"), false);
  const store = createPostgresStore(db);
  for (const item of durable) assert.deepEqual(await store.get(item.pk), item);
  const listed = await store.listByPartition("clan##P0LYQ");
  assert.equal(listed.length, 3);
  assert.ok(!listed.some((i) => i.pk.startsWith("model_key")));
  await store.put({ ...durable[0], version: 4 });
  assert.equal((await compareSnapshot(db, bytes, digest)).equal, false);
  const repeat = await importSnapshot(db, bytes, digest, { apply: true });
  assert.equal(repeat.already_imported, true);
  assert.equal((await store.get(durable[0].pk)).version, 4);
  const changed = snapshot([
    ...durable,
    { pk: "note##P0LYQ#new", text: "new" },
  ]);
  await assert.rejects(
    importSnapshot(db, changed.bytes, changed.digest, { apply: true }),
    /destination must be empty/,
  );
});
test("import refuses mismatches, unknown kinds, tokens, plaintext keys and temporary sessions before writes", async () => {
  for (const item of [
    { pk: "session#old", accessToken: "opaque" },
    { pk: "login#temporary" },
    { pk: "future#unknown" },
    { pk: "pref#user", nested: { refresh_token: "opaque" } },
    { pk: "model_key#clan", key: "sk-ant-123456789012345678901234567" },
    { pk: "model_key#clan", sealed: "not-a-box" },
  ]) {
    const s = snapshot([item]);
    assert.throws(() => inspectSnapshot(s.bytes, s.digest));
  }
  const s = snapshot(durable);
  assert.throws(
    () => inspectSnapshot(s.bytes, "0".repeat(64)),
    /digest mismatch/,
  );
  const dup = snapshot([durable[0], durable[0]]);
  assert.throws(() => inspectSnapshot(dup.bytes, dup.digest), /duplicate/);
  await assert.rejects(
    createPostgresStore(db).put({ pk: "session#forbidden" }),
    /clan_state_not_session/,
  );
});
test("two independent connections atomically allocate counters, first attributes, and daily claims", async () => {
  const a = createPostgresStore(db),
    b = createPostgresStore(other);
  const numbers = await Promise.all([
    a.increment("action_seq##P0LYQ"),
    b.increment("action_seq##P0LYQ"),
  ]);
  assert.deepEqual(numbers.sort(), [1, 2]);
  await a.put({ pk: "card##P0LYQ#id", unknown: "keep" });
  const numbered = await Promise.all([
    a.setIfAbsent("card##P0LYQ#id", "number", 1),
    b.setIfAbsent("card##P0LYQ#id", "number", 2),
  ]);
  assert.equal(numbered.filter(Boolean).length, 1);
  assert.equal((await a.get("card##P0LYQ#id")).unknown, "keep");
  assert.equal(await a.setIfAbsent("missing", "number", 1), false);
  const claimed = await Promise.all([
    a.claimDay("morning##P0LYQ", "2026-10-02", "now"),
    b.claimDay("morning##P0LYQ", "2026-10-02", "now"),
  ]);
  assert.equal(claimed.filter(Boolean).length, 1);
  assert.equal(await b.claimDay("morning##P0LYQ", "2026-10-03", "later"), true);
});
test("shared ledger preserves version history, literal prefix matching, and excludes sealed keys from clan lists", async () => {
  const l = createPostgresLedger(db);
  await l.savePolicy("#P0LYQ", { values: { enabled: true }, by: "#P2LQ0" });
  await l.savePolicy("#P0LYQ", { values: { enabled: false }, by: "#P2LQ0" });
  assert.equal((await l.currentPolicy("#P0LYQ")).version, 2);
  assert.equal((await l.policyVersions("#P0LYQ")).length, 2);
  const store = createPostgresStore(db);
  await store.put({
    pk: "note##P0LYQ#id",
    gsi1pk: "clan##P0LYQ",
    gsi1sk: "note#percent_%",
    text: "literal",
  });
  assert.equal(
    (await store.listByPartition("clan##P0LYQ", "note#percent_%")).length,
    1,
  );
  assert.equal(
    (await store.listByPartition("clan##P0LYQ", "note#percent_X")).length,
    0,
  );
  await l.saveModelKey("#P0LYQ", { sealed: durable[6].sealed });
  assert.deepEqual((await l.modelKey("#P0LYQ")).sealed, durable[6].sealed);
  assert.ok(
    !(await store.listByPartition("clan##P0LYQ")).some((i) =>
      i.pk.startsWith("model_key"),
    ),
  );
});

test("bounded action logs and numbered cards cannot cross clans or card prefixes", async () => {
  const ledger = createPostgresLedger(db);
  for (const clan of ["#P0LYQ", "#OTHER"])
    for (const cardId of ["one", "one-extra", "two"]) {
      await ledger.putCard(clan, {
        card_id: cardId,
        number: cardId === "one" ? 1 : 2,
        raised_at: "2026-10-01T00:00:00Z",
      });
      await ledger.appendActionLog(clan, {
        card_id: cardId,
        kind: "comment",
        text: `${clan}:${cardId}`,
        at: "2026-10-01T00:00:00Z",
      });
    }
  const logs = await ledger.actionLogsFor("#P0LYQ", ["one", "two"]);
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map((r) => r.text).sort(), [
    "#P0LYQ:one",
    "#P0LYQ:two",
  ]);
  assert.deepEqual(await ledger.actionLogsFor("#P0LYQ", []), []);
  assert.equal((await ledger.cardByNumber("#P0LYQ", 1)).card_id, "one");
  assert.equal(await ledger.cardByNumber("#MISSING", 1), null);
});
