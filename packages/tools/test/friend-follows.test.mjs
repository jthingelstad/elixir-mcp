import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { addPlayer, setRelationship } from "@elixir-mcp/claims";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

let scratch;
before(async () => {
  scratch = await scratchDb("friend_follow_results");
});
after(async () => scratch?.drop());
beforeEach(async () => {
  await scratch.db.query("truncate account cascade");
});
const TAGS = ["#0JQ0JQ8", "#0QJ29VYL", "#0VY8RUJ2"];
async function account(key) {
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account(email_hash,status,role) values ($1,'approved','owner') returning account_id",
    [key],
  );
  return { accountId: row.account_id, kind: "person", role: "owner" };
}
const followAs = (person) =>
  makeInvoker({ db: scratch.db, account: person, registry: makeRegistry() });

test("an unnamed later MCP follow cannot cross a two-way block or start recording/linking", async () => {
  const db = scratch.db;
  for (const direction of ["outbound", "inbound"]) {
    const person = await account(`blocked-follow-${direction}`);
    const owner = await account(`blocked-owner-${direction}`);
    await addPlayer(db, person, { tag: TAGS[0] });
    await db.query(
      "insert into player(player_tag) values ($1) on conflict do nothing",
      [TAGS[1]],
    );
    await db.query(
      "insert into claim(account_id,player_tag,relationship,is_primary,status) values ($1,$2,'primary',true,'verified')",
      [owner.accountId, TAGS[1]],
    );
    const pair =
      direction === "outbound"
        ? [person.accountId, owner.accountId]
        : [owner.accountId, person.accountId];
    await db.query(
      "insert into account_block(account_id,blocked_account_id) values ($1,$2)",
      pair,
    );
    const before = (
      await db.query(
        "select count(*)::int n from account_event where account_id=$1",
        [person.accountId],
      )
    ).rows[0].n;
    const result = await followAs(person)("elixir_follow_player", {
      player_tag: TAGS[1],
    });
    assert.equal(result.isError, true, JSON.stringify(result.body));
    assert.equal(result.body.error.code, "not_found");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from claim where account_id=$1 and player_tag=$2",
          [person.accountId, TAGS[1]],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from recording where subject_tag=$1",
          [TAGS[1]],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from account_follow where account_id=$1",
          [person.accountId],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from account_event where account_id=$1",
          [person.accountId],
        )
      ).rows[0].n,
      before,
    );
    await db.query("delete from claim where account_id=$1", [owner.accountId]);
  }
});

test("turning a retained self claim into a friend cannot revive a blocked social follow", async () => {
  const db = scratch.db;
  const person = await account("blocked-transition");
  const owner = await account("blocked-transition-owner");
  await db.query(
    "insert into player(player_tag) values ($1) on conflict do nothing",
    [TAGS[1]],
  );
  // A legacy self claim that predates another account's verification.
  await db.query(
    `insert into claim(account_id,player_tag,relationship,is_primary,status) values
      ($1,$3,'alt',false,'unverified'),($2,$3,'primary',true,'verified')`,
    [person.accountId, owner.accountId, TAGS[1]],
  );
  await db.query(
    "insert into account_block(account_id,blocked_account_id) values ($1,$2)",
    [owner.accountId, person.accountId],
  );
  const result = await setRelationship(db, person, {
    tag: TAGS[1],
    relationship: "friend",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_found");
  assert.equal(
    (
      await db.query(
        "select relationship from claim where account_id=$1 and player_tag=$2",
        [person.accountId, TAGS[1]],
      )
    ).rows[0].relationship,
    "alt",
  );
});

test("MCP re-adds report the stored primary, alt and friend without unmuting them", async () => {
  const db = scratch.db;
  const person = await account("repeat-follow");
  const invoke = followAs(person);
  const first = await invoke("elixir_follow_player", { player_tag: TAGS[0] });
  assert.equal(first.isError, false, JSON.stringify(first.body));
  assert.equal(first.body.applied.relationship, "primary");
  await addPlayer(db, person, { tag: TAGS[1], relationship: "alt" });
  await addPlayer(db, person, { tag: TAGS[2], relationship: "friend" });
  await db.query("update claim set notify=false where account_id=$1", [
    person.accountId,
  ]);
  for (const [tag, relationship] of TAGS.map((tag, n) => [
    tag,
    ["primary", "alt", "friend"][n],
  ])) {
    const result = await invoke("elixir_follow_player", { player_tag: tag });
    assert.equal(result.isError, false, JSON.stringify(result.body));
    assert.equal(result.body.added, false);
    assert.equal(result.body.applied.relationship, relationship);
    assert.equal(result.body.notify, false);
    const {
      rows: [stored],
    } = await db.query(
      "select relationship,notify from claim where account_id=$1 and player_tag=$2",
      [person.accountId, tag],
    );
    assert.deepEqual(stored, { relationship, notify: false });
  }
  const named = await invoke("elixir_follow_player", {
    player_tag: TAGS[1],
    relationship: "friend",
  });
  assert.equal(named.body.applied.relationship, "alt");
  assert.equal(named.body.notify, false);
});
