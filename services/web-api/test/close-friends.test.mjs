/**
 * Close friends and Your circle this week (Jamie, 2026-11-16), against a
 * real PostgreSQL database. A close friend is the reader's private mark on
 * a friend follow (claim.close, 0281): one tap sets and unsets it; a
 * linked account's Verified players never disagree about it; nobody else
 * ever reads it. The circle tells each close friend's week since Monday's
 * reset, facts only, newest play first. Made-up tags: this repository is
 * public.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { gameWeekStartMs } from "@elixir-mcp/record/form";
import { ensurePassport } from "@elixir-mcp/stamps";
import { makeHandler } from "../src/handler.mjs";
import { circleItems, circleOrder } from "../src/circle.mjs";
import { groupsOf } from "../src/feed.mjs";

const V = "#0YRL2GQP"; // OWNER's primary, verified
const W = "#0UVC8J9R"; // OWNER's alt, verified
const MINE = "#0LCVJ8YR"; // READER's own player
const F = "#0RQYGC2L"; // a friend READER follows, claimed by nobody
const Q = "#0GUQ28PV"; // a friend READER follows who has not played
const WATCHED = "#0QYC9U2P"; // a player READER watches

let scratch, handler, OWNER, READER;
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
  await ensurePassport(scratch.db, id);
  return id;
}
const call = (id, method, path, body, query = {}) =>
  handler({
    path,
    method,
    queryStringParameters: query,
    headers: {
      cookie: `__Host-elixir_session=${sessions.get(id)}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const claim = (account, tag, relationship, verified = false) =>
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
const mark = (reader, tag, on = true) =>
  call(reader, "POST", "/api/claims", {
    player_tag: tag,
    action: on ? "close_on" : "close_off",
  });
const closeOf = async (id) =>
  (
    await scratch.db.query(
      `select player_tag from claim where account_id = $1 and close
        order by player_tag`,
      [id],
    )
  ).rows.map((r) => r.player_tag);

let battleN = 0;
/** One battle of `tag`'s at `atMs`. */
async function battle(tag, atMs, { type = "PvP", boat = null } = {}) {
  const id = `close-${(battleN += 1)}`;
  const at = new Date(atMs).toISOString();
  await scratch.db.query(
    `insert into battle (battle_id, battle_time, type, type_class, boat_battle_side)
     values ($1, $2, $3, 'pvp', $4)`,
    [id, at, type, boat],
  );
  await scratch.db.query(
    `insert into battle_participant
       (battle_id, player_tag, side, battle_time, outcome, type, type_class)
     values ($1, $2, 0, $3, 'win', $4, 'pvp')`,
    [id, tag, at, type],
  );
}

before(async () => {
  scratch = await scratchDb("close_friends");
  const { db } = scratch;
  for (const tag of [V, W, MINE, F, Q, WATCHED])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      `Name ${tag.slice(1, 4)}`,
    ]);
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  OWNER = await person("cf-owner");
  READER = await person("cf-reader");
  await claim(OWNER, V, "primary", true);
  await claim(OWNER, W, "alt", true);
  await claim(READER, MINE, "primary", true);
  await claim(READER, F, "friend");
  await claim(READER, Q, "friend");
  await claim(READER, WATCHED, "watching");
  // OWNER follows the reader back: a follow of the reader's own player.
  await claim(OWNER, MINE, "friend");
});

after(async () => {
  await scratch?.drop();
});

test("with nobody marked, the circle offers the people you follow, follows back first", async () => {
  // Following V links OWNER's account and W (linked follows).
  const f = await call(READER, "POST", "/api/claims", {
    player_tag: V,
    relationship: "friend",
  });
  assert.equal(f.statusCode, 200, f.body);
  const r = await call(READER, "GET", "/api/me/home/circle");
  assert.equal(r.statusCode, 200, r.body);
  const { circle } = data(r);
  assert.equal(circle.ok, true);
  assert.deepEqual(circle.friends, []);
  const tags = circle.suggestions.map((s) => s.tag);
  // OWNER follows the reader back, so both its players come first.
  assert.deepEqual(tags.slice(0, 2).sort(), [V, W].sort());
  assert.ok(circle.suggestions.slice(0, 2).every((s) => s.follows_you));
  // Friends only: never the reader's own player or one it watches.
  assert.ok(!tags.includes(MINE));
  assert.ok(!tags.includes(WATCHED));
  assert.ok(tags.includes(F) && tags.includes(Q));
});

