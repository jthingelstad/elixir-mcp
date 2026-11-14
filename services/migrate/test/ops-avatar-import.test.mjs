/**
 * {avatar_import} (2026-11-14): Elixir Drop's profile images come into
 * Elixir once. A dry run writes nothing; a run sets an image only on an
 * account with none, only to a card that can be a profile image, and a
 * second run sets nothing. The answer is counts, never an id or a name.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { avatarImportOp, readPairs } from "../src/ops-avatar-import.mjs";
import { classifyOp } from "../../../infra/scripts/lib/ops-invoke.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_avatar_import_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const STRANGER = "00000000-0000-4000-8000-000000000000";

let db;
const ids = {};

const account = async (hash) =>
  (
    await db.query(
      `insert into account (email_hash, email, status, role)
       values ($1, $2, 'approved', 'member') returning account_id`,
      [hash, `${hash}@example.org`],
    )
  ).rows[0].account_id;
const avatarOf = async (id) =>
  (
    await db.query(
      "select avatar_card_id, avatar_set_at from account where account_id = $1",
      [id],
    )
  ).rows[0];

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  for (const [id, name, kind, inCatalog] of [
    [26000000, "Knight", "card", true],
    [28000006, "Mirror", "card", true],
    [159000000, "Tower Princess", "support", true],
    [26099999, "Gone Card", "card", false],
  ])
    await db.query(
      `insert into card (card_id, name, kind, icon_medium, in_catalog)
       values ($1, $2, $3, 'https://example.invalid/card.png', $4)
       on conflict (card_id) do update
         set kind = excluded.kind, in_catalog = excluded.in_catalog,
             icon_medium = excluded.icon_medium`,
      [id, name, kind, inCatalog],
    );
  ids.fresh = await account("import-fresh");
  ids.second = await account("import-second");
  ids.chose = await account("import-chose");
  ids.towerPick = await account("import-tower");
  ids.gonePick = await account("import-gone");
  ids.removed = await account("import-removed");
  await db.query(
    "update account set email_hash = 'removed:' || account_id, email = null, status = 'disabled' where account_id = $1",
    [ids.removed],
  );
  ids.agent = (
    await db.query(
      `insert into account (kind, owned_by_account_id, public_id, status, role)
       values ('agent', $1, 'importagent1', 'approved', 'member')
       returning account_id`,
      [ids.fresh],
    )
  ).rows[0].account_id;
  await db.query(
    "update account set avatar_card_id = 28000006, avatar_set_at = now() - interval '1 day' where account_id = $1",
    [ids.chose],
  );
});
after(async () => {
  await db?.end();
  await dropScratch(SCRATCH);
});

const pairs = () => [
  { account_id: ids.fresh, card_id: 26000000 },
  { account_id: ids.second.toUpperCase(), card_id: 28000006 },
  { account_id: ids.chose, card_id: 26000000 },
  { account_id: ids.towerPick, card_id: 159000000 },
  { account_id: ids.gonePick, card_id: 26099999 },
  { account_id: ids.agent, card_id: 26000000 },
  { account_id: ids.removed, card_id: 26000000 },
  { account_id: STRANGER, card_id: 26000000 },
  { account_id: ids.fresh, card_id: 28000006 },
  { account_id: "not-a-uuid", card_id: 26000000 },
  { account_id: ids.second, card_id: "26000000" },
];

test("a dry run reports what it would set and writes nothing", async () => {
  const out = await avatarImportOp(SCRATCH_URL, { pairs: pairs() });
  assert.deepEqual(out, {
    dry_run: true,
    pairs: 11,
    set: 0,
    would_set: 2,
    already_had_one: 1,
    unknown_account: 3,
    unknown_card: 2,
    malformed: 2,
    repeated: 1,
  });
  assert.equal((await avatarOf(ids.fresh)).avatar_card_id, null);
  // Counts only: no account id, address or name in the answer.
  const text = JSON.stringify(out);
  for (const id of Object.values(ids)) assert.ok(!text.includes(id));
  assert.ok(!/example\.org|Knight|Mirror/.test(text));
});

test("apply sets only accounts with no image, to cards that can be one; a rerun sets nothing", async () => {
  const before = await avatarOf(ids.chose);
  const out = await avatarImportOp(SCRATCH_URL, {
    pairs: pairs(),
    apply: true,
  });
  assert.equal(out.dry_run, false);
  assert.equal(out.set, 2);
  assert.equal(out.would_set, undefined);
  assert.equal((await avatarOf(ids.fresh)).avatar_card_id, 26000000);
  assert.ok((await avatarOf(ids.fresh)).avatar_set_at);
  assert.equal((await avatarOf(ids.second)).avatar_card_id, 28000006);
  // A choice made in Elixir stands, set_at and all.
  assert.deepEqual(await avatarOf(ids.chose), before);
  // A tower troop, a card out of the catalog, an agent and a removed
  // account's tombstone stay unset.
  for (const id of [ids.towerPick, ids.gonePick, ids.agent, ids.removed])
    assert.equal((await avatarOf(id)).avatar_card_id, null);

  const again = await avatarImportOp(SCRATCH_URL, {
    pairs: pairs(),
    apply: true,
  });
  assert.equal(again.set, 0);
  assert.equal(again.already_had_one, 3);
});

test("a malformed payload is refused before any connection", () => {
  assert.deepEqual(readPairs(undefined), { error: "pairs required" });
  assert.deepEqual(readPairs(true), { error: "pairs required" });
  assert.deepEqual(readPairs({ pairs: [] }), { error: "pairs required" });
  assert.equal(readPairs({ pairs: [{}], apply: "yes" }).error.length > 0, true);
  assert.deepEqual(readPairs({ pairs: [{}], dry_run: false }), {
    error: "unknown_keys",
    keys: ["dry_run"],
  });
  assert.equal(
    readPairs({ pairs: Array(5001).fill({}) }).error,
    "too_many_pairs",
  );
});

test("npm run op takes the lock for an apply, and none for a dry run", () => {
  assert.equal(
    classifyOp("migrate", { avatar_import: { pairs: [] } }).kind,
    "read",
  );
  for (const v of [
    { pairs: [], apply: true },
    { pairs: [], apply: false },
    { pairs: [], dry_run: true },
    true,
  ])
    assert.equal(classifyOp("migrate", { avatar_import: v }).kind, "write");
});
