/**
 * Verify (0080): the deck-slot challenge over the real handler and a
 * scratch database. Reads go through an injected live lane so the tests
 * see exactly what was asked for and nothing is charged to a quota.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import {
  verifyRoutes,
  deckMatches,
  DECK_SIZE,
  STARTS_PER_HOUR,
} from "../src/routes/verify.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_verify_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, cookie, person, other;
const TAG = "#2PP0V90Y";
const OTHER_TAG = "#8QU2PJ8C";

const request = (method, path, body, session = cookie) =>
  handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers: { cookie: session, "x-elixir-client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const data = (r) => JSON.parse(r.body);

/** A collection of N plain cards plus one tower troop for a player. */
async function seedCollection(tag, n = 20) {
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Seed') on conflict do nothing`,
    [tag],
  );
  for (let i = 1; i <= n; i += 1) {
    await db.query(
      `insert into card (card_id, name, kind, icon_urls) values ($1, $2, 'card', $3::jsonb)
       on conflict (card_id) do nothing`,
      [
        26000000 + i,
        `Card ${i}`,
        JSON.stringify({ medium: `https://x/${i}.png` }),
      ],
    );
    await db.query(
      `insert into player_card (player_tag, card_id, level, first_seen_at, observed_at)
       values ($1, $2, 10, now(), now()) on conflict do nothing`,
      [tag, 26000000 + i],
    );
  }
  await db.query(
    `insert into card (card_id, name, kind) values (159000000, 'Tower Princess', 'support')
     on conflict (card_id) do nothing`,
  );
  await db.query(
    `insert into player_card (player_tag, card_id, level, first_seen_at, observed_at)
     values ($1, 159000000, 16, now(), now()) on conflict do nothing`,
    [tag],
  );
}

let battleSeq = 0;
/** A recorded battle for `tag` with the given deck, against a stand-in
 *  opponent; the shape the battlelog projector writes. */
