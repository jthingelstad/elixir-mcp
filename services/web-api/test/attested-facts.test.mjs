/**
 * Attested facts (contract 9.2.0) over a scratch database: Clan records
 * what a person did in their clan, as their verified player with the role
 * the record holds; the refusals say why; a retry is the same fact and a
 * correction replaces it; Clan's morning run records its computed award
 * standings; a player fact a family app wrote before JSON API 5.0.0 stays
 * readable; and the timeline shows each fact only to the reader its type
 * allows. The JSON API's clan fact doors are gone (4.0.0), and its player
 * fact door (5.0.0).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { mintTokens, registerClient } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import {
  writeClanFactInClan,
  removeClanFactInClan,
  writeClanFactBySystem,
  removeClanFactBySystem,
} from "@elixir-mcp/record/attested-facts";
import { factItems } from "../../../packages/tools/src/activity/entries.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

// A family app's client is provisioned (0185), never merely registered to
// a family redirect: registration is open and proves nothing.
async function familyClient(db, spec, app) {
  const c = await registerClient(db, spec);
  await db.query(
    `insert into family_oauth_client (client_id, app) values ($1, $2)`,
    [c.clientId, app],
  );
  return c;
}

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_facts_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
const API = "https://elixir.poapkings.com/api/v1";
const CLAN = "#0QC8RCGY";
const LEADER_TAG = "#0LCLRCPQ";
const MEMBER_TAG = "#0J8CVLL8";
const ELDER_TAG = "#0Q0L80CC";
const LEFT_TAG = "#0UY8VUR9";
const OUTSIDER_TAG = "#0LUCVCJV";

let db, handler, clan, accounts;
const request = (method, path, body, token) =>
  handler({
    path,
    method,
    headers: { authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const data = (r) => JSON.parse(r.body);
const facts = `/api/v1/clans/${encodeURIComponent(CLAN)}/facts`;

/** A writer's answer as a status and body, as Clan's routes give it. */
async function answer(run) {
  try {
    const r = await run();
    return {
      statusCode: r.created ? 201 : 200,
      body: JSON.stringify({ data: r }),
    };
  } catch (e) {
    if (!e.status) throw e;
    return { statusCode: e.status, body: JSON.stringify({ code: e.code }) };
  }
}
/** The person Clan's session signed in. */
const as = (accountId) => ({ accountId, kind: "person" });
/** Write or take back a clan fact in Clan, as `who`. */
const write = (body, who) =>
  answer(() => writeClanFactInClan(db, who, CLAN, body));
const remove = (ref, who) =>
  answer(() => removeClanFactInClan(db, who, CLAN, ref));

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
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  handler = makeHandler({ databaseUrl, secret: "test" });
  await db.query("insert into clan(clan_tag,name) values ($1,'Example Clan')", [
    CLAN,
  ]);
  clan = await familyClient(
    db,
    {
      clientName: "Elixir Clan",
      redirectUris: ["https://elixir.poapkings.com/api/clan/auth/callback"],
    },
    "clan",
  );
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
  await dropScratch(name);
});

