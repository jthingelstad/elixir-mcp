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
import { emitEvent } from "../../../packages/ingest/src/events.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import {
  followAllRefusal,
  followPlan,
  markOf,
  sessionWindow,
  tagsOf,
} from "../src/routes/player.mjs";

// Made-up tags: this repository is public.
const A = "#0JR2U89V"; // verified by X
const B = "#0PYP8RQ2"; // X follows
const D = "#0YLPUQU8"; // Y's own, verified
const E = "#0UCCGLUQ"; // the reader's own
const U = "#0RPYVQ9R"; // nobody's
const CL = "#0Q2L8"; // claimed by account WA, never verified
const N1 = "#0C8VR2CG";
const N2 = "#0C2P8LJR";
const CLAN = "#0L8P9LLJ";
const NICK = "Pet Name Nobody Else Sees";
const DISCORD = "secret_discord_handle";

let scratch, handler, X, Y, Z, R, WA, Q;
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
    [CL, "Willow"],
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
            ($1,'2026-11-10','daily',12,7400,now(),now()),
            -- #512: the frozen pre_reset row of the same game day, observed
            -- earlier; the page's trophies are the daily row's.
            ($1,'2026-11-10','pre_reset',11,7350,now() - interval '1 hour',now() - interval '1 hour')`,
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
  // WA claims W and never verified it; Q claims D, which Y verified, so Q
  // has no player of its own to be named by.
  WA = await person("player-wa");
  Q = await person("player-q");
  await claim(WA, CL, "primary");
  await claim(WA, A, "friend");
  await claim(Q, D, "primary");
  await claim(Q, A, "friend");
  await db.query(
    "update account set avatar_card_id = 26000000 where account_id = $1",
    [WA],
  );
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
  assert.deepEqual(tagsOf("0jr2u89v, #0PYP8RQ2,0JR2U89V"), [A, B]);
  assert.equal(tagsOf(""), null);
  assert.equal(tagsOf("0JR2U89V,not a tag"), null, "never part of a link");
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
    // The reader's own close-friend mark (0281), in the reader's block only.
    close: false,
    relationship: null,
    // The reader's own block of the verified owner (2026-11-16).
    blocked: false,
    clanmate: null,
  });
  // Follows are the account's friends, never what it only watches.
  assert.deepEqual(page.follows, {
    count: 1,
    players: [{ tag: B, name: "Birch" }],
  });
  // Y is named by the player Y verified; WA by the player it claims,
  // marked unverified and with no profile image; Z has no player and Q's
  // claim is on a tag Y verified, so both are counted, never named.
  assert.deepEqual(page.followers, {
    count: 4,
    players: [
      { tag: D, name: "Dogwood", verified: true },
      { tag: CL, name: "Willow", verified: false },
    ],
    no_player: 2,
    unnamed: 2,
  });
  for (const k of ["timeline", "moments"]) assert.ok(Array.isArray(page[k]), k);
  // Posts about the player's battles are posts (0292): the page reads
  // them with the player's other posts (GET /api/me/posts?player=), and
  // its timeline carries no record item for them beside.
  assert.equal("highlights" in page, false);
  assert.ok(!page.timeline.some((it) => it.kind === "battle_highlight"));
  assert.equal(page.window_days, 30);
  assert.ok(!r.body.includes(NICK), "no nickname, the reader's included");
  assert.ok(!r.body.includes(DISCORD), "that a Discord is linked, never which");
  assert.ok(!r.body.includes("email"), "no email field");
});

test("a moment the record proved links its battle; one it did not has no link", async () => {
  const proof = "ab".repeat(32);
  const ago = (h) => new Date(Date.now() - h * 3_600_000);
  await scratch.db.query(
    "insert into battle (battle_id,battle_time,type,type_class,created_at) values ($1,$2,'PvP','pvp',$3)",
    [proof, ago(2.5), ago(2.4)],
  );
  await scratch.db.query(
    "insert into battle_participant (battle_id,player_tag,battle_time,side,type,type_class,outcome,crowns) values ($1,$2,$3,0,'PvP','pvp','win',3)",
    [proof, A, ago(2.5)],
  );
  await emitEvent(scratch.db, "ranked_promotion", {
    tag: A,
    payload: { from: 2, to: 3, promoted_by: { battle_id: proof } },
    windowStart: ago(3),
    windowEnd: ago(2),
    occurredAt: ago(2.5),
  });
  await emitEvent(scratch.db, "career_wins_step", {
    tag: A,
    payload: { wins: 1000, step: 1000 },
    windowStart: ago(5),
    windowEnd: ago(4),
  });
  const page = data(
    await call(R, "GET", `/api/player?tag=${encodeURIComponent(A)}`),
  );
  const promoted = page.moments.find((m) => m.kind === "ranked_promotion");
  const step = page.moments.find((m) => m.kind === "career_wins_step");
  assert.ok(promoted, JSON.stringify(page.moments));
  assert.match(promoted.battle_url, new RegExp(`/battle/${proof.slice(0, 8)}`));
  assert.ok(step, JSON.stringify(page.moments));
  assert.equal(step.battle_url, undefined, "no fake link");
  // The Timeline tab draws the same item with the same link.
  assert.equal(
    page.timeline.find((m) => m.kind === "ranked_promotion").battle_url,
    promoted.battle_url,
  );
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
  const missing = await call(R, "GET", "/api/player?tag=%230Q020PQR");
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
    [A, N1, N2].sort(),
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

// A second reader, W, whose pool records two players W does not follow: one
// W only watches, one only W's agent tracks (Codex on #784).
const W_OWN = "#00YQ9Q90";
const WATCHED = "#0U9RGV8R";
const AGENTS = "#0GJLGVVR";
let W;
async function secondReader() {
  if (W) return W;
  const { db } = scratch;
  for (const [tag, name] of [
    [W_OWN, "Willow"],
    [WATCHED, "Walnut"],
    [AGENTS, "Wisteria"],
  ])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
  W = await person("player-w");
  await claim(W, W_OWN, "primary");
  await claim(W, WATCHED, "watching");
  const agent = (
    await db.query(
      "insert into account(kind,owned_by_account_id,status,role) values ('agent',$1,'approved','member') returning account_id",
      [W],
    )
  ).rows[0].account_id;
  await claim(agent, AGENTS, "watching");
  return W;
}

test("following is the reader's own Follow: a watched player, or one only their agent tracks, is not followed, and following them is free", async () => {
  const w = await secondReader();
  const page = data(
    await call(w, "GET", `/api/player?tag=${encodeURIComponent(WATCHED)}`),
  );
  assert.equal(page.you.following, false, "watching is not following");
  assert.equal(page.you.relationship, "watching");

  const plan = await followPlan(scratch.db, w, [WATCHED, AGENTS]);
  assert.deepEqual(
    plan.players.map((p) => [p.player_tag, p.following, p.free]),
    [
      [WATCHED, false, true],
      [AGENTS, false, true],
    ],
  );
  assert.equal(plan.to_follow, 2);
  assert.equal(plan.following, 0);
  assert.equal(plan.slots, 0, "the pool records both already");

  const ok = await call(w, "POST", "/api/me/follow-all", {
    player_tags: [WATCHED, AGENTS],
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(data(ok).followed, [WATCHED, AGENTS]);
  const { rows } = await scratch.db.query(
    "select player_tag, relationship from claim where account_id = $1 and player_tag = any($2) order by player_tag",
    [w, [WATCHED, AGENTS]],
  );
  assert.deepEqual(
    rows.map((r) => [r.player_tag, r.relationship]),
    [AGENTS, WATCHED].sort().map((t) => [t, "friend"]),
  );
  const after = await followPlan(scratch.db, w, [WATCHED, AGENTS]);
  assert.equal(after.following, 2);
  assert.equal(after.to_follow, 0);
});

test("a plan that needs no slot fits, even with the pool over its limit (Codex on #784)", async () => {
  const w = await secondReader();
  // Over the limit: W's pool uses more slots than its ceiling of one.
  await scratch.db.query(
    "update account set max_player_recordings = 1 where account_id = $1",
    [w],
  );
  const plan = await followPlan(scratch.db, w, [A]);
  assert.ok(plan.used > plan.limit, JSON.stringify(plan));
  assert.equal(plan.slots, 0, "others follow A, so A is free");
  assert.equal(plan.fits, true);
  const ok = await call(w, "POST", "/api/me/follow-all", { player_tags: [A] });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(data(ok).followed, [A]);
});

test("a sitting carries Home's session row: sparkline, numbers, and its games by the page's own read", async () => {
  const { db } = scratch;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  for (const [i, [minutes, outcome, crowns]] of [
    [50, "win", 3],
    [45, "loss", 0],
    [40, "win", 1],
  ].entries()) {
    const id = `player-sitting-${i}`;
    await db.query(
      `insert into battle(battle_id,battle_time,type,type_class,created_at)
       values ($1,$2,'PvP','pvp',$3)`,
      [id, iso(now - minutes * 60_000), iso(now - 30 * 60_000)],
    );
    await db.query(
      `insert into battle_participant(battle_id,player_tag,battle_time,side,type,type_class,crowns,trophy_change,outcome)
       values ($1,$2,$3,0,'PvP','pvp',$4,$5,$6)`,
      [
        id,
        A,
        iso(now - minutes * 60_000),
        crowns,
        outcome === "win" ? 30 : -30,
        outcome,
      ],
    );
  }
  const page = data(
    await call(R, "GET", `/api/player?tag=${encodeURIComponent(A)}`),
  );
  const sitting = page.timeline.find((it) => it.kind === "battle_session");
  assert.ok(sitting, JSON.stringify(page.timeline));
  assert.equal(sitting.spark.length, 3);
  assert.deepEqual(
    sitting.spark.map((b) => b.r),
    ["w", "l", "w"],
  );
  assert.deepEqual(Object.keys(sitting.facts).sort(), [
    "battles",
    "by_mode",
    "decks",
    "drawn",
    "ended_at",
    "events",
    "lost",
    "started_at",
    "trophy_net",
    "won",
    "won_in_a_row",
  ]);
  assert.equal(sitting.facts.battles, 3);
  assert.equal(sitting.evidence.kind, "session");

  const ask = (q) =>
    call(R, "GET", `/api/player/evidence?${new URLSearchParams(q)}`);
  const games = await ask({
    tag: A,
    evidence_item_id: sitting.id,
    expected_evidence_version: sitting.evidence.version,
    evidence_offset: "0",
  });
  assert.equal(games.statusCode, 200, games.body);
  assert.equal(data(games).battles.length, 3);
  assert.ok(!games.body.includes(NICK));
  assert.equal(
    (
      await ask({
        tag: A,
        evidence_item_id: sitting.id,
        expected_evidence_version: "ev_stale",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await ask({ tag: A, evidence_item_id: "nothing" })).statusCode,
    404,
  );
  assert.equal(
    (await ask({ tag: "nope", evidence_item_id: "x" })).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        null,
        "GET",
        `/api/player/evidence?tag=${encodeURIComponent(A)}&evidence_item_id=x`,
      )
    ).statusCode,
    401,
  );
});

test("a session's own page: the item, its games newest first, the reader's side, and refusals", async () => {
  const page = data(
    await call(X, "GET", `/api/player?tag=${encodeURIComponent(A)}`),
  );
  const sitting = page.timeline.find((it) => it.kind === "battle_session");
  assert.ok(sitting?.facts.started_at, JSON.stringify(sitting));
  const ask = (who, q) =>
    call(who, "GET", `/api/player/session?${new URLSearchParams(q)}`);

  // The owner, by the card's link (its start), reads the sitting whole.
  const own = await ask(X, {
    tag: A,
    id: sitting.id,
    at: sitting.facts.started_at,
  });
  assert.equal(own.statusCode, 200, own.body);
  const body = data(own);
  assert.equal(body.player.name, "Alder");
  assert.deepEqual(body.you, { own: true, can_post: true });
  assert.equal(body.item.id, sitting.id);
  assert.equal(body.item.evidence.version, sitting.evidence.version);
  assert.equal(body.games.order, "newest_first");
  assert.deepEqual(
    body.games.battles.map((b) => b.outcome),
    ["win", "loss", "win"],
  );
  assert.deepEqual(body.marks, []);
  assert.ok(!own.body.includes(NICK));

  // Another reader sees the same public games, and may not post them.
  const other = data(await ask(R, { tag: A, id: sitting.id }));
  assert.deepEqual(other.you, { own: false, can_post: false });
  assert.equal(other.games.battles.length, 3);
  // Y follows A (a friend claim): not theirs either.
  assert.deepEqual(data(await ask(Y, { tag: A, id: sitting.id })).you, {
    own: false,
    can_post: false,
  });

  assert.equal(
    (
      await ask(R, {
        tag: A,
        id: sitting.id,
        offset: "0",
        expected_evidence_version: "ev_stale",
      })
    ).statusCode,
    409,
  );
  assert.equal((await ask(R, { tag: A, id: "tl_nothing" })).statusCode, 404);
  assert.equal((await ask(R, { tag: "nope", id: "x" })).statusCode, 400);
  assert.equal((await ask(R, { tag: A })).statusCode, 400);
  assert.equal((await ask(null, { tag: A, id: sitting.id })).statusCode, 401);
});

test("a session's window: an hour before its start to a day after, else the page's", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  assert.deepEqual(sessionWindow("2026-11-15T10:00:00Z", now), {
    fromMs: Date.parse("2026-11-15T09:00:00Z"),
    toMs: Date.parse("2026-11-16T10:00:00Z"),
  });
  assert.deepEqual(sessionWindow("2026-11-16T11:00:00Z", now), {
    fromMs: Date.parse("2026-11-16T10:00:00Z"),
    toMs: now,
  });
  assert.equal(sessionWindow("nonsense", now), null);
  assert.equal(sessionWindow(undefined, now), null);
  assert.equal(sessionWindow("2026-12-01T00:00:00Z", now), null);
  assert.equal(sessionWindow("2026-09-01T00:00:00Z", now), null);
});

test("a game's mark says the moment's fact, and nothing for a kind without one", () => {
  assert.equal(
    markOf({ kind: "best_trophies_band", facts: { to: 9000 } }),
    "New best: 9,000 trophies",
  );
  assert.equal(
    markOf({ kind: "arena_changed", facts: { to_name: "Legendary Arena" } }),
    "Reached Legendary Arena",
  );
  assert.equal(
    markOf({ kind: "ranked_promotion", facts: { to_name: "Champion" } }),
    "Promoted to Champion",
  );
  assert.equal(markOf({ kind: "badge_earned", facts: {} }), null);
});
