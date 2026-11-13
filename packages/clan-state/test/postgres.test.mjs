import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { schemaFingerprint } from "../../../services/migrate/src/fingerprint.mjs";
import { createPostgresStore, createPostgresLedger } from "../src/postgres.mjs";
import { warMembershipEvidence } from "../../record/src/war-membership.mjs";
import { backfillReadFacts } from "../../record/src/read-facts.mjs";
import {
  inspectSnapshot,
  importSnapshot,
  compareSnapshot,
} from "../src/import.mjs";
import { createScratch, dropScratch } from "../../ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_clan_state_test_${process.pid}`;
const url = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, other;
before(async () => {
  await createScratch(name);
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
  await dropScratch(name);
});
beforeEach(async () => {
  await db.query("truncate clan_state, clan_state_import");
});
const snapshot = (items) => {
  const bytes = Buffer.from(JSON.stringify({ version: 1, items }));
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
};
const durable = [
  { pk: "policy##00UQG", version: 3 },
  {
    pk: "policy##00UQG#v3",
    gsi1pk: "clan##00UQG",
    gsi1sk: "policy#v000003",
    version: 3,
    values: { free_text: "old exact words" },
  },
  { pk: "action_seq##00UQG", n: 37 },
  {
    pk: "card##00UQG#stable-id",
    gsi1pk: "clan##00UQG",
    gsi1sk: "card#2026-10-01#stable-id",
    card_id: "stable-id",
    number: 37,
    frozen: { evidence: [1, 2] },
    unknown_future: { kept: true },
  },
  {
    pk: "mailed##00UQG##0LGYR",
    gsi1pk: "clan##00UQG",
    gsi1sk: "mailed##0LGYR",
    player_tag: "#0LGYR",
    at: "2026-10-01T09:00:00Z",
  },
  { pk: "pref##0LGYR", clan_tag: "#00UQG" },
  {
    pk: "model_key##00UQG",
    sealed: {
      v: 1,
      iv: "AAAAAAAAAAAAAAAA",
      tag: "AAAAAAAAAAAAAAAAAAAAAA==",
      ct: "c2VhbGVk",
    },
    set_by: "#0LGYR",
  },
];
test("award plans and grant receipts survive duplicate writes without changing provenance", async () => {
  const ledger = createPostgresLedger(db);
  const grant = {
    season_id: 136,
    award_id: "champ",
    player_tag: "#0LGYR",
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
  assert.deepEqual(await ledger.saveAwardPlan("#00UQG", plan), plan);
  assert.deepEqual(
    await ledger.saveAwardPlan("#00UQG", { ...plan, grants: [] }),
    plan,
  );
  assert.deepEqual(await ledger.putGrant("#00UQG", grant), grant);
  assert.deepEqual(
    await ledger.putGrant("#00UQG", { ...grant, metric_value: 0 }),
    grant,
  );
  assert.deepEqual(await ledger.grants("#00UQG"), [grant]);
  await ledger.completeAwardPlan("#00UQG", plan, "2026-10-05T10:01:00Z");
  const saved = (await ledger.awardPlans("#00UQG"))[0];
  assert.deepEqual(saved.grants, [grant]);
  assert.equal(saved.completed_at, "2026-10-05T10:01:00Z");
  await ledger.saveDiscordLog("#00UQG", {
    entries: [
      { at: "2026-10-05T10:02:00Z", outcome: "posted", excerpt: "#1 Fixture" },
    ],
    missed: {},
  });
  assert.equal((await ledger.discordLog("#00UQG")).entries.length, 1);
  await ledger.deleteClan("#00UQG");
  assert.deepEqual(await ledger.awardPlans("#00UQG"), []);
  assert.equal(
    await ledger.discordLog("#00UQG"),
    null,
    "the delivery log goes with the clan",
  );
});
test("canonical membership SQL keeps race absence separate from full donation-week absence", async () => {
  await db.query("begin");
  try {
    await db.query(
      "insert into player (player_tag,name) values ('#0LGYR','Fixture')",
    );
    await db.query(
      "insert into clan (clan_tag,name) values ('#00UQG','Fixture Clan')",
    );
    await db.query(`insert into clan_membership (clan_tag,player_tag,joined_observed_at,left_observed_at)
      values ('#00UQG','#0LGYR','2026-08-01','2026-09-08T13:00:00Z'),
      ('#00UQG','#0LGYR','2026-09-29',null)`);
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
      select 'clan','#00UQG',t,'fixture',$1,'admitted'
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
    await backfillReadFacts(db, {});
    const participation = {
      recording_active_since: "2026-08-01",
      first_roster_observed_at: "2026-08-01",
      members: [{ player_tag: "#0LGYR" }],
      war_weeks: [
        {
          started_observed_at: "2026-09-09T10:00:00Z",
          finished_observed_at: "2026-09-14T10:00:00Z",
        },
      ],
      weeks: [{ from: "2026-09-07", to: "2026-09-14" }],
    };
    assert.deepEqual(await warMembershipEvidence(db, "#00UQG", participation), {
      war: { "#0LGYR": [true] },
      donations: { "#0LGYR": [false] },
    });
    // Evidence reads the read facts (0259), so take the read after the
    // finish out of those.
    await db.query(`update admitted_read_day
      set read_at = array(select x from unnest(read_at) x
                          where x < '2026-09-14T10:00:00Z')
      where entity_key='#00UQG'`);
    assert.deepEqual(await warMembershipEvidence(db, "#00UQG", participation), {
      war: { "#0LGYR": [null] },
      donations: { "#0LGYR": [null] },
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
  const listed = await store.listByPartition("clan##00UQG");
  assert.equal(listed.length, 3);
  assert.ok(!listed.some((i) => i.pk.startsWith("model_key")));
  await store.put({ ...durable[0], version: 4 });
  assert.equal((await compareSnapshot(db, bytes, digest)).equal, false);
  const repeat = await importSnapshot(db, bytes, digest, { apply: true });
  assert.equal(repeat.already_imported, true);
  assert.equal((await store.get(durable[0].pk)).version, 4);
  const changed = snapshot([
    ...durable,
    { pk: "note##00UQG#new", text: "new" },
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
    a.increment("action_seq##00UQG"),
    b.increment("action_seq##00UQG"),
  ]);
  assert.deepEqual(numbers.sort(), [1, 2]);
  await a.put({ pk: "card##00UQG#id", unknown: "keep" });
  const numbered = await Promise.all([
    a.setIfAbsent("card##00UQG#id", "number", 1),
    b.setIfAbsent("card##00UQG#id", "number", 2),
  ]);
  assert.equal(numbered.filter(Boolean).length, 1);
  assert.equal((await a.get("card##00UQG#id")).unknown, "keep");
  assert.equal(await a.setIfAbsent("missing", "number", 1), false);
  const claimed = await Promise.all([
    a.claimDay("morning##00UQG", "2026-10-02", "now"),
    b.claimDay("morning##00UQG", "2026-10-02", "now"),
  ]);
  assert.equal(claimed.filter(Boolean).length, 1);
  assert.equal(await b.claimDay("morning##00UQG", "2026-10-03", "later"), true);
});
test("shared ledger preserves version history, literal prefix matching, and excludes sealed keys from clan lists", async () => {
  const l = createPostgresLedger(db);
  await l.savePolicy("#00UQG", { values: { enabled: true }, by: "#0LGYR" });
  await l.savePolicy("#00UQG", { values: { enabled: false }, by: "#0LGYR" });
  assert.equal((await l.currentPolicy("#00UQG")).version, 2);
  assert.equal((await l.policyVersions("#00UQG")).length, 2);
  const store = createPostgresStore(db);
  await store.put({
    pk: "note##00UQG#id",
    gsi1pk: "clan##00UQG",
    gsi1sk: "note#percent_%",
    text: "literal",
  });
  assert.equal(
    (await store.listByPartition("clan##00UQG", "note#percent_%")).length,
    1,
  );
  assert.equal(
    (await store.listByPartition("clan##00UQG", "note#percent_X")).length,
    0,
  );
  await l.saveModelKey("#00UQG", { sealed: durable[6].sealed });
  assert.deepEqual((await l.modelKey("#00UQG")).sealed, durable[6].sealed);
  assert.ok(
    !(await store.listByPartition("clan##00UQG")).some((i) =>
      i.pk.startsWith("model_key"),
    ),
  );
});

test("bounded action logs and numbered cards cannot cross clans or card prefixes", async () => {
  const ledger = createPostgresLedger(db);
  for (const clan of ["#00UQG", "#OTHER"])
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
  const logs = await ledger.actionLogsFor("#00UQG", ["one", "two"]);
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map((r) => r.text).sort(), [
    "#00UQG:one",
    "#00UQG:two",
  ]);
  assert.deepEqual(await ledger.actionLogsFor("#00UQG", []), []);
  assert.equal((await ledger.cardByNumber("#00UQG", 1)).card_id, "one");
  assert.equal(await ledger.cardByNumber("#MISSING", 1), null);
});

test("concurrent member-count observations cannot roll back a newer source read", async () => {
  const a = createPostgresLedger(db),
    b = createPostgresLedger(other);
  const old = { members: 9, observed_at: "2026-10-03T21:00:00.000Z" };
  const fresh = { members: 50, observed_at: "2026-10-03T21:01:00.000Z" };
  await Promise.all([
    a.saveClanSize("#00UQG", fresh),
    b.saveClanSize("#00UQG", old),
  ]);
  assert.deepEqual(await a.clanSize("#00UQG"), fresh);
  assert.equal(await b.saveClanSize("#00UQG", old), false);
  assert.equal(await b.saveClanSize("#00UQG", { ...fresh, members: 1 }), false);
  assert.deepEqual(await a.clanSize("#00UQG"), fresh);
});

test("reopen compare-and-patch is atomic across clients and preserves partial sent receipts", async () => {
  const a = createPostgresLedger(db),
    b = createPostgresLedger(other);
  const original = await a.putCard("#00UQG", {
    card_id: "reopen-fixture",
    number: 33,
    raised_at: "2026-10-03T10:00:00Z",
    status: "declined",
    decided_at: "2026-10-03T12:00:00Z",
    evidence: { messages: [{ part: 1 }, { part: 2 }] },
    messages_sent: [
      { part: 1, title: "Exact title", body: "Exact sent words" },
    ],
  });
  const expected = await a.card("#00UQG", "reopen-fixture");
  const patch = {
    status: "proposed",
    decided_at: null,
    reopenings: [
      { request_id: "fixture", decline: { decided_at: expected.decided_at } },
    ],
  };
  const results = await Promise.all([
    a.updateCardIf("#00UQG", expected, patch),
    b.updateCardIf("#00UQG", expected, patch),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const saved = await a.card("#00UQG", "reopen-fixture");
  assert.deepEqual(saved.evidence, expected.evidence);
  assert.deepEqual(saved.messages_sent, expected.messages_sent);
  assert.equal(saved.number, 33);
  assert.equal(saved.reopenings.length, 1);
  assert.equal(original.card_id, "reopen-fixture");
});
