/**
 * 0276: a place is a place (Jamie, 2026-11-15). Run here as the migrate
 * runner does (one transaction around the file), on a scratch database put
 * back to the state before it (0275's index, place rows with and without
 * the owner stamp and the `player_map` key), with a row in every state:
 * a stamped row of the tag's owner, a stamped row of a former owner, an
 * unstamped row written after its claim was verified, one written before
 * (an orphan behind a moved tag), one under a claim verified before that
 * column existed, one under no verified claim, one with an unreadable
 * set_at, an alt's row, and `player_map` true, false and absent. Owned
 * rows are stamped and keep everything else; orphans are deleted; no row
 * keeps `player_map`; rows already right are not touched; 0275's index is
 * replaced by one whose predicate never names `player_map`; a re-run
 * changes nothing. Invented tags throughout.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../../db/migrations");

const VERIFIED = "2026-11-10T00:00:00.000Z";
const AFTER = "2026-11-12T00:00:00.000Z";
const BEFORE = "2026-11-05T00:00:00.000Z";

// Each tag's claim, and the row under it before 0276.
const T = {
  stampedOwn: "#0YVQL2", // stamped by its owner, player_map true
  stampedFormer: "#0YVQL8", // stamped by a former owner: orphan
  unstampedOwn: "#0YVQL9", // written after verification, player_map false
  unstampedAbsent: "#0YVQLP", // written after verification, no key
  unstampedOrphan: "#0YVQLY", // written before this claim's verification
  oldClaim: "#0YVQLL", // claim verified before verified_at existed
  noClaim: "#0YVQLQ", // the claim ended: no verified claim at all
  badSetAt: "#0YVQLG", // an unreadable set_at: never after verification
  alt: "#0YVQLR", // the owner's alt, unstamped, written after
  clean: "#0YVQLJ", // stamped, no key: already as 0276 leaves it
  friend: "#0YVQLC", // verified, but a follow, not the owner's own
};

let scratch, sql;
const acct = {};

async function account(key) {
  const { rows } = await scratch.db.query(
    `insert into account(email_hash, kind, status, role)
     values ($1, 'person', 'approved', 'member') returning account_id`,
    [`place-one-setting-${key}`],
  );
  acct[key] = rows[0].account_id;
  return acct[key];
}

async function claim(owner, tag, extra = {}) {
  await scratch.db.query(
    `insert into claim(account_id, player_tag, status, is_primary, relationship, verified_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      owner,
      tag,
      extra.status ?? "verified",
      extra.is_primary ?? true,
      extra.relationship ?? "primary",
      extra.verified_at === undefined ? VERIFIED : extra.verified_at,
    ],
  );
}

async function row(tag, extra) {
  const pk = `place#${tag}`;
  await scratch.db.query(
    `insert into clan_state(pk, body, updated_at)
     values ($1, $2, '2026-11-13T00:00:00Z')`,
    [
      pk,
      {
        pk,
        player_tag: tag,
        country: "US",
        region: "TX",
        city: 4671654,
        set_at: AFTER,
        ...extra,
      },
    ],
  );
}

/** The migrate runner's shape: one transaction around the file. */
async function runFile() {
  await scratch.db.query("begin");
  try {
    await scratch.db.query(sql);
    await scratch.db.query("commit");
  } catch (err) {
    await scratch.db.query("rollback");
    throw err;
  }
}

const places = async () =>
  Object.fromEntries(
    (
      await scratch.db.query(
        `select pk, body, updated_at from clan_state
          where pk like 'place#%' order by pk`,
      )
    ).rows.map((r) => [r.body.player_tag, r]),
  );

const indexes = async () =>
  Object.fromEntries(
    (
      await scratch.db.query(
        `select indexname, indexdef from pg_indexes
          where tablename = 'clan_state'`,
      )
    ).rows.map((r) => [r.indexname, r.indexdef]),
  );

