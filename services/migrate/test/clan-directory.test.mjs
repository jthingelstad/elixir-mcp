// The clan directory (#768): every recorded clan with a saved policy, read
// through Clan's closed in-process reader by a signed-in, approved person.
// A tile carries the policy's public part only: never who saved it, a note,
// a minimum, a clock or the Recruit pitch.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { readClanDirectory } from "@elixir-mcp/auth/clan-context";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";

let scratch, ledger, me, pending;
const person = (accountId) => ({
  accountId,
  kind: "person",
  credentialType: "oauth",
});

const insertAccount = async (hash, status = "approved") =>
  (
    await scratch.db.query(
      "insert into account(email_hash,kind,status,role) values($1,'person',$2,'member') returning account_id",
      [hash, status],
    )
  ).rows[0].account_id;

before(async () => {
  scratch = await scratchDb("clan_directory");
  const db = scratch.db;
  ledger = createPostgresLedger(db);
  // Invented clans: two named, one unnamed, one with no policy.
  await db.query(
    `insert into clan(clan_tag,name,type,description) values
       ('#028','zeta Example','inviteOnly','  War every week, chat in English.  '),
       ('#029','Alpha Example','open',null),
       ('#02P',null,'mystery',''),
       ('#02Y','No Policy Example','open','Not listed')`,
  );
  await db.query("insert into player(player_tag) values('#02Q'),('#02G')");
  me = await insertAccount("dir-me");
  pending = await insertAccount("dir-pending", "disabled");
  await db.query(
    `insert into clan_snapshot_daily (clan_tag, day, snapshot_kind, observed_at, members, required_trophies) values
       ('#028','2026-11-10','daily','2026-11-10T12:00:00Z',31,4000),
       ('#028','2026-11-11','daily','2026-11-11T12:00:00Z',33,5000),
       ('#029','2026-11-11','daily','2026-11-11T12:00:00Z',50,null)`,
  );
});
after(async () => scratch?.drop());

beforeEach(async () => {
  const db = scratch.db;
  await db.query("delete from clan_state");
  await db.query("delete from claim");
  await db.query("delete from clan_membership");
});

const seedPolicies = async () => {
  await ledger.savePolicy("#028", {
    values: { war_intent: "participating", posture: "strict" },
    by: "#02Q",
  });
  await ledger.savePolicy("#028", {
    values: {
      war_intent: "participating",
      posture: "strict",
      goal_together: true,
      war_enabled: true,
      donations_enabled: true,
      war_min_decks: 12,
      removal_enabled: true,
      confirm_days: 10,
      leader_notes: "private-canary-policy",
    },
    by: "#02Q",
    by_name: "private-canary-saver",
    note: "private-canary-note",
  });
  await ledger.savePolicy("#029", { values: {}, by: "#02Q" });
  await ledger.savePolicy("#02P", {
    values: { removal_enabled: false, confirm_days: 9 },
    by: "#02Q",
  });
  await ledger.savePitch("#028", {
    values: { tagline: "private-canary-pitch" },
    by: "#02Q",
  });
};

test("lists clans with a saved policy, by name, never by size", async () => {
  await seedPolicies();
  const got = await readClanDirectory(scratch.db, person(me));
  assert.ok(got.directory, JSON.stringify(got));
  assert.deepEqual(
    got.directory.clans.map((c) => c.clan_tag),
    // Unnamed sorts first (empty name), then case-blind by name.
    ["#02P", "#029", "#028"],
  );
  assert.equal(got.directory.truncated, false);
  assert.equal(got.directory.schema_version, 1);
});

