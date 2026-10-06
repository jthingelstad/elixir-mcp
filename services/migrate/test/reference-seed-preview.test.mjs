import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import os from "node:os";
import { readFileSync } from "node:fs";
import { cardRolesImport } from "../src/ops-archetypes.mjs";
import {
  verifyReferenceSeed,
  prepareReferenceSeedRefresh,
} from "../../../infra/scripts/lib/reference-seed-check.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ??
  `postgres://${os.userInfo().username}@localhost:5432/postgres`;
const name = `elixir_mcp_test_reference_preview_${process.pid}`;
const url = adminUrl.replace(/\/postgres$/, `/${name}`);
const spec = {
  roles: [
    {
      id: 1,
      name: "Fixture tank",
      tier: 1,
      family: "beatdown",
      source: "https://example.com/reference",
      attested_at: "2026-09-20",
      pairs_with: [{ id: 2, family: "control" }],
    },
    {
      id: 2,
      name: "Fixture bait",
      bait_unit: true,
      names_deck: true,
      source: "https://example.com/bait",
    },
  ],
  aliases: [
    {
      alias: "Fixture  Deck",
      cards: [1, 2],
      family: "beatdown",
      source: "https://example.com/deck",
      attested_at: "2026-09-20",
    },
  ],
  roles_version: "2026-09-20T00:00:00.000Z",
  source_commit: "a".repeat(40),
};
let db;
before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query(
    "create table card (card_id integer primary key); insert into card values(1),(2)",
  );
  await db.query(
    readFileSync(
      new URL("../../../db/migrations/0147_card_roles.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query(
    readFileSync(
      new URL(
        "../../../db/migrations/0149_card_role_names_deck.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await cardRolesImport(url, spec);
});
after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});
async function snapshot() {
  return (
    await db.query(
      "select jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r) order by card_id) from card_role r),'aliases',(select jsonb_agg(to_jsonb(a) order by alias) from deck_alias a),'version',(select to_jsonb(v) from card_role_version v)) as result",
    )
  ).rows[0].result;
}
test("preview compares every real stored column and leaves rows and import metadata unchanged", async () => {
  const before = await snapshot();
  const preview = await cardRolesImport(url, { ...spec, preview: true });
  assert.equal(preview.readonly, true);
  assert.equal(preview.preview, true);
  assert.equal(preview.identical, true);
  assert.equal(preview.version_identical, true);
  assert.equal(preview.live_sha256, preview.proposed_sha256);
  assert.deepEqual(preview.differences, []);
  assert.deepEqual(await snapshot(), before);
});
test("preview detects overwritten sources, removed rows, normalized alias columns and metadata drift", async () => {
  await db.query(
    "update card_role set source='https://example.com/operator-note' where card_id=1",
  );
  await db.query("update deck_alias set alias_key='custom key'");
  const before = await snapshot();
  const preview = await cardRolesImport(url, {
    ...spec,
    roles: spec.roles.slice(0, 1),
    source_commit: "b".repeat(40),
    preview: true,
  });
  assert.equal(preview.identical, false);
  assert.equal(preview.version_identical, false);
  assert.notEqual(preview.live_sha256, preview.proposed_sha256);
  assert.deepEqual(preview.differences, [
    { table: "roles", key: 1, fields: ["source"] },
    { table: "roles", key: 2, fields: ["extra_live"] },
    { table: "aliases", key: "Fixture  Deck", fields: ["alias_key"] },
  ]);
  assert.deepEqual(await snapshot(), before);
});
test("malformed or oversized previews refuse before connecting", async () => {
  for (const patch of [
    { preview: false },
    { preview: null },
    { preview: "true" },
    { preview: true, apply: true },
    { preview: true, roles: Array(1001).fill(spec.roles[0]) },
    { preview: true, aliases: null },
  ]) {
    let connections = 0;
    const result = await cardRolesImport(
      "unused",
      { ...spec, ...patch },
      {
        connect() {
          connections++;
        },
      },
    );
    assert.equal(result.error, "invalid_reference_preview");
    assert.equal(connections, 0);
  }
});

test("ordinary source-commit metadata change is allowed only with identical full seed rows", async () => {
  await cardRolesImport(url, spec);
  const before = await snapshot();
  const preview = await cardRolesImport(url, {
    ...spec,
    source_commit: "b".repeat(40),
    preview: true,
  });
  assert.equal(preview.identical, true);
  assert.equal(preview.version_compatible, true);
  assert.equal(preview.version_identical, false);
  assert.equal(preview.live_sha256, preview.proposed_sha256);
  assert.deepEqual(await snapshot(), before);
});

test("falsy JSON inputs preview the exact SQL-null normalization used by the real importer", async () => {
  const value = structuredClone(spec);
  value.roles[0].pairs_with = false;
  value.roles[0].bait_tiers = 0;
  await cardRolesImport(url, value);
  const before = await snapshot();
  const preview = await cardRolesImport(url, { ...value, preview: true });
  assert.equal(preview.identical, true);
  assert.equal(preview.live_sha256, preview.proposed_sha256);
  assert.equal(before.roles[0].pairs_with, null);
  assert.equal(before.roles[0].bait_tiers, null);
  assert.deepEqual(await snapshot(), before);
});

test("a source or caller change after preview cannot change the frozen refresh payload", async () => {
  const value = structuredClone(spec),
    sent = [];
  const lambda = {
    async send(command) {
      const payload = JSON.parse(command.input.Payload);
      sent.push(payload);
      const result = payload.reference_seed_preview
        ? {
            preview: true,
            readonly: true,
            identical: true,
            version_compatible: true,
            live_sha256: "a".repeat(64),
            proposed_sha256: "a".repeat(64),
          }
        : {
            roles: spec.roles.length,
            aliases: spec.aliases.length,
            roles_version: spec.roles_version,
            source_commit: spec.source_commit,
          };
      return { Payload: Buffer.from(JSON.stringify(result)) };
    },
  };
  const prepared = await prepareReferenceSeedRefresh(lambda, value);
  value.roles[0].source = "https://example.com/changed";
  value.source_commit = "b".repeat(40);
  assert.throws(() => {
    prepared.vocabulary.roles[0].source = "https://example.com/unverified";
  }, TypeError);
  await prepared.refresh();
  assert.deepEqual(sent[0].reference_seed_preview, spec);
  assert.deepEqual(sent[1].card_roles_import, spec);
});

test("preview uses the writer's PostgreSQL numeric precision for fractional source tiers", async () => {
  const value = structuredClone(spec);
  value.roles[0].tier = 6.51;
  await cardRolesImport(url, value);
  const before = await snapshot();
  assert.equal(before.roles[0].tier, 6.5);
  const preview = await cardRolesImport(url, { ...value, preview: true });
  assert.equal(preview.identical, true);
  assert.equal(preview.changed_rows, 0);
  assert.equal(preview.live_sha256, preview.proposed_sha256);
  assert.deepEqual(await snapshot(), before);
});
test("a query failure rolls back without leaking internal details", async () => {
  const queries = [];
  let ended = false;
  const client = {
    async connect() {},
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("select")) throw new Error("private database host");
      return { rows: [] };
    },
    async end() {
      ended = true;
    },
  };
  const result = await cardRolesImport(
    "unused",
    { ...spec, preview: true },
    client,
  );
  assert.deepEqual(result, { error: "reference_preview_failed" });
  assert.equal(ended, true);
  assert.ok(
    queries.includes("begin isolation level repeatable read read only"),
  );
  assert.equal(queries.at(-1), "rollback");
  assert.ok(queries.every((q) => !/delete|insert|update/i.test(q)));
});
test("mixed or false preview operations never select a write branch", async () => {
  const { handler } = await import("../src/lambda.mjs");
  const connect = pg.Client.prototype.connect;
  let connections = 0;
  pg.Client.prototype.connect = async function () {
    connections++;
    throw new Error("unexpected connect");
  };
  try {
    for (const event of [
      {
        vacuum: { table: "battle" },
        card_roles_import: { ...spec, preview: true },
      },
      { card_roles_import: { ...spec, preview: false } },
      { account_track: {}, card_roles_import: { ...spec, preview: null } },
      { vacuum: { table: "battle" }, reference_seed_preview: spec },
      { reference_seed_preview: { ...spec, apply: true } },
      { reference_seed_preview: false },
    ]) {
      assert.equal((await handler(event)).error, "invalid_reference_preview");
    }
    assert.equal(connections, 0);
  } finally {
    pg.Client.prototype.connect = connect;
  }
});
test("release verification accepts identical readonly receipts and fails closed for other responses", async () => {
  const good = {
    preview: true,
    readonly: true,
    identical: true,
    version_identical: true,
    version_compatible: true,
    live_sha256: "a".repeat(64),
    proposed_sha256: "a".repeat(64),
  };
  let payload;
  const lambda = {
    async send(command) {
      payload = JSON.parse(command.input.Payload);
      return { Payload: Buffer.from(JSON.stringify(good)) };
    },
  };
  assert.deepEqual(await verifyReferenceSeed(lambda, spec), good);
  assert.deepEqual(payload.reference_seed_preview, spec);
  for (const patch of [
    { identical: false },
    { readonly: false },
    { preview: false },
    { version_compatible: false },
    { proposed_sha256: "b".repeat(64) },
    { error: "unknown_op" },
  ]) {
    await assert.rejects(
      verifyReferenceSeed(
        {
          async send() {
            return {
              Payload: Buffer.from(JSON.stringify({ ...good, ...patch })),
            };
          },
        },
        spec,
      ),
    );
  }
});
test("release guard executes after operator code update and before migrations and reference refresh", () => {
  const source = readFileSync(
    new URL("../../../infra/scripts/deploy.mjs", import.meta.url),
    "utf8",
  );
  const preview = source.indexOf("? await prepareReferenceSeedRefresh(lambda)");
  assert.ok(preview > source.indexOf("await waitUntilFunctionUpdatedV2"));
  assert.ok(
    preview <
      source.indexOf(
        'if (!isCreate && lane === "platform") await runMigrations',
      ),
  );
  assert.ok(
    preview <
      source.indexOf(
        "if (verifiedReferenceSeed) await verifiedReferenceSeed.refresh()",
      ),
  );
});