before(async () => {
  scratch = await scratchDb("place_one_setting");
  const db = scratch.db;
  sql = await readFile(
    path.join(MIGRATIONS, "0276_place_one_setting.sql"),
    "utf8",
  );
  // Back to the state before 0276: its index gone, 0275's in place.
  await db.query("drop index clan_state_place");
  await db.query(
    await readFile(
      path.join(MIGRATIONS, "0275_clan_state_player_map.sql"),
      "utf8",
    ),
  );
  for (const tag of Object.values(T))
    await db.query(
      `insert into player(player_tag, name) values ($1, 'Invented')`,
      [tag],
    );
  const owner = await account("owner");
  const former = await account("former");
  const other = await account("other");
  for (const key of [
    "stampedOwn",
    "stampedFormer",
    "unstampedOwn",
    "unstampedAbsent",
    "unstampedOrphan",
    "badSetAt",
    "clean",
  ])
    await claim(await account(key), T[key]);
  await claim(await account("oldClaim"), T.oldClaim, { verified_at: null });
  await claim(owner, T.alt, { is_primary: false, relationship: "alt" });
  await claim(other, T.noClaim, { status: "unverified", verified_at: null });
  await claim(other, T.friend, { is_primary: false, relationship: "friend" });

  await row(T.stampedOwn, { account_id: acct.stampedOwn, player_map: true });
  await row(T.stampedFormer, { account_id: former, player_map: true });
  await row(T.unstampedOwn, { player_map: false });
  await row(T.unstampedAbsent, {});
  await row(T.unstampedOrphan, { set_at: BEFORE, player_map: true });
  await row(T.oldClaim, { set_at: BEFORE, player_map: false });
  await row(T.noClaim, { player_map: true });
  await row(T.badSetAt, { set_at: "last Tuesday" });
  await row(T.alt, { player_map: true });
  await row(T.clean, { account_id: acct.clean });
  await row(T.friend, {});
  // Not a place: its keys are never touched, player_map or not.
  await db.query(
    `insert into clan_state(pk, body) values ('social##0YVQL2', $1)`,
    [{ pk: "social##0YVQL2", enabled: true, player_map: true }],
  );
});
after(async () => scratch?.drop());

test("0276 stamps the owned places, deletes the orphans and drops player_map", async () => {
  assert.ok((await indexes()).clan_state_player_map, "0275's index to replace");
  await runFile();
  const got = await places();
  // Kept and stamped with the claim's account; nothing else changes.
  const kept = {
    stampedOwn: acct.stampedOwn,
    unstampedOwn: acct.unstampedOwn,
    unstampedAbsent: acct.unstampedAbsent,
    oldClaim: acct.oldClaim,
    alt: acct.owner,
    clean: acct.clean,
  };
  assert.deepEqual(
    Object.keys(got).sort(),
    Object.keys(kept)
      .map((key) => T[key])
      .sort(),
  );
  for (const [key, owner] of Object.entries(kept)) {
    const { body } = got[T[key]];
    assert.equal(body.account_id, owner, key);
    assert.equal("player_map" in body, false, key);
    assert.deepEqual(
      [body.country, body.region, body.city, body.player_tag],
      ["US", "TX", 4671654, T[key]],
      key,
    );
  }
  assert.equal(got[T.oldClaim].body.set_at, BEFORE, "set_at kept");
  // A row already as 0276 leaves it is not rewritten.
  assert.equal(
    got[T.clean].updated_at.toISOString(),
    "2026-11-13T00:00:00.000Z",
  );
  // Gone: another person's place left behind, an orphan behind a moved
  // tag, a row under no verified claim, an unreadable time, and a row
  // under a follow rather than the owner's own claim.
  for (const key of [
    "stampedFormer",
    "unstampedOrphan",
    "noClaim",
    "badSetAt",
    "friend",
  ])
    assert.equal(got[T[key]], undefined, key);
  // Not a place: untouched.
  const {
    rows: [social],
  } = await scratch.db.query(
    `select body from clan_state where pk = 'social##0YVQL2'`,
  );
  assert.equal(social.body.player_map, true);
});

test("0276 replaces 0275's index with one that never names player_map", async () => {
  const idx = await indexes();
  assert.equal(idx.clan_state_player_map, undefined);
  assert.ok(idx.clan_state_place, JSON.stringify(Object.keys(idx)));
  assert.doesNotMatch(idx.clan_state_place, /player_map/);
  assert.match(idx.clan_state_place, /place##/);
});

test("0276 re-run changes nothing", async () => {
  const before = await places();
  await runFile();
  assert.deepEqual(await places(), before);
  assert.ok((await indexes()).clan_state_place);
});