async function playBattle(tag, ids, at = new Date(), outcome = "win") {
  battleSeq += 1;
  const battleId = `verify-battle-${process.pid}-${battleSeq}`;
  const opponent = "#PPRJ8V0L";
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Rival') on conflict do nothing`,
    [opponent],
  );
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, game_mode_name)
     values ($1, $2, 'pathOfLegend', 'pvp', 'Ranked1v1_NewArena2')`,
    [battleId, at],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, crowns, deck, outcome, battle_time)
     values ($1, $2, 0, $5, $3::jsonb, $4, $6),
            ($1, $7, 1, $8, '{"norm":1,"cards":[]}'::jsonb, $9, $6)`,
    [
      battleId,
      tag,
      JSON.stringify({ norm: 1, cards: ids.map((id) => ({ id, level: 14 })) }),
      outcome,
      outcome === "win" ? 3 : 1,
      at,
      opponent,
      outcome === "win" ? 1 : 3,
      outcome === "win" ? "loss" : "win",
    ],
  );
  return battleId;
}

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  person = (
    await db.query(
      "insert into account(email_hash,status,role) values ('verify-person','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  other = (
    await db.query(
      "insert into account(email_hash,status,role) values ('verify-other','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  for (const [acct, hash] of [
    [person, "verify-person"],
    [other, "verify-other"],
  ]) {
    const session = await createSession(db, {
      secret: "test",
      accountId: acct,
      emailHash: hash,
    });
    if (acct === person) cookie = `__Host-elixir_session=${session.token}`;
  }
  handler = makeHandler({ databaseUrl, secret: "test" });
  await seedCollection(TAG);
  // Claims are made under Tracking; Verify proves them.
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship)
     values ($1, $2, 'unverified', true, 'primary')`,
    [person, TAG],
  );
});
after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("deckMatches: the set of eight ids, order and duplicates aside", () => {
  const t = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.equal(deckMatches(t, [8, 7, 6, 5, 4, 3, 2, 1]), true);
  assert.equal(deckMatches(t, [1, 2, 3, 4, 5, 6, 7, 9]), false);
  assert.equal(deckMatches(t, [1, 2, 3, 4, 5, 6, 7]), false);
  assert.equal(deckMatches(t, [1, 1, 2, 3, 4, 5, 6, 7]), false);
});

test("start: draws eight owned plain cards, is idempotent while open, asks the live lane without a quota, and refuses a tag that is not tracked", async () => {
  const asked = [];
  const live = async (_db, args) => {
    asked.push(args);
    return {
      ok: false,
      reason: "pending",
      retry_after_s: 15,
      job_id: 4242,
      minted: true,
    };
  };
  // A handler with an injected live lane, so the ask is visible.
  const h = makeHandler({ databaseUrl, secret: "test" });
  void h;
  const routes = verifyRoutes({
    resolveAccount: async () => ({
      accountId: person,
      role: "member",
      kind: "person",
    }),
    logEvent: async () => {},
    live,
  });
  const untracked = await routes["POST /api/me/verify"](
    db,
    {},
    { player_tag: "#PPUV0LC2" },
  );
  assert.equal(untracked.statusCode, 404);
  assert.equal(JSON.parse(untracked.body).error, "not_tracked");
  const started = await routes["POST /api/me/verify"](
    db,
    {},
    { player_tag: TAG },
  );
  assert.equal(started.statusCode, 200, started.body);
  const c = JSON.parse(started.body);
  assert.equal(c.state, "open");
  assert.equal(c.target.length, DECK_SIZE);
  assert.ok(
    c.target.every((x) => x.icon && x.name),
    "art rides with the target",
  );
  assert.ok(
    c.target.every((x) => x.id !== 159000000),
    "never a tower troop",
  );
  assert.equal(
    new Set(c.target.map((x) => x.id)).size,
    DECK_SIZE,
    "eight distinct",
  );
  assert.equal(c.live_pending, true);
  assert.deepEqual(asked, [{ endpoint: "player_battlelog", entityKey: TAG }]);
  // The claim exists now, unverified, and the account's live quota is untouched.
  const { rows: claim } = await db.query(
    `select status from claim where account_id = $1 and player_tag = $2`,
    [person, TAG],
  );
  assert.equal(claim[0].status, "unverified");
  const { rows: quota } = await db.query(
    `select count(*)::int n from rate_limit where bucket = $1`,
    [`liveday#${person}`],
  );
  assert.equal(quota[0].n, 0, "nothing charged to the live-fetch quota");
  const { rows: ch } = await db.query(
    `select live_job_id, live_reads from claim_challenge where challenge_id = $1`,
    [c.challenge_id],
  );
  assert.equal(
    Number(ch[0].live_job_id),
    4242,
    "the read is auditable by job id",
  );
  assert.equal(ch[0].live_reads, 1);

  // A second start while open returns the SAME target.
  const again = await routes["POST /api/me/verify"](
    db,
    {},
    { player_tag: TAG },
  );
  const c2 = JSON.parse(again.body);
  assert.equal(c2.challenge_id, c.challenge_id);
  assert.deepEqual(
    c2.target.map((x) => x.id),
    c.target.map((x) => x.id),
  );
  const { rows: open } = await db.query(
    `select count(*)::int n from claim_challenge where account_id = $1 and outcome = 'open'`,
    [person],
  );
  assert.equal(open[0].n, 1, "one open challenge per claim");
});

