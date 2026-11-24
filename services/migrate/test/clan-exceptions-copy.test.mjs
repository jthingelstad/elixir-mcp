import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import { exceptionActiveAt } from "@elixir-mcp/clan-engine";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

/**
 * 0318 copies each Clan hold (hold#<clan>#<tag>) into a member exception
 * (Jamie, 2026-11-23). The test seeds synthetic holds as the old code
 * wrote them and runs the file as the migrate runner does: a member's
 * away becomes a clan-visible Away, a leader's hold (or one from before
 * kinds) a leaders-only Keep in clan, a hold with no end date ends 90
 * days on with a 'changed' event by Elixir, the hold's body rides along
 * whole, an exception already there wins, and a re-run copies nothing.
 * The hold items stay (expand and contract).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const FILE = path.join(repoRoot, "db/migrations/0318_clan_exceptions.sql");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_clan_exceptions_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const CLAN = "#0Q2L8";
const DAY = 86400_000;

let db;
let sql;

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  sql = await readFile(FILE, "utf8");
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
  await db.query(`insert into clan_state (pk, body) values ($1, $2::jsonb)`, [
    item.pk,
    JSON.stringify(item),
  ]);
}

async function apply() {
  await db.query("begin");
  try {
    await db.query(sql);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

test("each hold becomes an exception: away to a clan-visible Away, a leader's to a leaders-only Keep in clan", async () => {
  const away = {
    player_tag: "#0YY9P",
    kind: "away",
    until: "2026-12-10T00:00:00.000Z",
    note: "Exams",
    by: "#0YY9P",
    by_name: "Bea",
    set_at: "2026-11-20T08:00:00.000Z",
  };
  const forever = {
    player_tag: "#0PQ2VY",
    kind: "leader",
    until: null,
    note: "Second account",
    by: "#0LUVR2",
    by_name: "Ada",
    set_at: "2026-10-01T09:00:00.000Z",
  };
  const untyped = {
    player_tag: "#0CU8LG",
    until: "2027-01-05T00:00:00.000Z",
    reason: "From before kinds",
    by: "#0LUVR2",
    set_at: "2026-09-02T10:00:00.000Z",
  };
  for (const h of [away, forever, untyped]) await hold(CLAN, h);
  const t0 = Date.now();
  await apply();
  const ledger = createPostgresLedger(db);
  const all = await ledger.exceptions(CLAN);
  assert.equal(all.length, 3);
  const of = (tag) => all.find((e) => e.player_tag === tag);

  const a = of("#0YY9P");
  assert.equal(a.exception_id, "hold-0YY9P");
  assert.equal(a.kind, "away");
  assert.equal(a.visibility, "clan");
  assert.equal(a.until, away.until);
  assert.equal(a.note, "Exams");
  assert.equal(a.set_by, "#0YY9P");
  assert.equal(a.set_by_name, "Bea");
  assert.equal(a.set_at, away.set_at);
  assert.deepEqual(
    a.events.map((e) => e.event),
    ["added"],
  );
  assert.equal(a.migrated_from, "hold");
  assert.deepEqual(a.hold, away, "the hold's whole body, lossless");

  const f = of("#0PQ2VY");
  assert.equal(f.kind, "keep_in_clan");
  assert.equal(f.visibility, "leaders");
  const until = Date.parse(f.until);
  assert.ok(
    until >= t0 + 90 * DAY - 60_000 && until <= Date.now() + 90 * DAY + 60_000,
    "no end date: 90 days from the migration",
  );
  assert.deepEqual(
    f.events.map((e) => [e.event, e.by, e.migration ?? null]),
    [
      ["added", "#0LUVR2", null],
      ["changed", null, "0318"],
    ],
  );
  assert.equal(f.events[0].until, null, "the hold as it was set");
  assert.equal(f.events[1].until, f.until);
  assert.ok(exceptionActiveAt(f, Date.now()));

  const u = of("#0CU8LG");
  assert.equal(u.kind, "keep_in_clan");
  assert.equal(u.note, "From before kinds");
  assert.equal(u.set_by_name, null);

  // Listed by member, and the holds stay for the contract migration.
  assert.equal((await ledger.exceptions(CLAN, "#0YY9P")).length, 1);
  const {
    rows: [n],
  } = await db.query(
    `select count(*)::int as n from clan_state where pk like 'hold#%'`,
  );
  assert.equal(n.n, 3);
});

test("an exception already there wins, and a re-run copies nothing", async () => {
  await hold(CLAN, {
    player_tag: "#0RC",
    kind: "leader",
    until: null,
    by: "#0LUVR2",
    set_at: "2026-10-01T09:00:00.000Z",
  });
  await apply();
  const ledger = createPostgresLedger(db);
  const first = await ledger.exceptions(CLAN);
  await apply();
  assert.deepEqual(await ledger.exceptions(CLAN), first);
  const ended = { ...first[0], ended_at: "2026-11-23T00:00:00.000Z" };
  await ledger.putException(CLAN, ended);
  await apply();
  assert.equal(
    (await ledger.exceptions(CLAN))[0].ended_at,
    "2026-11-23T00:00:00.000Z",
  );
});
