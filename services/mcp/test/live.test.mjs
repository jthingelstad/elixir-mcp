import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { makeLive, livePathToJob } from "../src/live.mjs";
import { enqueueJob } from "../../scheduler/src/ledger.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { normalizeTag } from "@elixir-mcp/contracts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_live_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let gatewayId;
let account;

async function fixture(rel) {
  return JSON.parse(
    await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
  );
}

/** A fake LIVE-channel gateway: enqueue the real ledger job, then run the
 *  REAL results pipeline as if THAT job's fetch completed — the exact
 *  round trip, minus the wire. The receipt carries the job id and the
 *  live gateway, which is what the waiter binds to (issue #3). */
function fakeGatewayLive(payloadByKey) {
  return makeLive({
    retryAfterS: 15,
    enqueue: async (_db, job) => {
      const row = await enqueueJob(db, job);
      const payload = payloadByKey[`${job.endpoint}:${job.entity_key}`];
      if (!payload) return row; // never fulfilled -> stays pending
      await processResult(db, {
        v: 1,
        job,
        job_id: Number(row.job_id),
        gateway_id: gatewayId,
        fetched_at: new Date().toISOString(),
        status: "ok",
        body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
          "base64",
        ),
      });
      // A real submit closes the lease; the next ask must see no open job.
      await db.query(`update job set status = 'done' where job_id = $1`, [
        row.job_id,
      ]);
      return row;
    },
  });
}

/** A recorded-but-stale profile for a tag: a bulk receipt older than the
 *  API's cache window, so live: true has something to answer from and a
 *  reason to queue. */
async function recordStale(profile, minutesAgo = 10) {
  const job = {
    endpoint: "player",
    entity_key: normalizeTag(profile.tag),
    lane: "bulk",
  };
  await processResult(db, {
    v: 1,
    job,
    gateway_id: gatewayId,
    fetched_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(profile))).toString(
      "base64",
    ),
  });
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('live-owner', 'approved', false)
     returning account_id`,
  );
  account = { accountId: acct.account_id, isOwner: false, timezone: null };
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status, channel)
     values ($1, 'live-gw', '127.0.0.1', 'active', 'live') returning gateway_id`,
    [acct.account_id],
  );
  gatewayId = gw.gateway_id;
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("livePathToJob maps the allowlist and rejects the rest", () => {
  assert.deepEqual(livePathToJob("/players/#20JJJ2CCRU", normalizeTag), {
    endpoint: "player",
    entityKey: "#20JJJ2CCRU",
  });
  assert.deepEqual(
    livePathToJob("/clans/#J2RGCRVG/riverracelog", normalizeTag),
    {
      endpoint: "riverracelog",
      entityKey: "#J2RGCRVG",
    },
  );
  assert.equal(
    livePathToJob("/locations/global", normalizeTag).error,
    "bad_request",
  );
  assert.equal(
    livePathToJob("/players/NOPE!", normalizeTag).error,
    "invalid_tag",
  );
});

test("live_fetch: the first ask queues and answers live_pending; the second finds the fresh payload, recorded", async () => {
  const profile = await fixture("player/profile.json");
  const tag = normalizeTag(profile.tag);
  const live = fakeGatewayLive({ [`player:${tag}`]: profile });
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const first = await invoke("live_fetch", { path: `/players/${tag}` });
  assert.equal(first.isError, true);
  assert.equal(first.body.error.code, "live_pending");
  assert.match(first.body.error.hint, /15 s/);
  const { body, isError } = await invoke("live_fetch", {
    path: `/players/${tag}`,
  });
  assert.equal(isError, false, JSON.stringify(body).slice(0, 200));
  assert.equal(body.live, true);
  assert.equal(body.live_status.state, "fresh");
  assert.equal(body.data.tag, profile.tag, "API-shaped passthrough");
  // Opportunistic recording: the fetch left a snapshot behind.
  const snaps = (
    await db.query(
      `select count(*)::int n from player_snapshot_daily where player_tag = $1`,
      [tag],
    )
  ).rows[0].n;
  assert.ok(snaps > 0, "live fetch was recorded");
});

