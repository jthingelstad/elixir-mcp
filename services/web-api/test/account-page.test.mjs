/**
 * Account pages and account follows (Jamie, 2026-11-15), against a real
 * PostgreSQL database. A player is Imported, Claimed or Verified; a Claimed
 * player's page names the account claiming it; an account's page shows the
 * players it claims or verified, its Stamps and the combined timeline of
 * its players and its own news; and following an account brings that news
 * to Home. Verifying a player is the news that matters most: nobody else
 * can claim it then.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makeHandler as makeGameConsumer } from "../../timeline-sync/src/handler.mjs";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { playerIdentityStates } from "@elixir-mcp/auth/player-identities";
import { ensurePassport } from "@elixir-mcp/stamps";
import { buildTimeline } from "@elixir-mcp/tools/activity/entries";
import { makeHandler } from "../src/handler.mjs";
import { claimantsOf } from "../src/account-page.mjs";

// Made-up tags: this repository is public.
const V = "#0VRGQ2YC"; // verified by MAIN, its primary
const ALT = "#0J8RLG2V"; // MAIN's alt, claimed
const C = "#0CYQ8UUL"; // claimed by OTHER and by THIRD, never verified
const I = "#0QPG29LR"; // imported: followed, claimed by nobody
const DISCORD = "secret_discord_handle";
const NICK = "Pet Name Nobody Else Sees";

let scratch, handler, MAIN, OTHER, THIRD, READER;
const sessions = new Map();
const pageIds = new Map();
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
  pageIds.set(id, (await ensurePassport(scratch.db, id)).passport_id);
  return id;
}
const call = (id, method, path, body) =>
  handler({
    path,
    method,
    queryStringParameters: {},
    headers: {
      cookie: `__Host-elixir_session=${sessions.get(id)}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const claim = (account, tag, relationship, { verifiedAt = null } = {}) =>
  scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      account,
      tag,
      verifiedAt ? "verified" : "unverified",
      relationship === "primary",
      relationship,
      verifiedAt,
    ],
  );

before(async () => {
  scratch = await scratchDb("account_page");
  const { db } = scratch;
  for (const [tag, name] of [
    [V, "Valerian"],
    [ALT, "Aster"],
    [C, "Clover"],
    [I, "Iris"],
  ])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  MAIN = await person("acct-main");
  OTHER = await person("acct-other");
  THIRD = await person("acct-third");
  READER = await person("acct-reader");
  await claim(MAIN, V, "primary", {
    verifiedAt: new Date(Date.now() - 3_600_000),
  });
  await claim(MAIN, ALT, "alt");
  await claim(OTHER, C, "primary");
  await claim(THIRD, C, "alt");
  await claim(READER, I, "friend");
  await claim(READER, V, "friend");
  await db.query(
    "insert into player_nickname(account_id,player_tag,nickname) values ($1,$2,$3)",
    [READER, V, NICK],
  );
  await db.query(
    "insert into account_discord(account_id,discord_user_id,username) values ($1,'123456789012345678',$2)",
    [MAIN, DISCORD],
  );
  // A Stamp MAIN earned live an hour ago, and one the launch backfill
  // granted (legacy grants are not news).
  await db.query(
    `insert into account_stamp_earned(account_id,stamp_id,level,earned_at,earned_on,definition_version)
     values ($1,'player_verified',1,now() - interval '1 hour',current_date,1)`,
    [MAIN],
  );
  await db.query(
    `insert into account_stamp_earned(account_id,stamp_id,level,earned_at,definition_version,legacy_before,legacy_source_to)
     values ($1,'linked',1,now() - interval '2 hours',1,current_date,now())`,
    [MAIN],
  );
  await db.query(
    "insert into account_event(account_id,kind,detail) values ($1,'place_set','{}')",
    [MAIN],
  );
});

after(async () => {
  await scratch?.drop();
});

test("a player is Verified, Claimed or Imported, in one statement", async () => {
  let statements = 0;
  const db = {
    query: (...a) => {
      statements += 1;
      return scratch.db.query(...a);
    },
  };
  const states = await playerIdentityStates(db, [V, ALT, C, I]);
  assert.equal(statements, 1);
  assert.equal(states.get(V), "verified");
  assert.equal(states.get(ALT), "claimed");
  assert.equal(states.get(C), "claimed");
  // A friend's follow is not a claim: Imported.
  assert.equal(states.has(I), false);
});

test("a Claimed player names every account claiming it; a Verified one only its verifier", async () => {
  const claimed = await claimantsOf(scratch.db, C);
  assert.deepEqual(
    claimed.map((c) => [c.id, c.verified, c.relationship]),
    [
      [pageIds.get(OTHER), false, "primary"],
      [pageIds.get(THIRD), false, "alt"],
    ],
  );
  const verified = await claimantsOf(scratch.db, V);
  assert.deepEqual(
    verified.map((c) => [c.id, c.verified]),
    [[pageIds.get(MAIN), true]],
  );
  // An alt's claimant is named by the player it is.
  const alt = await claimantsOf(scratch.db, ALT);
  assert.deepEqual(alt[0].player, { tag: V, name: "Valerian", verified: true });
  // Imported: nobody.
  assert.deepEqual(await claimantsOf(scratch.db, I), []);
});

test("the player page carries its claimants by page id", async () => {
  const page = await handler({
    path: "/api/player",
    method: "GET",
    queryStringParameters: { tag: C },
    headers: {
      cookie: `__Host-elixir_session=${sessions.get(READER)}`,
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
  });
  assert.equal(page.statusCode, 200, page.body);
  const body = data(page);
  assert.deepEqual(
    body.claimants.map((c) => c.id),
    [pageIds.get(OTHER), pageIds.get(THIRD)],
  );
  assert.equal(body.player_claims[C], true);
  assert.equal(body.player_verifications[C], false);
});

test("an account's page shows its players, badges, Stamps and news, and nothing private", async () => {
  const r = await call(READER, "GET", `/api/accounts/${pageIds.get(MAIN)}`);
  assert.equal(r.statusCode, 200, r.body);
  const page = data(r);
  assert.equal(page.account.id, pageIds.get(MAIN));
  assert.equal(page.account.name, "Valerian");
  assert.equal(page.account.state, "verified");
  assert.deepEqual(
    page.account.players.map((p) => [p.tag, p.relationship, p.state]),
    [
      [V, "primary", "verified"],
      [ALT, "alt", "claimed"],
    ],
  );
  assert.deepEqual(page.account.badges, {
    verified_player: true,
    discord: true,
  });
  assert.equal(page.you.self, false);
  assert.equal(page.you.following, false);
  // READER follows V already: a Follow adds no player (linked follows).
  assert.deepEqual(page.you.to_follow, []);
  assert.ok(page.passport, "the account's passport rides along");
  const kinds = page.timeline.map((it) => it.kind).sort();
  assert.deepEqual(kinds, ["place_set", "player_verified", "stamp_earned"]);
  const stamp = page.timeline.find((it) => it.kind === "stamp_earned");
  assert.deepEqual(
    stamp.facts.stamps.map((s) => s.stamp_id),
    ["player_verified"],
    "a legacy grant is not news",
  );
  const verified = page.timeline.find((it) => it.kind === "player_verified");
  assert.match(verified.text, /Nobody else can claim/);
  assert.equal(verified.facts.account_id, pageIds.get(MAIN));
  // Never an email hash, a Discord username, a nickname or an account UUID.
  for (const secret of [DISCORD, NICK, "acct-main", MAIN])
    assert.ok(!r.body.includes(secret), `the page leaks ${secret}`);
});

test("an unknown, malformed or agent page id is not found", async () => {
  for (const id of ["abcdefghjkmn", "not-an-id", MAIN]) {
    const r = await call(READER, "GET", `/api/accounts/${id}`);
    assert.equal(r.statusCode, 404, id);
  }
});

test("following an account: yourself refused, idempotent, counted, undone", async () => {
  const self = await call(READER, "POST", "/api/me/account-follows", {
    id: pageIds.get(READER),
  });
  assert.equal(self.statusCode, 400);
  for (let i = 0; i < 2; i++) {
    const r = await call(READER, "POST", "/api/me/account-follows", {
      id: pageIds.get(MAIN),
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(data(r), {
      ok: true,
      following: true,
      followed: [],
      skipped: [],
    });
  }
  const events = await scratch.db.query(
    "select detail from account_event where account_id = $1 and kind = 'account_followed'",
    [READER],
  );
  assert.equal(events.rows.length, 1, "a second follow logs nothing");
  assert.equal(events.rows[0].detail.account_id, pageIds.get(MAIN));
  const page = data(
    await call(READER, "GET", `/api/accounts/${pageIds.get(MAIN)}`),
  );
  assert.equal(page.you.following, true);
  assert.equal(page.account.followers, 1);
  const own = data(
    await call(READER, "GET", `/api/accounts/${pageIds.get(READER)}`),
  );
  assert.equal(own.you.self, true);
  assert.equal(own.account.following_accounts, 1);
  // Home's week now carries MAIN's news, and the follow rebuilt it.
  const home = await call(READER, "GET", "/api/me/home/feed");
  assert.equal(home.statusCode, 200, home.body);
  const items = data(home).timeline;
  assert.ok(
    items.some((it) => it.kind === "stamp_earned"),
    "a followed account's Stamp reaches Home",
  );
  assert.ok(
    items.every((it) => it.section !== "people" || !it.cheers?.can_cheer),
    "people items take no cheer",
  );
  const off = await call(
    READER,
    "DELETE",
    `/api/me/account-follows/${pageIds.get(MAIN)}`,
  );
  assert.equal(off.statusCode, 200, off.body);
  // Linked follows: unfollowing the account unfollows its Verified
  // player V, which READER followed.
  assert.deepEqual(data(off), { ok: true, following: false, unfollowed: [V] });
  const missing = await call(READER, "POST", "/api/me/account-follows", {
    id: "abcdefghjkmn",
  });
  assert.equal(missing.statusCode, 404);
});

test("the timeline tool's reads serve no people item", async () => {
  // MCP, the digest, RSS and Discord build without `people`.
  const built = await buildTimeline(
    scratch.db,
    [{ kind: "player", tag: V, relationship: "friend", nickname: null }],
    {
      fromMs: Date.now() - 86_400_000,
      toMs: Date.now(),
      timezone: "UTC",
      accountId: READER,
      basis: "occurred",
    },
  );
  assert.deepEqual(
    (built.timeline ?? []).filter((it) => it.section === "people"),
    [],
  );
  // The same read asking for people items gets V's verification, because
  // the reader follows V.
  const withPeople = await buildTimeline(
    scratch.db,
    [{ kind: "player", tag: V, relationship: "friend", nickname: null }],
    {
      fromMs: Date.now() - 86_400_000,
      toMs: Date.now(),
      timezone: "UTC",
      accountId: READER,
      basis: "occurred",
      people: { accounts: [], players: true },
    },
  );
  assert.deepEqual(
    withPeople.timeline
      .filter((it) => it.section === "people")
      .map((it) => it.kind),
    ["player_verified"],
  );
});

test("a queued Drop game reaches only its player's audience and retries never double-count it", async () => {
  const follower = await person("drop-game-follower");
  await claim(follower, V, "friend");
  const queue = "arn:aws:sqs:us-east-1:000000000000:elixir-drop-games";
  const at = new Date(Date.now() - 60000).toISOString();
  const game = {
    version: 1,
    type: "drop.game.completed",
    accountId: MAIN,
    playerTag: V,
    gameId: randomUUID(),
    mode: "exact-ten",
    startedAt: at,
    completedAt: at,
    score: 10,
    answers: 1,
    cards: [
      { id: 26000000, name: "Knight", cost: 3, reason: "solution" },
      { id: 26000020, name: "Giant Skeleton", cost: 6, reason: "solution" },
      { id: 26000010, name: "Skeletons", cost: 1, reason: "solution" },
    ],
  };
  const consumer = makeGameConsumer({
    dropGamesQueueArn: queue,
    connect: async () => ({
      query: scratch.db.query.bind(scratch.db),
      end: async () => {},
    }),
  });
  const record = (id, payload) => ({
    eventSourceARN: queue,
    messageId: id,
    body: JSON.stringify(payload),
  });
  const result = await consumer({
    Records: [
      record("first", game),
      record("retry", game),
      record("second", { ...game, gameId: randomUUID() }),
      record("wrong-owner", {
        ...game,
        gameId: randomUUID(),
        accountId: OTHER,
      }),
      record("malformed", { ...game, version: 99 }),
    ],
  });
  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "malformed" }],
  });
  for (const [reader, expected] of [
    [MAIN, 2],
    [follower, 2],
    [OTHER, 0],
  ]) {
    const response = await call(
      reader,
      "GET",
      `/api/accounts/${pageIds.get(MAIN)}`,
    );
    assert.equal(response.statusCode, 200, response.body);
    const items = data(response).timeline.filter((i) => i.kind === "drop_game");
    assert.equal(items.length, expected);
    for (const item of items) {
      assert.deepEqual(item.facts.cards, game.cards);
      assert.match(
        item.text,
        /Knight \(3\).*Giant Skeleton \(6\).*Skeletons \(1\)/,
      );
      assert.equal(item.publishable, false);
      assert.ok(!JSON.stringify(item).includes(MAIN));
    }
  }
});
