/**
 * Your own battles, read now (2026-11-14; src/own-refresh.mjs). Pinned
 * here: only your own verified players are asked for, primary first; a log
 * read in the last two minutes is skipped; one ask per account per five
 * minutes however many arrive at once; no token in the global bucket and a
 * spent daily allowance answer `queued: false` quietly and charge nothing;
 * the allowance is its own bucket, never the MCP live quota's; an agent is
 * refused; the follow-up read says when a read landed and wakes Home's
 * stored week once per read. Invented tags only.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { enqueueJob } from "../../../packages/ledger/src/ledger.mjs";
import { makeLive } from "../../../packages/tools/src/live.mjs";
import { AGENT_SCOPED_ROUTES, makeHandler } from "../src/handler.mjs";
import { refreshRoutes } from "../src/routes/refresh.mjs";
import {
  FLOOR_S,
  OTHERS_PER_HOUR,
  PLAYER_FLOOR_S,
  REFRESH_DAY,
} from "../src/own-refresh.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_own_refresh_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

const PRIMARY = "#0GRJCUV";
const ALT = "#0Q2L8";
const UNVERIFIED_ALT = "#0LUVR2";
const FRIEND = "#0YY9P";
const ALL = [PRIMARY, ALT, UNVERIFIED_ALT, FRIEND];
/** Known from an opponent's log only: a page, no recording. */
const STRANGER = "#0PQ2VY";
/** Never seen at all. */
const UNKNOWN = "#0CU8LG";

let db;
let gatewayId;
let person;
const wakes = [];
let routes;

const call = async (method, account, { pool = db, tag } = {}) => {
  const r = routes({ account })[`${method} /api/me/refresh`];
  const event = {
    headers: { "x-elixir-client": "web" },
    ...(tag && method === "GET"
      ? { queryStringParameters: { player_tag: tag } }
      : {}),
  };
  const res = await r(
    pool,
    event,
    tag && method === "POST" ? { player_tag: tag } : {},
  );
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

/** A battle log read `minutesAgo`, as a recorded receipt. */
async function readLog(tag, minutesAgo) {
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('player_battlelog', $1::text, now() - make_interval(mins => $2::int), 'h', $3::uuid, 'admitted')`,
    [tag, minutesAgo, gatewayId],
  );
}

const tokens = async () =>
  Number((await db.query("select tokens from budget_state")).rows[0].tokens);
const openJobs = async () =>
  (
    await db.query(
      `select entity_key from job where endpoint = 'player_battlelog'
        and status in ('queued', 'leased') order by job_id`,
    )
  ).rows.map((r) => r.entity_key);

before(async () => {
  await createScratch(name);
  db = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ('own-refresh-person', 'approved', 'member', 'UTC') returning account_id`,
  );
  person = { accountId: a.account_id, kind: "person", role: "member" };
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'own-refresh-gw', '127.0.0.1', 'active') returning gateway_id`,
    [a.account_id],
  );
  gatewayId = gw.gateway_id;
  for (const tag of ALL) {
    await db.query(`insert into player (player_tag) values ($1)`, [tag]);
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, scope)
       values ('player', $1, $2, 'comprehensive')`,
      [tag, a.account_id],
    );
  }
  await db.query(`insert into player (player_tag) values ($1)`, [STRANGER]);
  for (const [tag, primary, relationship, status] of [
    [PRIMARY, true, "primary", "verified"],
    [ALT, false, "alt", "verified"],
    [UNVERIFIED_ALT, false, "alt", "unverified"],
    [FRIEND, false, "friend", "unverified"],
  ])
    await db.query(
      `insert into claim (account_id, player_tag, is_primary, relationship, notify, status, verified_at)
       values ($1, $2, $3, $4, true, $5, case when $5 = 'verified' then now() end)`,
      [a.account_id, tag, primary, relationship, status],
    );
  const live = makeLive({ enqueue: enqueueJob });
  routes = ({ account }) =>
    refreshRoutes({
      resolveAccount: async () => account,
      live,
      wake: async (accountId, now, opts) => wakes.push({ accountId, ...opts }),
    });
});

after(async () => {
  await db?.end();
  await dropScratch(name);
});

beforeEach(async () => {
  await db.query(`update account set own_refresh_at = null`);
  await db.query(`delete from job`);
  await db.query(`delete from api_receipt`);
  await db.query(`delete from rate_limit`);
  await db.query(`delete from home_feed`);
  await db.query(`update budget_state set tokens = 20`);
  wakes.length = 0;
});

