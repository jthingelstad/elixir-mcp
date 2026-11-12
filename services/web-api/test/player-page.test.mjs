/**
 * The player page and its follows (slice 6, #764), against a real PostgreSQL
 * database. The page shows what DECISIONS "What is public about an account"
 * makes public and nothing past it: follows, followers and badges only for a
 * player an account verified, game names and tags only, never a nickname or
 * a Discord username. A follow of several players is priced first and
 * refused whole past the limit.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { followAllRefusal, followPlan, tagsOf } from "../src/routes/player.mjs";

// Made-up tags: this repository is public.
const A = "#PQ2Y8LV0"; // verified by X
const B = "#PQ2Y8LV2"; // X follows
const D = "#PQ2Y8LV8"; // Y's own, verified
const E = "#PQ2Y8LVC"; // the reader's own
const U = "#PQ2Y8LVG"; // nobody's
const N1 = "#PQ2Y8LVJ";
const N2 = "#PQ2Y8LVL";
const CLAN = "#PQ2Y8LVR";
const NICK = "Pet Name Nobody Else Sees";
const DISCORD = "secret_discord_handle";

let scratch, handler, X, Y, Z, R;
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
const call = (id, method, path, body, { contract = true } = {}) =>
  handler({
    path: path.split("?")[0],
    method,
    queryStringParameters: Object.fromEntries(
      new URLSearchParams(path.split("?")[1] ?? ""),
    ),
    headers: {
      ...(id ? { cookie: `__Host-elixir_session=${sessions.get(id)}` } : {}),
      ...(contract ? { "x-elixir-client": "web" } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const claim = (account, tag, relationship, { verified = false } = {}) =>
  scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      account,
      tag,
      verified ? "verified" : "unverified",
      relationship === "primary",
      relationship,
      verified ? new Date() : null,
    ],
  );

before(async () => {
  scratch = await scratchDb("player_page");
  const { db } = scratch;
  for (const [tag, name] of [
    [A, "Alder"],
    [B, "Birch"],
    [D, "Dogwood"],
    [E, "Elm"],
    [U, "Umber"],
    [N1, "Nettle"],
    [N2, "Nutmeg"],
  ])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
  await db.query("insert into clan(clan_tag,name) values ($1,'Grove')", [CLAN]);
  await db.query(
    `insert into clan_membership(clan_tag,player_tag,joined_observed_at)
     values ($1,$2,now()), ($1,$3,now()), ($1,$4,now())`,
    [CLAN, A, N1, N2],
  );
  await db.query(
    `insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,battle_count,trophies,profile_observed_at,observed_at)
     values ($1,'2026-11-01','daily',10,7000,now(),now()),
            ($1,'2026-11-10','daily',12,7400,now(),now())`,
    [A],
  );
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test" });

  X = await person("player-x");
  Y = await person("player-y");
  Z = await person("player-z");
  R = await person("player-reader");
  await claim(X, A, "primary", { verified: true });
  await claim(X, B, "friend");
  await claim(X, U, "watching");
  await claim(Y, D, "primary", { verified: true });
  await claim(Y, A, "friend");
  await claim(Z, A, "friend");
  await claim(R, E, "primary");
  await db.query(
    "insert into account_discord(account_id,discord_user_id,username) values ($1,'123456789012345678',$2)",
    [X, DISCORD],
  );
  // Nicknames are the account's own and never reach the page, the
  // reader's included.
  for (const acct of [X, Y, R])
    await db.query(
      "insert into player_nickname(account_id,player_tag,nickname) values ($1,$2,$3)",
      [acct, acct === X ? B : A, NICK],
    );
});
after(async () => scratch?.drop());

test("tagsOf: a Follow me link's tags, normalized, once each, or nothing", () => {
  assert.deepEqual(tagsOf("pq2y8lv0, #PQ2Y8LV2,PQ2Y8LV0"), [A, B]);
  assert.equal(tagsOf(""), null);
  assert.equal(tagsOf("PQ2Y8LV0,not a tag"), null, "never part of a link");
});

test("every route wants a signed-in person", async () => {
  for (const [m, p] of [
    ["GET", `/api/player?tag=${encodeURIComponent(A)}`],
    ["GET", `/api/me/follow-plan?player_tags=${encodeURIComponent(A)}`],
    ["POST", "/api/me/follow-all"],
  ])
    assert.equal(
      (await call(null, m, p, { player_tags: [A] })).statusCode,
      401,
    );
});

test("a verified player's page: record, badges, follows and followers by game name, nothing private", async () => {
  const r = await call(R, "GET", `/api/player?tag=${encodeURIComponent(A)}`);
  assert.equal(r.statusCode, 200, r.body);
  const page = data(r);
  assert.deepEqual(page.player, {
    tag: A,
    name: "Alder",
    clan_tag: CLAN,
    clan_name: "Grove",
    trophies: 7400,
    recorded: false,
  });
  assert.deepEqual(page.badges, { verified_player: true, discord: true });
  assert.deepEqual(page.you, {
    own: false,
    following: false,
    relationship: null,
    clanmate: null,
  });
  // Follows are the account's friends, never what it only watches.
  assert.deepEqual(page.follows, {
    count: 1,
    players: [{ tag: B, name: "Birch" }],
  });
  // Y is named by the player Y verified; Z has none and is counted.
  assert.deepEqual(page.followers, {
    count: 2,
    players: [{ tag: D, name: "Dogwood" }],
    unnamed: 1,
  });
  for (const k of ["timeline", "moments", "highlights"])
    assert.ok(Array.isArray(page[k]), k);
  assert.equal(page.window_days, 30);
  assert.ok(!r.body.includes(NICK), "no nickname, the reader's included");
  assert.ok(!r.body.includes(DISCORD), "that a Discord is linked, never which");
  assert.ok(!r.body.includes("email"), "no email field");
});

test("a player no account verified shows no follows, followers or badges", async () => {
  const page = data(
    await call(R, "GET", `/api/player?tag=${encodeURIComponent(U)}`),
  );
  assert.deepEqual(page.badges, { verified_player: false, discord: false });
  assert.equal(page.follows, null);
  assert.equal(page.followers, null);
});

test("the reader's own player says so; a followed one says so", async () => {
  const own = data(
    await call(R, "GET", `/api/player?tag=${encodeURIComponent(E)}`),
  );
  assert.equal(own.you.own, true);
  assert.equal(own.you.relationship, "own");
  const followed = data(
    await call(Y, "GET", `/api/player?tag=${encodeURIComponent(A)}`),
  );
  assert.equal(followed.you.following, true);
  assert.equal(followed.you.relationship, "friend");
});

test("a bad tag is a 400 and an unrecorded one a 404 that says so", async () => {
  assert.equal((await call(R, "GET", "/api/player?tag=nope")).statusCode, 400);
  const missing = await call(R, "GET", "/api/player?tag=%2389PQ2Y8L");
  assert.equal(missing.statusCode, 404);
  assert.equal(data(missing).message, "Elixir has not recorded that player.");
});

test("a plan prices each player and leaves the reader's own out", async () => {
  const plan = await followPlan(scratch.db, R, [E, A, N1]);
  assert.deepEqual(plan.yours, [E]);
  assert.deepEqual(
    plan.players.map((p) => [p.player_tag, p.following, p.free, p.reason]),
    [
      // Others follow A already, so following A is free.
      [A, false, true, "followed_by_others"],
      [N1, false, false, null],
    ],
  );
  assert.equal(plan.to_follow, 2);
  assert.equal(plan.free, 1);
  assert.equal(plan.slots, 1);
  assert.equal(typeof plan.fits, "boolean");
});

test("the plan route names a clan's members, and a bad tag is a 400", async () => {
  const r = await call(
    R,
    "GET",
    `/api/me/follow-plan?clan_tag=${encodeURIComponent(CLAN)}`,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(data(r).clan_tag, CLAN);
  assert.deepEqual(
    data(r)
      .players.map((p) => p.player_tag)
      .sort(),
    [A, N1, N2],
  );
  assert.equal(
    (await call(R, "GET", "/api/me/follow-plan?player_tags=zz")).statusCode,
    400,
  );
});

test("follow-all past the limit is refused whole, saying why; within it, everyone is followed", async () => {
  // The reader's own player takes one of two slots; two fresh players
  // need two.
  await scratch.db.query(
    "update account set max_player_recordings = 2 where account_id = $1",
    [R],
  );
  const refused = await call(R, "POST", "/api/me/follow-all", {
    player_tags: [N1, N2],
  });
  assert.equal(refused.statusCode, 429, refused.body);
  assert.equal(data(refused).error, "quota_exceeded");
  assert.equal(
    data(refused).message,
    followAllRefusal({ slots: 2, used: 1, limit: 2 }),
  );
  const none = await scratch.db.query(
    "select 1 from claim where account_id = $1 and player_tag = any($2)",
    [R, [N1, N2]],
  );
  assert.equal(none.rows.length, 0, "nobody followed");

  // A write needs the contract header, as every web write does.
  const bare = await call(
    R,
    "POST",
    "/api/me/follow-all",
    { player_tags: [N1] },
    { contract: false },
  );
  assert.equal(bare.statusCode, 401);

  await scratch.db.query(
    "update account set max_player_recordings = 5 where account_id = $1",
    [R],
  );
  const ok = await call(R, "POST", "/api/me/follow-all", {
    player_tags: [A, N1, N2],
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(data(ok).followed, [A, N1, N2]);
  const { rows } = await scratch.db.query(
    "select player_tag, relationship, is_primary from claim where account_id = $1 and player_tag = any($2) order by player_tag",
    [R, [A, N1, N2]],
  );
  assert.deepEqual(
    rows.map((r) => [r.player_tag, r.relationship, r.is_primary]),
    [A, N1, N2].sort().map((t) => [t, "friend", false]),
  );
  // Following again changes nothing.
  const again = await call(R, "POST", "/api/me/follow-all", {
    player_tags: [A, N1],
  });
  assert.deepEqual(data(again).followed, []);
});

test("the refusal's words count what is left", () => {
  assert.match(
    followAllRefusal({ slots: 3, used: 4, limit: 5 }),
    /needs 3 player slots and 1 of your 5 is left \(4 in use\)\. Nobody was followed\./,
  );
});
