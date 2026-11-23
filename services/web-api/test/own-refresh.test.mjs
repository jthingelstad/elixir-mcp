/**
 * Your own battles, read now (2026-11-14; src/own-refresh.mjs). Pinned
 * here: only your own verified players are asked for, primary first; a log
 * read in the last two minutes is skipped; one ask per account per five
 * minutes however many arrive at once; no token in the global bucket and a
 * spent daily allowance answer `queued: false` quietly and charge nothing;
 * the allowance is its own bucket, never the MCP live quota's; the
 * follow-up read says when a read landed and wakes Home's
 * stored week once per read. A tap of Check for new battles (2026-11-23)
 * also reads the page player's profile, under the rules readProfile
 * states, and its follow-up read says what the check found. Invented tags
 * only.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { enqueueJob } from "../../../packages/ledger/src/ledger.mjs";
import { makeLive } from "../../../packages/tools/src/live.mjs";
import { makeHandler } from "../src/handler.mjs";
import { refreshRoutes } from "../src/routes/refresh.mjs";
import {
  FLOOR_S,
  OTHERS_PER_HOUR,
  PLAYER_FLOOR_S,
  PROFILE_FRESH_S,
  REFRESH_DAY,
  SINCE_MAX_S,
  decodeSince,
  encodeSince,
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
const clientsEnded = [];
let gatewayId;
let person;
const wakes = [];
let routes;

const call = async (
  method,
  account,
  { pool = db, tag, tap = false, since } = {},
) => {
  const r = routes({ account })[`${method} /api/me/refresh`];
  const event = {
    headers: { "x-elixir-client": "web" },
    ...(tag && method === "GET"
      ? {
          queryStringParameters: {
            player_tag: tag,
            ...(since ? { since } : {}),
          },
        }
      : {}),
  };
  const res = await r(
    pool,
    event,
    tag && method === "POST"
      ? { player_tag: tag, ...(tap ? { tap: true } : {}) }
      : {},
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

/** A profile read `minutesAgo`, as a recorded receipt. */
async function readProfileReceipt(tag, minutesAgo) {
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('player', $1::text, now() - make_interval(mins => $2::int), 'h', $3::uuid, 'admitted')`,
    [tag, minutesAgo, gatewayId],
  );
}
const openProfiles = async () =>
  (
    await db.query(
      `select entity_key from job where endpoint = 'player'
        and status in ('queued', 'leased') order by job_id`,
    )
  ).rows.map((r) => r.entity_key);

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
  db.on("connect", (client) => {
    clientsEnded.push(new Promise((resolve) => client.once("end", resolve)));
  });
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
  // Pool.end resolves when clients leave the pool, before their sockets
  // necessarily close. Let PostgreSQL finish disconnecting before FORCE
  // drops the scratch database, so it cannot terminate a retiring client.
  await Promise.all(clientsEnded);
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

test("the route is wired into the web API: signed out is a 401, not a missing route", async () => {
  const handler = makeHandler({
    databaseUrl,
    secret: "own-refresh-secret",
    sendLoginEmail: async () => {},
  });
  try {
    for (const method of ["POST", "GET"]) {
      const res = await handler({
        path: "/api/me/refresh",
        method,
        headers: { "x-elixir-client": "web" },
      });
      assert.equal(res.statusCode, 401, method);
    }
  } finally {
    // Its pool closes before the scratch database is dropped: an idle
    // connection the drop terminates otherwise surfaces after the run as
    // an uncaught error, failing the file now and then (2026-11-14).
    await handler.close();
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

test("another player: an unlimited live quota (admin) is not held to the hour", async () => {
  const admin = { ...person, role: "admin" };
  const tags = [];
  for (let i = 0; i < OTHERS_PER_HOUR + 2; i++) {
    const tag = `#0${"2289PYLQGRJCUV"[i]}${"0289PYLQGRJCUV"[(i * 5) % 14]}V2`;
    tags.push(tag);
    await db.query(
      `insert into player (player_tag) values ($1) on conflict do nothing`,
      [tag],
    );
  }
  for (const tag of tags) {
    const r = await call("POST", admin, { tag });
    assert.equal(r.body.queued, true, tag);
  }
  assert.equal((await openJobs()).length, OTHERS_PER_HOUR + 2);
  assert.equal(await liveday(), 0);
  // A second tap on one player mints nothing more.
  await call("POST", admin, { tag: tags[0] });
  assert.equal((await openJobs()).length, OTHERS_PER_HOUR + 2);
  for (const tag of tags)
    await db.query(`delete from player where player_tag = $1::text`, [tag]);
});