test("asks for your own verified players' logs only, primary first", async () => {
  const before = await tokens();
  const r = await call("POST", person);
  assert.equal(r.status, 200);
  assert.equal(r.body.queued, true);
  assert.deepEqual(
    r.body.players.map((p) => [p.tag, p.state]),
    [
      [PRIMARY, "queued"],
      [ALT, "queued"],
    ],
  );
  for (const p of r.body.players) assert.equal(p.retry_after_s, 15);
  // Nothing private: a tag and a state per player.
  for (const p of r.body.players)
    assert.deepEqual(Object.keys(p).sort(), ["retry_after_s", "state", "tag"]);
  assert.deepEqual(await openJobs(), [PRIMARY, ALT]);
  const { rows: jobs } = await db.query(`select lane, record from job`);
  for (const j of jobs) assert.deepEqual(j, { lane: "live", record: true });
  // One token each from the one global bucket, and the person's own
  // allowance, never the MCP live quota's bucket.
  assert.equal(before - (await tokens()), 2);
  const { rows: buckets } = await db.query(
    `select bucket, count from rate_limit where bucket like '%day#%'`,
  );
  assert.deepEqual(buckets, [
    { bucket: `${REFRESH_DAY}${person.accountId}`, count: 2 },
  ]);
});

test("a log read in the last two minutes is fresh, and nothing is minted for it", async () => {
  await readLog(PRIMARY, 1);
  await readLog(ALT, 3);
  const r = await call("POST", person);
  assert.deepEqual(
    r.body.players.map((p) => [p.tag, p.state]),
    [
      [PRIMARY, "fresh"],
      [ALT, "queued"],
    ],
  );
  assert.deepEqual(await openJobs(), [ALT]);
});

test("one ask per five minutes, however many arrive at once", async () => {
  const many = await Promise.all(
    Array.from({ length: 6 }, () => call("POST", person)),
  );
  for (const r of many) assert.equal(r.status, 200);
  // Exactly one passed the floor and minted; the rest minted nothing.
  assert.deepEqual(await openJobs(), [PRIMARY, ALT]);
  const { rows } = await db.query(
    `select count from rate_limit where bucket = $1`,
    [`${REFRESH_DAY}${person.accountId}`],
  );
  assert.equal(rows[0].count, 2);
  // A later ask inside the floor answers the open reads as queued.
  const again = await call("POST", person);
  assert.deepEqual(
    again.body.players.map((p) => p.state),
    ["queued", "queued"],
  );
  // With the reads done and the floor still shut: skipped, and when to ask.
  await db.query(`update job set status = 'done'`);
  const shut = await call("POST", person);
  assert.equal(shut.body.queued, false);
  for (const p of shut.body.players) {
    assert.equal(p.state, "skipped");
    assert.ok(p.retry_after_s > 0 && p.retry_after_s <= FLOOR_S);
  }
  assert.deepEqual(await openJobs(), []);
  // Past the floor, the next ask mints again.
  await db.query(
    `update account set own_refresh_at = now() - interval '301 seconds'`,
  );
  const open = await call("POST", person);
  assert.equal(open.body.queued, true);
});

test("no token in the global bucket: queued false, nothing charged", async () => {
  await db.query(`update budget_state set tokens = 0`);
  const r = await call("POST", person);
  assert.equal(r.status, 200);
  assert.equal(r.body.queued, false);
  for (const p of r.body.players) {
    assert.equal(p.state, "skipped");
    assert.ok(p.retry_after_s >= 15);
  }
  assert.deepEqual(await openJobs(), []);
  assert.equal(await tokens(), 0);
  const { rows } = await db.query(
    `select 1 from rate_limit where bucket like '${REFRESH_DAY}%'`,
  );
  assert.equal(rows.length, 0);
});

