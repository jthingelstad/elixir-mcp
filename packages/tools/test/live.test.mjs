import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { makeLive, livePathToJob, requestFirstRead } from "../src/live.mjs";
import { enqueueJob } from "../../ledger/src/ledger.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { normalizeTag } from "@elixir-mcp/contracts";
import { trackClans } from "../../ingest/test/helpers.mjs";
import { addPlayer } from "@elixir-mcp/claims";

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
  // Every live mint takes a token from the one global bucket (#64); the
  // bucket tests below set their own balance and put this one back.
  await db.query("update budget_state set tokens = 1000, settled_at = now()");
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

test("live_fetch: the first ask queues and answers live_pending; the second finds the fresh payload, and nothing is recorded (0209)", async () => {
  const profile = await fixture("player/profile.json");
  const tag = normalizeTag(profile.tag);
  const live = fakeGatewayLive({ [`player:${tag}`]: profile });
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const first = await invoke("live_fetch", { path: `/players/${tag}` });
  assert.equal(first.isError, true);
  assert.equal(first.body.error.code, "live_pending");
  assert.match(first.body.error.hint, /15 s/);
  // The seconds ride as a field, not only inside the English (defect 8).
  assert.equal(first.body.error.retry_after_s, 15);
  const { rows: jobs } = await db.query(
    `select record from job where endpoint = 'player' and entity_key = $1`,
    [tag],
  );
  assert.deepEqual(
    jobs.map((j) => j.record),
    [false],
    "minted fetch-only",
  );
  const { body, isError } = await invoke("live_fetch", {
    path: `/players/${tag}`,
  });
  assert.equal(isError, false, JSON.stringify(body).slice(0, 200));
  assert.equal(body.live, true);
  assert.equal(body.live_status.state, "fresh");
  assert.equal(body.data.tag, profile.tag, "API-shaped passthrough");
  assert.match(body.notes.join(" "), /live_fetch stores nothing/);
  // Jamie, 2026-10-08: "live_fetch should ONLY live fetch and not record
  // data." Nothing of the read is in the record, its receipts or archive.
  const count = async (sql) => (await db.query(sql, [tag])).rows[0].n;
  for (const [what, sql] of [
    ["player", `select count(*)::int n from player where player_tag = $1`],
    [
      "snapshot",
      `select count(*)::int n from player_snapshot_daily where player_tag = $1`,
    ],
    [
      "receipt",
      `select count(*)::int n from api_receipt where entity_key = $1`,
    ],
    [
      "payload",
      `select count(*)::int n from api_payload where entity_key = $1`,
    ],
    [
      "freshness",
      `select count(*)::int n from poll_state where subject_tag = $1`,
    ],
  ])
    assert.equal(await count(sql), 0, `no ${what} row`);
  assert.equal(
    await count(
      `select count(*)::int n from live_fetch_result where entity_key = $1 and admission = 'admitted'`,
    ),
    1,
    "the result waited outside the record",
  );
});

test("a recording live read neither counts live_fetch's result as fresh nor leaves its open job fetch-only (0209)", async () => {
  const profile = structuredClone(await fixture("player/profile.json"));
  profile.tag = "#0J9VLCJ";
  const tag = profile.tag;
  const live = fakeGatewayLive({ [`player:${tag}`]: profile });
  // live_fetch's read lands; a recording ask inside the cache window
  // still queues, because the record did not move.
  await live(db, { endpoint: "player", entityKey: tag, record: false });
  const fetched = await live(db, {
    endpoint: "player",
    entityKey: tag,
    needPayload: true,
    record: false,
  });
  assert.equal(fetched.ok, true, "live_fetch's own next ask is answered");
  let queued = null;
  const recording = makeLive({
    enqueue: async (_db, job) => (queued = await enqueueJob(db, job)),
  });
  const r = await recording(db, { endpoint: "player", entityKey: tag });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "pending");
  assert.equal(queued?.record, true, "a recording fetch is queued");

  // A fetch-only job still open when a recording ask arrives records.
  const other = "#0UU200U";
  const fetchOnly = await enqueueJob(db, {
    endpoint: "player",
    entity_key: other,
    lane: "live",
    record: false,
  });
  assert.equal(fetchOnly.record, false);
  await db.query(`update job set status = 'leased' where job_id = $1`, [
    fetchOnly.job_id,
  ]);
  const again = await recording(db, { endpoint: "player", entityKey: other });
  assert.equal(again.reason, "pending");
  const {
    rows: [row],
  } = await db.query(`select record from job where job_id = $1`, [
    fetchOnly.job_id,
  ]);
  assert.equal(row.record, true, "the door reads record at submit");
  // And the reverse never happens: live_fetch behind a recording job
  // leaves it recording.
  const third = "#0YV2YYP";
  const bulk = await enqueueJob(db, {
    endpoint: "player",
    entity_key: third,
    lane: "bulk",
  });
  await enqueueJob(db, {
    endpoint: "player",
    entity_key: third,
    lane: "live",
    record: false,
  });
  const {
    rows: [kept],
  } = await db.query(`select lane, record from job where job_id = $1`, [
    bulk.job_id,
  ]);
  assert.deepEqual({ ...kept }, { lane: "live", record: true });
});

