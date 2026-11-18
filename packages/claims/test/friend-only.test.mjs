import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { addPlayer, setRelationship } from "../src/index.mjs";

let scratch;
before(async () => {
  scratch = await scratchDb("friend_only");
});
after(async () => scratch?.drop());
const TAGS = ["#0JQ0JQ8", "#0QJ29VYL", "#0VY8RUJ2"];
async function account(name, kind = "person", owner = null) {
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status,kind,owned_by_account_id,role) values ($1,'approved',$2,$3,'owner') returning account_id",
    [name, kind, owner],
  );
  return { accountId: row.account_id, kind };
}

test("a later unnamed player is a friend, with the same recording and explicit notification choice", async () => {
  const person = await account("friend-default");
  assert.equal(
    (await addPlayer(scratch.db, person, { tag: TAGS[0] })).isPrimary,
    true,
  );
  await addPlayer(scratch.db, person, { tag: TAGS[1] });
  const read = async () =>
    (
      await scratch.db.query(
        "select relationship, notify from claim where account_id=$1 and player_tag=$2",
        [person.accountId, TAGS[1]],
      )
    ).rows[0];
  assert.deepEqual(await read(), { relationship: "friend", notify: true });
  await scratch.db.query(
    "update claim set notify=false where account_id=$1 and player_tag=$2",
    [person.accountId, TAGS[1]],
  );
  await addPlayer(scratch.db, person, { tag: TAGS[1] });
  assert.deepEqual(await read(), { relationship: "friend", notify: false });
});

test("an agent follows as a friend while remaining unable to claim a player as itself", async () => {
  const owner = await account("friend-agent-owner");
  const agent = await account("friend-agent", "agent", owner.accountId);
  const added = await addPlayer(scratch.db, agent, {
    tag: TAGS[2],
    relationship: "friend",
  });
  assert.equal(added.ok, true);
  assert.equal(added.isPrimary, false);
  assert.equal(
    (await addPlayer(scratch.db, agent, { tag: TAGS[2], follow: true })).ok,
    true,
  );
  assert.equal(
    (
      await setRelationship(scratch.db, agent, {
        tag: TAGS[2],
        relationship: "alt",
      })
    ).error,
    "not_entitled",
  );
  assert.equal(
    (await addPlayer(scratch.db, agent, { tag: TAGS[0], relationship: "alt" }))
      .error,
    "not_entitled",
  );
  assert.equal(
    (await addPlayer(scratch.db, agent, { tag: TAGS[0], makePrimary: true }))
      .error,
    "not_entitled",
  );
});

test("retired relationships are refused by the source writers", async () => {
  const person = await account("friend-no-watching");
  assert.equal(
    (
      await addPlayer(scratch.db, person, {
        tag: TAGS[0],
        relationship: "watching",
      })
    ).error,
    "bad_relationship",
  );
  assert.equal(
    (
      await setRelationship(scratch.db, person, {
        tag: TAGS[0],
        relationship: "watching",
      })
    ).error,
    "bad_relationship",
  );
});
