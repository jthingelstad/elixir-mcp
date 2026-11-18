import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { followsOf, followersOf } from "../../tools/src/social.mjs";
import { grantStamps, readSnapshot } from "../src/store.mjs";
import { readLaunchSnapshot } from "../src/legacy.mjs";
import { friendlyBattles, reconcilePassport } from "../src/earn.mjs";
import { evaluatePassport } from "../src/eligibility.mjs";

const now = "2026-11-18T12:00:00Z";
const made = "2026-11-08T12:00:00Z";
const battleAt = "2026-11-17T12:00:00Z";
const cases = [
  {
    name: "two watched claims, outbound block",
    relationships: ["watching", "watching"],
    direction: 0,
  },
  {
    name: "two watched claims, inbound block",
    relationships: ["watching", "watching"],
    direction: 1,
  },
  {
    name: "mixed old claims, outbound block",
    relationships: ["watching", "friend"],
    direction: 0,
  },
  {
    name: "mixed old claims, inbound block",
    relationships: ["friend", "watching"],
    direction: 1,
  },
  {
    name: "unblocked mixed old claims",
    relationships: ["watching", "friend"],
    direction: null,
  },
];
let scratch;
const pairs = [];
const tag = (n) =>
  `#0QJ${n
    .toString(4)
    .replace(/[0-3]/g, (d) => "0289"[Number(d)])
    .padStart(4, "0")}`;

before(async () => {
  scratch = await scratchDb("stamp_friend_blocks");
  const { db } = scratch;
  await db.query(`alter table claim drop constraint claim_relationship_check;
    alter table claim add constraint claim_relationship_check
      check (relationship in ('primary','alt','friend','watching'));`);
  for (const [i, item] of cases.entries()) {
    const { rows: accounts } = await db.query(
      `insert into account(email_hash,status,created_at,timezone) values
        ($1,'approved',$3,'UTC'),($2,'approved',$3,'UTC') returning account_id`,
      [`stamp-block-${i}-a`, `stamp-block-${i}-b`, made],
    );
    const ids = accounts.map((a) => a.account_id);
    const tags = [tag(i * 2), tag(i * 2 + 1)];
    for (const [n, player] of tags.entries()) {
      await db.query("insert into player(player_tag,name) values ($1,$2)", [
        player,
        `Invented peer ${i}-${n}`,
      ]);
      await db.query(
        `insert into claim(account_id,player_tag,is_primary,relationship,status,verified_at,created_at)
         values ($1,$2,true,'primary','verified',$3,$3)`,
        [ids[n], player, made],
      );
    }
    for (const n of [0, 1])
      await db.query(
        "insert into claim(account_id,player_tag,relationship,created_at) values ($1,$2,$3,$4)",
        [ids[n], tags[1 - n], item.relationships[n], made],
      );
    if (item.direction !== null)
      await db.query(
        "insert into account_block(account_id,blocked_account_id) values ($1,$2)",
        [ids[item.direction], ids[1 - item.direction]],
      );
    const battle = (i + 1).toString(16).padStart(64, "0");
    await db.query(
      "insert into battle(battle_id,battle_time,type,type_class,created_at) values ($1,$2,'friendly','pvp',$2)",
      [battle, battleAt],
    );
    for (const n of [0, 1])
      await db.query(
        "insert into battle_participant(battle_id,player_tag,side,battle_time,type,type_class) values ($1,$2,$3,$4,'friendly','pvp')",
        [battle, tags[n], n, battleAt],
      );
    pairs.push({ ...item, ids, tags, battle });
  }
  for (const file of [
    "0301_friend_follows.sql",
    "0302_validate_friend_follows.sql",
  ]) {
    await db.query("begin");
    await db.query(
      await readFile(
        new URL(`../../../db/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
    await db.query("commit");
  }
});
after(async () => scratch?.drop());

for (const [i, item] of cases.entries()) {
  test(`Stamps and public follow reads agree after conversion: ${item.name}`, async () => {
    const { db } = scratch;
    const pair = pairs[i];
    const visible = item.direction === null ? 1 : 0;
    for (const n of [0, 1]) {
      const account = pair.ids[n];
      assert.equal((await followsOf(db, account)).count, visible);
      assert.equal(
        (await followersOf(db, pair.tags[n], account)).count,
        visible,
      );
      const snapshot = await readSnapshot(db, account, { now });
      assert.equal(
        snapshot.follows.length,
        visible,
        "current followed activity respects the block",
      );
      assert.equal(
        snapshot.mutual_count,
        visible,
        "current mutual eligibility respects the block",
      );
      const launch = await readLaunchSnapshot(db, account, now);
      assert.equal(
        launch.follows.length,
        visible,
        "legacy eligibility uses the same visible follow rule",
      );
      assert.equal(launch.mutual_count, visible);
      assert.equal(
        (await friendlyBattles(db, account, { now })).length,
        visible,
        "recorded play is eligible only with a visible followed player",
      );
      const grants = evaluatePassport(snapshot, now).grants;
      assert.equal(
        grants.some((g) => g.stamp_id === "mutual"),
        visible === 1,
      );
    }
  });
}

test("a block changes new eligibility without revoking an already-earned Stamp", async () => {
  const { db } = scratch;
  const account = pairs[0].ids[0];
  await grantStamps(db, account, [{ stamp_id: "mutual", level: 1 }], {
    now: "2026-11-16T12:00:00Z",
  });
  const earned = async () =>
    (
      await db.query(
        "select * from account_stamp_earned where account_id=$1 and stamp_id='mutual'",
        [account],
      )
    ).rows;
  const before = await earned();
  assert.equal(before.length, 1);
  await reconcilePassport(db, account, { now });
  assert.deepEqual(await earned(), before);
});