test("one tap marks and unmarks; only a friend follow can be marked", async () => {
  assert.equal((await mark(READER, F)).statusCode, 200);
  assert.deepEqual(await closeOf(READER), [F]);
  assert.equal((await mark(READER, F, false)).statusCode, 200);
  assert.deepEqual(await closeOf(READER), []);
  // Your own player and a watched one are not friends.
  assert.equal((await mark(READER, MINE)).statusCode, 409);
  assert.equal((await mark(READER, WATCHED)).statusCode, 409);
  assert.equal((await mark(READER, "#0PJ8LQ2Y")).statusCode, 404);
  assert.deepEqual(await closeOf(READER), []);
});

test("a linked account's players never disagree about the mark", async () => {
  const r = await mark(READER, V);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(data(r).tags, [V, W].sort());
  assert.deepEqual(await closeOf(READER), [V, W].sort());
  // Unmarking the other one unmarks both.
  await mark(READER, W, false);
  assert.deepEqual(await closeOf(READER), []);
  await mark(READER, W);
  assert.deepEqual(await closeOf(READER), [V, W].sort());
});

test("the mark is the reader's alone: never on another reader's page or the owner's", async () => {
  const mine = data(await call(READER, "GET", "/api/me"));
  assert.equal(mine.claims.find((c) => c.player_tag === V).close, true);
  const page = data(
    await call(READER, "GET", "/api/player", null, { tag: V }),
  );
  assert.equal(page.you?.close, true);
  // The marked player's own account reads its page, its account page, its
  // bell and its activity: not a word of the mark.
  for (const [path, q] of [
    ["/api/player", { tag: V }],
    ["/api/player", { tag: MINE }],
    ["/api/me/bell", {}],
    ["/api/me/activity", {}],
  ]) {
    const r = await call(OWNER, "GET", path, null, q);
    assert.ok(!/"close"\s*:\s*true/.test(r.body), `${path} carries the mark`);
  }
  // No account event names it, for either side.
  const { rows } = await scratch.db.query(
    `select kind from account_event where kind ilike '%close%'`,
  );
  assert.equal(rows.length, 0);
});

