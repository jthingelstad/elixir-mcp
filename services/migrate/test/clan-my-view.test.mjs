// clans_my_view (#535): a person's own view of their clan, read through
// Clan's closed in-process reader. Exactly three things; never another
// member's line or clock, never a removal Action, never a write.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { readOwnClanView } from "@elixir-mcp/auth/clan-context";
import { makeRegistry } from "@elixir-mcp/tools";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import { evaluate } from "@elixir-mcp/clan-engine";
import {
  EXAMPLE_POLICY,
  NOW,
  member,
  participation,
} from "@elixir-mcp/clan-engine/fixtures";

const CLAN = "#028";
const FILLERS = Array.from({ length: 8 }, (_, i) => `#0P${i}`);
let scratch, ledger, me, lead, unverified, outsider;
const person = (accountId) => ({
  accountId,
  kind: "person",
  credentialType: "oauth",
});

const insertAccount = async (hash) =>
  (
    await scratch.db.query(
      "insert into account(email_hash,kind,status,role) values($1,'person','approved','member') returning account_id",
      [hash],
    )
  ).rows[0].account_id;

before(async () => {
  scratch = await scratchDb("clan_my_view");
  const db = scratch.db;
  ledger = createPostgresLedger(db);
  await db.query("insert into clan(clan_tag) values('#028'),('#029')");
  await db.query(
    "insert into player(player_tag) values('#02Q'),('#02L'),('#02G'),('#02C')",
  );
  me = await insertAccount("view-me");
  lead = await insertAccount("view-lead");
  unverified = await insertAccount("view-unverified");
  outsider = await insertAccount("view-outsider");
  await db.query(
    "insert into recording(subject_type,subject_tag,requested_by,status) values('clan','#028',$1,'active'),('clan','#029',$1,'active')",
    [me],
  );
});
after(async () => scratch?.drop());

