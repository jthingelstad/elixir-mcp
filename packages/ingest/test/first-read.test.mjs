/**
 * first_read_landed (first-read.mjs): one line on a tracked player's first
 * admitted profile and first battle log, with the seconds from the add and
 * from the job's mint; none on the second admission, none for a subject
 * nobody tracks, and a failure in the timing never fails the admission.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { processResult } from "../src/pipeline.mjs";
import { fixture, scratchDb } from "./helpers.mjs";

let ctx;
let gatewayId;
let accountId;
let profile;
let battlelog;

const TRACKED = "#2PYLQ0";
const UNTRACKED = "#2PYLQ2";
const BROKEN = "#2PYLQ8";

function message({ endpoint, entityKey, payload, fetchedAt, jobId }) {
  return {
    v: 1,
    job: { endpoint, entity_key: entityKey, lane: "live" },
    ...(jobId ? { job_id: jobId } : {}),
    gateway_id: gatewayId,
    fetched_at: fetchedAt,
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  };
}

const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString();

async function track(tag, { addedSecondsAgo }) {
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'p') on conflict do nothing`,
    [tag],
  );
  await ctx.db.query(
    `insert into recording (subject_type, subject_tag, status, scope, requested_by, created_at)
     values ('player', $1, 'active', 'comprehensive', $2, now() - make_interval(secs => $3))`,
    [tag, accountId, addedSecondsAgo],
  );
}

/** A live job minted `mintedSecondsAgo` and leased `queuedS` later. */
async function job(endpoint, tag, { mintedSecondsAgo, queuedS }) {
  const {
    rows: [j],
  } = await ctx.db.query(
    `insert into job (endpoint, entity_key, lane, status, created_at, leased_at, leased_by)
     values ($1, $2, 'live', 'leased', now() - make_interval(secs => $3),
             now() - make_interval(secs => $3) + make_interval(secs => $4), $5)
     returning job_id`,
    [endpoint, tag, mintedSecondsAgo, queuedS, gatewayId],
  );
  return Number(j.job_id);
}

function forTag(payload, endpoint, tag) {
  if (endpoint === "player") return { ...structuredClone(payload), tag };
  return structuredClone(payload).map((b) => {
    b.team[0].tag = tag;
    return b;
  });
}

async function admit(endpoint, tag, { jobId, fetchedAt, db = ctx.db } = {}) {
  const lines = [];
  const r = await processResult(
    db,
    message({
      endpoint,
      entityKey: tag,
      payload: forTag(
        endpoint === "player" ? profile : battlelog,
        endpoint,
        tag,
      ),
      fetchedAt: fetchedAt ?? secondsAgo(1),
      jobId,
    }),
    { firstReadLog: (line) => lines.push(line) },
  );
  return { outcome: r.outcome, lines };
}

before(async () => {
  ctx = await scratchDb("first_read");
  const {
    rows: [account],
  } = await ctx.db.query(
    `insert into account (email_hash, status, is_owner, role) values ('first-read-owner', 'approved', true, 'owner')
     returning account_id`,
  );
  accountId = account.account_id;
  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'first-read-gw', '127.0.0.1', 'active') returning gateway_id`,
    [accountId],
  );
  gatewayId = gw.gateway_id;
  profile = await fixture("player/profile.json");
  battlelog = await fixture("player_battlelog/with_path_of_legend.json");
});

after(async () => {
  await ctx?.drop();
});

for (const endpoint of ["player", "player_battlelog"]) {
  test(`${endpoint}: one line on the first admission, with its seconds`, async () => {
    const tag = endpoint === "player" ? TRACKED : "#2PYLQR";
    await track(tag, { addedSecondsAgo: 120 });
    const jobId = await job(endpoint, tag, {
      mintedSecondsAgo: 90,
      queuedS: 6,
    });
    const first = await admit(endpoint, tag, {
      jobId,
      fetchedAt: secondsAgo(2),
    });
    assert.equal(first.outcome, "admitted");
    assert.equal(first.lines.length, 1);
    const [line] = first.lines;
    assert.equal(line.event, "first_read_landed");
    assert.equal(line.endpoint, endpoint);
    assert.equal(line.lane, "live");
    assert.ok(
      line.seconds_from_tracked >= 120 && line.seconds_from_tracked < 150,
      `from tracked ${line.seconds_from_tracked}`,
    );
    assert.ok(
      line.seconds_from_minted >= 90 && line.seconds_from_minted < 120,
      `from minted ${line.seconds_from_minted}`,
    );
    assert.equal(line.seconds_queued, 6);
    // No tag, account or email in the line.
    const text = JSON.stringify(line);
    assert.ok(!text.includes(tag.slice(1)));
    assert.ok(!text.includes(accountId));

    // The second admission is not a first read.
    const second = await admit(endpoint, tag, { fetchedAt: secondsAgo(0) });
    assert.equal(second.outcome, "admitted");
    assert.deepEqual(second.lines, []);
  });
}

test("a first read without a job still times from the add", async () => {
  const tag = "#2PYLQU";
  await track(tag, { addedSecondsAgo: 30 });
  const { lines } = await admit("player", tag);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].seconds_from_minted, null);
  assert.equal(lines[0].seconds_queued, null);
  assert.ok(lines[0].seconds_from_tracked >= 30);
});

test("a subject nobody tracks logs nothing", async () => {
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'p') on conflict do nothing`,
    [UNTRACKED],
  );
  const { outcome, lines } = await admit("player", UNTRACKED);
  assert.equal(outcome, "admitted");
  assert.deepEqual(lines, []);
});

test("a failure in the timing never fails the admission", async () => {
  await track(BROKEN, { addedSecondsAgo: 10 });
  // The timing query fails; every other statement runs as written.
  const failing = {
    query(sql, params) {
      if (typeof sql === "string" && sql.includes("as from_tracked"))
        return Promise.reject(new Error("timing query failed"));
      return ctx.db.query(sql, params);
    },
  };
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  let result;
  try {
    result = await admit("player", BROKEN, { db: failing });
  } finally {
    console.error = original;
  }
  assert.equal(result.outcome, "admitted");
  assert.deepEqual(result.lines, []);
  assert.deepEqual(errors, [
    ["first_read_timing_failed", "player", "timing query failed"],
  ]);
  const {
    rows: [ps],
  } = await ctx.db.query(
    `select last_admitted_at from poll_state where subject_tag = $1 and endpoint = 'player'`,
    [BROKEN],
  );
  assert.ok(ps?.last_admitted_at, "the admission committed");
});

test("a throwing log never fails the admission", async () => {
  const tag = "#2PYLQV";
  await track(tag, { addedSecondsAgo: 5 });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  let r;
  try {
    r = await processResult(
      ctx.db,
      message({
        endpoint: "player",
        entityKey: tag,
        payload: forTag(profile, "player", tag),
        fetchedAt: secondsAgo(1),
      }),
      {
        firstReadLog: () => {
          throw new Error("log failed");
        },
      },
    );
  } finally {
    console.error = original;
  }
  assert.equal(r.outcome, "admitted");
  assert.equal(errors[0]?.[0], "first_read_timing_failed");
});
