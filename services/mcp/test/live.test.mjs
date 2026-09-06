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

/** A fake gateway: on enqueue, run the REAL results pipeline as if the
 *  fetch completed — the exact round trip, minus SQS and the wire. */
function fakeGatewayLive(payloadByKey) {
  return makeLive({
    timeoutMs: 3000,
    enqueue: async (_db, job) => {
      const payload = payloadByKey[`${job.endpoint}:${job.entity_key}`];
      if (!payload) return; // never fulfilled -> timeout path
      await processResult(db, {
        v: 1,
        job,
        gateway_id: gatewayId,
        fetched_at: new Date().toISOString(),
        status: "ok",
        body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
          "base64",
        ),
      });
    },
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
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'live-gw', '127.0.0.1', 'active') returning gateway_id`,
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

test("live_fetch round-trips through the REAL pipeline and records opportunistically", async () => {
  const profile = await fixture("player/profile.json");
  const tag = normalizeTag(profile.tag);
  const live = fakeGatewayLive({ [`player:${tag}`]: profile });
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const { body, isError } = await invoke("live_fetch", {
    path: `/players/${tag}`,
  });
  assert.equal(isError, false, JSON.stringify(body).slice(0, 200));
  assert.equal(body.live, true);
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

test("players_profile live:true refreshes then serves the snapshot", async () => {
  const profile = structuredClone(await fixture("player/profile.json"));
  const tag = normalizeTag(profile.tag);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'unverified', true)
     on conflict do nothing`,
    [account.accountId, tag],
  );
  profile.trophies += 99;
  const live = fakeGatewayLive({ [`player:${tag}`]: profile });
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const { body, isError } = await invoke("players_profile", { live: true });
  assert.equal(isError, false, JSON.stringify(body).slice(0, 200));
  assert.equal(
    body.snapshot.trophies,
    profile.trophies,
    "served fresh from the live fetch",
  );
});

test("an unfulfilled live job times out to a structured live_unavailable", async () => {
  const live = fakeGatewayLive({});
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const { body, isError } = await invoke("live_fetch", {
    path: "/clans/#GQ0YLCYJ",
  });
  assert.equal(isError, true);
  assert.equal(body.error.code, "live_unavailable");
});

test("the live daily cap trips as quota_exceeded", async () => {
  const profile = await fixture("player/profile.json");
  const tag = normalizeTag(profile.tag);
  const day = new Date().toISOString().slice(0, 10);
  await db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 50)
     on conflict (bucket, window_start) do update set count = 50`,
    [`liveday#${account.accountId}`, day],
  );
  const live = fakeGatewayLive({ [`player:${tag}`]: profile });
  const invoke = makeInvoker({ db, account, registry: makeRegistry(), live });
  const { body, isError } = await invoke("live_fetch", {
    path: `/players/${tag}`,
  });
  assert.equal(isError, true);
  assert.equal(body.error.code, "quota_exceeded");
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