test("players_profile live:true answers from the record NOW with pending, then serves the fresh snapshot", async () => {
  const profile = structuredClone(await fixture("player/profile.json"));
  profile.tag = "#PP0Y8LQ";
  const tag = profile.tag;
  await db.query(`delete from api_receipt where entity_key = $1`, [tag]);
  await recordStale(profile, 10); // creates the player row the claim needs
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'unverified', true)
     on conflict do nothing`,
    [account.accountId, tag],
  );
  const fresher = structuredClone(profile);
  fresher.trophies += 99;
  // A collector fulfils the queued job BETWEEN the two calls, as in
  // production; the first call sees only the record as it stands.
  let queued = null;
  const live = makeLive({
    retryAfterS: 15,
    enqueue: async (_db, job) => (queued = await enqueueJob(db, job)),
  });
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const first = await invoke("players_profile", {
    player_tag: tag,
    live: true,
  });
  assert.ok(queued, "a priority fetch was queued");
  await processResult(db, {
    v: 1,
    job: { endpoint: "player", entity_key: tag, lane: "live" },
    job_id: Number(queued.job_id),
    gateway_id: gatewayId,
    fetched_at: new Date().toISOString(),
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(fresher))).toString(
      "base64",
    ),
  });
  await db.query(`update job set status = 'done' where job_id = $1`, [
    queued.job_id,
  ]);
  assert.equal(first.isError, false, JSON.stringify(first.body).slice(0, 200));
  assert.equal(first.body.live_status.state, "pending");
  assert.equal(first.body.live_status.retry_after_s, 15);
  assert.equal(
    first.body.snapshot.trophies,
    profile.trophies,
    "the record as it stands",
  );
  assert.match(first.body.notes.join(" "), /queued; call again in 15 s/);
  const second = await invoke("players_profile", {
    player_tag: tag,
    live: true,
  });
  assert.equal(second.isError, false);
  assert.equal(second.body.live_status.state, "fresh");
  assert.equal(second.body.snapshot.trophies, fresher.trophies, "served fresh");
});

test("an unfulfilled live ask stays live_pending; asking again neither mints a second job nor charges twice", async () => {
  const live = fakeGatewayLive({});
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const day = new Date().toISOString().slice(0, 10);
  const bucket = async () =>
    (
      await db.query(
        `select coalesce(sum(count), 0)::int as n from rate_limit where bucket = $1 and window_start = $2::date`,
        [`liveday#${account.accountId}`, day],
      )
    ).rows[0].n;
  const before = await bucket();
  for (let i = 0; i < 2; i += 1) {
    const { body, isError } = await invoke("live_fetch", {
      path: "/clans/#GQ0YLCYJ",
    });
    assert.equal(isError, true);
    assert.equal(body.error.code, "live_pending");
  }
  const { rows: jobs } = await db.query(
    `select count(*)::int n from job where entity_key = '#GQ0YLCYJ' and status in ('queued', 'leased')`,
  );
  assert.equal(jobs[0].n, 1, "one open job for the subject");
  assert.equal(await bucket(), before + 1, "charged once, when minted");
});

test("the live daily cap trips as quota_exceeded before anything is minted", async () => {
  const tag = "#QQ0Y8LQ";
  const day = new Date().toISOString().slice(0, 10);
  await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 50)
     on conflict (bucket, window_start) do update set count = 50`,
    [`liveday#${account.accountId}`, day],
  );
  const live = fakeGatewayLive({});
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const { body, isError } = await invoke("live_fetch", {
    path: `/players/${tag}`,
  });
  assert.equal(isError, true);
  assert.equal(body.error.code, "quota_exceeded");
  const { rows: jobs } = await db.query(
    `select count(*)::int n from job where entity_key = $1`,
    [tag],
  );
  assert.equal(jobs[0].n, 0, "nothing minted for a refused ask");
  await db.query(
    `delete from rate_limit where bucket = $1 and window_start = $2::date`,
    [`liveday#${account.accountId}`, day],
  );
});

test("rankings paths map to leaderboard jobs; bad locations refuse (feedback #6)", async (t) => {
  const { livePathToJob } = await import("../src/live.mjs");
  const { normalizeTag } = await import("@elixir-mcp/contracts");
  const g = livePathToJob("/locations/global/rankings/players", normalizeTag);
  t.assert.deepStrictEqual(g, {
    endpoint: "rankings_players",
    entityKey: "global",
  });
  const pol = livePathToJob(
    "/locations/57000249/pathoflegend/players",
    normalizeTag,
  );
  t.assert.strictEqual(pol.endpoint, "rankings_pol");
  t.assert.strictEqual(pol.entityKey, "57000249");
  const bad = livePathToJob("/locations/nope!/rankings/players", normalizeTag);
  t.assert.strictEqual(bad.error, "bad_request");
});