test("a leader records a departure as a kick; a retry is the same fact and a correction replaces it", async () => {
  const token = as(accounts.leader);
  const body = {
    type: "departure_classified",
    ref: "card-1",
    player_tag: LEFT_TAG,
    detail: { kind: "kick" },
  };
  const made = await write(body, token);
  assert.equal(made.statusCode, 201, made.body);
  const f = data(made).data;
  assert.equal(f.created, true);
  assert.equal(f.visibility, "clan");
  assert.deepEqual(f.attested_by, {
    app: "Clan",
    player_tag: LEADER_TAG,
    role: "leader",
  });
  assert.deepEqual(f.subject, {
    kind: "clan",
    clan_tag: CLAN,
    player_tag: LEFT_TAG,
  });
  const again = await write(body, token);
  assert.equal(again.statusCode, 200);
  assert.equal(data(again).data.id, f.id);
  const corrected = await write({ ...body, detail: { kind: "leave" } }, token);
  assert.equal(data(corrected).data.detail.kind, "leave");
  const { rows } = await db.query(
    "select count(*)::int as n from attested_fact",
  );
  assert.equal(rows[0].n, 1);
  // A ref cannot jump to another type.
  const jump = await write(
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
  // A person's clan facts are keyed as Clan's were before it moved into
  // Elixir, so Clan still corrects and removes the facts it wrote then.
  const { rows: keyed } = await db.query(
    "select source from attested_fact where source_ref = 'card-1'",
  );
  assert.deepEqual(keyed, [{ source: "clan.poapkings.com" }]);
});

test("refusals say why: not a person, not in the clan, the wrong role, a bad detail", async () => {
  const leader = as(accounts.leader);
  const departure = {
    type: "departure_classified",
    ref: "card-2",
    player_tag: LEFT_TAG,
    detail: { kind: "leave" },
  };
  const agentOf = await write(departure, {
    accountId: accounts.leader,
    kind: "agent",
  });
  assert.equal(data(agentOf).code, "not_a_person");
  const outsider = as(accounts.outsider);
  const r3 = await write(departure, outsider);
  assert.equal(data(r3).code, "not_in_clan");
  const member = as(accounts.member);
  const r4 = await write(departure, member);
  assert.equal(r4.statusCode, 403);
  assert.equal(data(r4).code, "not_permitted");
  // An elder may say something in clan chat, never as a Leader Message.
  const elder = as(accounts.elder);
  const chat = await write(
    {
      type: "clan_message",
      ref: "welcome-1",
      detail: { channel: "clan_chat", body: "Welcome to the clan!" },
    },
    elder,
  );
  assert.equal(chat.statusCode, 201, chat.body);
  const letter = await write(
    {
      type: "clan_message",
      ref: "msg-1",
      detail: { channel: "leader_message", title: "Hi", body: "Hello all" },
    },
    elder,
  );
  assert.equal(data(letter).code, "not_permitted");
  // A member may say they are away themselves, and nobody else.
  const away = await write(
    {
      type: "member_away",
      ref: "away-1",
      player_tag: MEMBER_TAG,
      detail: { until: null },
    },
    member,
  );
  assert.equal(away.statusCode, 201, away.body);
  // An away's end lies ahead: next week is fine, two years out is not.
  const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const until = await write(
    {
      type: "member_away",
      ref: "away-1",
      player_tag: MEMBER_TAG,
      detail: { until: nextWeek },
    },
    member,
  );
  assert.equal(until.statusCode, 200, "the same ref, now with an end");
  assert.equal(JSON.parse(until.body).data.detail.until, nextWeek);
  const farOff = await write(
    {
      type: "member_away",
      ref: "away-1",
      player_tag: MEMBER_TAG,
      detail: { until: new Date(Date.now() + 800 * 86_400_000).toISOString() },
    },
    member,
  );
  assert.equal(data(farOff).code, "invalid_fact");
  const notMine = await write(
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
    [
      {
        type: "role_change_made",
        ref: "role-same",
        player_tag: MEMBER_TAG,
        detail: { from: "elder", to: "elder" },
      },
      "invalid_fact",
    ],
  ]) {
    const r = await write(bad, leader);
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(data(r).code, code);
  }
  // Taken back by its ref.
  const gone = await remove("welcome-1", leader);
  assert.equal(gone.statusCode, 200, gone.body);
  assert.equal(data(gone).data.removed, true);
  const missing = await remove("welcome-1", leader);
  assert.equal(missing.statusCode, 404);
});

test("an overwrite needs the right to the fact already there, not only the one sent", async () => {
  const leader = as(accounts.leader);
  const elder = as(accounts.elder);
  const member = as(accounts.member);
  const letter = await write(
    {
      type: "clan_message",
      ref: "letter-overwrite",
      detail: { channel: "leader_message", title: "Hi", body: "From the top" },
    },
    leader,
  );
  assert.equal(letter.statusCode, 201, letter.body);
  const overwrite = await write(
    {
      type: "clan_message",
      ref: "letter-overwrite",
      detail: { channel: "clan_chat", body: "Replaced" },
    },
    elder,
  );
  assert.equal(overwrite.statusCode, 403);
  assert.equal(data(overwrite).code, "not_permitted");

  const theirs = await write(
    {
      type: "member_away",
      ref: "away-overwrite",
      player_tag: ELDER_TAG,
      detail: {},
    },
    elder,
  );
  assert.equal(theirs.statusCode, 201, theirs.body);
  const repointed = await write(
    {
      type: "member_away",
      ref: "away-overwrite",
      player_tag: MEMBER_TAG,
      detail: {},
    },
    member,
  );
  assert.equal(repointed.statusCode, 403);
  assert.equal(data(repointed).code, "not_permitted");
  const { rows } = await db.query(
    `select player_tag, detail from attested_fact where source_ref in ('letter-overwrite', 'away-overwrite') order by source_ref`,
  );
  assert.equal(rows[0].player_tag, ELDER_TAG, "the away is untouched");
  assert.equal(rows[1].detail.channel, "leader_message", "so is the letter");

  // The leader may still correct their own letter.
  const fixed = await write(
    {
      type: "clan_message",
      ref: "letter-overwrite",
      detail: { channel: "leader_message", title: "Hi", body: "Corrected" },
    },
    leader,
  );
  assert.equal(fixed.statusCode, 200, fixed.body);
});