test("a fetch-only result is never archived or projected, and a duplicate submit is one row (0209)", async () => {
  const profile = structuredClone(await fixture("player/profile.json"));
  profile.tag = "#0UUYVLG";
  const job = await enqueueJob(db, {
    endpoint: "player",
    entity_key: profile.tag,
    lane: "live",
    record: false,
  });
  const puts = [];
  const msg = {
    v: 1,
    job: {
      endpoint: "player",
      entity_key: profile.tag,
      lane: "live",
      record: false,
    },
    job_id: Number(job.job_id),
    gateway_id: gatewayId,
    fetched_at: new Date().toISOString(),
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(profile))).toString(
      "base64",
    ),
  };
  const archive = { put: async (key) => puts.push(key) };
  const first = await processResult(db, msg, { archive });
  assert.equal(first.outcome, "admitted");
  assert.equal(first.fetch_only, true);
  const second = await processResult(db, msg, { archive });
  assert.equal(second.outcome, "duplicate");
  assert.deepEqual(puts, [], "no S3 archive object, so no replay");
  const {
    rows: [n],
  } = await db.query(
    `select (select count(*)::int from live_fetch_result where entity_key = $1) as held,
            (select count(*)::int from player where player_tag = $1) as players`,
    [profile.tag],
  );
  assert.deepEqual({ ...n }, { held: 1, players: 0 });
  // A failed fetch-only read leaves its operational receipt and owes the
  // subject no retry: nobody records it.
  const failed = await processResult(db, {
    ...msg,
    fetched_at: new Date(Date.now() - 1000).toISOString(),
    status: "error",
    http_status: 503,
    error: { kind: "http" },
    body_gzip_b64: undefined,
  });
  assert.equal(failed.outcome, "fetch_error");
  const {
    rows: [retry],
  } = await db.query(
    `select count(*)::int n from poll_state where subject_tag = $1`,
    [profile.tag],
  );
  assert.equal(retry.n, 0);
});

test("players_profile live:true answers from the record NOW with pending, then serves the fresh snapshot", async () => {
  const profile = structuredClone(await fixture("player/profile.json"));
  profile.tag = "#0YQ08PQ";
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

test("an unrecorded clan asked live answers live_pending with retry_after_s as a field (defect 8, 2026-09-19)", async () => {
  const live = fakeGatewayLive({});
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const { body, isError } = await invoke("clans_roster", {
    clan_tag: "#0QUULJ00",
    live: true,
  });
  assert.equal(isError, true);
  assert.equal(body.error.code, "live_pending");
  assert.equal(body.error.retry_after_s, 15);
  assert.match(body.error.hint, /Call again in 15 s/);
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
      path: "/clans/#0C2LJUVU",
    });
    assert.equal(isError, true);
    assert.equal(body.error.code, "live_pending");
    assert.ok(Number.isInteger(body.error.retry_after_s));
  }
  const { rows: jobs } = await db.query(
    `select count(*)::int n from job where entity_key = '#0C2LJUVU' and status in ('queued', 'leased')`,
  );
  assert.equal(jobs[0].n, 1, "one open job for the subject");
  assert.equal(await bucket(), before + 1, "charged once, when minted");
});