beforeEach(async () => {
  const db = scratch.db;
  await db.query("delete from clan_state");
  await db.query("delete from claim");
  await db.query("delete from clan_membership");
  await db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship) values
       ($1,'#02Q','verified',true,'primary'),
       ($2,'#02L','verified',true,'primary'),
       ($3,'#02G','unverified',true,'primary')`,
    [me, lead, unverified],
  );
  await db.query(
    `insert into clan_membership(clan_tag,player_tag,joined_observed_at,role) values
       ('#028','#02Q',now(),'member'),
       ('#028','#02L',now(),'leader'),
       ('#028','#02G',now(),'member')`,
  );
});

/** A clan of eleven under the example policy, evaluated, with one idle
 *  member (a removal recommended) and five open Actions. */
async function seedClan({ members = 11, evaluatedVersion = null } = {}) {
  const saved = await ledger.savePolicy(CLAN, {
    values: { ...EXAMPLE_POLICY, leader_notes: "private-canary-policy" },
    by: "#02L",
  });
  await ledger.saveClanSize(CLAN, {
    members,
    observed_at: NOW.toISOString(),
  });
  const verdicts = evaluate({
    participation: participation([
      ...FILLERS.map((t) => member(t, { name: `Filler ${t.slice(1)}` })),
      member("#02Q", { name: "Me Myself", tenureDays: 10 }),
      member("#02L", { name: "The Leader" }),
      member("#02G", {
        name: "Gone Quiet",
        lastBattleDaysAgo: 9,
        war: [0, 0, 0, 0, 0, 0],
      }),
    ]),
    policy: EXAMPLE_POLICY,
    now: NOW,
    policy_version: evaluatedVersion ?? saved.version,
  });
  await ledger.saveVerdicts(CLAN, verdicts);
  const card = (card_id, type, player_tag, player_name, extra = {}) =>
    ledger.putCard(CLAN, {
      card_id,
      type,
      player_tag,
      player_name,
      status: "proposed",
      raised_at: extra.raised_at,
      audience: type === "removal" ? "leaders" : undefined,
      evidence: "private-canary-evidence",
      ...extra,
    });
  await card("rm", "removal", "#02G", "Gone Quiet", {
    number: 1,
    raised_at: "2026-09-12T10:00:00Z",
  });
  await card("pr", "promotion", "#0P1", "Filler P1", {
    number: 2,
    raised_at: "2026-09-11T10:00:00Z",
  });
  await card("wl", "welcome", "#0P2", "Filler P2", {
    raised_at: "2026-09-10T10:00:00Z",
  });
  await card("aw", "away", "#02Q", "Me Myself", {
    number: 4,
    raised_at: "2026-09-09T10:00:00Z",
  });
  await card("aw2", "away", "#02G", "Gone Quiet", {
    number: 5,
    raised_at: "2026-09-08T10:00:00Z",
  });
  await card("old", "promotion", "#0P3", "Filler P3", {
    number: 6,
    status: "done",
    raised_at: "2026-09-13T10:00:00Z",
  });
  await ledger.putHold(CLAN, {
    player_tag: "#02Q",
    reason: "private-canary-hold",
  });
  await ledger.putNote(CLAN, {
    note_id: "n1",
    player_tag: "#02Q",
    created_at: NOW.toISOString(),
    text: "private-canary-note",
  });
  return verdicts;
}

const invoke = (accountId, args = {}) =>
  makeRegistry().invoke(
    "clans_my_view",
    { db: scratch.db, account: person(accountId) },
    args,
  );

const snapshotOfState = async () =>
  (
    await scratch.db.query(
      "select pk, body::text as body from clan_state order by pk",
    )
  ).rows;

test("a member sees the three things and nothing else; no removal, no other member", async () => {
  await seedClan();
  const before = await snapshotOfState();
  const r = await invoke(me);
  assert.deepEqual(Object.keys(r.view).sort(), [
    "actions",
    "clan_tag",
    "policy",
    "read_at",
    "reason",
    "schema_version",
    "standing",
    "you",
  ]);
  assert.equal(r.view.reason, null);
  assert.deepEqual(r.view.you, { player_tag: "#02Q", role: "member" });
  assert.equal(r.view.policy.active, true);
  assert.deepEqual(
    r.view.actions.waiting.map((a) => a.type),
    ["away"],
  );
  assert.equal(r.view.actions.count, r.view.actions.waiting.length);
  assert.equal(
    r.view.actions.waiting[0].url,
    "https://elixir.poapkings.com/clan/028/actions/4",
  );
  const text = JSON.stringify(r);
  for (const leak of [
    "#02G",
    "Gone Quiet",
    "#02L",
    "The Leader",
    "#0P",
    "Filler",
    "private-canary",
    "removal_safety",
    me,
  ])
    assert.ok(!text.includes(leak), `no ${leak} in a member's view`);
  assert.deepEqual(await snapshotOfState(), before, "the read writes nothing");
});

test("a leader who would decide a removal never sees it; counts exclude it; the note is always there", async () => {
  await seedClan();
  const r = await invoke(lead);
  assert.deepEqual(r.view.you, { player_tag: "#02L", role: "leader" });
  assert.deepEqual(
    r.view.actions.waiting.map((a) => a.type),
    ["promotion", "welcome"],
  );
  assert.equal(r.view.actions.count, 2);
  const unnumbered = r.view.actions.waiting[1];
  assert.equal(unnumbered.number, null);
  assert.equal(unnumbered.url, "https://elixir.poapkings.com/clan/028/actions");
  const text = JSON.stringify(r);
  // `policy.removal` is the policy switch; no Action of the type appears.
  for (const leak of [
    '"type":"removal"',
    "Gone Quiet",
    "#02G",
    "private-canary",
    'days_idle":9',
  ])
    assert.ok(!text.includes(leak), `no ${leak} in a leader's view`);
  assert.ok(r.notes.some((n) => /only in Elixir Clan/.test(n)));
  // No Action was numbered by the read.
  assert.equal((await ledger.card(CLAN, "wl")).number, undefined);
});