test("a player fact Drop wrote on its key before 5.0.0 stays stored and labelled; nothing writes one now", async () => {
  // JSON API 5.0.0 removed the write (integration keys went); the rows a
  // family app wrote stay, read as their type says (the timeline below).
  const attester = (
    await db.query(
      "insert into account(kind,owned_by_account_id,status,role) values ('integration',$1,'approved','partner') returning account_id",
      [accounts.leader],
    )
  ).rows[0].account_id;
  await db.query(
    `insert into attested_fact
       (subject_kind, player_tag, fact_type, detail, visibility, source,
        source_ref, attester_account_id, occurred_at)
     values ('player', $1, 'personal_record',
             '{"game":"Ranked","score":1840,"previous_best":1710}', 'player',
             'elixir-drop', 'run-7', $2, now())`,
    [MEMBER_TAG, attester],
  );
  const [item] = await factItems(db, [{ kind: "player", tag: MEMBER_TAG }], {
    accountId: accounts.outsider,
    interactive: true,
    fromMs: Date.now() - 86_400_000,
    toMs: Date.now() + 1000,
  });
  assert.equal(item.kind, "personal_record");
  assert.equal(item.facts.attested_by.app, "Elixir Drop");
  const r = await request(
    "POST",
    `/api/v1/players/${encodeURIComponent(MEMBER_TAG)}/facts`,
    { type: "personal_record", ref: "run-8", detail: {} },
  );
  assert.equal(r.statusCode, 404, r.body);
});