test("the live daily cap trips as quota_exceeded before anything is minted", async () => {
  const tag = "#0U8L2UC";
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

test("a bulk receipt inside the API's cache window IS the live answer; outside it, a fetch is queued", async () => {
  // The CR API serves a cached copy for max-age seconds, so a receipt
  // inside that window is what a new fetch would return, whichever lane
  // fetched it. That replaces the old job-id binding (issue #3).
  const profile = structuredClone(await fixture("player/profile.json"));
  profile.tag = "#0Q8LLUY";
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
  await db.query(`delete from live_fetch_result where entity_key = $1`, [tag]);
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
  const refused = await invoke("live_fetch", { path: `/players/#0PPYJRC` });
  assert.equal(refused.isError, true);
  assert.equal(refused.body.error.code, "quota_exceeded");
  assert.match(refused.body.error.message, /20\/day for the member tier/);
});

// Review 2026-09-27 §4.1 (#64): a live mint is charged to the one global
// bucket, so the live reserve is a reservation and not the planner
// abstaining.
const tokens = async () =>
  (await db.query("select tokens::float as t from budget_state")).rows[0].t;
const liveCharged = async () =>
  (
    await db.query(
      "select coalesce(sum(charged), 0)::int as n from budget_charge where lane = 'live'",
    )
  ).rows[0].n;

test("a minted live job takes one token from the one budget; asking again and promoting a queued bulk row are free (#64)", async () => {
  await db.query("update budget_state set tokens = 10");
  const chargedBefore = await liveCharged();
  const live = fakeGatewayLive({});
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  try {
    const first = await invoke("live_fetch", { path: "/clans/#0QYGLP0V" });
    assert.equal(first.body.error.code, "live_pending");
    assert.equal(await tokens(), 9, "minted: one token");
    assert.equal(await liveCharged(), chargedBefore + 1, "and recorded");
    await invoke("live_fetch", { path: "/clans/#0QYGLP0V" });
    assert.equal(await tokens(), 9, "the same open job: not charged again");
    // A queued bulk row was paid for when the planner inserted it.
    await enqueueJob(db, {
      endpoint: "clan",
      entity_key: "#0LVUYR8C",
      lane: "bulk",
    });
    await invoke("live_fetch", { path: "/clans/#0LVUYR8C" });
    assert.equal(await tokens(), 9, "a promotion is free");
    const { rows } = await db.query(
      "select lane from job where entity_key = '#0LVUYR8C' and status = 'queued'",
    );
    assert.equal(rows[0].lane, "live");
  } finally {
    await db.query("update budget_state set tokens = 1000");
  }
});

test("with no token left nothing is minted or charged, and the answer is pending until the next tick (#64)", async () => {
  // The last tick ran a minute ago: the next is about four minutes off.
  await db.query(
    "update budget_state set tokens = 0.5, settled_at = now() - interval '1 minute'",
  );
  const day = new Date().toISOString().slice(0, 10);
  const quota = async () =>
    (
      await db.query(
        `select coalesce(sum(count), 0)::int as n from rate_limit where bucket = $1 and window_start = $2::date`,
        [`liveday#${account.accountId}`, day],
      )
    ).rows[0].n;
  const quotaBefore = await quota();
  const live = fakeGatewayLive({});
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  try {
    const { body, isError } = await invoke("live_fetch", {
      path: "/clans/#08RJJJPJ",
    });
    assert.equal(isError, true);
    assert.equal(body.error.code, "live_pending");
    assert.match(body.error.message, /shared Clash Royale budget/);
    assert.ok(
      body.error.retry_after_s >= 200 && body.error.retry_after_s <= 260,
      `retry at the next tick, got ${body.error.retry_after_s}`,
    );
    const { rows } = await db.query(
      "select count(*)::int n from job where entity_key = '#08RJJJPJ'",
    );
    assert.equal(rows[0].n, 0, "nothing minted");
    assert.equal(await quota(), quotaBefore, "the account's quota untouched");
    assert.equal(await tokens(), 0.5, "the bucket untouched");
  } finally {
    await db.query("update budget_state set tokens = 1000, settled_at = now()");
  }
});

test("a live ask the account's quota refuses gives its token back (#64)", async () => {
  await db.query("update budget_state set tokens = 5");
  const day = new Date().toISOString().slice(0, 10);
  await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 50)
     on conflict (bucket, window_start) do update set count = 50`,
    [`liveday#${account.accountId}`, day],
  );
  const chargedBefore = await liveCharged();
  const live = fakeGatewayLive({});
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  try {
    const { body } = await invoke("live_fetch", { path: "/clans/#0VJQG8UY" });
    assert.equal(body.error.code, "quota_exceeded");
    assert.equal(await tokens(), 5, "refunded");
    assert.equal(await liveCharged(), chargedBefore, "and uncounted");
  } finally {
    await db.query(
      `delete from rate_limit where bucket = $1 and window_start = $2::date`,
      [`liveday#${account.accountId}`, day],
    );
    await db.query("update budget_state set tokens = 1000");
  }
});

