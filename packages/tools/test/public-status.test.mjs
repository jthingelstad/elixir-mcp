/**
 * GET /api/public/status's receipt reads were restructured for cost
 * (2026-10-21, platform review §2 and §3): the freshness counters are two
 * index probes instead of one FILTERed aggregate that scanned all of
 * api_receipt, and a collector's hour and day come from one grouped pass
 * instead of three subqueries per collector. The answer must not move.
 * The statements they replaced are pinned here as the reference, run in
 * the same snapshot (one repeatable-read transaction, so now() is one
 * instant) over receipts that exercise every filter and null.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { readPublicStatus } from "../src/public-status.mjs";

let scratch;

const REFERENCE_COLLECTORS = `
  select coalesce(g.card_name, 'unnamed') as name,
         (select count(*)::int from api_receipt ar
          where ar.gateway_id = g.gateway_id
            and ar.fetched_at > now() - interval '1 hour') as fetches_1h,
         (select round(avg(case when ar.new_facts > 0 then 1 else 0 end), 3)
            from api_receipt ar where ar.gateway_id = g.gateway_id
            and ar.fetched_at > now() - interval '24 hours'
            and ar.new_facts is not null) as yield_24h,
         (select case when sum(ar.observed) > 0
                   then round(sum(ar.filtered)::numeric / sum(ar.observed), 3) end
            from api_receipt ar where ar.gateway_id = g.gateway_id
            and ar.endpoint = 'player_battlelog'
            and ar.fetched_at > now() - interval '24 hours'
            and ar.observed is not null) as edge_filtered_24h
  from gateway g
  where g.status in ('active', 'probation', 'pending')
    and g.name <> 'backfill-elixir-bot'
  order by g.enrolled_at`;

const REFERENCE_LATEST = `
  select extract(epoch from now() - max(fetched_at))::int as last_fetch_s,
         extract(epoch from now() - max(fetched_at)
           filter (where admission = 'admitted'))::int as last_admit_s
  from api_receipt`;

async function seedGateways(db) {
  const {
    rows: [account],
  } = await db.query(
    `insert into account (email_hash, status, is_owner, role)
     values ('status-owner', 'approved', true, 'owner') returning account_id`,
  );
  const gateways = {};
  // enrolled_at fixes the listing order; one of each status the page
  // lists, one it does not, the excluded backfill lane, and a collector
  // with no receipts at all.
  const rows = [
    ["alpha", "Knight", "active", 6],
    ["beta", null, "probation", 5],
    ["gamma", "Archers", "pending", 4],
    ["delta", "Giant", "revoked", 3],
    ["backfill-elixir-bot", "Miner", "active", 2],
    ["epsilon", "Valkyrie", "active", 1],
  ];
  for (const [name, card, status, daysAgo] of rows) {
    const {
      rows: [g],
    } = await db.query(
      `insert into gateway (owner_account_id, name, card_name, status, enrolled_at)
       values ($1, $2, $3, $4, now() - make_interval(days => $5)) returning gateway_id`,
      [account.account_id, name, card, status, daysAgo],
    );
    gateways[name] = g.gateway_id;
  }
  return gateways;
}

/** Receipts every 7 minutes over 30 hours per collector, varied so each
 *  filter (endpoint, admission, new_facts and observed nulls, the hour
 *  and day edges) has rows on both sides. */
async function seedReceipts(db, gateways, names) {
  for (const [i, name] of names.entries()) {
    await db.query(
      `insert into api_receipt
         (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission,
          new_facts, observed, filtered)
       select case when n % 3 = 0 then 'clan' else 'player_battlelog' end,
              '#K' || n, now() - make_interval(mins => n * 7 + $2), 'h' || n, $1,
              case when n % 5 = 0 then 'rejected'
                   when n % 11 = 0 then 'matchmaking' else 'admitted' end,
              case when n % 4 = 0 then null else (n + $2) % 3 end,
              case when n % 6 = 0 then null else 20 + n % 7 end,
              case when n % 8 = 0 then null else n % 5 end
       from generate_series(0, 257) n`,
      [gateways[name], i],
    );
  }
}

