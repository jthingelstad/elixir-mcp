import { verifiedPlayerIdentities } from "@elixir-mcp/tools/social";
/**
 * Profile images (2026-11-14): an account chooses one card, and it shows on
 * every player that account verified, wherever the website draws them.
 * Pinned here: the write (set, clear, and every refusal), who shows it (a
 * verified primary and a verified alt; never an unverified claim, a follow,
 * or a tag nobody verified; it follows a verification that moves), and the
 * reads that carry it (the player page with its follows and followers, the
 * feed, the people lists, /api/me) in one statement a read. MCP is not
 * here: no tool reads it. Invented names and tags throughout.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { annotateFeed } from "../src/feed.mjs";
import { peopleWithAvatars, verifiedAvatars } from "../src/avatars.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_avatar_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
const SECRET = "avatar-secret";

// The owner verified MAIN (primary) and ALT; claims SELF_ONLY unverified.
const MAIN = "#0PRJ8Y2C";
const ALT = "#0PRJ8Y2G";
const SELF_ONLY = "#0PRJ8Y2L";
// Followed by the owner, verified by nobody.
const FRIEND = "#0PRJ8Y2Q";
// Verified by a second account, which chose no image.
const PLAIN = "#0PRJ8Y2R";
// Verified by a third account with an image, which follows MAIN.
const FAN = "#0PRJ8Y2U";

const KNIGHT = 26000000;
const ARROWS = 28000001;
const TOWER = 159000000;
const STUB = 26000999; // in the card table, not in the current catalog

let db, handler, ownerId, plainId, fanId, ownerCookie;

const call = async (
  path,
  {
    method = "GET",
    body,
    cookie = ownerCookie,
    contract = true,
    query = {},
  } = {},
) => {
  const res = await handler({
    path,
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(contract ? { "x-elixir-client": "web" } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const setAvatar = (card_id, opts = {}) =>
  call("/api/me/avatar", { method: "POST", body: { card_id }, ...opts });

async function account(hash, extra = "") {
  const { rows } = await db.query(
    `insert into account (email_hash, status, role${extra ? ", kind, owned_by_account_id, public_id" : ""})
     values ($1, 'approved', 'member'${extra ? ", 'agent', $2, 'agavatar1'" : ""}) returning account_id`,
    extra ? [hash, extra] : [hash],
  );
  return rows[0].account_id;
}
const claim = (acct, tag, status, relationship, primary = false) =>
  db.query(
    `insert into claim (account_id, player_tag, status, relationship, is_primary, verified_at)
     values ($1, $2, $3, $4, $5, case when $3 = 'verified' then now() end)`,
    [acct, tag, status, relationship, primary],
  );
const cookieFor = async (accountId, hash) =>
  `__Host-elixir_session=${(await createSession(db, { secret: SECRET, accountId, emailHash: hash })).token}`;

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  for (const [tag, n] of [
    [MAIN, "Invented Main"],
    [ALT, "Invented Alt"],
    [SELF_ONLY, "Invented Claimed"],
    [FRIEND, "Invented Friend"],
    [PLAIN, "Invented Plain"],
    [FAN, `<img src=x onerror=alert(1)>Fan`],
  ])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      n,
    ]);
  for (const [id, n, kind, inCatalog] of [
    [KNIGHT, "Knight", "card", true],
    [ARROWS, "Arrows", "card", true],
    [TOWER, "Tower Princess", "support", true],
    [STUB, "Event Card", "card", false],
  ])
    await db.query(
      `insert into card (card_id, name, kind, icon_medium, in_catalog)
       values ($1, $2, $3, 'https://example.invalid/card.png', $4)`,
      [id, n, kind, inCatalog],
    );
  ownerId = await account("avatar-owner");
  plainId = await account("avatar-plain");
  fanId = await account("avatar-fan");
  await claim(ownerId, MAIN, "verified", "primary", true);
  await claim(ownerId, ALT, "verified", "alt");
  await claim(ownerId, SELF_ONLY, "unverified", "alt");
  await claim(ownerId, FRIEND, "unverified", "friend");
  await claim(plainId, PLAIN, "verified", "primary", true);
  await claim(fanId, FAN, "verified", "primary", true);
  await claim(fanId, MAIN, "unverified", "friend");
  await db.query(
    `update account set avatar_card_id = $2 where account_id = $1`,
    [fanId, ARROWS],
  );
  await account("avatar-agent", ownerId);
  ownerCookie = await cookieFor(ownerId, "avatar-owner");
  handler = makeHandler({
    databaseUrl,
    secret: SECRET,
    sendLoginEmail: async () => {},
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

test("an account sets its profile image to a catalog card and clears it", async (t) => {
  t.mock.method(console, "info", () => {});
  const set = await setAvatar(KNIGHT);
  assert.equal(set.status, 200);
  assert.deepEqual(set.body, { ok: true, avatar_card_id: KNIGHT });
  const me = await call("/api/me");
  assert.equal(me.body.avatar_card_id, KNIGHT);
  const {
    rows: [row],
  } = await db.query(
    `select avatar_card_id, avatar_set_at from account where account_id = $1`,
    [ownerId],
  );
  assert.equal(row.avatar_card_id, KNIGHT);
  assert.ok(row.avatar_set_at instanceof Date);

  const cleared = await setAvatar(null);
  assert.deepEqual(cleared.body, { ok: true, avatar_card_id: null });
  assert.equal((await call("/api/me")).body.avatar_card_id, null);
});

test("the write refuses a tower troop, an unknown or retired card, a hostile id, the signed out, an agent and a missing contract header", async (t) => {
  t.mock.method(console, "info", () => {});
  await setAvatar(KNIGHT);
  for (const bad of [
    TOWER,
    26009999,
    STUB,
    -1,
    1.5,
    "26000000",
    "<script>",
    { id: 1 },
    true,
  ]) {
    const r = await setAvatar(bad);
    assert.equal(r.status, 400, `refused ${JSON.stringify(bad)}`);
    assert.equal(r.body.error, "unknown_card");
  }
  assert.equal((await setAvatar(ARROWS, { cookie: null })).status, 401);
  assert.equal((await setAvatar(ARROWS, { contract: false })).status, 401);
  // An agent reaches the website only through its owner's scoped path, and
  // the image is not one of the routes an agent has there.
  const agent = await call("/api/agent/agavatar1/avatar", {
    method: "POST",
    body: { card_id: ARROWS },
  });
  assert.equal(agent.status, 404);
  // Nothing refused moved the image.
  const {
    rows: [row],
  } = await db.query(
    `select avatar_card_id from account where account_id = $1`,
    [ownerId],
  );
  assert.equal(row.avatar_card_id, KNIGHT);
});

test("only a verified primary or alt shows the image; an unverified claim, a follow and a tag nobody verified show none", async () => {
  await db.query(
    `update account set avatar_card_id = $2 where account_id = $1`,
    [ownerId, KNIGHT],
  );
  const faces = await verifiedAvatars(db, [
    MAIN,
    ALT,
    SELF_ONLY,
    FRIEND,
    PLAIN,
    FAN,
    "#0PRJ8Y2V",
    null,
  ]);
  assert.deepEqual(Object.fromEntries(faces), {
    [MAIN]: KNIGHT,
    [ALT]: KNIGHT,
    [FAN]: ARROWS,
  });
  const proof = await verifiedPlayerIdentities(db, [
    MAIN,
    ALT,
    SELF_ONLY,
    FRIEND,
    PLAIN,
    FAN,
  ]);
  assert.equal(proof.has(MAIN), true);
  assert.equal(proof.has(ALT), true);
  assert.equal(proof.has(SELF_ONLY), false);
  assert.equal(proof.has(FRIEND), false);
  assert.equal(proof.has(PLAIN), true);
  assert.equal(proof.get(PLAIN).avatar_card_id, null);
  // No tags, no statement.
  assert.equal((await verifiedAvatars(db, [])).size, 0);
});

test("the player page shows the image on its head and on its follows and followers, never on an unverified player", async (t) => {
  t.mock.method(console, "info", () => {});
  await db.query(
    `update account set avatar_card_id = $2 where account_id = $1`,
    [ownerId, KNIGHT],
  );
  // The owner follows FAN too, so FAN is in MAIN's follows, and FAN's
  // account follows MAIN, so FAN is among MAIN's followers.
  await claim(ownerId, FAN, "unverified", "friend");
  const main = await call("/api/player", { query: { tag: MAIN } });
  assert.equal(main.status, 200);
  assert.equal(main.body.player.avatar_card_id, KNIGHT);
  assert.equal(main.body.player_verifications[MAIN], true);
  const follows = new Map(main.body.follows.players.map((f) => [f.tag, f]));
  assert.equal(follows.get(FAN).avatar_card_id, ARROWS);
  assert.equal("avatar_card_id" in follows.get(FRIEND), false);
  assert.equal(main.body.followers.players[0].tag, FAN);
  assert.equal(main.body.followers.players[0].avatar_card_id, ARROWS);

  const alt = await call("/api/player", { query: { tag: ALT } });
  assert.equal(alt.body.player.avatar_card_id, KNIGHT);
  for (const tag of [SELF_ONLY, FRIEND, PLAIN]) {
    const page = await call("/api/player", { query: { tag } });
    assert.equal(page.status, 200);
    assert.equal("avatar_card_id" in page.body.player, false, tag);
  }
  await db.query(
    `delete from claim where account_id = $1 and player_tag = $2`,
    [ownerId, FAN],
  );
});

test("when the verification moves, the image follows the account that verified", async (t) => {
  t.mock.method(console, "info", () => {});
  await db.query(
    `update account set avatar_card_id = $2 where account_id = $1`,
    [ownerId, KNIGHT],
  );
  // ALT's verification moves to the plain account, which chose none.
  await db.query(
    `delete from claim where account_id = $1 and player_tag = $2`,
    [ownerId, ALT],
  );
  await claim(plainId, ALT, "verified", "alt");
  assert.equal(
    "avatar_card_id" in
      (await call("/api/player", { query: { tag: ALT } })).body.player,
    false,
  );
  // Once the plain account chooses one, ALT wears that.
  await db.query(
    `update account set avatar_card_id = $2 where account_id = $1`,
    [plainId, ARROWS],
  );
  assert.equal(
    (await call("/api/player", { query: { tag: ALT } })).body.player
      .avatar_card_id,
    ARROWS,
  );
  // And back.
  await db.query(
    `delete from claim where account_id = $1 and player_tag = $2`,
    [plainId, ALT],
  );
  await db.query(
    `update account set avatar_card_id = null where account_id = $1`,
    [plainId],
  );
  await claim(ownerId, ALT, "verified", "alt");
  assert.equal(
    (await call("/api/player", { query: { tag: ALT } })).body.player
      .avatar_card_id,
    KNIGHT,
  );
});

test("an account with no verified player still sees its own image in its bar, and on no player", async (t) => {
  t.mock.method(console, "info", () => {});
  const lone = await account("avatar-lone");
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Invented Lone')`,
    ["#0PRJ8Y2Y"],
  );
  await claim(lone, "#0PRJ8Y2Y", "unverified", "primary", true);
  const cookie = await cookieFor(lone, "avatar-lone");
  assert.equal((await setAvatar(KNIGHT, { cookie })).status, 200);
  assert.equal((await call("/api/me", { cookie })).body.avatar_card_id, KNIGHT);
  assert.equal((await verifiedAvatars(db, ["#0PRJ8Y2Y"])).size, 0);
});

test("the feed carries each item's image in one statement, for the player the avatar draws", async () => {
  await db.query(
    `update account set avatar_card_id = $2 where account_id = $1`,
    [ownerId, KNIGHT],
  );
  const items = [
    { kind: "trophy_milestone", subjects: [{ kind: "player", tag: MAIN }] },
    {
      kind: "member_joined",
      subjects: [{ kind: "clan", tag: "#0PRJ8Y2P" }],
      facts: { player_tag: FAN },
    },
    { kind: "session", subjects: [{ kind: "player", tag: FRIEND }] },
    { kind: "clan_week", subjects: [{ kind: "clan", tag: "#0PRJ8Y2P" }] },
  ];
  let statements = 0;
  const counting = { query: (...a) => ((statements += 1), db.query(...a)) };
  const out = await annotateFeed(counting, items, []);
  assert.deepEqual(
    out.map((it) => it.avatar_card_id ?? null),
    [KNIGHT, ARROWS, null, null],
  );
  // battleLinks and the images: two, however many items.
  assert.ok(statements <= 2, `${statements} statements`);
});

test("people lists carry each row's image in one statement", async () => {
  let statements = 0;
  const counting = { query: (...a) => ((statements += 1), db.query(...a)) };
  const out = await peopleWithAvatars(counting, {
    people: [{ tag: FAN, name: "x" }, { tag: FRIEND }],
    players: [{ player_tag: MAIN }],
    used: 1,
  });
  assert.equal(statements, 1);
  assert.equal(out.people[0].avatar_card_id, ARROWS);
  assert.equal("avatar_card_id" in out.people[1], false);
  assert.equal(out.players[0].avatar_card_id, KNIGHT);
  assert.equal(out.used, 1);
  // No rows, no statement.
  await peopleWithAvatars(counting, { people: [] });
  assert.equal(statements, 1);
});
