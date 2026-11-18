import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";

const mine = "#0QJ8202";
const peers = ["#0QJ8208", "#0QJ8209", "#0QJ8220"];
let scratch, reader, handler, token;

before(async () => {
  scratch = await scratchDb("circle_friend_blocks");
  const { db } = scratch;
  await db.query(`drop trigger if exists claim_watching_compat on claim;
    drop function if exists normalize_legacy_watching_claim();
    alter table claim drop constraint claim_relationship_check;
    alter table claim add constraint claim_relationship_check
      check (relationship in ('primary','alt','friend','watching'))`);
  const person = async (hash, tag) => {
    const id = (
      await db.query(
        "insert into account(email_hash,status) values ($1,'approved') returning account_id",
        [hash],
      )
    ).rows[0].account_id;
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      `Invented ${tag.slice(1)}`,
    ]);
    await db.query(
      `insert into claim(account_id,player_tag,is_primary,relationship,status,verified_at)
       values ($1,$2,true,'primary','verified',now())`,
      [id, tag],
    );
    return id;
  };
  reader = await person("circle-reader", mine);
  for (const [i, tag] of peers.entries()) {
    const owner = await person(`circle-peer-${i}`, tag);
    await db.query(
      `insert into claim(account_id,player_tag,relationship,notify)
       values ($1,$2,'watching',false)`,
      [reader, tag],
    );
    if (i < 2)
      await db.query(
        "insert into account_block(account_id,blocked_account_id) values ($1,$2)",
        i === 0 ? [reader, owner] : [owner, reader],
      );
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
  ({ token } = await createSession(db, {
    secret: "test",
    accountId: reader,
    emailHash: "circle-reader",
  }));
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test" });
});

after(async () => {
  await handler?.close();
  await scratch?.drop();
});

async function circle() {
  const r = await handler({
    path: "/api/me/home/circle",
    method: "GET",
    headers: {
      cookie: `__Host-elixir_session=${token}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  const out = JSON.parse(r.body).circle;
  assert.equal(out.ok, true);
  return out;
}

test("converted blocked recordings never become circle suggestions in either direction", async () => {
  const out = await circle();
  assert.deepEqual(out.friends, []);
  assert.deepEqual(
    out.suggestions.map((p) => p.tag),
    [peers[2]],
  );
  const { rows } = await scratch.db.query(
    `select player_tag,relationship,notify,followed_at from claim
      where account_id=$1 and not is_primary order by player_tag`,
    [reader],
  );
  assert.deepEqual(
    rows,
    peers.map((tag) => ({
      player_tag: tag,
      relationship: "friend",
      notify: false,
      followed_at: null,
    })),
    "the saved recording choices remain intact",
  );
});

test("private close marks do not turn blocked recordings into a visible circle", async () => {
  await scratch.db.query(
    "update claim set close=true where account_id=$1 and player_tag=any($2::text[])",
    [reader, peers.slice(0, 2)],
  );
  const out = await circle();
  assert.deepEqual(out.friends, []);
  assert.deepEqual(
    out.suggestions.map((p) => p.tag),
    [peers[2]],
  );
  assert.equal(
    (
      await scratch.db.query(
        "select count(*)::int as n from claim where account_id=$1 and close",
        [reader],
      )
    ).rows[0].n,
    2,
    "a social read does not change the owner's private saved marks",
  );
});

test("the normal unblocked converted friend can still join the circle", async () => {
  await scratch.db.query(
    "update claim set close=true where account_id=$1 and player_tag=$2",
    [reader, peers[2]],
  );
  const out = await circle();
  assert.deepEqual(
    out.friends.map((p) => p.tag),
    [peers[2]],
  );
  assert.equal(out.friends[0].battles, 0);
});