test("a friend made a watched player loses the mark with the friendship", async () => {
  await mark(READER, F);
  const r = await call(READER, "POST", "/api/claims", {
    player_tag: F,
    action: "relationship",
    relationship: "watching",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!(await closeOf(READER)).includes(F));
  await call(READER, "POST", "/api/claims", {
    player_tag: F,
    action: "relationship",
    relationship: "friend",
  });
});

test("the circle tells this week's battles and days, newest play first, a quiet friend as such", async () => {
  await mark(READER, F);
  await mark(READER, Q);
  const now = Date.now();
  const monday = gameWeekStartMs(now);
  // F played twice this week, and once last week (not counted); a boat
  // defense is not their battle.
  await battle(F, monday + 60_000);
  await battle(F, now - 5 * 60_000);
  await battle(F, monday - 3_600_000);
  await battle(F, now - 4 * 60_000, { type: "boatBattle", boat: "defender" });
  // V played once, longer ago this week than F's last.
  await battle(V, monday + 30_000);
  const r = await call(READER, "GET", "/api/me/home/circle");
  assert.equal(r.statusCode, 200, r.body);
  const { circle } = data(r);
  assert.equal(circle.from, new Date(monday).toISOString());
  const order = circle.friends.map((f) => f.tag);
  // Played, newest first; then who did not play, by name.
  assert.deepEqual(order.slice(0, 2), [F, V]);
  assert.deepEqual(order.slice(2).sort(), [Q, W].sort());
  const f = circle.friends.find((x) => x.tag === F);
  assert.equal(f.battles, 2);
  assert.ok(f.days >= 1 && f.days <= 2);
  const q = circle.friends.find((x) => x.tag === Q);
  assert.equal(q.battles, 0);
  assert.equal(q.last_battle_at, null);
  assert.equal(q.sittings, null);
  // Never a rate, a record or a score.
  assert.ok(!/"wins"|"losses"|"rate"|"score"/.test(r.body));
});

test("the circle is gated as its neighbours", async () => {
  const r = await handler({
    path: "/api/me/home/circle",
    method: "GET",
    queryStringParameters: {},
    headers: { "x-elixir-client": "web" },
  });
  assert.equal(r.statusCode, 401);
});

test("the feed's chips: a close friend's item sits under close too", () => {
  const subjects = [
    { tag: MINE, kind: "player", relationship: "primary" },
    { tag: F, kind: "player", relationship: "friend" },
  ];
  const item = { subject_tag: F, subjects: [{ tag: F }] };
  assert.deepEqual(groupsOf(item, subjects), ["friends"]);
  assert.deepEqual(groupsOf(item, subjects, new Set([F])), [
    "friends",
    "close",
  ]);
});

test("circleItems counts a friend's sittings and keeps two moments, newest first", () => {
  const from = Date.parse("2026-11-16T10:00:00Z");
  const at = (h) => new Date(from + h * 3_600_000).toISOString();
  const items = [
    {
      id: "s1",
      kind: "battle_session",
      sort_at: at(1),
      subject_tag: F,
      subjects: [{ tag: F, kind: "player" }],
      facts: { player_tag: F, started_at: at(0.5) },
      evidence: { kind: "session" },
    },
    {
      id: "s2",
      kind: "battle_session",
      sort_at: at(5),
      subject_tag: F,
      // A 2v2 sitting names its partner: it is F's, not Q's.
      subjects: [
        { tag: F, kind: "player" },
        { tag: Q, kind: "player" },
      ],
      facts: { player_tag: F, started_at: at(4) },
      evidence: { kind: "session" },
    },
    {
      id: "old",
      kind: "battle_session",
      sort_at: at(-2),
      subject_tag: F,
      subjects: [{ tag: F, kind: "player" }],
      facts: { player_tag: F },
    },
    ...[1, 2, 3].map((n) => ({
      id: `m${n}`,
      kind: "arena_promotion",
      sort_at: at(n),
      subject_tag: F,
      subjects: [{ tag: F, kind: "player" }],
      text: `moment ${n}`,
    })),
    {
      id: "h",
      kind: "battle_highlight",
      sort_at: at(6),
      subject_tag: F,
      subjects: [{ tag: F, kind: "player" }],
      text: "a highlight",
    },
  ];
  const out = circleItems(items, new Set([F, Q]), from);
  assert.equal(out.get(F).sittings, 2);
  assert.deepEqual(out.get(F).session, { id: "s2", started_at: at(4) });
  assert.deepEqual(
    out.get(F).moments.map((m) => m.text),
    ["moment 3", "moment 2"],
  );
  assert.equal(out.get(Q).sittings, 0);
});

test("circleOrder: newest play first, then the quiet ones by name", () => {
  const rows = [
    { tag: "a", name: "Zed", last_battle_at: null },
    { tag: "b", name: "Amy", last_battle_at: "2026-11-16T12:00:00Z" },
    { tag: "c", name: "Bo", last_battle_at: null },
    { tag: "d", name: "Cy", last_battle_at: "2026-11-17T12:00:00Z" },
  ];
  assert.deepEqual(
    [...rows].sort(circleOrder).map((r) => r.name),
    ["Cy", "Amy", "Bo", "Zed"],
  );
});
