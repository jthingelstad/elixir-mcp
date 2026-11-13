/**
 * Cheers on the player page and the battle page, People to follow and
 * Find's sections (2026-11-12). Pinned here: a page's item takes cheers only
 * while it is in the reader's own feed, and a reader with none of it sees no
 * item and no count; signed out is refused; People to follow names game
 * names only, never a nickname, never a player the reader already claims,
 * each with why and what it costs; From your battles counts meetings from
 * the log; Your clan prices its members. Synthetic names; the fixture's tag
 * and its opponents.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { AGENT_SCOPED_ROUTES, makeHandler } from "../src/handler.mjs";
import { interleave } from "../src/people.mjs";
import { shapeRaceNow } from "../src/routes/home.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_canvas_social_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

// The fixture's own player (fixtures/player_battlelog).
const PLAYER = "#0QRVVG22J";
const CLAN = "#GRC2PQ";
const CLANMATE = "#UUU2CC";
const PICKED = "#QQ8822";
const OWNER = "canvas-owner@example.com";
const FRIEND = "canvas-friend@example.com";
const STRANGER = "canvas-stranger@example.com";
const VOUCHER = "canvas-voucher@example.com";
const NICKNAME = "Private Nickname";

let db, handler;
const sent = [];
const cookies = {};
let ownerId, battleId, otherBattle, opponents;

const request = (method, p, { body, who, contract = true } = {}) =>
  handler({
    path: p.split("?")[0],
    queryStringParameters: Object.fromEntries(
      new URLSearchParams(p.split("?")[1] ?? ""),
    ),
    method,
    headers: {
      ...(who ? { cookie: cookies[who] } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
      ...(contract ? { "x-elixir-client": "web" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = async (method, p, opts) => {
  const res = await request(method, p, opts);
  return { status: res.statusCode, body: JSON.parse(res.body), raw: res.body };
};

async function signIn(email) {
  await request("POST", "/api/auth", { body: { age_13: true, email } });
  const { code } = sent.at(-1);
  const res = await request("POST", "/api/auth/code", {
    body: { email, code },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

async function account(email) {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, 'approved', 'member', 'UTC') returning account_id`,
    [emailHash(email)],
  );
  return a.account_id;
}

const claim = (accountId, tag, kind) =>
  db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship,
                        notify, status, verified_at)
     values ($1, $2, $3, $4, true, $5, case when $5 = 'verified' then now() end)`,
    [
      accountId,
      tag,
      kind === "verified",
      kind === "verified" ? "primary" : "friend",
      kind === "verified" ? "verified" : "unverified",
    ],
  );

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const {
    rows: [operator],
  } = await db.query(
    `insert into account (email_hash, status) values ('canvas-op', 'approved')
     returning account_id`,
  );
  await db.query(`insert into player (player_tag) values ($1)`, [PLAYER]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [PLAYER, operator.account_id],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'canvas-gw', '127.0.0.1', 'active') returning gateway_id`,
    [operator.account_id],
  );
  for (const [endpoint, entityKey, rel, fetchedAt] of [
    ["cards", "GLOBAL", "cards/catalog.json", "2026-09-03T13:00:00Z"],
    [
      "player_battlelog",
      PLAYER,
      "player_battlelog/with_colosseum_duel.json",
      "2026-09-03T14:30:34Z",
    ],
  ]) {
    const payload = JSON.parse(
      await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
    );
    const result = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(result.outcome, "admitted", JSON.stringify(result));
  }
  // The fixture's battles, moved into the last day: People reads a week.
  await db.query(
    `update battle set battle_time = now() - interval '1 day'
      where battle_id in (select battle_id from battle_participant
                           where player_tag = $1)`,
    [PLAYER],
  );
  await db.query(
    `update battle_participant set battle_time = now() - interval '1 day'
      where battle_id in (select battle_id from battle_participant
                           where player_tag = $1)`,
    [PLAYER],
  );
  const { rows: mine } = await db.query(
    `select bp.battle_id from battle_participant bp join battle b using (battle_id)
      where bp.player_tag = $1 and b.type = 'PvP'
      order by b.battle_time desc limit 2`,
    [PLAYER],
  );
  battleId = mine[0].battle_id;
  otherBattle = mine[1].battle_id;
  ({ rows: opponents } = await db.query(
    `select distinct o.player_tag from battle_participant me
       join battle_participant o on o.battle_id = me.battle_id
      where me.player_tag = $1 and o.player_tag <> $1
      order by o.player_tag`,
    [PLAYER],
  ));
  assert.ok(opponents.length >= 2, "the fixture has opponents");

  // A clan for the owner's player, with one other member.
  for (const tag of [CLANMATE, PICKED])
    await db.query(
      `insert into player (player_tag, name) values ($1, $2)
       on conflict (player_tag) do update set name = excluded.name`,
      [tag, tag === CLANMATE ? "Copper Fern" : "Umber"],
    );
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Grove')`, [
    CLAN,
  ]);
  await db.query(
    `update clan_membership set left_observed_at = now()
      where player_tag = any($1::text[]) and left_observed_at is null`,
    [[PLAYER, CLANMATE]],
  );
  for (const tag of [PLAYER, CLANMATE])
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
       values ($1, $2, now(), 'member')`,
      [CLAN, tag],
    );

  handler = makeHandler({
    databaseUrl,
    secret: "canvas-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
  ownerId = await account(OWNER);
  await claim(ownerId, PLAYER, "verified");
  const friendId = await account(FRIEND);
  await claim(friendId, PLAYER, "friend");
  await account(STRANGER);
  // An opponent the owner follows, whose own account follows PICKED: the
  // friends-follow source.
  const voucherId = await account(VOUCHER);
  const followed = opponents[0].player_tag;
  await claim(ownerId, followed, "friend");
  await claim(voucherId, followed, "verified");
  await claim(voucherId, PICKED, "friend");
  // The owner's private name for an opponent: never in any answer.
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname)
     values ($1, $2, $3)`,
    [ownerId, opponents[1].player_tag, NICKNAME],
  );
  cookies.owner = await signIn(OWNER);
  cookies.friend = await signIn(FRIEND);
  cookies.stranger = await signIn(STRANGER);
  const made = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: battleId, words: "A comeback" },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

const q = encodeURIComponent;

test("a player page's cheers: only what is in your feed, counts only", async () => {
  const friend = await call("GET", `/api/me/cheers?player=${q(PLAYER)}`, {
    who: "friend",
  });
  assert.equal(friend.status, 200, friend.raw);
  const highlight = friend.body.items.find(
    (it) => it.kind === "battle_highlight",
  );
  assert.ok(highlight, "the highlight is in the friend's feed");
  assert.match(highlight.id, /^tl_[0-9a-f]{20}$/);
  assert.deepEqual(highlight.cheers, {});
  assert.equal(highlight.my_cheer, null);
  assert.deepEqual(friend.body.subjects, [PLAYER]);
  assert.ok(!friend.raw.includes(NICKNAME));
  // Someone who follows neither the player nor the clan: nothing, no counts.
  const stranger = await call("GET", `/api/me/cheers?player=${q(PLAYER)}`, {
    who: "stranger",
  });
  assert.equal(stranger.status, 200);
  assert.deepEqual(stranger.body.items, []);
  // A cheer sent with the read's follows is stored, and the stranger then
  // still sees nothing of it.
  const put = await call("PUT", "/api/me/cheers", {
    who: "friend",
    body: {
      item_id: highlight.id,
      cheer: "royal",
      subjects: friend.body.subjects,
    },
  });
  assert.equal(put.status, 200, put.raw);
  const again = await call("GET", `/api/me/cheers?player=${q(PLAYER)}`, {
    who: "friend",
  });
  const one = again.body.items.find((it) => it.id === highlight.id);
  assert.deepEqual(one.cheers, { royal: 1 });
  assert.equal(one.my_cheer, "royal");
  const still = await call("GET", `/api/me/cheers?player=${q(PLAYER)}`, {
    who: "stranger",
  });
  assert.deepEqual(still.body.items, []);
});

test("a battle page's cheers: the items that battle proves, nothing else", async () => {
  const on = await call("GET", `/api/me/cheers?battle=${battleId}`, {
    who: "friend",
  });
  assert.equal(on.status, 200, on.raw);
  assert.deepEqual(
    on.body.items.map((it) => it.kind),
    ["battle_highlight"],
  );
  const short = await call(
    "GET",
    `/api/me/cheers?battle=${battleId.slice(0, 12)}`,
    { who: "friend" },
  );
  assert.equal(short.body.items.length, 1, "a short id names it too");
  const other = await call("GET", `/api/me/cheers?battle=${otherBattle}`, {
    who: "friend",
  });
  assert.deepEqual(other.body.items, []);
  const stranger = await call("GET", `/api/me/cheers?battle=${battleId}`, {
    who: "stranger",
  });
  assert.deepEqual(stranger.body.items, []);
  const missing = await call("GET", `/api/me/cheers?battle=${"f".repeat(64)}`, {
    who: "friend",
  });
  assert.equal(missing.status, 404);
});

test("signed out there is no cheer read and no people read; bad asks are refused", async () => {
  for (const p of [
    `/api/me/cheers?battle=${battleId}`,
    `/api/me/cheers?player=${q(PLAYER)}`,
    "/api/me/people/suggested",
    "/api/me/people/battles",
    "/api/me/people/clan",
  ]) {
    const res = await call("GET", p);
    assert.equal(res.status, 401, p);
  }
  assert.equal(
    (await call("GET", "/api/me/cheers", { who: "friend" })).status,
    400,
  );
  assert.equal(
    (await call("GET", "/api/me/cheers?player=zz", { who: "friend" })).status,
    400,
  );
  for (const key of [
    "GET /api/me/cheers",
    "GET /api/me/people/suggested",
    "GET /api/me/people/battles",
    "GET /api/me/people/clan",
  ])
    assert.ok(!AGENT_SCOPED_ROUTES.has(key), key);
});

test("People to follow: why and the cost, game names, never anyone you claim", async () => {
  const res = await call("GET", "/api/me/people/suggested", { who: "owner" });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.ok, true);
  assert.ok(!res.raw.includes(NICKNAME), "no nickname");
  const tags = res.body.people.map((p) => p.tag);
  assert.ok(tags.length <= 5);
  assert.ok(!tags.includes(PLAYER), "never your own player");
  assert.ok(
    !tags.includes(opponents[0].player_tag),
    "never a player you follow",
  );
  const clanmate = res.body.people.find((p) => p.tag === CLANMATE);
  assert.deepEqual(clanmate?.why, [{ kind: "clan", clan_name: "Grove" }]);
  const picked = res.body.people.find((p) => p.tag === PICKED);
  assert.ok(picked, JSON.stringify(res.body.people));
  assert.equal(picked.why[0].kind, "followed_by");
  assert.equal(picked.why[0].via.tag, opponents[0].player_tag);
  assert.equal(picked.why[0].others, 0);
  // Followed by another account already: free, and says why.
  assert.equal(picked.free, true);
  assert.equal(picked.reason, "followed_by_others");
  for (const p of res.body.people) {
    assert.equal(typeof p.free, "boolean");
    for (const w of p.why)
      assert.ok(["battles", "clan", "followed_by"].includes(w.kind));
    // Facts, never a rating: no trophies, wins or level on a suggestion.
    for (const k of ["trophies", "wins", "losses", "level", "rank", "score"])
      assert.ok(!(k in p), k);
  }
  assert.equal(typeof res.body.used, "number");
});

test("From your battles: how often you met and how it went, most met first", async () => {
  const res = await call("GET", "/api/me/people/battles", { who: "owner" });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.days, 30);
  assert.ok(res.body.people.length > 0);
  assert.ok(!res.raw.includes(NICKNAME), "no nickname");
  const tags = res.body.people.map((p) => p.tag);
  assert.ok(!tags.includes(PLAYER));
  const met = res.body.people.map((p) => p.against + p.with_you);
  assert.deepEqual(
    met,
    [...met].sort((a, b) => b - a),
  );
  const followed = res.body.people.find(
    (p) => p.tag === opponents[0].player_tag,
  );
  assert.equal(followed?.following, true, "a follow is marked, not hidden");
  for (const p of res.body.people)
    assert.equal(p.wins + p.losses + p.draws, p.against);
});

test("Your clan: its members, each priced, yours left out", async () => {
  const res = await call("GET", "/api/me/people/clan", { who: "owner" });
  assert.equal(res.status, 200, res.raw);
  assert.deepEqual(res.body.clan, { clan_tag: CLAN, name: "Grove" });
  assert.deepEqual(
    res.body.players.map((p) => p.player_tag),
    [CLANMATE],
  );
  assert.deepEqual(res.body.yours, [PLAYER]);
  assert.equal(res.body.players[0].role, "member");
  const none = await call("GET", "/api/me/people/clan", { who: "stranger" });
  assert.deepEqual(none.body, { ok: true, clan: null });
});

test("the sources take turns, and a person in two is one row with both reasons", () => {
  const p = (tag, kind) => ({ tag, name: tag, why: { kind } });
  const out = interleave(
    [
      [p("#A", "battles"), p("#B", "battles"), p("#C", "battles")],
      [p("#B", "clan"), p("#D", "clan")],
      [p("#E", "followed_by")],
    ],
    4,
  );
  assert.deepEqual(
    out.map((x) => x.tag),
    ["#A", "#B", "#E", "#C"],
  );
  assert.deepEqual(
    out.find((x) => x.tag === "#B").why.map((w) => w.kind),
    ["clan", "battles"],
  );
});

test("this week's race: a place by fame on a war day, never the day's decks", () => {
  const current = {
    season_id: 137,
    section_index: 1,
    is_colosseum: false,
    day_kind: "war",
    war_day: 2,
    race_finished_at: null,
    standings: [
      { participant_clan_tag: "#AAA", fame: 9000 },
      { participant_clan_tag: CLAN, fame: 8200 },
      { participant_clan_tag: "#CCC", fame: 100 },
    ],
    decks_today: { counts: { finished: 3 } },
  };
  assert.deepEqual(shapeRaceNow(current, CLAN), {
    season_id: 137,
    section_index: 1,
    is_colosseum: false,
    day_kind: "war",
    war_day: 2,
    finished: false,
    place: 2,
    fame: 8200,
  });
  assert.deepEqual(
    shapeRaceNow({ ...current, day_kind: "training", war_day: null }, CLAN),
    {
      season_id: 137,
      section_index: 1,
      is_colosseum: false,
      day_kind: "training",
      war_day: null,
    },
  );
  assert.equal(shapeRaceNow({ ...current, day_kind: null }, CLAN), null);
  assert.equal(shapeRaceNow(null, CLAN), null);
});

test("this week's race: no place before any fame, nor on a tie (Codex on #792)", () => {
  const race = (standings) =>
    shapeRaceNow(
      {
        season_id: 137,
        section_index: 0,
        is_colosseum: false,
        day_kind: "war",
        war_day: 1,
        race_finished_at: null,
        standings,
      },
      CLAN,
    );
  // The first war day, nothing banked: all five level at zero.
  const zero = race(
    ["#AAA", CLAN, "#CCC", "#DDD", "#EEE"].map((t) => ({
      participant_clan_tag: t,
      fame: 0,
    })),
  );
  assert.equal(zero.place, null);
  assert.equal(zero.fame, 0);
  // Level with another clan: no place, the fame still said.
  const tied = race([
    { participant_clan_tag: "#AAA", fame: 9000 },
    { participant_clan_tag: CLAN, fame: 4000 },
    { participant_clan_tag: "#CCC", fame: 4000 },
  ]);
  assert.equal(tied.place, null);
  assert.equal(tied.fame, 4000);
  // A tie elsewhere does not move a place that is one.
  assert.equal(
    race([
      { participant_clan_tag: "#AAA", fame: 4000 },
      { participant_clan_tag: "#CCC", fame: 4000 },
      { participant_clan_tag: CLAN, fame: 9000 },
    ]).place,
    1,
  );
});