test("all leaderboard live paths and helpers refuse without IO or quota spend", async () => {
  const { RETIRED_RECORDING_ENDPOINTS } = await import("@elixir-mcp/contracts");
  const forbidden = () => {
    throw new Error("retired live work performed IO");
  };
  const live = makeLive({
    enqueue: forbidden,
    charge: forbidden,
    refund: forbidden,
  });
  for (const endpoint of RETIRED_RECORDING_ENDPOINTS)
    assert.deepEqual(
      await live(
        { query: forbidden },
        { endpoint, entityKey: "global", beforeMint: forbidden },
      ),
      { ok: false, reason: "live_unavailable" },
    );
  for (const path of [
    "/locations/global/rankings/players",
    "/locations/57000249/pathoflegend/players",
  ])
    assert.equal(livePathToJob(path, normalizeTag).error, "bad_request");
});

/** The whole body currentriverrace answers between the season roll's 404
 *  and the drawn bracket (cr-agent-api-docs models/river-race.md,
 *  observed 2026-10-05): no clan, so no tags of anyone. */
const MATCHMAKING = { periodIndex: 0, sectionIndex: 0, state: "matchmaking" };

test("war_current live:true in matchmaking says no race yet, never 'rejected'; the record stays the last race and nothing is re-minted", async () => {
  const race = await fixture("currentriverrace/war_day.json");
  const clanTag = normalizeTag(race.clan.tag);
  // A recorded clan, so the call without live: true reads it too (an
  // earlier test's primary-clan follow may already record it).
  const { rowCount: tracked } = await db.query(
    `select 1 from recording where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
    [clanTag],
  );
  if (!tracked) await trackClans(db, [clanTag]);
  // The last race, recorded before the roll.
  await processResult(db, {
    v: 1,
    job: { endpoint: "currentriverrace", entity_key: clanTag, lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(race))).toString(
      "base64",
    ),
  });
  const weeks = async () =>
    (
      await db.query(
        `select (select count(*)::int from war_week where clan_tag = $1) as weeks,
                (select count(*)::int from war_participation where clan_tag = $1) as parts,
                (select last_admitted_at from poll_state
                  where subject_tag = $1 and endpoint = 'currentriverrace') as admitted_at`,
        [clanTag],
      )
    ).rows[0];
  const recorded = await weeks();
  assert.equal(recorded.weeks, 1, "the last race is in the record");
  const live = fakeGatewayLive({
    [`currentriverrace:${clanTag}`]: MATCHMAKING,
  });
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  // The first ask queues the read (the collector answers in between).
  const first = await invoke("war_current", {
    clan_tag: clanTag,
    live: true,
  });
  assert.equal(first.isError, false, JSON.stringify(first.body).slice(0, 300));
  assert.equal(first.body.live_status.state, "pending");
  const jobs = async () =>
    (
      await db.query(
        `select count(*)::int n from job where endpoint = 'currentriverrace' and entity_key = $1`,
        [clanTag],
      )
    ).rows[0].n;
  const minted = await jobs();
  // The second finds the read: the race is matchmaking.
  const { body, isError } = await invoke("war_current", {
    clan_tag: clanTag,
    live: true,
  });
  assert.equal(isError, false, JSON.stringify(body).slice(0, 300));
  assert.equal(body.live_status.state, "matchmaking");
  assert.ok(body.live_status.fetched_at);
  assert.ok(body.live_status.retry_after_s >= 15);
  const said = body.notes.join(" ");
  assert.match(said, /No race yet/);
  assert.match(said, /not an error, and no race or war day is missed/);
  assert.doesNotMatch(JSON.stringify(body), /rejected/);
  assert.equal(body.season_id, race.seasonId ?? body.season_id);
  assert.equal(body.section_index, race.sectionIndex, "the last race recorded");
  assert.ok(body.standings.length > 0);
  assert.equal(await jobs(), minted, "inside the cache window: nothing minted");
  // The record is untouched and its freshness held, so it is read again.
  assert.deepEqual(await weeks(), recorded);
  const {
    rows: [receipt],
  } = await db.query(
    `select admission, admission_errors from api_receipt
      where endpoint = 'currentriverrace' and entity_key = $1
      order by receipt_id desc limit 1`,
    [clanTag],
  );
  assert.deepEqual(
    { ...receipt },
    {
      admission: "matchmaking",
      admission_errors: null,
    },
  );
  // Without live: true the answer says it too, from the latest receipt.
  const plain = await invoke("war_current", { clan_tag: clanTag });
  assert.equal(plain.isError, false, JSON.stringify(plain.body).slice(0, 300));
  assert.equal(plain.body.live_status, undefined);
  assert.match(plain.body.notes.join(" "), /No race yet/);
  assert.match(plain.body.notes.join(" "), /usual race cadence/);
  // The matched race lands: the note goes.
  await processResult(db, {
    v: 1,
    job: { endpoint: "currentriverrace", entity_key: clanTag, lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: new Date().toISOString(),
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(race))).toString(
      "base64",
    ),
  });
  const after = await invoke("war_current", { clan_tag: clanTag, live: true });
  assert.equal(after.isError, false);
  assert.equal(after.body.live_status.state, "fresh");
  assert.doesNotMatch(after.body.notes.join(" "), /No race yet/);
});

test("an unrecorded clan's race in matchmaking answers no race yet with retry_after_s, never live_unavailable", async () => {
  const clanTag = "#0G28U99G";
  const live = fakeGatewayLive({
    [`currentriverrace:${clanTag}`]: MATCHMAKING,
  });
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const first = await invoke("war_current", { clan_tag: clanTag, live: true });
  assert.equal(first.body.error.code, "live_pending", "queued");
  assert.match(first.body.error.message, /queued/);
  const { body, isError } = await invoke("war_current", {
    clan_tag: clanTag,
    live: true,
  });
  assert.equal(isError, true);
  assert.equal(body.error.code, "live_pending");
  assert.match(body.error.message, /No race yet/);
  assert.match(body.error.message, /matchmaking/);
  assert.doesNotMatch(body.error.message, /rejected/);
  assert.ok(body.error.retry_after_s >= 15);
  assert.match(body.error.hint, /matched race/);
});

test("live_fetch of a race in matchmaking serves the API's body as no race yet, and records nothing (0209, 0211)", async () => {
  const clanTag = "#0U8CPYVV";
  const live = fakeGatewayLive({
    [`currentriverrace:${clanTag}`]: MATCHMAKING,
  });
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const path = `/clans/${clanTag}/currentriverrace`;
  const first = await invoke("live_fetch", { path });
  assert.equal(first.body.error.code, "live_pending");
  const { body, isError } = await invoke("live_fetch", { path });
  assert.equal(isError, false, JSON.stringify(body).slice(0, 300));
  assert.deepEqual(body.data, MATCHMAKING, "the API's own body");
  assert.equal(body.live_status.state, "matchmaking");
  assert.match(body.notes.join(" "), /No race yet/);
  const {
    rows: [n],
  } = await db.query(
    `select (select count(*)::int from api_receipt where entity_key = $1) as receipts,
            (select count(*)::int from live_fetch_result
              where entity_key = $1 and admission = 'matchmaking') as held`,
    [clanTag],
  );
  assert.deepEqual({ ...n }, { receipts: 0, held: 1 });
});

test("free first reads are bounded per person per UTC day, agents included: cycling fresh tags stops minting at the pool's player slots (#371 review)", async () => {
  const day = new Date().toISOString().slice(0, 10);
  // A member with three player slots, and one agent spending them too.
  const { rows: people } = await db.query(
    `insert into account (email_hash, status, role, max_player_recordings)
     values ('first-read-person', 'approved', 'member', 3) returning account_id`,
  );
  const personId = people[0].account_id;
  const { rows: agents } = await db.query(
    `insert into account (email_hash, status, role, kind, owned_by_account_id, public_id)
     values ('first-read-agent', 'approved', 'member', 'agent', $1, 'f1r57ead0001')
     returning account_id`,
    [personId],
  );
  const agentId = agents[0].account_id;
  const live = makeLive({ enqueue: enqueueJob });
  const tags = ["#000880", "#09CCYU", "#0GLP0L", "#0Q9998", "#0CQGPR"];
  const jobsFor = async (keys) =>
    (
      await db.query(
        `select count(*)::int as n from job where endpoint = 'player' and entity_key = any($1)`,
        [keys],
      )
    ).rows[0].n;

  // Add, remove, add a fresh tag: each add is a new tag and asks.
  for (const [tag, who] of [
    [tags[0], personId],
    [tags[1], agentId],
    [tags[2], personId],
  ]) {
    const r = await requestFirstRead(db, live, tag, who);
    assert.equal(r.requested, true, `${tag} gets its first read`);
  }
  // The pool's three are spent: the fourth fresh tag mints nothing, and
  // the global token it took goes back.
  const before = await tokens();
  const spent = await requestFirstRead(db, live, tags[3], agentId);
  assert.deepEqual(spent, { requested: false, reason: "first_reads_spent" });
  assert.equal(await tokens(), before, "the token is given back");
  assert.equal(await jobsFor(tags), 3);
  const { rows: bucket } = await db.query(
    `select bucket from rate_limit where bucket like 'firstread#%' and window_start = $1::date
       and bucket in ($2, $3)`,
    [day, `firstread#${personId}`, `firstread#${agentId}`],
  );
  assert.deepEqual(
    bucket.map((b) => b.bucket),
    [`firstread#${personId}`],
    "one bucket, the person's",
  );

  // A tag with an open job asks nothing new and costs nothing.
  const open = await requestFirstRead(db, live, tags[0], personId);
  assert.equal(open.requested, true);
  assert.equal(await jobsFor(tags), 3);

  // The next UTC day the pool has its first reads again.
  await db.query(
    `update rate_limit set window_start = window_start - interval '1 day'
      where bucket = $1`,
    [`firstread#${personId}`],
  );
  const tomorrow = await requestFirstRead(db, live, tags[4], personId);
  assert.equal(tomorrow.requested, true);
  assert.equal(await jobsFor(tags), 4);
});

