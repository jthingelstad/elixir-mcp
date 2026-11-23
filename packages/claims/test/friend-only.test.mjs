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
async function account(name) {
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status,kind,role) values ($1,'approved','person','owner') returning account_id",
    [name],
  );
  return { accountId: row.account_id, kind: "person" };
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