test("the timeline shows each fact only to the reader its type allows; a departure reaches the clan and its agent, an away only leaders", async () => {
  const clanSubject = [{ kind: "clan", tag: CLAN, scope: "activity" }];
  const leader = as(accounts.leader);
  const awarded = await write(
    {
      type: "award_granted",
      ref: "grant-1",
      player_tag: MEMBER_TAG,
      detail: { award: "Iron Deck", season_id: 131, place: 1 },
    },
    leader,
  );
  assert.equal(awarded.statusCode, 201, awarded.body);
  const kick = await write(
    {
      type: "departure_classified",
      ref: "card-3",
      player_tag: LEFT_TAG,
      detail: { kind: "kick" },
    },
    leader,
  );
  assert.equal(kick.statusCode, 201, kick.body);
  // The window closes after the writes: taken before them, a slow machine
  // records the kick past its end and the leader seems not to see it.
  const window = { fromMs: Date.now() - 86_400_000, toMs: Date.now() + 1000 };
  const kinds = async (accountId, subjects = clanSubject, interactive = true) =>
    (await factItems(db, subjects, { accountId, interactive, ...window }))
      .map((i) => `${i.kind}${i.facts.kind ? `:${i.facts.kind}` : ""}`)
      .sort();
  // The leader sees everything the clan shares, the kick included.
  const seen = await kinds(accounts.leader);
  assert.ok(seen.includes("award_granted"));
  assert.ok(seen.includes("departure_classified:kick"));
  assert.ok(seen.includes("member_away"));
  // A leaders' fact needs the leader reading in person: a
  // headless key bound to the leader's account reads what the clan shares.
  const headless = await kinds(accounts.leader, clanSubject, false);
  assert.ok(headless.includes("departure_classified:kick"));
  assert.ok(!headless.includes("member_away"));
  // A member sees the award and the departure, kick and all (9.3.0: the
  // game already told the clan), never an away.
  const memberSees = await kinds(accounts.member);
  assert.ok(memberSees.includes("award_granted"));
  assert.ok(memberSees.includes("departure_classified:kick"));
  assert.ok(!memberSees.includes("member_away"));
  // Someone outside the clan sees none of it.
  assert.deepEqual(await kinds(accounts.outsider), []);
  // The leader's own agent reads as its owner: the clan's facts, the
  // departure included, never a leaders' fact.
  const agent = (
    await db.query(
      "insert into account(kind,owned_by_account_id,status,role) values ('agent',$1,'approved','member') returning account_id",
      [accounts.leader],
    )
  ).rows[0].account_id;
  const agentSees = await kinds(agent);
  assert.ok(agentSees.includes("award_granted"));
  assert.ok(agentSees.includes("departure_classified:kick"));
  assert.ok(!agentSees.includes("member_away"));
  // A departure written under 9.2.0 carries visibility 'leaders' in its
  // row; who sees it is the type's rule now, so the agent sees it too.
  await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, occurred_at)
     values ('clan', $1, $2, 'departure_classified', '{"kind":"leave"}',
             'leaders', 'clan.poapkings.com', 'legacy-9.2.0', now())`,
    [CLAN, LEFT_TAG],
  );
  const legacy = (
    await factItems(db, clanSubject, { accountId: agent, ...window })
  ).find((i) => i.kind === "departure_classified" && i.facts.kind === "leave");
  assert.ok(legacy, "a 9.2.0 row follows the type's rule");
  assert.equal(legacy.facts.visibility, "clan");
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
  assert.equal(award.facts.attested_by.app, "Clan");
  assert.equal(award.facts.attested_by.role, "leader");
});

test("Clan's morning run records its computed award standing; a person cannot, and it cannot write a person's kind", async () => {
  // The account Clan's facts were attested by when it wrote through an
  // integration row; Elixir still writes under it (services/jobs clan.mjs).
  const attester = (
    await db.query(
      "insert into account(email_hash,status,role,kind,owned_by_account_id) values ('clan-attester','approved','member','integration',$1) returning account_id",
      [accounts.leader],
    )
  ).rows[0].account_id;
  const system = (body) =>
    answer(() => writeClanFactBySystem(db, attester, CLAN, body));
  const standing = {
    type: "award_standing",
    ref: "standing:136:war_champ:1",
    player_tag: MEMBER_TAG,
    detail: {
      award: "War Champ",
      award_id: "war_champ",
      season_id: 136,
      place: 1,
      value: 6400,
      unit: "points",
      as_of: new Date().toISOString(),
      previous_player_tag: LEFT_TAG,
    },
  };
  const made = await system(standing);
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(data(made).data.attested_by.app, "Clan");
  assert.equal(
    data(made).data.attested_by.player_tag,
    null,
    "Clan's, not a person's",
  );
  assert.equal(data(made).data.visibility, "clan");
  // A newer standing under the same ref replaces it.
  const again = await system({
    ...standing,
    detail: { ...standing.detail, value: 6500 },
  });
  assert.equal(again.statusCode, 200);
  assert.equal(data(again).data.detail.value, 6500);
  // A person's kind is refused on the morning run; Clan's kind as a person.
  const kick = await system({
    type: "departure_classified",
    ref: "k-1",
    player_tag: LEFT_TAG,
    detail: { kind: "kick" },
  });
  assert.equal(data(kick).code, "unknown_fact_type");
  const asPerson = await write(
    { ...standing, ref: "p-1" },
    as(accounts.leader),
  );
  assert.equal(asPerson.statusCode, 403);
  // The clan's agent sees it, in words.
  const window = { fromMs: Date.now() - 86_400_000, toMs: Date.now() + 1000 };
  const agent = (
    await db.query(
      "insert into account(kind,owned_by_account_id,status,role) values ('agent',$1,'approved','member') returning account_id",
      [accounts.leader],
    )
  ).rows[0].account_id;
  const seen = (
    await factItems(db, [{ kind: "clan", tag: CLAN, scope: "activity" }], {
      accountId: agent,
      ...window,
    })
  ).filter((i) => i.kind === "award_standing");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].facts.value, 6500);
  assert.equal(seen[0].facts.previous_name, "gone", "who held first, by name");
  assert.equal(seen[0].facts.attested_by.app, "Clan");
  // A person cannot take it back; the morning run can, by its ref.
  assert.equal(
    (await remove(standing.ref, as(accounts.leader))).statusCode,
    404,
  );
  const gone = await answer(() =>
    removeClanFactBySystem(db, attester, CLAN, standing.ref),
  );
  assert.equal(gone.statusCode, 200, gone.body);
  assert.equal(data(gone).data.removed, true);
});

test("the JSON API has no clan fact doors: a person's grant or a key gets the unknown operation's 404", async () => {
  const grantToken = await grant(accounts.leader, "cr:read");
  const body = {
    type: "departure_classified",
    ref: "door-1",
    player_tag: LEFT_TAG,
    detail: { kind: "leave" },
  };
  for (const [method, path] of [
    ["POST", facts],
    ["DELETE", `${facts}/door-1`],
  ]) {
    const r = await request(
      method,
      path,
      method === "POST" ? body : undefined,
      grantToken,
    );
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(data(r).code, "not_found");
    assert.match(data(r).detail, /No \/api\/v1 operation answers/);
  }
  const { rows } = await db.query(
    "select count(*)::int as n from attested_fact where source_ref = 'door-1'",
  );
  assert.equal(rows[0].n, 0);
});
