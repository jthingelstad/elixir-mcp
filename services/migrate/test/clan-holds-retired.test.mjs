import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

/**
 * 0319 is the contract half of 0318 (Clan holds became member exceptions,
 * Jamie, 2026-11-23). The test seeds synthetic hold items as the old
 * ledger's putHold wrote them, runs 0318 and then 0319 as the migrate
 * runner does, and checks: a hold whose copy exists goes, a hold set after
 * 0318 is copied first and then goes, a hold the old code rewrote after
 * its copy stays, a hold neither migration can copy stays, a leader's
 * later change to the copy does not keep the hold, and a re-run writes
 * nothing.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const COPY = path.join(repoRoot, "db/migrations/0318_clan_exceptions.sql");
const CONTRACT = path.join(
  repoRoot,
  "db/migrations/0319_clan_holds_retired.sql",
);
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_clan_holds_retired_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const CLAN = "#0Q2L8";
const DAY = 86400_000;

let db;
let copySql;
let contractSql;

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  copySql = await readFile(COPY, "utf8");
  contractSql = await readFile(CONTRACT, "utf8");
});

after(async () => {
  await db.end();
  await dropScratch(SCRATCH);
});

beforeEach(async () => {
  await db.query("truncate clan_state");
});

/** A hold item exactly as the old ledger's putHold wrote it. */
async function hold(clanTag, body) {
  const item = {
    pk: `hold#${clanTag}#${body.player_tag}`,
    gsi1pk: `clan#${clanTag}`,
    gsi1sk: `hold#${body.player_tag}`,
    ...body,
  };
  await raw(item);
}

/** Any item, as written. */
async function raw(item) {
  await db.query(
    `insert into clan_state (pk, body) values ($1, $2::jsonb)
     on conflict (pk) do update set body = excluded.body`,
    [item.pk, JSON.stringify(item)],
  );
}

async function apply(sql) {
  await db.query("begin");
  try {
    await db.query(sql);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

async function holdKeys() {
  const { rows } = await db.query(
    `select pk from clan_state where pk like 'hold#%' order by pk`,
  );
  return rows.map((r) => r.pk);
}

async function everything() {
  const { rows } = await db.query(
    `select pk, body from clan_state order by pk`,
  );
  return rows;
}

const AWAY = {
  player_tag: "#0YY9P",
  kind: "away",
  until: "2026-12-10T00:00:00.000Z",
  note: "Exams",
  by: "#0YY9P",
  by_name: "Bea",
  set_at: "2026-11-20T08:00:00.000Z",
};
const KEEP = {
  player_tag: "#0PQ2VY",
  kind: "leader",
  until: null,
  note: "Second account",
  by: "#0LUVR2",
  by_name: "Ada",
  set_at: "2026-10-01T09:00:00.000Z",
};

test("a hold whose copy exists is deleted; the exception stays as it was", async () => {
  await hold(CLAN, AWAY);
  await hold(CLAN, KEEP);
  await apply(copySql);
  const ledger = createPostgresLedger(db);
  const copied = await ledger.exceptions(CLAN);
  assert.equal(copied.length, 2);

  await apply(contractSql);
  assert.deepEqual(await holdKeys(), []);
  assert.deepEqual(await ledger.exceptions(CLAN), copied);
});

test("a hold set after 0318 is copied in 0318's shape first, then deleted", async () => {
  await apply(copySql); // nothing to copy yet
  await hold(CLAN, KEEP); // the old code, before the flip
  const t0 = Date.now();
  await apply(contractSql);
  assert.deepEqual(await holdKeys(), []);

  const ledger = createPostgresLedger(db);
  const [e] = await ledger.exceptions(CLAN);
  assert.equal(e.exception_id, "hold-0PQ2VY");
  assert.equal(e.kind, "keep_in_clan");
  assert.equal(e.visibility, "leaders");
  assert.equal(e.set_by, "#0LUVR2");
  assert.equal(e.set_at, KEEP.set_at);
  assert.equal(e.migrated_from, "hold");
  assert.deepEqual(e.hold, KEEP, "the hold's whole body, lossless");
  const until = Date.parse(e.until);
  assert.ok(
    until >= t0 + 90 * DAY - 60_000 && until <= Date.now() + 90 * DAY + 60_000,
    "no end date: 90 days from this migration",
  );
  assert.deepEqual(
    e.events.map((x) => [x.event, x.by, x.migration ?? null]),
    [
      ["added", "#0LUVR2", null],
      ["changed", null, "0319"],
    ],
  );
});

test("a hold rewritten after its copy is kept, and its copy is untouched", async () => {
  await hold(CLAN, AWAY);
  await apply(copySql);
  const ledger = createPostgresLedger(db);
  const copied = await ledger.exceptions(CLAN);
  // The member marked away again before the flip: the old code rewrote it.
  await hold(CLAN, {
    ...AWAY,
    until: "2026-12-20T00:00:00.000Z",
    set_at: "2026-11-23T08:00:00.000Z",
  });

  await apply(contractSql);
  assert.deepEqual(await holdKeys(), [`hold#${CLAN}#${AWAY.player_tag}`]);
  assert.deepEqual(await ledger.exceptions(CLAN), copied);
});

test("a hold neither migration can copy is kept", async () => {
  const noTag = {
    pk: `hold#${CLAN}#`,
    gsi1pk: `clan#${CLAN}`,
    gsi1sk: "hold#",
    kind: "leader",
    set_at: "2026-10-01T09:00:00.000Z",
  };
  const noClan = {
    pk: `hold#${CLAN}#${KEEP.player_tag}`,
    ...KEEP,
  };
  await raw(noTag);
  await raw(noClan);
  await apply(copySql);
  await apply(contractSql);
  assert.deepEqual(await holdKeys(), [noTag.pk, noClan.pk].sort());
  const ledger = createPostgresLedger(db);
  assert.deepEqual(await ledger.exceptions(CLAN), []);
});

test("a leader's later change to the copy does not keep the hold", async () => {
  await hold(CLAN, KEEP);
  await apply(copySql);
  const ledger = createPostgresLedger(db);
  const [e] = await ledger.exceptions(CLAN);
  // As the service ends one: the whole item spread, `hold` included.
  await ledger.putException(CLAN, {
    ...e,
    ended_at: "2026-11-24T00:00:00.000Z",
    ended_by: "#0LUVR2",
    events: [...e.events, { event: "ended", at: "2026-11-24T00:00:00.000Z" }],
  });

  await apply(contractSql);
  assert.deepEqual(await holdKeys(), []);
  const [after] = await ledger.exceptions(CLAN);
  assert.equal(after.ended_at, "2026-11-24T00:00:00.000Z");
});

test("a re-run writes nothing", async () => {
  await hold(CLAN, AWAY);
  await apply(copySql);
  await hold(CLAN, { ...AWAY, set_at: "2026-11-23T08:00:00.000Z" }); // kept
  await hold(CLAN, KEEP); // carried over
  await apply(contractSql);
  const once = await everything();
  await apply(contractSql);
  assert.deepEqual(await everything(), once);
  assert.deepEqual(await holdKeys(), [`hold#${CLAN}#${AWAY.player_tag}`]);
});
