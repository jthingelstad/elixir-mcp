import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";

const mine = "#0QJ9000";
const via = ["#0QJ9002", "#0QJ9008"];
const target = "#0QJ9009";
const active = ["#0QJ9020", "#0QJ9022", "#0QJ9028", "#0QJ9029", "#0QJ9080"];
let scratch, reader, intermediaries, targetOwner, activeOwners, handler, token;

before(async () => {
  scratch = await scratchDb("friend_discovery");
  const { db } = scratch;
  await db.query(`alter table claim drop constraint claim_relationship_check;
    alter table claim add constraint claim_relationship_check
      check (relationship in ('primary','alt','friend','watching'))`);
  const person = async (hash, tag, name) => {
    const id = (
      await db.query(
        "insert into account(email_hash,status) values ($1,'approved') returning account_id",
        [hash],
      )
    ).rows[0].account_id;
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
    await db.query(
      `insert into claim(account_id,player_tag,is_primary,relationship,status,verified_at)
       values ($1,$2,true,'primary','verified',now())`,
      [id, tag],
    );
    return id;
  };
  const follow = (account, tag, relationship) =>
    db.query(
      "insert into claim(account_id,player_tag,relationship,notify) values ($1,$2,$3,false)",
      [account, tag, relationship],
    );
  reader = await person("discover-reader", mine, "Invented Reader");
  intermediaries = [
    await person("discover-amber", via[0], "Amber"),
    await person("discover-zinnia", via[1], "Zinnia"),
  ];
  targetOwner = await person("discover-target", target, "Invented Target");
  await follow(reader, via[0], "watching");
  await follow(reader, via[1], "friend");
  await follow(intermediaries[0], target, "watching");
  await follow(intermediaries[1], target, "friend");
  activeOwners = [];
  for (const [i, tag] of active.entries()) {
    activeOwners.push(
      await person(`discover-active-${i}`, tag, `Invented Active ${i}`),
    );
    await follow(reader, tag, "watching");
    await db.query(
      "insert into recording(subject_type,subject_tag,requested_by) values ('player',$1,$2)",
      [tag, reader],
    );
    await db.query(
      `insert into battle(battle_id,battle_time,type,type_class)
       values ($1,now()-interval '1 hour','PvP','pvp')`,
      [`discovery-${i}`],
    );
    await db.query(
      `insert into battle_participant(battle_id,player_tag,side,battle_time,type,type_class)
       values ($1,$2,0,now()-interval '1 hour','PvP','pvp')`,
      [`discovery-${i}`, tag],
    );
  }
  for (const file of [
    "0298_friend_follows.sql",
    "0299_validate_friend_follows.sql",
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
  ({ token } = await createSession(db, {
    secret: "test",
    accountId: reader,
    emailHash: "discover-reader",
  }));
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    comments: { enabled: true, capUsd: 0 },
  });
});

after(async () => {
  await handler?.close();
  await scratch?.drop();
});

async function read(path) {
  const r = await handler({
    path,
    method: "GET",
    headers: {
      cookie: `__Host-elixir_session=${token}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  return JSON.parse(r.body);
}

for (const direction of ["outbound", "inbound"]) {
  test(`discovery excludes a blocked intermediary before counting reasons: ${direction}`, async () => {
    await scratch.db.query("delete from account_block");
    await scratch.db.query(
      "insert into account_block(account_id,blocked_account_id) values ($1,$2)",
      direction === "outbound"
        ? [reader, intermediaries[0]]
        : [intermediaries[0], reader],
    );
    for (const path of ["/api/me/people/suggested", "/api/me/people/find"]) {
      const out = await read(path);
      const candidate = out.people.find((p) => p.tag === target);
      assert.ok(candidate, "the unblocked third party remains a suggestion");
      assert.deepEqual(candidate.why, [
        {
          kind: "followed_by",
          via: { tag: via[1], name: "Zinnia" },
          others: 0,
        },
      ]);
    }
  });

  test(`discovery excludes a blocked intermediary-to-candidate edge: ${direction}`, async () => {
    await scratch.db.query("delete from account_block");
    await scratch.db.query(
      "insert into account_block(account_id,blocked_account_id) values ($1,$2)",
      direction === "outbound"
        ? [intermediaries[0], targetOwner]
        : [targetOwner, intermediaries[0]],
    );
    const out = await read("/api/me/people/find");
    const candidate = out.people.find((p) => p.tag === target);
    assert.ok(candidate);
    assert.deepEqual(candidate.why, [
      {
        kind: "followed_by",
        via: { tag: via[1], name: "Zinnia" },
        others: 0,
      },
    ]);
  });
}

test("blocked converted active recordings do not suppress onboarding suggestions", async () => {
  const { db } = scratch;
  await db.query("delete from account_block");
  for (const [i, owner] of activeOwners.entries())
    await db.query(
      "insert into account_block(account_id,blocked_account_id) values ($1,$2)",
      i % 2 ? [owner, reader] : [reader, owner],
    );
  const first = await read("/api/me/first-answer");
  assert.equal(first.setup.following_played, 0);
  assert.equal(
    first.setup.following,
    7,
    "the owner's saved player count stays intact",
  );
  assert.equal((await read("/api/me/people/starter")).offer, true);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from recording where requested_by=$1 and subject_tag=any($2::text[])",
        [reader, active],
      )
    ).rows[0].n,
    5,
    "the saved recording rows remain intact",
  );
});

test("five normal active follows still finish the starter offer", async () => {
  await scratch.db.query("delete from account_block");
  const first = await read("/api/me/first-answer");
  assert.equal(first.setup.following_played, 5);
  assert.equal(first.setup.following, 7);
  assert.equal((await read("/api/me/people/starter")).offer, false);
});