test("poll: a near-miss battle lights up what matched, a battle after the brief with the target deck verifies the claim and names the proof, and a later poll resumes the verified state", async () => {
  const routes = verifyRoutes({
    resolveAccount: async () => ({
      accountId: person,
      role: "member",
      kind: "person",
    }),
    logEvent: async () => {},
    live: async () => ({
      ok: false,
      reason: "pending",
      retry_after_s: 15,
      job_id: 1,
      minted: true,
    }),
  });
  const { rows: open } = await db.query(
    `select challenge_id, target_card_ids from claim_challenge where account_id = $1 and outcome = 'open'`,
    [person],
  );
  const id = open[0].challenge_id;
  const target = open[0].target_card_ids;
  const poll = () => routes["GET /api/me/verify/*"](db, { pathParam: id });

  // No battle yet.
  let r = JSON.parse((await poll()).body);
  assert.equal(r.state, "open");
  assert.equal(r.last_battle, null);
  assert.equal(r.battles_since, 0);
  assert.equal(r.matched, 0);

  // Half the target in the slot: four light up, not verified. Fillers come
  // from outside the (random) target, or a lucky draw could match five.
  const fillers = Array.from({ length: 20 }, (_, i) => 26000001 + i)
    .filter((id) => !target.includes(id))
    .slice(0, 4);
  await playBattle(
    TAG,
    [...target.slice(0, 4), ...fillers],
    new Date(),
    "loss",
  );
  r = JSON.parse((await poll()).body);
  assert.equal(r.state, "open");
  assert.equal(r.matched, 4);
  assert.equal(r.target.filter((x) => x.matched).length, 4);
  assert.equal(r.battles_since, 1);
  assert.equal(r.last_battle.cards.length, 8);
  assert.equal(r.last_battle.outcome, "loss");
  assert.equal(r.last_battle.opponent.name, "Rival");
  assert.equal(r.last_battle.proof, false);

  // The full target, but played BEFORE the brief: not proof.
  await playBattle(TAG, target, new Date(Date.now() - 3600_000));
  r = JSON.parse((await poll()).body);
  assert.equal(r.state, "open", "a battle before the challenge proves nothing");

  // The full target, in a different order, played now: verified, and the
  // proving battle is named with its result.
  const proofId = await playBattle(
    TAG,
    [...target].reverse(),
    new Date(),
    "win",
  );
  r = JSON.parse((await poll()).body);
  assert.equal(r.state, "verified");
  assert.ok(r.verified_at);
  assert.equal(r.last_battle.battle_id, proofId);
  assert.equal(r.last_battle.proof, true);
  assert.equal(r.last_battle.outcome, "win");
  assert.equal(r.matched, 8);
  assert.equal(
    r.seen_after_s,
    null,
    "no log read in the scratch record: nothing to claim",
  );
  const { rows: ch } = await db.query(
    `select proof_battle_id, outcome from claim_challenge where challenge_id = $1`,
    [id],
  );
  assert.equal(ch[0].proof_battle_id, proofId);
  assert.equal(ch[0].outcome, "verified");
  const { rows: claim } = await db.query(
    `select status, verified_method, verified_at from claim where account_id = $1 and player_tag = $2`,
    [person, TAG],
  );
  assert.equal(claim[0].status, "verified");
  assert.equal(claim[0].verified_method, "deck_battle");
  assert.ok(claim[0].verified_at);

  // Resume: polling again says verified; starting again says verified.
  r = JSON.parse((await poll()).body);
  assert.equal(r.state, "verified");
  const again = await routes["POST /api/me/verify"](
    db,
    {},
    { player_tag: TAG },
  );
  assert.equal(JSON.parse(again.body).state, "verified");

  // The list carries it.
  const list = JSON.parse((await routes["GET /api/me/verify"](db, {})).body);
  const mine = list.players.find((p) => p.player_tag === TAG);
  assert.equal(mine.status, "verified");
  assert.ok(mine.verified_at);
});

test("only the primary or an alt can be verified: a watched player is refused", async () => {
  const routes = verifyRoutes({
    resolveAccount: async () => ({
      accountId: other,
      role: "member",
      kind: "person",
    }),
    logEvent: async () => {},
    live: async () => ({
      ok: true,
      fetched_at: new Date().toISOString(),
      payload: null,
    }),
  });
  await db.query(
    `insert into player (player_tag) values ('#PPCGRJ8V') on conflict do nothing`,
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship)
     values ($1, '#PPCGRJ8V', 'unverified', false, 'watching')`,
    [other],
  );
  const r = await routes["POST /api/me/verify"](
    db,
    {},
    { player_tag: "#PPCGRJ8V" },
  );
  assert.equal(r.statusCode, 403);
  assert.equal(JSON.parse(r.body).error, "not_yours");
  const list = JSON.parse((await routes["GET /api/me/verify"](db, {})).body);
  assert.equal(
    list.players.find((p) => p.player_tag === "#PPCGRJ8V").eligible,
    false,
  );
});

test("a tag verified by one account cannot be started by another", async () => {
  const routes = verifyRoutes({
    resolveAccount: async () => ({
      accountId: other,
      role: "member",
      kind: "person",
    }),
    logEvent: async () => {},
    live: async () => ({
      ok: true,
      fetched_at: new Date().toISOString(),
      payload: null,
    }),
  });
  const r = await routes["POST /api/me/verify"](db, {}, { player_tag: TAG });
  assert.equal(r.statusCode, 409);
  assert.equal(JSON.parse(r.body).error, "verified_elsewhere");
});

test("an alt with no recorded collection yet: the start asks for a read and says collecting", async () => {
  const asked = [];
  const routes = verifyRoutes({
    resolveAccount: async () => ({
      accountId: other,
      role: "member",
      kind: "person",
    }),
    logEvent: async () => {},
    live: async (_db, args) => {
      asked.push(args);
      return {
        ok: false,
        reason: "pending",
        retry_after_s: 15,
        job_id: 7,
        minted: true,
      };
    },
  });
  await db.query(
    `insert into player (player_tag) values ($1) on conflict do nothing`,
    [OTHER_TAG],
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship)
     values ($1, $2, 'unverified', false, 'alt')`,
    [other, OTHER_TAG],
  );
  const r = await routes["POST /api/me/verify"](
    db,
    {},
    { player_tag: OTHER_TAG },
  );
  assert.equal(r.statusCode, 202);
  const body = JSON.parse(r.body);
  assert.equal(body.state, "collecting");
  assert.equal(body.live_pending, true);
  assert.deepEqual(asked, [{ endpoint: "player", entityKey: OTHER_TAG }]);
});