test("an agent, an integration, an unverified claimant and a non-member are refused, and read nothing", async () => {
  await seedClan();
  const registry = makeRegistry();
  for (const account of [
    {
      accountId: me,
      kind: "agent",
      credentialType: "service",
      tokenId: "t",
      scopes: ["cr:read"],
    },
    { accountId: me, kind: "integration", credentialType: "service" },
  ]) {
    await assert.rejects(
      registry.invoke(
        "clans_my_view",
        { db: scratch.db, account },
        { clan_tag: CLAN },
      ),
      (e) =>
        e.code === "not_entitled" && /person's own connection/.test(e.message),
    );
    assert.deepEqual(await readOwnClanView(scratch.db, account, CLAN), {
      refused: "not_a_person",
    });
    assert.equal(registry.availableTo("clans_my_view", account.kind), false);
  }
  assert.equal(registry.availableTo("clans_my_view", "person"), true);
  // Unverified: the claimant gets nothing, even for their own player.
  await assert.rejects(
    invoke(unverified, { clan_tag: CLAN }),
    (e) => e.code === "not_entitled",
  );
  await assert.rejects(invoke(unverified), (e) => e.code === "not_entitled");
  // No claim at all in the clan; a clan with no primary to default to.
  await assert.rejects(
    invoke(outsider, { clan_tag: CLAN }),
    (e) => e.code === "not_entitled",
  );
  await assert.rejects(invoke(outsider), (e) => e.code === "no_subject");
  // Another recorded clan the person is not in.
  await assert.rejects(
    invoke(me, { clan_tag: "#029" }),
    (e) => e.code === "not_entitled",
  );
  // A clan that is not recorded.
  await assert.rejects(
    invoke(me, { clan_tag: "#2PP" }),
    (e) => e.code === "not_recorded",
  );
});

test("a former member, a watched claim and a disabled account fail closed", async () => {
  await seedClan();
  for (const sql of [
    "update clan_membership set left_observed_at=now() where player_tag='#02Q'",
    "update claim set is_primary=false,relationship='watching' where player_tag='#02Q'",
    "update claim set status='unverified' where player_tag='#02Q'",
    "update account set status='disabled' where email_hash='view-me'",
  ]) {
    await scratch.db.query("begin");
    try {
      await scratch.db.query(sql);
      assert.deepEqual(await readOwnClanView(scratch.db, person(me), CLAN), {
        refused: "not_verified_member",
      });
    } finally {
      await scratch.db.query("rollback");
    }
  }
});

test("no policy, too few members and a stale snapshot each say why and show no line", async () => {
  let r = await invoke(me, { clan_tag: CLAN });
  assert.equal(r.view.reason, "no_policy");
  assert.equal(r.view.policy.set, false);
  assert.equal(r.view.policy.version, null);
  assert.equal(r.view.standing, null);
  assert.equal(r.view.actions, null);

  await seedClan({ members: 9 });
  r = await invoke(me);
  assert.equal(r.view.reason, "too_few_members");
  assert.equal(r.view.standing, null);
  assert.equal(r.view.actions, null);

  await scratch.db.query("delete from clan_state");
  await seedClan({ evaluatedVersion: 99 });
  r = await invoke(me);
  assert.equal(r.view.reason, "not_evaluated");
  assert.equal(r.view.standing, null);
  assert.equal(r.view.actions, null);
});

test("a verified player missing from the snapshot is not evaluated", async () => {
  await seedClan();
  await scratch.db.query(
    "insert into claim(account_id,player_tag,status,is_primary,relationship) values($1,'#02C','verified',true,'primary')",
    [outsider],
  );
  await scratch.db.query(
    "insert into clan_membership(clan_tag,player_tag,joined_observed_at,role) values('#028','#02C',now(),'member')",
  );
  const r = await invoke(outsider);
  assert.equal(r.view.reason, "not_evaluated");
  assert.equal(r.view.standing, null);
});

test("two verified players in one clan: the read acts as the higher in-game role", async () => {
  await seedClan();
  await scratch.db.query(
    "insert into claim(account_id,player_tag,status,is_primary,relationship) values($1,'#02C','verified',false,'alt')",
    [me],
  );
  await scratch.db.query(
    "insert into clan_membership(clan_tag,player_tag,joined_observed_at,role) values('#028','#02C',now(),'coLeader')",
  );
  const r = await readOwnClanView(scratch.db, person(me), CLAN);
  assert.deepEqual(r.view.you, { player_tag: "#02C", role: "coLeader" });
  assert.equal(r.view.reason, "not_evaluated", "#02C has no verdict");
});
