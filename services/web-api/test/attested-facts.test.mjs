/**
 * Attested facts (JSON API 2.2.0, contract 9.2.0) over a scratch database:
 * a family app records what a person did in their clan, as their verified
 * player with the role the record holds; the refusals say why; a retry is
 * the same fact and a correction replaces it; an integration records its
 * game's facts for a player; and the timeline shows each fact only to the
 * reader its type allows (a kick never reaches an agent).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { mintTokens, registerClient } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { factItems } from "../../mcp/src/activity/entries.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_facts_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
const API = "https://elixir.poapkings.com/api/v1";
const CLAN = "#2PQRJ8LV";
const LEADER_TAG = "#20QQL8CC";
const MEMBER_TAG = "#8QQ8QQ8Q";
const ELDER_TAG = "#9RRYR9RR";
const LEFT_TAG = "#2PPGY0Q8";
const OUTSIDER_TAG = "#UUYY22VV";

let db, handler, clan, other, accounts;
const request = (method, path, body, token) =>
  handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers: { authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const data = (r) => JSON.parse(r.body);
const facts = `/api/v1/clans/${encodeURIComponent(CLAN)}/facts`;

async function person(label, tag, role) {
  const id = (
    await db.query(
      "insert into account(email_hash,status,role) values ($1,'approved','member') returning account_id",
      [label],
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
  if (role)
    await db.query(
      "insert into clan_membership(clan_tag,player_tag,joined_observed_at,role) values ($1,$2,now() - interval '30 days',$3)",
      [CLAN, tag, role],
    );
  return id;
}
const grant = async (accountId, scope, client = clan) =>
  (
    await mintTokens(db, {
      clientId: client.clientId,
      accountId,
      scope,
      resource: API,
    })
  ).accessToken;

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  handler = makeHandler({ databaseUrl, secret: "test" });
  await db.query("insert into clan(clan_tag,name) values ($1,'Example Clan')", [
    CLAN,
  ]);
  clan = await registerClient(db, {
    clientName: "Elixir Clan",
    redirectUris: ["https://clan.poapkings.com/auth/callback"],
  });
  other = await registerClient(db, {
    clientName: "Someone's app",
    redirectUris: ["https://example.org/callback"],
  });
  accounts = {
    leader: await person("leader", LEADER_TAG, "leader"),
    member: await person("member", MEMBER_TAG, "member"),
    elder: await person("elder", ELDER_TAG, "elder"),
    outsider: await person("outsider", OUTSIDER_TAG, null),
  };
  await db.query("insert into player(player_tag,name) values ($1,'gone')", [
    LEFT_TAG,
  ]);
});
after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database ${name} with (force)`);
  await admin.end();
});

test("a leader records a departure as a kick; a retry is the same fact and a correction replaces it", async () => {
  const token = await grant(accounts.leader, "cr:read clans:attest");
  const body = {
    type: "departure_classified",
    ref: "card-1",
    player_tag: LEFT_TAG,
    detail: { kind: "kick" },
  };
  const made = await request("POST", facts, body, token);
  assert.equal(made.statusCode, 201, made.body);
  const f = data(made).data;
  assert.equal(f.created, true);
  assert.equal(f.visibility, "leaders");
  assert.deepEqual(f.attested_by, {
    app: "Elixir Clan",
    player_tag: LEADER_TAG,
    role: "leader",
  });
  assert.deepEqual(f.subject, {
    kind: "clan",
    clan_tag: CLAN,
    player_tag: LEFT_TAG,
  });
  const again = await request("POST", facts, body, token);
  assert.equal(again.statusCode, 200);
  assert.equal(data(again).data.id, f.id);
  const corrected = await request(
    "POST",
    facts,
    { ...body, detail: { kind: "leave" } },
    token,
  );
  assert.equal(data(corrected).data.detail.kind, "leave");
  const { rows } = await db.query(
    "select count(*)::int as n from attested_fact",
  );
  assert.equal(rows[0].n, 1);
  // A ref cannot jump to another type.
  const jump = await request(
    "POST",
    facts,
    {
      type: "award_granted",
      ref: "card-1",
      player_tag: LEFT_TAG,
      detail: { award: "X", season_id: 130 },
    },
    token,
  );
  assert.equal(jump.statusCode, 409);
  assert.equal(data(jump).code, "ref_conflict");
});

test("refusals say why: another app, no capability, not in the clan, the wrong role, a bad detail", async () => {
  const leader = await grant(accounts.leader, "cr:read clans:attest");
  const departure = {
    type: "departure_classified",
    ref: "card-2",
    player_tag: LEFT_TAG,
    detail: { kind: "leave" },
  };
  const elsewhere = await grant(accounts.leader, "cr:read clans:attest", other);
  const r1 = await request("POST", facts, departure, elsewhere);
  assert.equal(data(r1).code, "family_apps_only");
  const noScope = await grant(accounts.leader, "cr:read");
  const r2 = await request("POST", facts, departure, noScope);
  assert.equal(data(r2).code, "insufficient_scope");
  const outsider = await grant(accounts.outsider, "cr:read clans:attest");
  const r3 = await request("POST", facts, departure, outsider);
  assert.equal(data(r3).code, "not_in_clan");
  const member = await grant(accounts.member, "cr:read clans:attest");
  const r4 = await request("POST", facts, departure, member);
  assert.equal(r4.statusCode, 403);
  assert.equal(data(r4).code, "not_permitted");
  // An elder may say something in clan chat, never as a Leader Message.
  const elder = await grant(accounts.elder, "cr:read clans:attest");
  const chat = await request(
    "POST",
    facts,
    {
      type: "clan_message",
      ref: "welcome-1",
      detail: { channel: "clan_chat", body: "Welcome to the clan!" },
    },
    elder,
  );
  assert.equal(chat.statusCode, 201, chat.body);
  const letter = await request(
    "POST",
    facts,
    {
      type: "clan_message",
      ref: "msg-1",
      detail: { channel: "leader_message", title: "Hi", body: "Hello all" },
    },
    elder,
  );
  assert.equal(data(letter).code, "not_permitted");
  // A member may say they are away themselves, and nobody else.
  const away = await request(
    "POST",
    facts,
    {
      type: "member_away",
      ref: "away-1",
      player_tag: MEMBER_TAG,
      detail: { until: null },
    },
    member,
  );
  assert.equal(away.statusCode, 201, away.body);
  const notMine = await request(
    "POST",
    facts,
    { type: "member_away", ref: "away-2", player_tag: ELDER_TAG, detail: {} },
    member,
  );
  assert.equal(data(notMine).code, "not_permitted");
  for (const [bad, code] of [
    [{ ...departure, type: "personal_record" }, "unknown_fact_type"],
    [{ ...departure, detail: { kind: "exiled" } }, "invalid_fact"],
    [{ ...departure, detail: { kind: "kick", why: "x" } }, "invalid_fact"],
    [{ ...departure, ref: "" }, "invalid_fact"],
    [{ ...departure, occurred_at: "2020-01-01T00:00:00Z" }, "invalid_fact"],
    [{ ...departure, player_tag: "nope!" }, "invalid_tag"],
  ]) {
    const r = await request("POST", facts, bad, leader);
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(data(r).code, code);
  }
  // Taken back by its ref.
  const gone = await request("DELETE", `${facts}/welcome-1`, undefined, leader);
  assert.equal(gone.statusCode, 200, gone.body);
  assert.equal(data(gone).data.removed, true);
  const missing = await request(
    "DELETE",
    `${facts}/welcome-1`,
    undefined,
    leader,
  );
  assert.equal(missing.statusCode, 404);
});

test("an integration records its game's fact for a player with facts:write", async () => {
  const admin = (
    await db.query(
      "insert into account(email_hash,status,role) values ('admin','approved','admin') returning account_id",
    )
  ).rows[0].account_id;
  const { createSession } = await import("@elixir-mcp/auth");
  const session = await createSession(db, {
    secret: "test",
    accountId: admin,
    emailHash: "admin",
  });
  const cookie = `__Host-elixir_session=${session.token}`;
  const provision = (scopes, nameOf) =>
    handler({
      rawPath: "/api/admin/integrations",
      requestContext: { http: { method: "POST" } },
      headers: { cookie, "x-elixir-client": "web" },
      body: JSON.stringify({ name: nameOf, scopes }),
    });
  const drop = data(await provision(["facts:write"], "elixir-drop"));
  const reader = data(await provision(["players:read"], "reader-only"));
  const path = `/api/v1/players/${encodeURIComponent(MEMBER_TAG)}/facts`;
  const record = {
    type: "personal_record",
    ref: "run-7",
    detail: { game: "Ranked", score: 1840, previous_best: 1710 },
  };
  const made = await request("POST", path, record, drop.token);
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(data(made).data.attested_by.app, "Elixir Drop");
  assert.equal(data(made).data.visibility, "player");
  const refused = await request("POST", path, record, reader.token);
  assert.equal(data(refused).code, "insufficient_scope");
  const clanFact = await request(
    "POST",
    path,
    { ...record, type: "departure_classified" },
    drop.token,
  );
  assert.equal(data(clanFact).code, "unknown_fact_type");
});

test("the timeline shows each fact only to the reader its type allows; a kick never reaches an agent", async () => {
  const window = { fromMs: Date.now() - 86_400_000, toMs: Date.now() + 1000 };
  const clanSubject = [{ kind: "clan", tag: CLAN, scope: "activity" }];
  const leader = await grant(accounts.leader, "cr:read clans:attest");
  await request(
    "POST",
    facts,
    {
      type: "award_granted",
      ref: "grant-1",
      player_tag: MEMBER_TAG,
      detail: { award: "Iron Deck", season_id: 131, place: 1 },
    },
    leader,
  );
  await request(
    "POST",
    facts,
    {
      type: "departure_classified",
      ref: "card-3",
      player_tag: LEFT_TAG,
      detail: { kind: "kick" },
    },
    leader,
  );
  const kinds = async (accountId, subjects = clanSubject) =>
    (await factItems(db, subjects, { accountId, ...window }))
      .map((i) => `${i.kind}${i.facts.kind ? `:${i.facts.kind}` : ""}`)
      .sort();
  // The leader sees everything the clan shares, the kick included.
  const seen = await kinds(accounts.leader);
  assert.ok(seen.includes("award_granted"));
  assert.ok(seen.includes("departure_classified:kick"));
  assert.ok(seen.includes("member_away"));
  // A member sees the award, never a departure or an away.
  const memberSees = await kinds(accounts.member);
  assert.ok(memberSees.includes("award_granted"));
  assert.ok(!memberSees.some((k) => k.startsWith("departure_classified")));
  assert.ok(!memberSees.includes("member_away"));
  // Someone outside the clan sees none of it.
  assert.deepEqual(await kinds(accounts.outsider), []);
  // The leader's own agent reads as its owner, but never a leaders' fact.
  const agent = (
    await db.query(
      "insert into account(kind,owned_by_account_id,status,role) values ('agent',$1,'approved','member') returning account_id",
      [accounts.leader],
    )
  ).rows[0].account_id;
  const agentSees = await kinds(agent);
  assert.ok(agentSees.includes("award_granted"));
  assert.ok(!agentSees.some((k) => k.startsWith("departure_classified")));
  // No reader, no facts (the clan mail is composed without one).
  assert.deepEqual(
    await factItems(db, clanSubject, { accountId: null, ...window }),
    [],
  );
  // A player fact reaches whoever has the player on their timeline.
  const playerSees = await kinds(accounts.outsider, [
    { kind: "player", tag: MEMBER_TAG },
  ]);
  assert.deepEqual(playerSees, ["personal_record"]);
  // The item says who said it, and the member it is about.
  const [award] = (
    await factItems(db, clanSubject, { accountId: accounts.member, ...window })
  ).filter((i) => i.kind === "award_granted");
  assert.equal(award.section, "attested");
  assert.equal(award.facts.player_tag, MEMBER_TAG);
  assert.equal(award.facts.attested_by.app, "Elixir Clan");
  assert.equal(award.facts.attested_by.role, "leader");
});