test("the day's allowance spent: queued false, and the token goes back", async () => {
  // Member: the size of the live quota, 20 a day, in its own bucket.
  await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 20)`,
    [
      `${REFRESH_DAY}${person.accountId}`,
      new Date().toISOString().slice(0, 10),
    ],
  );
  const r = await call("POST", person);
  assert.equal(r.status, 200);
  assert.equal(r.body.queued, false);
  assert.deepEqual(
    r.body.players.map((p) => p.state),
    ["skipped", "skipped"],
  );
  assert.deepEqual(await openJobs(), []);
  assert.equal(await tokens(), 20);
  // The MCP live quota's bucket is untouched either way.
  const { rows } = await db.query(
    `select 1 from rate_limit where bucket like 'liveday#%'`,
  );
  assert.equal(rows.length, 0);
});

test("an agent is refused, and no agent console reaches the route", async () => {
  for (const method of ["POST", "GET"]) {
    const r = await call(method, { ...person, kind: "agent" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "not_entitled");
  }
  for (const key of AGENT_SCOPED_ROUTES)
    assert.equal(/\/refresh$/.test(key), false, key);
  assert.deepEqual(await openJobs(), []);
  // Wired into the web API: signed out is a 401, not a missing route.
  const handler = makeHandler({
    databaseUrl,
    secret: "own-refresh-secret",
    sendLoginEmail: async () => {},
  });
  for (const method of ["POST", "GET"]) {
    const res = await handler({
      path: "/api/me/refresh",
      method,
      headers: { "x-elixir-client": "web" },
    });
    assert.equal(res.statusCode, 401, method);
  }
});

test("the follow-up read says when a read landed and wakes the stored week once", async () => {
  await call("POST", person);
  const waiting = await call("GET", person);
  assert.deepEqual(
    waiting.body.players.map((p) => [p.tag, p.pending, p.read_at]),
    [
      [PRIMARY, true, null],
      [ALT, true, null],
    ],
  );
  // Home's week was built a minute ago; the primary's read lands now.
  await db.query(
    `insert into home_feed (account_id, built_at, build_ms, window_from, window_to, timezone, subjects_key, items, more)
     values ($1, now() - interval '1 minute', 1, now() - interval '7 days', now(), 'UTC', 'k', '[]'::jsonb, 0)`,
    [person.accountId],
  );
  await db.query(`update job set status = 'done' where entity_key = $1`, [
    PRIMARY,
  ]);
  await readLog(PRIMARY, 0);
  const landed = await call("GET", person);
  assert.equal(landed.body.players[0].pending, false);
  assert.ok(landed.body.players[0].read_at);
  assert.equal(landed.body.feed_current, false);
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].accountId, person.accountId);
  assert.equal(wakes[0].since, landed.body.players[0].read_at);
  // Built after the read: current, and no wake.
  await db.query(`update home_feed set built_at = now() + interval '1 second'`);
  const current = await call("GET", person);
  assert.equal(current.body.feed_current, true);
  assert.equal(wakes.length, 1);
});

/* --- Any player's battles: the player page's button ------------------- */

const liveday = async () =>
  Number(
    (
      await db.query(`select count from rate_limit where bucket = $1`, [
        `liveday#${person.accountId}`,
      ])
    ).rows[0]?.count ?? 0,
  );

test("another player's button: one recording read, charged as a live read", async () => {
  const before = await tokens();
  const r = await call("POST", person, {
    tag: STRANGER.slice(1).toLowerCase(),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    queued: true,
    players: [{ tag: STRANGER, state: "queued", retry_after_s: 15 }],
  });
  const { rows: jobs } = await db.query(
    `select entity_key, lane, record from job where status = 'queued'`,
  );
  assert.deepEqual(jobs, [
    { entity_key: STRANGER, lane: "live", record: true },
  ]);
  assert.equal(before - (await tokens()), 1);
  assert.equal(await liveday(), 1);
  // One read, never a recording: nothing starts recording them.
  const { rows: rec } = await db.query(
    `select 1 from recording where subject_tag = $1`,
    [STRANGER],
  );
  assert.equal(rec.length, 0);
  // The follow-up read is that player's.
  const s = await call("GET", person, { tag: STRANGER });
  assert.deepEqual(s.body.players, [
    { tag: STRANGER, read_at: null, pending: true },
  ]);
});

test("another player: read two minutes ago is fresh, and spends nothing", async () => {
  await readLog(STRANGER, 1);
  const r = await call("POST", person, { tag: STRANGER });
  assert.deepEqual(r.body.players, [{ tag: STRANGER, state: "fresh" }]);
  assert.deepEqual(await openJobs(), []);
  assert.equal(await liveday(), 0);
});

