/**
 * Home's starter set (2026-11-13): who a new account is offered to follow,
 * from facts Elixir already has. Pinned here: the order (clanmates Elixir
 * records already, free; then friendly-battle opponents, 2v2 teammates and
 * clanmates battled in clan chat; then the most recently active clanmates),
 * the cap on players that would take a slot, every row's reason and cost,
 * game names only, never a player the account claims, and the offer on
 * every visit while the account follows fewer than five players, unless
 * "Not now" was said in the last 30 days.
 * Nothing here follows anyone. Invented names and tags throughout.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_starter_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

const OWN = "#00092VJ2";
const CLAN = "#0U082URG";
// Clanmates: one Elixir records already (another account follows them), one
// battled in clan chat, two quiet ones with different last battles.
const RECORDED = "#00JRG2RU";
const CLAN_BATTLED = "#0LJR0G22";
const ACTIVE = "#02G2PJC0";
const QUIET = "#08VP8VYY";
// From the battle log: a friendly opponent, a 2v2 teammate, the 2v2's two
// opponents, and a ladder opponent.
const FRIEND = "#0YP8U0Y0";
const TEAMMATE = "#080J2V9Q";
const FOE_A = "#0J9YCYL2";
const FOE_B = "#09VURCVC";
const LADDER = "#0VJLCPJ0";
// A player the owner watches: never offered.
const WATCHED = "#0Q2UQ2YR";
const HOSTILE = `<img src=x onerror=alert(1)>Fern`;
const NICKNAME = "Private Nickname";

let db, handler, ownerId, cookie;

const call = async (p, who = cookie) => {
  const res = await handler({
    path: p,
    method: "GET",
    headers: who ? { cookie: who } : {},
    queryStringParameters: {},
  });
  return { status: res.statusCode, body: JSON.parse(res.body), raw: res.body };
};

const player = (tag, n) =>
  db.query(`insert into player (player_tag, name) values ($1, $2)`, [tag, n]);

let battleN = 0;
/** A battle `hours` ago of `type`: side 0 is `mine` (the owner first), side
 *  1 `theirs`; the owner's side won. */
