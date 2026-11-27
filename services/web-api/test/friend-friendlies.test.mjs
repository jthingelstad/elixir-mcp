/**
 * Friends' friendlies (2026-11-27): the players your friends (the players
 * you follow) played friendly battles with are suggested, one battle being
 * enough, ranked by how many. Never your own players, anyone you already
 * claim, your current clanmates, the friend themself, or anyone across a
 * block; never from a friend's ladder battle; never in the starter set.
 * Invented tags and names only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { findPeople, starterSet, suggestedPeople } from "../src/people.mjs";

const READER = "#0VQ2Y00";
const ADA = "#0VQ2Y02"; // a friend, verified by her own account
const BO = "#0VQ2Y08"; // a second friend, verified by his own account
const ONE = "#0VQ2Y09"; // one friendly with Ada
const THREE = "#0VQ2Y0P"; // three with Ada, one of them in clan chat
const LADDER = "#0VQ2Y0Y"; // only a ladder battle with Ada
const MATE = "#0VQ2Y0L"; // Ada's 2v2 teammate in a friendly against Bo
const FOE = "#0VQ2Y0Q"; // the other side of that one, and once more with Bo
const FOLLOWED = "#0VQ2Y0G"; // the reader already follows them
const CLANMATE = "#0VQ2Y0R"; // the reader's current clanmate
const CLAN = "#0VQ2Y0J";
const OWNED = "#0VQ2Y0C"; // a verified player whose owner may block
const BOTH = "#0VQ2Y0U"; // Ada's account follows them and Bo played them

let scratch, reader, ada, owned;

const at = (hours) => new Date(Date.now() - hours * 3_600_000);

before(async () => {
  scratch = await scratchDb("friend_friendlies");
  const { db } = scratch;
  const player = (tag, name) =>
    db.query(
      `insert into player (player_tag, name) values ($1, $2)
       on conflict (player_tag) do update set name = excluded.name`,
      [tag, name],
    );
  const person = async (hash, tag, name) => {
    const {
      rows: [a],
    } = await db.query(
      `insert into account (email_hash, status) values ($1, 'approved')
       returning account_id`,
      [hash],
    );
    await player(tag, name);
    await db.query(
      `insert into claim (account_id, player_tag, is_primary, relationship, status, verified_at)
       values ($1, $2, true, 'primary', 'verified', now())`,
      [a.account_id, tag],
    );
    return a.account_id;
  };
  const follow = (account, tag) =>
    db.query(
      `insert into claim (account_id, player_tag, relationship, notify)
       values ($1, $2, 'friend', false)`,
      [account, tag],
    );
  reader = await person("ff-reader", READER, "Invented Reader");
  ada = await person("ff-ada", ADA, "Ada");
  await person("ff-bo", BO, "Bo");
  owned = await person("ff-owned", OWNED, "Invented Owned");
  for (const [tag, name] of [
    [ONE, "Invented One"],
    [THREE, "Invented Three"],
    [LADDER, "Invented Ladder"],
    [MATE, "Invented Mate"],
    [FOE, "Invented Foe"],
    [FOLLOWED, "Invented Followed"],
    [CLANMATE, "Invented Clanmate"],
    [BOTH, "Invented Both"],
  ])
    await player(tag, name);
  await follow(reader, ADA);
  await follow(reader, BO);
  await follow(reader, FOLLOWED);
  await follow(ada, BOTH);

  // The reader and CLANMATE are in one clan now.
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Grove')`, [
    CLAN,
  ]);
  for (const tag of [READER, CLANMATE])
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
       values ($1, $2, now() - interval '1 day', 'member')`,
      [CLAN, tag],
    );

  let n = 0;
  const battle = async (type, hours, sides) => {
    const id = `ff-${n++}`;
    const when = at(hours);
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ($1, $2, $3, 'pvp')`,
      [id, when, type],
    );
    for (const [side, tags] of sides.entries())
      for (const tag of tags)
        await db.query(
          `insert into battle_participant
             (battle_id, player_tag, side, battle_time, type, type_class, outcome)
           values ($1, $2, $3, $4, $5, 'pvp', $6)`,
          [id, tag, side, when, type, side === 0 ? "win" : "loss"],
        );
  };
  await battle("friendly", 5, [[ADA], [ONE]]);
  await battle("friendly", 10, [[ADA], [THREE]]);
  await battle("friendly", 20, [[THREE], [ADA]]);
  await battle("clanMate", 30, [[ADA], [THREE]]);
  await battle("PvP", 2, [[ADA], [LADDER]]);
  // One 2v2 friendly with both friends in it: it counts once.
  await battle("friendly", 3, [
    [ADA, MATE],
    [BO, FOE],
  ]);
  await battle("friendly", 4, [[BO], [FOE]]);
  // Never suggested: the reader, a follow, a clanmate, the friends.
  await battle("friendly", 6, [[ADA], [READER]]);
  await battle("friendly", 7, [[ADA], [FOLLOWED]]);
  await battle("clanMate", 8, [[ADA], [CLANMATE]]);
  await battle("friendly", 9, [[ADA], [BO]]);
  await battle("friendly", 11, [[ADA], [OWNED]]);
  await battle("friendly", 12, [[BO], [BOTH]]);
  // Outside the window.
  await battle("friendly", 24 * 40, [[ADA], [LADDER]]);
});

after(async () => {
  await scratch?.drop();
});

const reasons = (out, tag) =>
  out.people.find((p) => p.tag === tag)?.why ?? null;
const friendly = (out, tag) =>
  reasons(out, tag)?.find((w) => w.kind === "friend_friendly") ?? null;

test("a friend's friendly opponent is suggested on Find, one battle enough, with why as data", async () => {
  await scratch.db.query("delete from account_block");
  const out = await findPeople(scratch.db, reader);
  assert.deepEqual(friendly(out, ONE), {
    kind: "friend_friendly",
    via: { tag: ADA, name: "Ada" },
    battles: 1,
    others: 0,
    days: 30,
  });
  // A clan-chat friendly counts with the rest.
  assert.equal(friendly(out, THREE).battles, 3);
});

test("ranked by how many friendly battles, then how recently", async () => {
  await scratch.db.query("delete from account_block");
  const out = await findPeople(scratch.db, reader);
  // Those here for this reason alone keep its order (BOTH comes in
  // earlier, with the follow source's turn).
  const order = out.people
    .filter((p) => p.why.every((w) => w.kind === "friend_friendly"))
    .map((p) => p.tag);
  assert.equal(order[0], THREE);
  assert.equal(order[1], FOE);
  // The rest have one each: the latest first.
  assert.deepEqual(order.slice(2), [MATE, ONE, OWNED]);
});

test("a battle with two friends counts once; others counts the second friend", async () => {
  await scratch.db.query("delete from account_block");
  const out = await findPeople(scratch.db, reader);
  // Ada and Bo both played the 2v2: one battle, and Ada by name order.
  assert.deepEqual(friendly(out, MATE), {
    kind: "friend_friendly",
    via: { tag: ADA, name: "Ada" },
    battles: 1,
    others: 1,
    days: 30,
  });
  // Bo played FOE twice, Ada once: Bo names it.
  assert.deepEqual(friendly(out, FOE), {
    kind: "friend_friendly",
    via: { tag: BO, name: "Bo" },
    battles: 2,
    others: 1,
    days: 30,
  });
});

test("never a ladder opponent, your own player, a follow, a clanmate or the friend", async () => {
  await scratch.db.query("delete from account_block");
  for (const out of [
    await findPeople(scratch.db, reader),
    await suggestedPeople(scratch.db, reader),
  ]) {
    const tags = out.people.map((p) => p.tag);
    for (const tag of [LADDER, READER, FOLLOWED, CLANMATE, ADA, BO])
      assert.ok(!tags.includes(tag), tag);
  }
});

test("Home's panel reads friends' friendlies over a month too", async () => {
  await scratch.db.query("delete from account_block");
  const out = await suggestedPeople(scratch.db, reader);
  assert.ok(out.people.length <= 5);
  assert.equal(friendly(out, THREE)?.days, 30);
});

for (const direction of ["outbound", "inbound"]) {
  test(`a block either way with the reader hides the candidate: ${direction}`, async () => {
    const { db } = scratch;
    await db.query("delete from account_block");
    assert.ok(friendly(await findPeople(db, reader), OWNED));
    await db.query(
      "insert into account_block (account_id, blocked_account_id) values ($1, $2)",
      direction === "outbound" ? [reader, owned] : [owned, reader],
    );
    assert.equal(reasons(await findPeople(db, reader), OWNED), null);
    await db.query("delete from account_block");
  });

  test(`a block between the friend and the candidate leaves that battle out: ${direction}`, async () => {
    const { db } = scratch;
    await db.query("delete from account_block");
    await db.query(
      "insert into account_block (account_id, blocked_account_id) values ($1, $2)",
      direction === "outbound" ? [ada, owned] : [owned, ada],
    );
    assert.equal(friendly(await findPeople(db, reader), OWNED), null);
    await db.query("delete from account_block");
  });
}

test("a player in two sources is one row with both reasons", async () => {
  await scratch.db.query("delete from account_block");
  const out = await findPeople(scratch.db, reader);
  const rows = out.people.filter((p) => p.tag === BOTH);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].why.map((w) => w.kind).sort(), [
    "followed_by",
    "friend_friendly",
  ]);
  assert.deepEqual(friendly(out, BOTH).via, { tag: BO, name: "Bo" });
});

test("the starter set never offers a friend's friendly opponent", async () => {
  await scratch.db.query("delete from account_block");
  const out = await starterSet(scratch.db, reader);
  assert.equal(out.offer, true);
  for (const p of out.people) {
    assert.ok(![ONE, THREE, MATE, FOE, OWNED, BOTH].includes(p.tag), p.tag);
    assert.ok(!p.why.some((w) => w.kind === "friend_friendly"));
  }
});