test("a tile is the record's facts and the policy's public part", async () => {
  await seedPolicies();
  const { directory } = await readClanDirectory(scratch.db, person(me));
  const zeta = directory.clans.find((c) => c.clan_tag === "#028");
  assert.deepEqual(Object.keys(zeta).sort(), [
    "clan_tag",
    "description",
    "members",
    "name",
    "policy",
    "required_trophies",
    "type",
    "yours",
  ]);
  assert.deepEqual(
    { ...zeta, policy: { ...zeta.policy, saved_at: "x" } },
    {
      clan_tag: "#028",
      name: "zeta Example",
      type: "inviteOnly",
      description: "War every week, chat in English.",
      // The newest snapshot, not the first.
      members: 33,
      required_trophies: 5000,
      yours: false,
      policy: {
        war_intent: "participating",
        posture: "strict",
        together: true,
        counted: ["war", "donations"],
        removal_day: 10,
        saved_at: "x",
      },
    },
  );
  assert.match(zeta.policy.saved_at, /^\d{4}-\d\d-\d\dT/);
  // Nothing private, anywhere in the answer.
  const text = JSON.stringify(directory);
  for (const canary of [
    "private-canary",
    "saved_by",
    "note",
    "war_min_decks",
    "tagline",
    "#02Q",
  ])
    assert.ok(!text.includes(canary), `${canary} leaked`);
});

test("defaults fill an unsaved field; an unknown value is said as unknown", async () => {
  await seedPolicies();
  const { directory } = await readClanDirectory(scratch.db, person(me));
  const alpha = directory.clans.find((c) => c.clan_tag === "#029");
  assert.deepEqual(alpha.policy.war_intent, "unknown");
  assert.equal(alpha.policy.posture, "standard");
  assert.equal(alpha.policy.removal_day, null);
  assert.equal(alpha.members, 50);
  assert.equal(alpha.required_trophies, null);
  assert.equal(alpha.description, null);
  const unnamed = directory.clans.find((c) => c.clan_tag === "#02P");
  // A removal day with removal off is not a rule the clan keeps.
  assert.equal(unnamed.policy.removal_day, null);
  assert.equal(unnamed.type, null);
  assert.equal(unnamed.description, null);
  assert.equal(unnamed.members, null);
});

test("yours is your own verified, current membership only", async () => {
  await seedPolicies();
  await scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship) values
       ($1,'#02Q','verified',true,'primary'),
       ($2,'#02G','unverified',true,'primary')`,
    [me, pending],
  );
  await scratch.db.query(
    `insert into clan_membership(clan_tag,player_tag,joined_observed_at,role,left_observed_at) values
       ('#028','#02Q',now(),'member',null),
       ('#029','#02Q',now() - interval '9 days','member',now() - interval '2 days')`,
  );
  const { directory } = await readClanDirectory(scratch.db, person(me));
  const yours = Object.fromEntries(
    directory.clans.map((c) => [c.clan_tag, c.yours]),
  );
  assert.deepEqual(yours, { "#02P": false, "#029": false, "#028": true });
});

test("only an approved person, or their agent, reads it", async () => {
  await seedPolicies();
  assert.deepEqual(await readClanDirectory(scratch.db, person(pending)), {
    refused: "not_a_person",
  });
  assert.deepEqual(
    await readClanDirectory(scratch.db, { ...person(me), kind: "integration" }),
    { refused: "not_a_person" },
  );
  // 12.0.0: an agent reads as its owner, only while the owner is approved.
  const agentOf = async (owner, email) =>
    (
      await scratch.db.query(
        "insert into account(email_hash,kind,status,role,owned_by_account_id) values($1,'agent','approved','member',$2) returning account_id",
        [email, owner],
      )
    ).rows[0].account_id;
  const mine = await agentOf(me, "dir-agent-me");
  const theirs = await agentOf(pending, "dir-agent-pending");
  const read = await readClanDirectory(scratch.db, {
    accountId: mine,
    kind: "agent",
  });
  assert.equal(read.directory.clans.length, 3);
  assert.deepEqual(
    await readClanDirectory(scratch.db, { accountId: theirs, kind: "agent" }),
    { refused: "not_a_person" },
  );
  assert.deepEqual(await readClanDirectory(scratch.db, null), {
    refused: "not_a_person",
  });
});

test("no saved policy anywhere is an empty directory, not a refusal", async () => {
  const got = await readClanDirectory(scratch.db, person(me));
  assert.deepEqual(got.directory.clans, []);
  assert.equal(got.directory.truncated, false);
});
