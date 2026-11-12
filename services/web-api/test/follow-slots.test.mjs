/**
 * Your follow slots (Settings › What members see, 2026-11-12), against a
 * real PostgreSQL database. The page's meter must say what every Follow
 * dialog says: `used` here is follow-cost's `used`, and the rows that use a
 * slot are exactly that many. Each row names who in the reader's own pool
 * follows the player; nothing names another account.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { pooledFollows, pooledUsage } from "@elixir-mcp/claims";
import { makeHandler } from "../src/handler.mjs";

// Made-up tags: this repository is public.
const OWN = "#PQ2Y8LV0"; // the reader's main player, in no recorded clan
const PAID = "#PQ2Y8LV2"; // the reader follows; nobody else does
const SHARED = "#PQ2Y8LV8"; // the reader follows; the agent tracks too
const CLANNED = "#PQ2Y8LVC"; // in a clan recorded in full
const FIRST = "#PQ2Y8LVG"; // another account followed first
const WATCHED = "#PQ2Y8LVJ"; // the reader only watches
const AGENTS = "#PQ2Y8LVL"; // only the reader's agent tracks
const OTHERS = "#PQ2Y8LVR"; // only the other account follows
const CLAN = "#PQ2Y8LVU";
const OTHER_EMAIL = "other-account-hash";

let scratch, handler, reader, other, agent;
const sessions = new Map();
const data = (r) => JSON.parse(r.body);

async function person(hash) {
  const id = (
    await scratch.db.query(
      "insert into account(email_hash,status) values ($1,'approved') returning account_id",
      [hash],
    )
  ).rows[0].account_id;
  const { token } = await createSession(scratch.db, {
    secret: "test",
    accountId: id,
    emailHash: hash,
  });
  sessions.set(id, token);
  return id;
}
const call = (id, method, path, body) =>
  handler({
    path: path.split("?")[0],
    method,
    queryStringParameters: Object.fromEntries(
      new URLSearchParams(path.split("?")[1] ?? ""),
    ),
    headers: {
      ...(id ? { cookie: `__Host-elixir_session=${sessions.get(id)}` } : {}),
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const claim = (account, tag, relationship, at = "now()") =>
  scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,created_at)
     values ($1,$2,'unverified',$3,$4,${at})`,
    [account, tag, relationship === "primary", relationship],
  );

before(async () => {
  scratch = await scratchDb("follow_slots");
  const { db } = scratch;
  for (const [tag, name] of [
    [OWN, "Oakmoss"],
    [PAID, "Pinecone"],
    [SHARED, "Sorrel"],
    [CLANNED, "Clover"],
    [FIRST, "Fennel"],
    [WATCHED, "Wren"],
    [AGENTS, "Aster"],
    [OTHERS, "Osier"],
  ])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  reader = await person("slots-reader");
  other = await person(OTHER_EMAIL);
  agent = (
    await db.query(
      "insert into account(kind,owned_by_account_id,status,role,public_id) values ('agent',$1,'approved','member','agslots1') returning account_id",
      [reader],
    )
  ).rows[0].account_id;
  await db.query(
    "insert into service_token(account_id,name,token_hash) values ($1,'Scout Bot','not-a-real-hash')",
    [agent],
  );
  // A clan recorded in full, with CLANNED open on its roster.
  await db.query("insert into clan(clan_tag,name) values ($1,'Grove')", [CLAN]);
  await db.query(
    `insert into recording(subject_type,subject_tag,requested_by,origin,scope)
     values ('clan',$1,$2,'claim','comprehensive')`,
    [CLAN, other],
  );
  await db.query(
    `insert into clan_membership(clan_tag,player_tag,joined_observed_at)
     values ($1,$2,now())`,
    [CLAN, CLANNED],
  );
  // The other account follows FIRST before the reader does, and OTHERS.
  await claim(other, FIRST, "friend", "now() - interval '1 day'");
  await claim(other, OTHERS, "friend");
  await claim(reader, OWN, "primary");
  await claim(reader, PAID, "friend");
  await claim(reader, SHARED, "friend");
  await claim(reader, CLANNED, "friend");
  await claim(reader, FIRST, "friend");
  await claim(reader, WATCHED, "watching");
  await claim(agent, SHARED, "watching");
  await claim(agent, AGENTS, "watching");
});
after(async () => scratch?.drop());

test("the slot meter wants a signed-in person", async () => {
  assert.equal(
    (await call(null, "GET", "/api/me/follow-slots")).statusCode,
    401,
  );
});

test("the meter's numbers are the Follow dialogs' numbers, player by player", async () => {
  const r = await call(reader, "GET", "/api/me/follow-slots");
  assert.equal(r.statusCode, 200, r.body);
  const slots = data(r);
  const cost = data(await call(reader, "GET", "/api/me/follow-cost"));
  assert.equal(slots.used, cost.used, "the meter and a Follow agree");
  assert.equal(slots.limit, cost.limit);
  assert.equal(
    slots.players.filter((p) => p.slot === "used").length,
    slots.used,
    "the rows that use a slot are the count",
  );
  assert.equal(
    slots.players.filter((p) => p.slot === "free").length,
    slots.free,
  );
  const row = Object.fromEntries(slots.players.map((p) => [p.player_tag, p]));
  assert.deepEqual(
    Object.keys(row).sort(),
    [OWN, PAID, SHARED, CLANNED, FIRST, WATCHED, AGENTS].sort(),
    "the pool's players, once each, and nobody only another account follows",
  );
  assert.deepEqual(
    Object.fromEntries(
      slots.players.map((p) => [p.player_tag, [p.slot, p.reason, p.yours]]),
    ),
    {
      [OWN]: ["used", null, "primary"],
      [PAID]: ["used", null, "friend"],
      [SHARED]: ["used", null, "friend"],
      [CLANNED]: ["free", "in_recorded_clan", "friend"],
      [FIRST]: ["free", "followed_by_others", "friend"],
      [WATCHED]: ["used", null, "watching"],
      [AGENTS]: ["used", null, null],
    },
  );
  assert.equal(slots.used, 5);
  assert.equal(row[PAID].name, "Pinecone");
  // The reader's agent, by its name; the other account, never.
  assert.deepEqual(row[AGENTS].agents, [
    { public_id: "agslots1", name: "Scout Bot", relationship: "watching" },
  ]);
  assert.deepEqual(
    row[SHARED].agents.map((a) => a.name),
    ["Scout Bot"],
  );
  assert.deepEqual(row[FIRST].agents, []);
  assert.ok(!r.body.includes(other), "no other account's id");
  assert.ok(!r.body.includes(OTHER_EMAIL));
  assert.ok(!r.body.includes(OTHERS), "nobody only another account follows");
  assert.ok(!r.body.includes("account_id"), "no account ids at all");
});

test("pooledFollows prices what pooledUsage counts, for the agent's view too", async () => {
  const rows = await pooledFollows(scratch.db, reader);
  const usage = await pooledUsage(scratch.db, reader);
  assert.equal(rows.filter((r) => !r.free).length, usage.players_used);
  assert.equal(rows.filter((r) => r.free).length, usage.players_free);
  assert.equal(rows.length, usage.players_followed);
  // The agent spends its owner's slots: its own read is the same pool.
  const r = await call(reader, "GET", "/api/me/follow-slots");
  assert.equal(data(r).used, usage.players_used);
});

test("stopping a follow frees its slot at once, and both reads say so", async () => {
  const before = data(await call(reader, "GET", "/api/me/follow-slots"));
  const stop = await call(reader, "POST", "/api/claims", {
    player_tag: PAID,
    action: "remove",
  });
  assert.equal(stop.statusCode, 200, stop.body);
  const after = data(await call(reader, "GET", "/api/me/follow-slots"));
  const cost = data(await call(reader, "GET", "/api/me/follow-cost"));
  assert.equal(after.used, before.used - 1);
  assert.equal(after.used, cost.used);
  assert.ok(!after.players.some((p) => p.player_tag === PAID));
  // A follow the agent also tracks keeps its slot when the reader stops.
  await call(reader, "POST", "/api/claims", {
    player_tag: SHARED,
    action: "remove",
  });
  const shared = data(await call(reader, "GET", "/api/me/follow-slots"));
  const row = shared.players.find((p) => p.player_tag === SHARED);
  assert.deepEqual([row.slot, row.yours], ["used", null]);
  assert.equal(shared.used, after.used);
});