async function battle(type, hours, mine, theirs) {
  const id = `starter-${(battleN += 1)}`;
  const at = new Date(Date.now() - hours * 3_600_000);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ($1, $2, $3, 'pvp')`,
    [id, at, type],
  );
  for (const [side, tags] of [mine, theirs].entries())
    for (const tag of tags)
      await db.query(
        `insert into battle_participant
           (battle_id, player_tag, side, battle_time, type, type_class, outcome)
         values ($1, $2, $3, $4, $5, 'pvp', $6)`,
        [id, tag, side, at, type, side === 0 ? "win" : "loss"],
      );
}

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  for (const [tag, n] of [
    [OWN, "Invented Owner"],
    [RECORDED, "Amber"],
    [CLAN_BATTLED, "Birch"],
    [ACTIVE, "Cedar"],
    [QUIET, "Dune"],
    [FRIEND, HOSTILE],
    [TEAMMATE, "Elm"],
    [FOE_A, "Fog"],
    [FOE_B, "Gale"],
    [LADDER, "Hail"],
    [WATCHED, "Iris"],
  ])
    await player(tag, n);
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Grove')`, [
    CLAN,
  ]);
  for (const tag of [OWN, RECORDED, CLAN_BATTLED, ACTIVE, QUIET, WATCHED])
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
       values ($1, $2, now() - interval '30 days', 'member')`,
      [CLAN, tag],
    );
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ('starter-owner', 'approved', 'member', 'UTC') returning account_id`,
  );
  ownerId = owner.account_id;
  await db.query(
    `insert into claim (account_id, player_tag, status, relationship, is_primary)
     values ($1, $2, 'verified', 'primary', true)`,
    [ownerId, OWN],
  );
  await db.query(
    `insert into claim (account_id, player_tag, relationship)
     values ($1, $2, 'watching')`,
    [ownerId, WATCHED],
  );
  // Another account follows RECORDED: Elixir records them already, so
  // following them is free.
  const {
    rows: [other],
  } = await db.query(
    `insert into account (email_hash, status, role)
     values ('starter-other', 'approved', 'member') returning account_id`,
  );
  await db.query(
    `insert into claim (account_id, player_tag, relationship, created_at)
     values ($1, $2, 'friend', now() - interval '1 day')`,
    [other.account_id, RECORDED],
  );
  // The owner's private name for the friendly opponent: never in an answer.
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname)
     values ($1, $2, $3)`,
    [ownerId, FRIEND, NICKNAME],
  );
  await battle("friendly", 2, [OWN], [FRIEND]);
  await battle("trail", 3, [OWN, TEAMMATE], [FOE_A, FOE_B]);
  await battle("clanMate", 4, [OWN], [CLAN_BATTLED]);
  await battle("PvP", 5, [OWN], [LADDER]);
  await battle("PvP", 1, [ACTIVE], [FOE_A]);
  await battle("PvP", 48, [QUIET], [FOE_B]);
  await battle("PvP", 6, [WATCHED], [FOE_B]);
  const session = await createSession(db, {
    secret: "starter-secret",
    accountId: ownerId,
    emailHash: "starter-owner",
  });
  cookie = `__Host-elixir_session=${session.token}`;
  handler = makeHandler({
    databaseUrl,
    secret: "starter-secret",
    sendLoginEmail: async () => {},
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

test("the starter set: free clanmates, then friendlies, teammates and clan battles, then the active clan", async (t) => {
  t.mock.method(console, "info", () => {});
  const res = await call("/api/me/people/starter");
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.offer, true);
  const tags = res.body.people.map((p) => p.tag);
  assert.deepEqual(tags, [
    RECORDED,
    FRIEND,
    TEAMMATE,
    CLAN_BATTLED,
    ACTIVE,
    QUIET,
  ]);
  const by = Object.fromEntries(res.body.people.map((p) => [p.tag, p]));
  assert.deepEqual(by[RECORDED].why, [
    { kind: "clan", clan_name: "Grove", recorded: true },
  ]);
  assert.equal(by[RECORDED].free, true);
  assert.equal(by[FRIEND].why[0].kind, "battles");
  assert.equal(by[FRIEND].why[0].friendly, 1);
  assert.equal(by[TEAMMATE].why[0].with_you, 1);
  assert.equal(by[TEAMMATE].why[0].friendly, 0);
  // A clan-chat friendly, and the clan's own reason beside it.
  assert.equal(by[CLAN_BATTLED].why[0].clanmate_battles, 1);
  assert.equal(by[CLAN_BATTLED].why[1].kind, "clan");
  // The fill: most recently active first, with when.
  assert.ok(by[ACTIVE].why[0].last_battle);
  assert.ok(
    Date.parse(by[ACTIVE].why[0].last_battle) >
      Date.parse(by[QUIET].why[0].last_battle),
  );
  for (const p of res.body.people) {
    assert.equal(typeof p.free, "boolean");
    for (const k of ["trophies", "wins", "losses", "level", "rank", "score"])
      assert.ok(!(k in p), k);
  }
  // Game names as stored (escaped where drawn), never a nickname; never
  // your own player, one you watch, a 2v2 opponent or a ladder opponent.
  assert.equal(by[FRIEND].name, HOSTILE);
  assert.ok(!res.raw.includes(NICKNAME));
  for (const never of [OWN, WATCHED, FOE_A, FOE_B, LADDER])
    assert.ok(!tags.includes(never), never);
  assert.equal(res.body.slots_cap, 10);
});

test("the starter set takes no more slots than are left; free ones are not counted", async (t) => {
  t.mock.method(console, "info", () => {});
  // The owner's own player and the one they watch take slots already:
  // leave room for two more.
  const { used } = (await call("/api/me/people/starter")).body;
  assert.ok(Number.isInteger(used));
  await db.query(
    `update account set max_player_recordings = $2 where account_id = $1`,
    [ownerId, used + 2],
  );
  try {
    const res = await call("/api/me/people/starter");
    assert.equal(res.body.slots_cap, 2);
    assert.deepEqual(
      res.body.people.map((p) => p.tag),
      [RECORDED, FRIEND, TEAMMATE],
    );
    assert.equal(res.body.people.filter((p) => !p.free).length, 2);
  } finally {
    await db.query(
      `update account set max_player_recordings = null where account_id = $1`,
      [ownerId],
    );
  }
});

test("offered on every visit while the account follows fewer than five, finished welcome or not", async (t) => {
  t.mock.method(console, "info", () => {});
  // A finished welcome changes nothing (Jamie, 2026-11-13: "even if it
  // isn't their first login").
  await db.query(
    `update account set welcome_finished_at = now() where account_id = $1`,
    [ownerId],
  );
  let res = await call("/api/me/people/starter");
  assert.equal(res.body.offer, true);
  // Four follows: still offered, and those four are never suggested.
  const followed = [LADDER, FOE_A, FOE_B, TEAMMATE];
  for (const tag of followed)
    await db.query(
      `insert into claim (account_id, player_tag, relationship) values ($1, $2, 'friend')`,
      [ownerId, tag],
    );
  res = await call("/api/me/people/starter");
  assert.equal(res.body.offer, true);
  for (const tag of followed)
    assert.ok(!res.body.people.some((p) => p.tag === tag), tag);
  // The fifth: no longer offered.
  await db.query(
    `insert into claim (account_id, player_tag, relationship) values ($1, $2, 'friend')`,
    [ownerId, FRIEND],
  );
  res = await call("/api/me/people/starter");
  assert.deepEqual(res.body, { ok: true, offer: false, people: [] });
  await db.query(
    `delete from claim where account_id = $1 and relationship = 'friend'`,
    [ownerId],
  );
  await db.query(
    `update account set welcome_finished_at = null where account_id = $1`,
    [ownerId],
  );
});

test("Not now puts it aside for 30 days, then it comes back", async (t) => {
  t.mock.method(console, "info", () => {});
  const hide = await handler({
    path: "/api/me/people/starter/hide",
    method: "POST",
    headers: { cookie, "x-elixir-client": "web" },
    queryStringParameters: {},
    body: "{}",
  });
  assert.equal(hide.statusCode, 200, hide.body);
  let res = await call("/api/me/people/starter");
  assert.equal(res.body.offer, false);
  await db.query(
    `update account set starter_hidden_at = now() - interval '31 days' where account_id = $1`,
    [ownerId],
  );
  res = await call("/api/me/people/starter");
  assert.equal(res.body.offer, true);
  await db.query(
    `update account set starter_hidden_at = null where account_id = $1`,
    [ownerId],
  );
  // Reading it follows nobody.
  const { rows } = await db.query(
    `select count(*)::int as n from claim where account_id = $1 and relationship = 'friend'`,
    [ownerId],
  );
  assert.equal(rows[0].n, 0);
});

test("an account with no player of its own is offered the list, empty", async (t) => {
  t.mock.method(console, "info", () => {});
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role)
     values ('starter-bare', 'approved', 'member') returning account_id`,
  );
  const s = await createSession(db, {
    secret: "starter-secret",
    accountId: a.account_id,
    emailHash: "starter-bare",
  });
  const res = await call(
    "/api/me/people/starter",
    `__Host-elixir_session=${s.token}`,
  );
  assert.deepEqual(res.body, { ok: true, offer: true, people: [] });
});

test("signed out there is no starter read and no Not now", async () => {
  const res = await call("/api/me/people/starter", null);
  assert.equal(res.status, 401);
  const hide = await handler({
    path: "/api/me/people/starter/hide",
    method: "POST",
    headers: { "x-elixir-client": "web" },
    queryStringParameters: {},
    body: "{}",
  });
  assert.equal(hide.statusCode, 401);
});
