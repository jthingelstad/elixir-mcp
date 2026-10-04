import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { clanContextOp } from "../src/ops-clan-context.mjs";
import { readAgentPolicyContext } from "@elixir-mcp/auth/clan-context";
import { makeRegistry } from "@elixir-mcp/tools";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
let scratch, owner, other, agent, token, account;
const ids = ["context01"];
before(async () => {
  scratch = await scratchDb("clan_context");
  const db = scratch.db;
  await db.query("insert into clan(clan_tag) values('#028'),('#029')");
  await db.query("insert into player(player_tag) values('#02P')");
  owner = (
    await db.query(
      "insert into account(email_hash,kind,status,role) values('context-owner','person','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  other = (
    await db.query(
      "insert into account(email_hash,kind,status,role) values('context-other','person','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  agent = (
    await db.query(
      "insert into account(kind,status,role,owned_by_account_id,public_id) values('agent','approved','leader',$1,'context01') returning account_id",
      [owner],
    )
  ).rows[0].account_id;
  token = (
    await db.query(
      "insert into service_token(account_id,name,token_hash,scope) values($1,'context',repeat('c',64),'cr:read') returning token_id",
      [agent],
    )
  ).rows[0].token_id;
  await db.query(
    "insert into claim(account_id,player_tag,status,is_primary,relationship) values($1,'#02P','verified',true,'primary')",
    [owner],
  );
  account = {
    accountId: agent,
    tokenId: token,
    kind: "agent",
    credentialType: "service",
    scopes: ["cr:read"],
  };
});
after(async () => scratch?.drop());
beforeEach(async () => {
  const db = scratch.db;
  await db.query("truncate agent_policy_context_grant");
  await db.query(
    "update account set status='approved' where account_id = any($1::uuid[])",
    [[owner, other, agent]],
  );
  await db.query(
    "update account set owned_by_account_id=$1 where account_id=$2",
    [owner, agent],
  );
  await db.query("delete from account_clan where account_id=$1", [agent]);
  await db.query(
    "insert into account_clan(account_id,clan_tag,is_primary) values($1,'#028',true)",
    [agent],
  );
  await db.query(
    "update claim set status='verified',is_primary=true,relationship='primary' where account_id=$1",
    [owner],
  );
  await db.query("delete from clan_membership where player_tag='#02P'");
  await db.query(
    "insert into clan_membership(clan_tag,player_tag,joined_observed_at,role) values('#028','#02P',now(),'member')",
  );
  await db.query(
    "update service_token set scope='cr:read',revoked_at=null where token_id=$1",
    [token],
  );
  await db.query(
    "delete from service_token where account_id=$1 and token_id<>$2",
    [agent, token],
  );
  await db.query("delete from clan_state");
});
const preview = () => clanContextOp(scratch.url, { agents: ids });
const grant = async () =>
  clanContextOp(scratch.url, {
    agents: ids,
    apply: true,
    expected_owner_account_id: owner,
    expected_sha256: (await preview()).expected_sha256,
  });
const read = () => readAgentPolicyContext(scratch.db, account);

test("preview proves actual binding; apply is explicit, idempotent and changes no token scope", async () => {
  const p = await preview();
  assert.equal(p.eligible, 1);
  assert.equal(p.changed, 0);
  assert.equal(p.applied, false);
  assert.equal(p.candidates[0].owner_account_id, owner);
  assert.equal(p.candidates[0].clan_tag, "#028");
  assert.equal(await read(), null);
  assert.equal((await grant()).changed, 1);
  assert.equal((await grant()).changed, 0);
  assert.equal(
    (
      await scratch.db.query(
        "select scope from service_token where token_id=$1",
        [token],
      )
    ).rows[0].scope,
    "cr:read",
  );
  const r = await read();
  assert.equal(r.reason, "no_policy");
  assert.equal(r.policy_version, null);
});
test("MCP envelope preserves the exact eight fields and serves fresh revisions without other private values", async () => {
  await grant();
  const ledger = createPostgresLedger(scratch.db);
  await ledger.savePolicy("#028", {
    values: {
      war_intent: "participating",
      war_enabled: false,
      leader_notes: "private-canary",
    },
    by: "#LEADER",
  });
  const registry = makeRegistry();
  const r = await registry.invoke(
    "clans_context",
    { db: scratch.db, account },
    {},
  );
  assert.deepEqual(
    Object.keys(r.context).sort(),
    [
      "schema_version",
      "clan_tag",
      "status",
      "reason",
      "war_intent",
      "policy_version",
      "policy_saved_at",
      "read_at",
    ].sort(),
  );
  assert.equal(r.context.war_intent, "participating");
  assert.equal(r.context.status, "known");
  assert.ok(!JSON.stringify(r).includes("private-canary"));
  assert.ok(!JSON.stringify(r).includes(owner));
  await ledger.savePolicy("#028", {
    values: { war_intent: "not_participating", war_enabled: true },
    by: "#LEADER",
  });
  const next = await read();
  assert.equal(next.war_intent, "not_participating");
  assert.ok(next.policy_version > r.context.policy_version);
  for (const war_intent of [undefined, "unsupported"]) {
    await ledger.savePolicy("#028", { values: { war_intent }, by: "#LEADER" });
    assert.equal((await read()).reason, "war_intent_unspecified");
  }
  await assert.rejects(
    registry.invoke(
      "clans_context",
      { db: scratch.db, account },
      { clan_tag: "#029" },
    ),
    /no property/,
  );
  assert.equal(registry.availableTo("clans_context", "person"), false);
  assert.equal(registry.availableTo("clans_context", "integration"), false);
});
test("another clan, former membership, unverified and watched claims cannot qualify or create grants", async () => {
  for (const sql of [
    "update clan_membership set clan_tag='#029'",
    "update clan_membership set left_observed_at=now()",
    "update claim set status='unverified'",
    "update claim set is_primary=false,relationship='watching'",
  ]) {
    await scratch.db.query("begin");
    try {
      await scratch.db.query(sql);
      const r = await read();
      assert.equal(r, null);
    } finally {
      await scratch.db.query("rollback");
    }
  }
  await scratch.db.query("update claim set status='unverified'");
  assert.equal((await preview()).eligible, 0);
  assert.equal((await grant()).changed, 0);
  assert.equal(
    (
      await scratch.db.query(
        "select count(*)::int as n from agent_policy_context_grant",
      )
    ).rows[0].n,
    0,
  );
});
test("stale preview and unexpected owner refuse the entire apply", async () => {
  const p = await preview();
  await scratch.db.query("update claim set status='unverified'");
  await assert.rejects(
    clanContextOp(scratch.url, {
      agents: ids,
      apply: true,
      expected_sha256: p.expected_sha256,
    }),
    /changed/,
  );
  await scratch.db.query("update claim set status='verified'");
  await assert.rejects(
    clanContextOp(scratch.url, {
      agents: ids,
      apply: true,
      expected_owner_account_id: other,
      expected_sha256: (await preview()).expected_sha256,
    }),
    /owner/,
  );
});
test("current verification, membership, roles, owner and token status are checked after grant", async () => {
  await grant();
  for (const sql of [
    "update claim set status='unverified'",
    "update clan_membership set left_observed_at=now()",
    "update clan_membership set role=null",
    "update clan_membership set clan_tag='#029'",
    "update claim set is_primary=false,relationship='watching'",
    "update account set status='disabled' where kind='person'",
    "update service_token set revoked_at=now()",
    "update service_token set scope='feedback:write'",
  ]) {
    await scratch.db.query("begin");
    try {
      await scratch.db.query(sql);
      assert.equal(await read(), null);
    } finally {
      await scratch.db.query("rollback");
    }
  }
  for (const role of ["member", "elder", "coLeader", "leader"]) {
    await scratch.db.query("update clan_membership set role=$1", [role]);
    assert.ok(await read());
  }
  await scratch.db.query(
    "update claim set is_primary=false,relationship='alt'",
  );
  assert.ok(await read());
  await scratch.db.query("update claim set relationship='friend'");
  assert.equal(await read(), null);
});
test("assignment and ownership changes durably revoke, including restoration", async () => {
  await grant();
  await scratch.db.query(
    "update account_clan set clan_tag='#029' where account_id=$1",
    [agent],
  );
  assert.equal(await read(), null);
  await scratch.db.query(
    "update account_clan set clan_tag='#028' where account_id=$1",
    [agent],
  );
  assert.equal(await read(), null);
  await grant();
  await scratch.db.query(
    "update account set owned_by_account_id=$1 where account_id=$2",
    [other, agent],
  );
  assert.equal(await read(), null);
  await scratch.db.query(
    "update account set owned_by_account_id=$1 where account_id=$2",
    [owner, agent],
  );
  assert.equal(await read(), null);
});
test("explicit revocation is durable; ambiguous credentials and unsupported principals fail closed", async () => {
  await grant();
  const r = await clanContextOp(scratch.url, {
    agents: ids,
    apply: true,
    revoke: true,
    expected_sha256: (await preview()).expected_sha256,
  });
  assert.equal(r.changed, 1);
  assert.equal(await read(), null);
  await scratch.db.query(
    "insert into service_token(account_id,name,token_hash,scope) values($1,'other-context',repeat('d',64),'cr:read')",
    [agent],
  );
  assert.equal((await preview()).eligible, 0);
  assert.equal((await grant()).changed, 0);
  for (const change of [
    { kind: "person" },
    { kind: "integration" },
    { credentialType: "oauth" },
    { tokenId: null },
    { scopes: [] },
  ])
    assert.equal(
      await readAgentPolicyContext(scratch.db, { ...account, ...change }),
      null,
    );
});

test("moving a primary assignment row or revoking its credential durably revokes the grant", async () => {
  await grant();
  await scratch.db.query(
    "update account_clan set account_id=$1 where account_id=$2",
    [other, agent],
  );
  assert.equal(await read(), null);
  await scratch.db.query(
    "update account_clan set account_id=$1 where account_id=$2",
    [agent, other],
  );
  assert.equal(await read(), null);
  await grant();
  await scratch.db.query(
    "update service_token set revoked_at=now() where token_id=$1",
    [token],
  );
  await scratch.db.query(
    "update service_token set revoked_at=null where token_id=$1",
    [token],
  );
  assert.equal(await read(), null);
});