test("expiry: an open challenge past its time reads as expired, and a restart hands back the SAME target", async () => {
  await seedCollection(OTHER_TAG);
  const routes = verifyRoutes({
    resolveAccount: async () => ({
      accountId: other,
      role: "member",
      kind: "person",
    }),
    logEvent: async () => {},
    live: async () => ({
      ok: false,
      reason: "pending",
      retry_after_s: 15,
      job_id: 8,
      minted: true,
    }),
  });
  const first = JSON.parse(
    (await routes["POST /api/me/verify"](db, {}, { player_tag: OTHER_TAG }))
      .body,
  );
  assert.equal(first.state, "open");
  await db.query(
    `update claim_challenge set expires_at = now() - interval '1 minute' where challenge_id = $1`,
    [first.challenge_id],
  );
  const polled = JSON.parse(
    (
      await routes["GET /api/me/verify/*"](db, {
        pathParam: first.challenge_id,
      })
    ).body,
  );
  assert.equal(polled.state, "expired");
  const second = JSON.parse(
    (await routes["POST /api/me/verify"](db, {}, { player_tag: OTHER_TAG }))
      .body,
  );
  assert.equal(second.state, "open");
  assert.notEqual(second.challenge_id, first.challenge_id);
  assert.deepEqual(
    second.target.map((x) => x.id),
    first.target.map((x) => x.id),
    "a challenge that never matched is not a new deck to build",
  );
});

test("rate limits: starts are capped per hour, and the live lane is asked at most once per cadence while polling", async () => {
  const routes = verifyRoutes({
    resolveAccount: async () => ({
      accountId: other,
      role: "member",
      kind: "person",
    }),
    logEvent: async () => {},
    live: async () => ({
      ok: false,
      reason: "pending",
      retry_after_s: 15,
      job_id: 9,
      minted: true,
    }),
  });
  // The account has used starts above; exhaust what is left.
  let last;
  for (let i = 0; i < STARTS_PER_HOUR + 1; i += 1)
    last = await routes["POST /api/me/verify"](
      db,
      {},
      { player_tag: OTHER_TAG },
    );
  assert.equal(last.statusCode, 429);
  assert.equal(JSON.parse(last.body).error, "rate_limited");

  const { rows: open } = await db.query(
    `select challenge_id, live_reads from claim_challenge where account_id = $1 and outcome = 'open'`,
    [other],
  );
  const before = open[0].live_reads;
  await routes["GET /api/me/verify/*"](db, { pathParam: open[0].challenge_id });
  await routes["GET /api/me/verify/*"](db, { pathParam: open[0].challenge_id });
  const { rows: after1 } = await db.query(
    `select live_reads from claim_challenge where challenge_id = $1`,
    [open[0].challenge_id],
  );
  assert.equal(
    after1[0].live_reads,
    before,
    "two polls inside the cadence ask nothing more",
  );
});

test("over HTTP: the routes need a session and the client header, and a bad tag is refused", async () => {
  const anon = await handler({
    rawPath: "/api/me/verify",
    requestContext: { http: { method: "GET" } },
    headers: {},
  });
  assert.equal(anon.statusCode, 401);
  const list = await request("GET", "/api/me/verify");
  assert.equal(list.statusCode, 200);
  assert.ok(Array.isArray(data(list).players));
  const bad = await request("POST", "/api/me/verify", { player_tag: "nope!" });
  assert.equal(bad.statusCode, 400);
  assert.equal(data(bad).error, "invalid_tag");
  const missing = await request(
    "GET",
    "/api/me/verify/00000000-0000-0000-0000-000000000000",
  );
  assert.equal(missing.statusCode, 404);
});
