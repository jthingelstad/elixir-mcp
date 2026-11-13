import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

/**
 * 0229 copies each clan's Discord editor voice (clan_activity_discord.voice,
 * 0214) into the clan's one voice setting, voice#<clan> in clan_state,
 * which the drafts and the editor both read (call 5, 2026-10-20). The test
 * seeds synthetic clans and runs the file as the migrate runner does: a
 * non-empty voice is copied as written and read back through the ledger,
 * an empty one is not, an item already there wins, and a re-run copies
 * nothing. The old column stays (expand and contract).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const FILE = path.join(repoRoot, "db/migrations/0229_clan_voice.sql");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_clan_voice_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

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
  await db.query("delete from clan_activity_discord");
  await db.query("delete from clan where clan_tag like '#0LQ0%'");
});

/** A connected clan, as Social > Discord leaves it before 0229. */
async function connected(clanTag, voice) {
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Voice Test')`,
    [clanTag],
  );
  await db.query(
    `insert into clan_activity_discord
       (clan_tag, channel_id, webhook_sealed, webhook_fp, webhook_display,
        rewrite, voice, set_by, set_by_name)
     values ($1, $2, '{}'::jsonb, '0123456789abcdef', 'discord.com/...', true,
             $3, '#0CR', 'Ada')`,
    [clanTag, randomUUID(), voice],
  );
}

/** The file, as the runner applies it: one transaction. */
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

test("a clan's editor voice becomes its voice setting, as written; an empty one is not copied", async () => {
  const voice = "Warm and short, a little dry. Cheer the grinders.";
  await connected("#0UPL9", voice);
  await connected("#0CP0C", "");
  await apply();
  const ledger = createPostgresLedger(db);
  const copied = await ledger.clanVoice("#0UPL9");
  assert.equal(copied.voice, voice);
  assert.equal(copied.clan_tag, "#0UPL9");
  assert.equal(copied.copied_from, "0229");
  assert.ok(Date.parse(copied.copied_at) > 0);
  assert.equal(
    copied.set_by,
    undefined,
    "the row's set_by may not be who wrote the voice",
  );
  assert.equal(await ledger.clanVoice("#0CP0C"), null);
  const {
    rows: [item],
  } = await db.query(
    `select partition_key, sort_key from clan_state where pk = 'voice##0UPL9'`,
  );
  assert.deepEqual(item, { partition_key: "clan##0UPL9", sort_key: "voice" });
  // Expand, not contract: the old column is still there, unchanged.
  const {
    rows: [row],
  } = await db.query(
    `select voice from clan_activity_discord where clan_tag = '#0UPL9'`,
  );
  assert.equal(row.voice, voice);
});

test("a voice item already there wins, and a re-run copies nothing", async () => {
  await connected("#0C298", "Old Discord words");
  const ledger = createPostgresLedger(db);
  await ledger.saveClanVoice("#0C298", {
    voice: "Newer words a leader saved",
    set_by: "#0CR",
    set_by_name: "Ada",
    set_at: "2026-10-20T12:00:00.000Z",
  });
  await apply();
  assert.equal(
    (await ledger.clanVoice("#0C298")).voice,
    "Newer words a leader saved",
  );
  await connected("#0J2VJ", "Friendly");
  await apply();
  const before = await ledger.clanVoice("#0J2VJ");
  await apply();
  assert.deepEqual(await ledger.clanVoice("#0J2VJ"), before);
  const {
    rows: [n],
  } = await db.query(
    `select count(*)::int as n from clan_state where pk like 'voice#%'`,
  );
  assert.equal(n.n, 2);
});