async function compareInOneSnapshot(db) {
  await db.query("begin isolation level repeatable read");
  try {
    const refCollectors = (await db.query(REFERENCE_COLLECTORS)).rows;
    const [refLatest] = (await db.query(REFERENCE_LATEST)).rows;
    const status = await readPublicStatus(db, { deadLetters: async () => 0 });
    return { refCollectors, refLatest, status };
  } finally {
    await db.query("commit");
  }
}

function assertSameAnswer({ refCollectors, refLatest, status }) {
  assert.equal(status.health.last_fetch_seconds, refLatest.last_fetch_s);
  assert.equal(status.health.last_admission_seconds, refLatest.last_admit_s);
  assert.deepEqual(
    status.collectors.map((c) => ({
      name: c.name,
      fetches_1h: c.fetches_1h,
      yield_24h: c.yield_24h,
      edge_filtered_24h: c.edge_filtered_24h,
    })),
    refCollectors.map((r) => ({
      name: r.name,
      fetches_1h: r.fetches_1h,
      yield_24h: r.yield_24h === null ? null : Number(r.yield_24h),
      edge_filtered_24h:
        r.edge_filtered_24h === null ? null : Number(r.edge_filtered_24h),
    })),
  );
}

before(async () => {
  scratch = await scratchDb("public_status");
});

after(async () => {
  await scratch?.drop();
});

test("no receipts: no freshness, every listed collector at zero", async () => {
  await seedGateways(scratch.db);
  const got = await compareInOneSnapshot(scratch.db);
  assertSameAnswer(got);
  assert.equal(got.status.health.last_fetch_seconds, null);
  assert.equal(got.status.health.last_admission_seconds, null);
  assert.deepEqual(
    got.status.collectors.map((c) => c.name),
    ["Knight", "unnamed", "Archers", "Valkyrie"],
  );
});

test("the restructured receipt reads answer what the old statements did", async () => {
  const { rows } = await scratch.db.query(
    "select name, gateway_id from gateway",
  );
  const gateways = Object.fromEntries(rows.map((r) => [r.name, r.gateway_id]));
  await seedReceipts(scratch.db, gateways, [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "backfill-elixir-bot",
  ]);
  await scratch.db.query("analyze api_receipt");
  const got = await compareInOneSnapshot(scratch.db);
  assertSameAnswer(got);
  // The fixture reaches every branch: counts, rates and a null rate.
  const alpha = got.status.collectors.find((c) => c.name === "Knight");
  assert.ok(alpha.fetches_1h > 0);
  assert.ok(alpha.yield_24h > 0 && alpha.yield_24h < 1);
  assert.ok(alpha.edge_filtered_24h > 0);
  const epsilon = got.status.collectors.find((c) => c.name === "Valkyrie");
  assert.deepEqual(
    [epsilon.fetches_1h, epsilon.yield_24h, epsilon.edge_filtered_24h],
    [0, null, null],
  );
});

test("the newest admission is found however many rejections follow it", async () => {
  await scratch.db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     select 'clan', '#R' || n, now() - make_interval(secs => n), 'r' || n,
            (select gateway_id from gateway where name = 'alpha'), 'rejected'
     from generate_series(1, 40) n`,
  );
  const got = await compareInOneSnapshot(scratch.db);
  assertSameAnswer(got);
  assert.ok(
    got.status.health.last_admission_seconds >
      got.status.health.last_fetch_seconds,
  );
});

test("the freshness counters probe the time index, never scan the receipts", async () => {
  const seen = [];
  const recording = {
    query: (sql, params) => {
      seen.push(sql);
      return scratch.db.query(sql, params);
    },
  };
  await readPublicStatus(recording, { deadLetters: async () => 0 });
  const sql = seen.find((s) => s.includes("last_admit_s"));
  const [{ "QUERY PLAN": plan }] = (
    await scratch.db.query(`explain (format json) ${sql}`)
  ).rows;
  const nodes = [];
  const walk = (n) => {
    nodes.push(n);
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(plan[0].Plan);
  const onReceipts = nodes.filter((n) => n["Relation Name"] === "api_receipt");
  assert.equal(onReceipts.length, 2);
  for (const n of onReceipts) {
    assert.match(n["Node Type"], /^Index (Only )?Scan$/);
    assert.equal(n["Index Name"], "api_receipt_fetched");
  }
});