test("a read already on its way by live_fetch (fetch-only) becomes a recording one, for nothing", async () => {
  for (const tag of [STRANGER, PRIMARY])
    await enqueueJob(db, {
      endpoint: "player_battlelog",
      entity_key: tag,
      lane: "live",
      record: false,
    });
  const other = await call("POST", person, { tag: STRANGER });
  assert.equal(other.body.players[0].state, "queued");
  const own = await call("POST", person);
  assert.equal(own.body.players[0].state, "queued");
  const { rows } = await db.query(
    `select entity_key, record from job where endpoint = 'player_battlelog'
      and status in ('queued', 'leased') order by job_id`,
  );
  const byTag = Object.fromEntries(rows.map((r) => [r.entity_key, r.record]));
  assert.equal(byTag[STRANGER], true);
  assert.equal(byTag[PRIMARY], true);
  assert.equal(await tokens(), 20 - (rows.length - 2));
  assert.equal(await liveday(), 0);
});

test("a queued bulk read of the player moves to the live lane, for nothing", async () => {
  await enqueueJob(db, {
    endpoint: "player_battlelog",
    entity_key: STRANGER,
    lane: "bulk",
    record: true,
  });
  const r = await call("POST", person, { tag: STRANGER });
  assert.equal(r.body.players[0].state, "queued");
  const { rows } = await db.query(
    `select lane, record from job where endpoint = 'player_battlelog'
      and entity_key = $1::text and status in ('queued', 'leased')`,
    [STRANGER],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lane, "live");
  assert.equal(rows[0].record, true);
  assert.equal(await tokens(), 20);
  assert.equal(await liveday(), 0);
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

test("another player: unknown, invalid, and your own player", async () => {
  const unknown = await call("POST", person, { tag: UNKNOWN });
  assert.deepEqual(unknown.body, {
    queued: false,
    players: [{ tag: UNKNOWN, state: "skipped" }],
  });
  assert.deepEqual(await openJobs(), []);
  const bad = await call("POST", person, { tag: "not a tag!" });
  assert.equal(bad.status, 400);
  assert.deepEqual(await openJobs(), []);
  // Your own verified player is your own refresh, the chip's action.
  const own = await call("POST", person, { tag: PRIMARY });
  assert.deepEqual(
    own.body.players.map((p) => p.tag),
    [PRIMARY, ALT],
  );
  assert.equal(await liveday(), 0);
});

/* --- A tap also reads the profile, and says what it found (2026-11-23) - */

const count = async (bucket) =>
  Number(
    (
      await db.query(
        `select coalesce(sum(count), 0) as n from rate_limit where bucket = $1`,
        [bucket],
      )
    ).rows[0].n,
  );

test("a tap on another player reads their profile too, for one global token and no second allowance", async () => {
  const before = await tokens();
  const r = await call("POST", person, { tag: STRANGER, tap: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.queued, true);
  assert.deepEqual(r.body.players, [
    { tag: STRANGER, state: "queued", retry_after_s: 15, profile: "queued" },
  ]);
  assert.equal(typeof r.body.since, "string");
  assert.deepEqual(await openJobs(), [STRANGER]);
  assert.deepEqual(await openProfiles(), [STRANGER]);
  const { rows } = await db.query(
    `select lane, record from job where endpoint = 'player'`,
  );
  assert.deepEqual(rows, [{ lane: "live", record: true }]);
  // Two reads from the one bucket; one ask from the person's allowances.
  assert.equal(before - (await tokens()), 2);
  assert.equal(await liveday(), 1);
  assert.equal(await count(`refreshother#${person.accountId}`), 1);
  // A one-off read, never a recording.
  const { rows: rec } = await db.query(
    `select 1 from recording where subject_tag = $1`,
    [STRANGER],
  );
  assert.equal(rec.length, 0);
});

test("the app's own asks, and a button without a tap, read no profile", async () => {
  await call("POST", person);
  await call("POST", person, { tag: STRANGER });
  assert.deepEqual(await openProfiles(), []);
  const own = await call("POST", person);
  for (const p of own.body.players) assert.equal("profile" in p, false);
  assert.equal("since" in own.body, false);
});

test("a profile read already on its way is joined, and one read recently is fresh", async () => {
  await enqueueJob(db, {
    endpoint: "player",
    entity_key: STRANGER,
    lane: "bulk",
    record: true,
  });
  const joined = await call("POST", person, { tag: STRANGER, tap: true });
  assert.equal(joined.body.players[0].profile, "queued");
  // Joined, never minted twice: the bulk job moved to the live lane.
  const { rows } = await db.query(
    `select lane from job where endpoint = 'player' and status = 'queued'`,
  );
  assert.deepEqual(rows, [{ lane: "live" }]);
  assert.equal(await tokens(), 19);
  await db.query(`delete from job`);
  await db.query(`delete from rate_limit`);
  await readProfileReceipt(STRANGER, PROFILE_FRESH_S / 60 - 1);
  const fresh = await call("POST", person, { tag: STRANGER, tap: true });
  assert.equal(fresh.body.players[0].state, "queued");
  assert.equal(fresh.body.players[0].profile, "fresh");
  assert.deepEqual(await openProfiles(), []);
});

test("no token for the profile: the battle log goes ahead, the profile is not read", async () => {
  await db.query(`update budget_state set tokens = 1`);
  const r = await call("POST", person, { tag: STRANGER, tap: true });
  assert.equal(r.body.queued, true);
  assert.equal(r.body.players[0].state, "queued");
  assert.equal(r.body.players[0].retry_after_s, 15);
  assert.equal(r.body.players[0].profile, "skipped");
  assert.deepEqual(await openJobs(), [STRANGER]);
  assert.deepEqual(await openProfiles(), []);
  assert.equal(await tokens(), 0);
  assert.equal(await liveday(), 1);
});

test("an ask a limit refused, or an unknown player, reads no profile", async () => {
  await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 20)`,
    [`liveday#${person.accountId}`, new Date().toISOString().slice(0, 10)],
  );
  const spent = await call("POST", person, { tag: STRANGER, tap: true });
  assert.equal(spent.body.queued, false);
  assert.equal(spent.body.players[0].state, "skipped");
  assert.ok(spent.body.players[0].retry_after_s > 0);
  assert.equal(spent.body.players[0].profile, "skipped");
  const unknown = await call("POST", person, { tag: UNKNOWN, tap: true });
  assert.equal(unknown.body.players[0].state, "skipped");
  assert.equal(unknown.body.players[0].profile, "skipped");
  assert.deepEqual(await openProfiles(), []);
  assert.equal(await tokens(), 20);
});

test("a tap on your own page reads that player's profile only, within your own ask", async () => {
  const r = await call("POST", person, { tag: PRIMARY, tap: true });
  assert.deepEqual(
    r.body.players.map((p) => [p.tag, p.state, p.profile]),
    [
      [PRIMARY, "queued", "queued"],
      [ALT, "queued", undefined],
    ],
  );
  assert.deepEqual(await openProfiles(), [PRIMARY]);
  // Two logs and one profile from the bucket; the day's allowance counts
  // the two logs only, and the live quota nothing.
  assert.equal(20 - (await tokens()), 3);
  assert.equal(await count(`${REFRESH_DAY}${person.accountId}`), 2);
  assert.equal(await liveday(), 0);
  // Its follow-up read is your own refresh's: every own player, and the
  // tapped one says what the check found.
  const s = await call("GET", person, { tag: PRIMARY, since: r.body.since });
  assert.deepEqual(
    s.body.players.map((p) => p.tag),
    [PRIMARY, ALT],
  );
  assert.equal(s.body.players[0].profile_pending, true);
  assert.equal(s.body.players[0].new_battles, 0);
  assert.equal("new_battles" in s.body.players[1], false);
});

test("the check's follow-up read: new battles and what moved on the profile", async () => {
  const CLAN = "#0C2C8";
  await db.query(
    `insert into arena (arena_id, name) values (54000001, 'Arena One'), (54000002, 'Arena Two')
     on conflict do nothing`,
  );
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Test Clan') on conflict do nothing`,
    [CLAN],
  );
  await db.query(`update player set name = 'Pip' where player_tag = $1`, [
    STRANGER,
  ]);
  // What Elixir had: yesterday's profile, in no clan, and one battle.
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, trophies, best_trophies,
       arena_id, pol_league, observed_at, profile_observed_at)
     values ($1, current_date - 1, 5000, 5100, 54000001, 2, now() - interval '1 day', now() - interval '1 day')`,
    [STRANGER],
  );
  await db.query(
    `insert into player_profile_membership (player_tag, state, observed_at)
     values ($1, 'none', now() - interval '1 day')`,
    [STRANGER],
  );
  const battle = async (id, ago) => {
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ($1, now() - $2::interval, 'PvP', 'pvp')`,
      [id, ago],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, battle_time, type, type_class)
       values ($1, $2, 0, now() - $3::interval, 'PvP', 'pvp')`,
      [id, STRANGER, ago],
    );
  };
  await battle("check-old", "2 days");
  try {
    const asked = await call("POST", person, { tag: STRANGER, tap: true });
    const since = asked.body.since;
    const waiting = await call("GET", person, { tag: STRANGER, since });
    assert.deepEqual(waiting.body.players[0], {
      tag: STRANGER,
      read_at: null,
      pending: true,
      new_battles: 0,
      newest_battle_at: waiting.body.players[0].newest_battle_at,
      latest_is_new: false,
      profile_read_at: null,
      profile_pending: true,
      profile_changes: [],
    });
    // Both land: two battles Elixir did not have, the newest among them,
    // and a profile that moved.
    await battle("check-new-1", "10 minutes");
    await battle("check-new-2", "3 days");
    await db.query(`update job set status = 'done'`);
    await readLog(STRANGER, 0);
    await readProfileReceipt(STRANGER, 0);
    await db.query(
      `insert into player_snapshot_daily (player_tag, snapshot_date, trophies, best_trophies,
         arena_id, pol_league, observed_at, profile_observed_at)
       values ($1, current_date, 5240, 5240, 54000002, 3, now(), now())`,
      [STRANGER],
    );
    await db.query(
      `update player_profile_membership set state = 'member', clan_tag = $2, observed_at = now()
        where player_tag = $1`,
      [STRANGER, CLAN],
    );
    await db.query(`update player set name = 'Pip Two' where player_tag = $1`, [
      STRANGER,
    ]);
    const landed = await call("GET", person, { tag: STRANGER, since });
    const p = landed.body.players[0];
    assert.equal(p.pending, false);
    assert.equal(p.profile_pending, false);
    assert.equal(p.new_battles, 2);
    assert.equal(p.latest_is_new, true);
    assert.ok(Date.now() - Date.parse(p.newest_battle_at) < 11 * 60_000);
    assert.deepEqual(p.profile_changes, [
      { field: "name", from: "Pip", to: "Pip Two" },
      {
        field: "clan",
        from: null,
        to: { tag: CLAN, name: "Test Clan" },
      },
      { field: "trophies", from: 5000, to: 5240 },
      { field: "best_trophies", from: 5100, to: 5240 },
      { field: "arena", from: "Arena One", to: "Arena Two" },
      { field: "league", from: "Master II", to: "Master III" },
    ]);
    // Without a marker, or with one that is not one: the plain answer.
    for (const bad of [undefined, "not-a-marker"]) {
      const plain = await call("GET", person, { tag: STRANGER, since: bad });
      assert.deepEqual(Object.keys(plain.body.players[0]).sort(), [
        "pending",
        "read_at",
        "tag",
      ]);
    }
  } finally {
    await db.query(
      `delete from battle_participant where player_tag = $1::text`,
      [STRANGER],
    );
    await db.query(`delete from battle where battle_id like 'check-%'`);
    await db.query(`delete from player_snapshot_daily where player_tag = $1`, [
      STRANGER,
    ]);
    await db.query(
      `delete from player_profile_membership where player_tag = $1`,
      [STRANGER],
    );
  }
});

test("older battles new to Elixir are new to the record, not the latest", async () => {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ('older-newest', now() - interval '1 hour', 'PvP', 'pvp')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, type, type_class)
     values ('older-newest', $1, 0, now() - interval '1 hour', 'PvP', 'pvp')`,
    [STRANGER],
  );
  try {
    const asked = await call("POST", person, { tag: STRANGER, tap: true });
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ('older-added', now() - interval '2 days', 'PvP', 'pvp')`,
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, battle_time, type, type_class)
       values ('older-added', $1, 0, now() - interval '2 days', 'PvP', 'pvp')`,
      [STRANGER],
    );
    const s = await call("GET", person, {
      tag: STRANGER,
      since: asked.body.since,
    });
    assert.equal(s.body.players[0].new_battles, 1);
    assert.equal(s.body.players[0].latest_is_new, false);
    // No profile before and none newer: nothing is said to have moved.
    assert.deepEqual(s.body.players[0].profile_changes, []);
  } finally {
    await db.query(
      `delete from battle_participant where battle_id like 'older-%'`,
    );
    await db.query(`delete from battle where battle_id like 'older-%'`);
  }
});

test("a marker is read back only while it is recent", () => {
  const facts = {
    at: new Date().toISOString(),
    name: "Pip",
    clan: 0,
    trophies: 10,
    arena: null,
    best: 12,
    league: null,
    observed: null,
  };
  const ok = decodeSince(encodeSince(facts));
  assert.equal(ok.facts.name, "Pip");
  assert.equal(ok.facts.clan, 0);
  assert.equal(ok.facts.trophies, 10);
  const old = {
    ...facts,
    at: new Date(Date.now() - (SINCE_MAX_S + 5) * 1000).toISOString(),
  };
  assert.equal(decodeSince(encodeSince(old)), null);
  assert.equal(decodeSince("%%%"), null);
  assert.equal(decodeSince(Buffer.from("[1]").toString("base64url")), null);
});