test("a first read that mints nothing gives the pool's read back: a lost race or a failed enqueue (#460 review)", async () => {
  const day = new Date().toISOString().slice(0, 10);
  const { rows: people } = await db.query(
    `insert into account (email_hash, status, role, max_player_recordings)
     values ('first-read-refund', 'approved', 'member', 3) returning account_id`,
  );
  const personId = people[0].account_id;
  const used = async () =>
    (
      await db.query(
        `select coalesce(sum(count), 0)::int as n from rate_limit
          where bucket = $1 and window_start = $2::date`,
        [`firstread#${personId}`, day],
      )
    ).rows[0].n;

  // Another add of the same tag inserts its job between this call's
  // open-job check and its insert: this call mints nothing.
  const raced = makeLive({
    enqueue: async (_db, job) => {
      await enqueueJob(db, job);
      return enqueueJob(db, job);
    },
  });
  const before = await tokens();
  const lost = await requestFirstRead(db, raced, "#0J2RUJ", personId);
  assert.equal(lost.requested, true, "the other add's job is pending");
  assert.equal(await used(), 0, "the pool's read is given back");
  assert.equal(await tokens(), before, "and so is the global token");

  // The enqueue fails after the pool paid: given back too.
  const failing = makeLive({
    enqueue: async () => {
      throw new Error("ledger down");
    },
  });
  const failed = await requestFirstRead(db, failing, "#0JLRYC", personId);
  assert.deepEqual(failed, { requested: false, reason: "error" });
  assert.equal(await used(), 0);
});

