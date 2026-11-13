/**
 * Elixir Clan's morning run as Elixir's own system actor, over a scratch
 * database with no integration row and no integration account ("No
 * integrations: Elixir has users and agents", Jamie, 2026-11-13).
 *
 * Through the same client the run uses (clanMorningClient): reads keep
 * their audit trail under no account, award standings stay "Elixir Clan"
 * facts (a standing written under the integration before the switch is
 * found, corrected and removed by its ref), and the Actions mail keeps its
 * once-a-day cap and its record.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { factItems } from "../../../packages/tools/src/activity/entries.mjs";
import { CLAN_SYSTEM_ACTOR } from "@elixir-mcp/clan/system-actor.mjs";
import { clanMorningClient, runClanEvaluation } from "../src/clan.mjs";

const CLAN = "#2PQRJ8LV";
const LEAD = "#20QQL8CC";
const MEMBER = "#8QQ8QQ8Q";
const sent = [];
let scratch, db, credential, mcp;

async function person(label, tag, role = "member") {
  const id = (
    await db.query(
      "insert into account(email_hash,email,status,role) values ($1,$2,'approved','member') returning account_id",
      [label, `${label}@example.org`],
    )
  ).rows[0].account_id;
  await db.query("insert into player(player_tag,name) values ($1,$2)", [
    tag,
    label,
  ]);
  await db.query(
    "insert into claim(account_id,player_tag,status,is_primary,relationship) values ($1,$2,'verified',true,'primary')",
    [id, tag],
  );
  await db.query(
    "insert into clan_membership(clan_tag,player_tag,joined_observed_at,role) values ($1,$2,now() - interval '9 days',$3)",
    [CLAN, tag, role],
  );
  return id;
}

const standing = (ref, value) => ({
  type: "award_standing",
  ref,
  player_tag: MEMBER,
  detail: {
    award: "War Champ",
    award_id: "war_champ",
    season_id: 136,
    place: 1,
    value,
    unit: "points",
    as_of: new Date().toISOString(),
  },
});

before(async () => {
  scratch = await scratchDb("clan_system_actor");
  db = scratch.db;
  await db.query("insert into clan(clan_tag,name) values ($1,'Example Clan')", [
    CLAN,
  ]);
  await person("lead", LEAD, "leader");
  await person("member", MEMBER);
  ({ credential, mcp } = clanMorningClient(db, {
    enqueue: async (msg) => sent.push(msg),
    secret: "test",
    archive: null,
  }));
});
after(async () => {
  await scratch?.drop();
});

test("the actor is Elixir's own: no account, no integration, nothing a door can present", () => {
  assert.equal(CLAN_SYSTEM_ACTOR.kind, "system");
  assert.equal(CLAN_SYSTEM_ACTOR.accountId, null);
  assert.equal(CLAN_SYSTEM_ACTOR.name, "elixir-clan");
  assert.ok(Object.isFrozen(CLAN_SYSTEM_ACTOR));
});

test("the morning run starts with no integration row (it used to refuse: clan_attester_identity_missing)", async () => {
  const { rows } = await db.query("select count(*)::int as n from integration");
  assert.equal(rows[0].n, 0);
  const r = await runClanEvaluation({
    databaseUrl: scratch.url,
    enqueue: async () => {},
    secret: "test",
    archive: null,
  });
  assert.deepEqual(r, { due: 0 });
});

test("a read keeps its audit trail: under no account, principal kind system, client Clan morning", async () => {
  await db.query("truncate mcp_call_audit");
  const r = await mcp.callTool(credential, "clans_roster", { clan_tag: CLAN });
  assert.ok(r.ok !== undefined, "an answer, success or structured failure");
  const { rows } = await db.query(
    "select account_id, principal_kind, client_name, surface, tool from mcp_call_audit",
  );
  assert.deepEqual(rows, [
    {
      account_id: null,
      principal_kind: "system",
      client_name: "Clan morning",
      surface: "web",
      tool: "clans_roster",
    },
  ]);
  // The closed reader still refuses anything outside Clan's reads.
  const refused = await mcp.callTool(credential, "players_follows", {});
  assert.equal(refused.error, "unsupported_clan_read");
});

test("an award standing is Elixir Clan's fact: written, corrected and removed with no account", async () => {
  const made = await mcp.writeFact(
    credential,
    CLAN,
    standing("standing:136:war_champ:new", 6400),
  );
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.body.attested_by.app, "Elixir Clan");
  assert.equal(made.body.attested_by.player_tag, null);
  const again = await mcp.writeFact(
    credential,
    CLAN,
    standing("standing:136:war_champ:new", 6500),
  );
  assert.equal(again.body.detail.value, 6500);
  assert.equal(again.body.id, made.body.id, "the same fact, replaced");
  const { rows } = await db.query(
    "select source, attester_account_id from attested_fact where fact_id = $1",
    [made.body.id],
  );
  assert.deepEqual(rows, [
    { source: "elixir-clan", attester_account_id: null },
  ]);
  // A person's kind of fact is still refused on Clan's own path.
  const kick = await mcp.writeFact(credential, CLAN, {
    type: "departure_classified",
    ref: "k-1",
    player_tag: MEMBER,
    detail: { kind: "kick" },
  });
  assert.equal(kick.ok, false);
  assert.equal(kick.code, "unknown_fact_type");
  const gone = await mcp.removeFact(
    credential,
    CLAN,
    "standing:136:war_champ:new",
  );
  assert.equal(gone.ok, true);
  assert.equal(gone.body.removed, true);
});

test("a standing written under the integration before the switch reads the same and is still Clan's to correct and remove", async () => {
  // As the integration wrote it: source elixir-clan, its account attesting.
  const owner = (
    await db.query(
      "insert into account(email_hash,status,role) values ('admin','approved','admin') returning account_id",
    )
  ).rows[0].account_id;
  const integrationAccount = (
    await db.query(
      "insert into account(kind,owned_by_account_id,status,role) values ('integration',$1,'approved','partner') returning account_id",
      [owner],
    )
  ).rows[0].account_id;
  const ref = "standing:136:war_champ:old";
  const s = standing(ref, 6100);
  const { rows: old } = await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, attester_account_id, occurred_at)
     values ('clan',$1,$2,'award_standing',$3,'clan','elixir-clan',$4,$5,now())
     returning fact_id`,
    [CLAN, MEMBER, JSON.stringify(s.detail), ref, integrationAccount],
  );
  const window = { fromMs: Date.now() - 86_400_000, toMs: Date.now() + 1000 };
  const lead = (
    await db.query("select account_id from claim where player_tag = $1", [LEAD])
  ).rows[0].account_id;
  const read = async () =>
    (
      await factItems(db, [{ kind: "clan", tag: CLAN, scope: "activity" }], {
        accountId: lead,
        ...window,
      })
    ).filter((i) => i.kind === "award_standing");
  const before = await read();
  assert.equal(before.length, 1);
  assert.equal(before[0].facts.attested_by.app, "Elixir Clan");
  // The system actor corrects it under its ref: the same row, same label.
  const corrected = await mcp.writeFact(credential, CLAN, standing(ref, 6200));
  assert.equal(corrected.ok, true, JSON.stringify(corrected));
  assert.equal(corrected.body.id, String(old[0].fact_id));
  const after = await read();
  assert.equal(after.length, 1);
  assert.equal(after[0].facts.value, 6200);
  assert.equal(after[0].facts.attested_by.app, "Elixir Clan");
  const removed = await mcp.removeFact(credential, CLAN, ref);
  assert.equal(removed.ok, true);
  assert.equal((await read()).length, 0);
});

test("the Actions mail goes once a day as Elixir Clan, recorded as before, with no integration", async () => {
  const body = {
    kind: "clan_actions_waiting",
    messages: [
      {
        player_tag: LEAD,
        subject: "1 action waiting for you in Example Clan",
        lines: ["Promote to Elder: Ada"],
        link: "https://elixir.poapkings.com/clan/2PQRJ8LV/actions",
      },
    ],
  };
  const first = await mcp.sendMail(credential, CLAN, body);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.body.results[0].status, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "lead@example.org");
  const { rows } = await db.query(
    "select i.kind, i.subject_key, i.facts->>'source' as source, count(s.*)::int as sends from email_issue i join email_send s using(issue_id) group by 1,2,3",
  );
  assert.deepEqual(rows, [
    {
      kind: "clan_actions_waiting",
      subject_key: CLAN,
      source: "elixir-clan",
      sends: 1,
    },
  ]);
  const again = await mcp.sendMail(credential, CLAN, body);
  assert.equal(again.body.results[0].status, "already_sent_today");
  assert.equal(sent.length, 1);
});