test("another player: taps at once mint once, and the floor holds two minutes", async () => {
  const many = await Promise.all(
    Array.from({ length: 6 }, () => call("POST", person, { tag: STRANGER })),
  );
  for (const r of many) assert.equal(r.status, 200);
  assert.deepEqual(await openJobs(), [STRANGER]);
  assert.equal(await liveday(), 1);
  // The read failed, say, and nothing is open: inside the floor, wait.
  await db.query(`update job set status = 'dead'`);
  // Should the two-minute slot turn over just here, its next one is taken
  // too, so this step never depends on the clock.
  await db.query(
    `insert into rate_limit (bucket, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int + $2::int), 1)
     on conflict do nothing`,
    [`refreshone#${person.accountId}#${STRANGER}`, PLAYER_FLOOR_S],
  );
  const shut = await call("POST", person, { tag: STRANGER });
  assert.equal(shut.body.queued, false);
  assert.equal(shut.body.players[0].state, "skipped");
  const wait = shut.body.players[0].retry_after_s;
  assert.ok(wait >= 1 && wait <= PLAYER_FLOOR_S, String(wait));
  assert.equal(await liveday(), 1);
});

test("another player: the hour's cap holds under concurrent taps on many players", async () => {
  const tags = [];
  // Invented tags over the alphabet, built here, never real players.
  for (let i = 0; i < OTHERS_PER_HOUR + 4; i++) {
    const tag = `#0${"2289PYLQGRJCUV"[i]}${"0289PYLQGRJCUV"[(i * 3) % 14]}Q8`;
    tags.push(tag);
    await db.query(
      `insert into player (player_tag) values ($1) on conflict do nothing`,
      [tag],
    );
  }
  const answers = await Promise.all(
    tags.map((tag) => call("POST", person, { tag })),
  );
  const queued = answers.filter((r) => r.body.queued);
  assert.equal(queued.length, OTHERS_PER_HOUR);
  assert.equal((await openJobs()).length, OTHERS_PER_HOUR);
  for (const r of answers.filter((a) => !a.body.queued)) {
    assert.equal(r.status, 200);
    assert.equal(r.body.players[0].state, "skipped");
    assert.ok(r.body.players[0].retry_after_s > 0);
  }
  // Refused taps took no token and no live quota.
  assert.equal(await liveday(), OTHERS_PER_HOUR);
  assert.equal(20 - (await tokens()), OTHERS_PER_HOUR);
  for (const tag of tags)
    await db.query(`delete from player where player_tag = $1::text`, [tag]);
});

test("another player: the live quota spent, or no token, answers quietly", async () => {
  await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 20)`,
    [`liveday#${person.accountId}`, new Date().toISOString().slice(0, 10)],
  );
  const spent = await call("POST", person, { tag: STRANGER });
  assert.equal(spent.status, 200);
  assert.equal(spent.body.players[0].state, "skipped");
  assert.ok(spent.body.players[0].retry_after_s > 0);
  assert.equal(await tokens(), 20);
  const { rows } = await db.query(
    `select count from rate_limit where bucket like 'refreshother#%'`,
  );
  assert.deepEqual(rows, [{ count: 0 }]);
  await db.query(`delete from rate_limit`);
  await db.query(`update budget_state set tokens = 0`);
  const none = await call("POST", person, { tag: STRANGER });
  assert.equal(none.body.queued, false);
  assert.equal(none.body.players[0].state, "skipped");
  assert.deepEqual(await openJobs(), []);
  assert.equal(await liveday(), 0);
});

test("another player: unknown, invalid, an agent, and your own player", async () => {
  const unknown = await call("POST", person, { tag: UNKNOWN });
  assert.deepEqual(unknown.body, {
    queued: false,
    players: [{ tag: UNKNOWN, state: "skipped" }],
  });
  assert.deepEqual(await openJobs(), []);
  const bad = await call("POST", person, { tag: "not a tag!" });
  assert.equal(bad.status, 400);
  for (const method of ["POST", "GET"]) {
    const r = await call(
      method,
      { ...person, kind: "agent" },
      { tag: STRANGER },
    );
    assert.equal(r.status, 403);
  }
  assert.deepEqual(await openJobs(), []);
  // Your own verified player is your own refresh, the chip's action.
  const own = await call("POST", person, { tag: PRIMARY });
  assert.deepEqual(
    own.body.players.map((p) => p.tag),
    [PRIMARY, ALT],
  );
  assert.equal(await liveday(), 0);
});