test("a refused first read takes nothing, so a read given back is there for the next add (#463 review)", async () => {
  const { rows: people } = await db.query(
    `insert into account (email_hash, status, role, max_player_recordings)
     values ('first-read-denied', 'approved', 'member', 2) returning account_id`,
  );
  const personId = people[0].account_id;
  const live = makeLive({ enqueue: enqueueJob });
  assert.equal(
    (await requestFirstRead(db, live, "#0R2008", personId)).requested,
    true,
  );
  // A takes the pool's second read and then loses its insert race; while
  // it is in flight, C asks for a fresh tag and is refused.
  let denied = null;
  const raced = makeLive({
    enqueue: async (_db, job) => {
      denied = await requestFirstRead(db, live, "#0R9RVC", personId);
      await enqueueJob(db, job);
      return enqueueJob(db, job);
    },
  });
  await requestFirstRead(db, raced, "#0GRYPL", personId);
  assert.deepEqual(denied, { requested: false, reason: "first_reads_spent" });
  // A gave its read back: one first read has been minted today, so D
  // gets the second.
  const next = await requestFirstRead(db, live, "#0R822P", personId);
  assert.equal(next.requested, true);
});

test("a first read's outcome is logged by name, so a slow first read can be told from a refused one", async () => {
  const lines = [];
  const info = console.info;
  const error = console.error;
  console.info = (line) => lines.push(line);
  console.error = () => {};
  const answer = (r) => async () => r;
  try {
    for (const [tag, live, outcome] of [
      [
        "#0RP00G",
        answer({ ok: false, reason: "pending", minted: true }),
        "minted",
      ],
      [
        "#0V98CU",
        answer({ ok: false, reason: "pending", minted: false }),
        "joined",
      ],
      [
        "#0000C8",
        answer({ ok: false, reason: "pending", minted: false, queued: false }),
        "no_token",
      ],
      ["#0UY9LG", answer({ ok: true }), "fresh"],
      ["#00UV2Q", null, "no_live_lane"],
      [
        "#0CYRJ2",
        async () => {
          throw new Error("ledger down");
        },
        "error",
      ],
    ]) {
      lines.length = 0;
      await requestFirstRead(db, live, tag, "an-account");
      assert.deepEqual(
        lines,
        [{ event: "first_read_requested", endpoint: "player", outcome }],
        tag,
      );
      assert.ok(!JSON.stringify(lines).includes(tag.slice(1)), "no tag");
    }
  } finally {
    console.info = info;
    console.error = error;
  }
});