test("a bulk receipt inside the API's cache window IS the live answer; outside it, a fetch is queued", async () => {
  // The CR API serves a cached copy for max-age seconds, so a receipt
  // inside that window is what a new fetch would return, whichever lane
  // fetched it. That replaces the old job-id binding (issue #3).
  const profile = structuredClone(await fixture("player/profile.json"));
  profile.tag = "#RR0Y8LQ";
  const tag = profile.tag;
  await db.query(`delete from job where entity_key = $1`, [tag]);
  let minted = 0;
  const live = makeLive({
    enqueue: async (_db, job) => {
      minted += 1;
      return enqueueJob(db, job);
    },
  });
  await recordStale(profile, 0); // a bulk fetch seconds ago
  const fresh = await live(db, { endpoint: "player", entityKey: tag });
  assert.equal(fresh.ok, true);
  assert.equal(minted, 0, "nothing queued: the record is as fresh as the API");

  await db.query(`delete from api_receipt where entity_key = $1`, [tag]);
  await recordStale(profile, 5); // five minutes: past the 60 s window
  const stale = await live(db, { endpoint: "player", entityKey: tag });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "pending");
  assert.equal(minted, 1, "one priority fetch queued");
  const { rows } = await db.query(
    `select lane from job where entity_key = $1 and status = 'queued'`,
    [tag],
  );
  assert.deepEqual(
    rows.map((r) => r.lane),
    ["live"],
    "queued on the live lane, which any collector serves first",
  );
});

test("an agent's live fetch is charged to its owner's bucket, and the owner's cap applies", async () => {
  const profile = await fixture("player/profile.json");
  const tag = normalizeTag(profile.tag);
  const day = new Date().toISOString().slice(0, 10);
  const { rows: owners } = await db.query(
    `insert into account (email_hash, status, role) values ('live-agent-owner', 'approved', 'member')
     returning account_id`,
  );
  const ownerId = owners[0].account_id;
  const { rows: agents } = await db.query(
    `insert into account (email_hash, status, role, kind, owned_by_account_id, public_id)
     values ('live-agent', 'approved', 'leader', 'agent', $1, 'abcdef012345')
     returning account_id`,
    [ownerId],
  );
  const agent = {
    accountId: agents[0].account_id,
    role: "leader",
    kind: "agent",
    isOwner: false,
    timezone: null,
    // What validateServiceToken resolves for an agent (auth budgetFor).
    budget: {
      accountId: ownerId,
      role: "member",
      override: null,
      liveOverride: null,
    },
  };
  await db.query(`delete from api_receipt where entity_key = $1`, [tag]);
  await db.query(`delete from job where entity_key = $1`, [tag]);
  const live = fakeGatewayLive({ [`player:${tag}`]: profile });
  const invoke = makeInvoker({
    db,
    account: agent,
    registry: makeRegistry(),
    live,
  });
  const first = await invoke("live_fetch", { path: `/players/${tag}` });
  assert.equal(first.body.error?.code, "live_pending", "queued and charged");
  const { rows: buckets } = await db.query(
    `select bucket, count from rate_limit where bucket like 'liveday#%' and window_start = $1::date
       and bucket in ($2, $3)`,
    [day, `liveday#${ownerId}`, `liveday#${agent.accountId}`],
  );
  assert.deepEqual(
    buckets.map((b) => [b.bucket, b.count]),
    [[`liveday#${ownerId}`, 1]],
    "the owner's bucket, and only the owner's",
  );
  // The owner's member cap (20/day) is the agent's cap: fill it and the
  // agent is refused, even though its own leader tier would allow 100.
  await db.query(
    `update rate_limit set count = 20 where bucket = $1 and window_start = $2::date`,
    [`liveday#${ownerId}`, day],
  );
  const refused = await invoke("live_fetch", { path: `/players/#UU0Y8LQ` });
  assert.equal(refused.isError, true);
  assert.equal(refused.body.error.code, "quota_exceeded");
  assert.match(refused.body.error.message, /20\/day for the member tier/);
});