/** A person with `slots` player slots who has added `tag` (claimed, so
 *  recorded comprehensively), as the web add and elixir_follow_player do. */
async function personWith(hash, tag, slots = 3) {
  const {
    rows: [p],
  } = await db.query(
    `insert into account (email_hash, status, role, max_player_recordings)
     values ($1, 'approved', 'member', $2) returning account_id`,
    [hash, slots],
  );
  if (tag) {
    const r = await addPlayer(
      db,
      { accountId: p.account_id },
      { tag, makePrimary: true, via: "web" },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  return p.account_id;
}

const jobsOf = async (tag) =>
  (
    await db.query(
      `select job_id::int as id, endpoint, lane from job
        where entity_key = $1 order by job_id`,
      [tag],
    )
  ).rows.map(({ endpoint, lane }) => `${endpoint}:${lane}`);

async function logged(fn) {
  const lines = [];
  const info = console.info;
  console.info = (line) => lines.push(line);
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.info = info;
  }
}

const requested = (lines) =>
  lines
    .filter((l) => l?.event === "first_read_requested")
    .map((l) => `${l.endpoint}:${l.outcome}`);

test("a person's add asks for the profile and then the battle log on the live lane, so both land in seconds (2026-11-09)", async () => {
  await db.query("update budget_state set tokens = 10");
  const tag = "#0JQY02";
  const personId = await personWith("first-battles-person", tag);
  const live = makeLive({ enqueue: enqueueJob });
  const before = await tokens();
  const { result, lines } = await logged(() =>
    requestFirstRead(db, live, tag, personId, { battles: true }),
  );
  assert.equal(result.requested, true);
  assert.deepEqual(result.battles, { requested: true, reason: "pending" });
  // Profile first, then the battle log, both live; two tokens.
  assert.deepEqual(await jobsOf(tag), ["player:live", "player_battlelog:live"]);
  assert.equal(before - (await tokens()), 2);
  assert.deepEqual(requested(lines), [
    "player:minted",
    "player_battlelog:minted",
  ]);
  assert.ok(!JSON.stringify(lines).includes(tag.slice(1)), "no tag");
  const day = new Date().toISOString().slice(0, 10);
  const { rows: pools } = await db.query(
    `select split_part(bucket, '#', 1) as pool, count from rate_limit
      where bucket in ($1, $2) and window_start = $3::date order by 1`,
    [`firstread#${personId}`, `firstbattles#${personId}`, day],
  );
  assert.deepEqual(
    pools.map((r) => `${r.pool}:${r.count}`),
    ["firstbattles:1", "firstread:1"],
    "each read from its own allowance",
  );

  // A re-add, or a second person adding the same tag while both are
  // open: one job per tag and endpoint, nothing more charged.
  const otherId = await personWith("first-battles-other", tag);
  const tokensNow = await tokens();
  const again = await logged(() =>
    requestFirstRead(db, live, tag, otherId, { battles: true }),
  );
  assert.deepEqual(requested(again.lines), [
    "player:joined",
    "player_battlelog:joined",
  ]);
  assert.deepEqual(await jobsOf(tag), ["player:live", "player_battlelog:live"]);
  assert.equal(await tokens(), tokensNow);
  const { rows: theirs } = await db.query(
    `select coalesce(sum(count), 0)::int as n from rate_limit
      where bucket in ($1, $2) and window_start = $3::date`,
    [`firstread#${otherId}`, `firstbattles#${otherId}`, day],
  );
  assert.equal(theirs[0].n, 0, "joining costs the second pool nothing");

  // Without battles (the default) the profile alone, as before.
  const solo = "#02JYJQ";
  await personWith("first-battles-solo", solo);
  const only = await logged(() => requestFirstRead(db, live, solo, personId));
  assert.equal(only.result.battles, undefined);
  assert.deepEqual(requested(only.lines), ["player:minted"]);
  assert.deepEqual(await jobsOf(solo), ["player:live"]);
});

test("a refused battle-log read leaves the add and the profile's read alone, and is logged by outcome (2026-11-09)", async () => {
  const day = new Date().toISOString().slice(0, 10);
  const live = makeLive({ enqueue: enqueueJob });

  // The global bucket has one token: the profile takes it.
  await db.query("update budget_state set tokens = 1");
  const a = "#0LQUJY";
  const aId = await personWith("first-battles-no-token", a);
  const empty = await logged(() =>
    requestFirstRead(db, live, a, aId, { battles: true }),
  );
  assert.equal(empty.result.requested, true);
  assert.deepEqual(empty.result.battles, {
    requested: false,
    reason: "pending",
  });
  assert.deepEqual(requested(empty.lines), [
    "player:minted",
    "player_battlelog:no_token",
  ]);
  assert.deepEqual(await jobsOf(a), ["player:live"]);
  const { rows: noCharge } = await db.query(
    `select count(*)::int as n from rate_limit
      where bucket = $1 and window_start = $2::date and count > 0`,
    [`firstbattles#${aId}`, day],
  );
  assert.equal(noCharge[0].n, 0, "a refused battle log takes no allowance");

  // The pool's battle-log reads are spent: the token goes back.
  await db.query("update budget_state set tokens = 10");
  const b = "#0VYLVQ";
  const bId = await personWith("first-battles-spent", b, 1);
  await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 1)`,
    [`firstbattles#${bId}`, day],
  );
  const before = await tokens();
  const spent = await logged(() =>
    requestFirstRead(db, live, b, bId, { battles: true }),
  );
  assert.equal(spent.result.requested, true);
  assert.deepEqual(spent.result.battles, {
    requested: false,
    reason: "first_reads_spent",
  });
  assert.deepEqual(requested(spent.lines), [
    "player:minted",
    "player_battlelog:first_reads_spent",
  ]);
  assert.deepEqual(await jobsOf(b), ["player:live"]);
  assert.equal(before - (await tokens()), 1, "the battle log's token is back");

  // The battle log's mint fails: the profile's job stays, the add stands.
  const c = "#0VYCQG";
  const cId = await personWith("first-battles-fails", c);
  const failing = makeLive({
    enqueue: async (_db, job) => {
      if (job.endpoint === "player_battlelog") throw new Error("ledger down");
      return enqueueJob(db, job);
    },
  });
  const error = console.error;
  console.error = () => {};
  let failed;
  try {
    failed = await logged(() =>
      requestFirstRead(db, failing, c, cId, { battles: true }),
    );
  } finally {
    console.error = error;
  }
  assert.equal(failed.result.requested, true);
  assert.deepEqual(failed.result.battles, {
    requested: false,
    reason: "error",
  });
  assert.deepEqual(requested(failed.lines), [
    "player:minted",
    "player_battlelog:error",
  ]);
  assert.deepEqual(await jobsOf(c), ["player:live"]);
  const { rows: refunded } = await db.query(
    `select coalesce(sum(count), 0)::int as n from rate_limit
      where bucket = $1 and window_start = $2::date`,
    [`firstbattles#${cId}`, day],
  );
  assert.equal(refunded[0].n, 0, "the failed mint's allowance is given back");

  // A battle log read in the last day is not asked again.
  const d = "#0VUL0C";
  const dId = await personWith("first-battles-read", d);
  await db.query(
    `insert into api_receipt (endpoint, entity_key, gateway_id, fetched_at, payload_hash, admission)
     values ('player_battlelog', $1, $2, now() - interval '1 hour', 'x', 'admitted')`,
    [d, gatewayId],
  );
  const recent = await logged(() =>
    requestFirstRead(db, live, d, dId, { battles: true }),
  );
  assert.deepEqual(requested(recent.lines), [
    "player:minted",
    "player_battlelog:read_today",
  ]);
  assert.deepEqual(await jobsOf(d), ["player:live"]);
});

test("a tag the game answered not found for asks for nothing, battle log included (2026-11-09)", async () => {
  await db.query("update budget_state set tokens = 10");
  const tag = "#0Y0LVJ";
  const personId = await personWith("first-battles-404", tag);
  await db.query(
    `insert into collector_fetch_error (gateway_id, endpoint, entity_key, fetched_at, http_status, error_kind)
     values ($1, 'player', $2, now() - interval '1 minute', 404, 'http')`,
    [gatewayId, tag],
  );
  const live = makeLive({ enqueue: enqueueJob });
  const { result, lines } = await logged(() =>
    requestFirstRead(db, live, tag, personId, { battles: true }),
  );
  assert.equal(result.requested, false);
  assert.equal(result.not_found, true);
  assert.equal(result.reason, "failed_today");
  assert.deepEqual(result.battles, {
    requested: false,
    reason: "profile_not_requested",
  });
  assert.deepEqual(requested(lines), [
    "player:not_found_today",
    "player_battlelog:profile_not_requested",
  ]);
  assert.deepEqual(await jobsOf(tag), []);
});
