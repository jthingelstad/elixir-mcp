import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { processResult } from "../src/pipeline.mjs";
import { fixture, fixtureMeta, scratchDb } from "./helpers.mjs";

let ctx;
let gatewayId;
let meta;
// The freshness guard (24h) gates activity signals; shared so the
// redelivery test reuses the exact same receipt identity.
const FRESH_AT = new Date(Date.now() - 3600_000).toISOString();

function message({
  endpoint,
  entityKey,
  payload,
  fetchedAt,
  status = "ok",
  lane = "bulk",
}) {
  const m = {
    v: 1,
    job: { endpoint, entity_key: entityKey, lane },
    gateway_id: gatewayId,
    fetched_at: fetchedAt,
    status,
  };
  if (status === "ok") {
    const body =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    m.body_gzip_b64 = gzipSync(Buffer.from(body)).toString("base64");
  }
  return m;
}

before(async () => {
  ctx = await scratchDb("pipeline");
  const {
    rows: [account],
  } = await ctx.db.query(
    `insert into account (email_hash, status, is_owner, role) values ('pipeline-owner', 'approved', true, 'owner')
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'pipeline-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  gatewayId = gw.gateway_id;
  meta = await fixtureMeta();
});

after(async () => ctx.drop());

test("battlelog message flows end to end: payload, receipt, battles, freshness, yield", async () => {
  const file = "player_battlelog/with_boat_and_duel.json";
  const observer = meta[file].entity_key;
  const payload = await fixture(file);
  await ctx.db.query(
    `insert into poll_state (subject_tag, endpoint) values ($1, 'player_battlelog')`,
    [observer],
  );

  const result = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: observer,
      payload,
      fetchedAt: FRESH_AT,
    }),
  );
  assert.equal(result.outcome, "admitted");
  assert.equal(result.projection.battlesSeen, payload.length);

  // The S3 archive key is built from the collector's fetched_at and the
  // weekly sweep reconstructs it from first_fetched_at - the two must
  // agree or every twin lookup misses (sol-6 finding 6).
  const { rows: ts } = await ctx.db.query(
    `select first_fetched_at from api_payload
     where endpoint = 'player_battlelog' and entity_key = $1`,
    [observer],
  );
  assert.equal(
    ts[0].first_fetched_at.toISOString(),
    new Date(FRESH_AT).toISOString(),
    "first_fetched_at is the collector's fetch time, not ingest now()",
  );

  const payloads = (
    await ctx.db.query(`select count(*)::int n from api_payload`)
  ).rows[0].n;
  assert.equal(payloads, 1, "content-addressed payload stored once");
  const { rows: receipts } = await ctx.db.query(
    `select admission from api_receipt where endpoint = 'player_battlelog'`,
  );
  assert.deepEqual(receipts, [{ admission: "admitted" }]);
  const battles = (await ctx.db.query(`select count(*)::int n from battle`))
    .rows[0].n;
  assert.ok(battles > 0);

  const { rows: ps } = await ctx.db.query(
    `select yield_bph, last_admitted_at from poll_state where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [observer],
  );
  assert.ok(Number(ps[0].yield_bph) > 0, "fresh battles feed the yield signal");
  assert.equal(ps[0].last_admitted_at.toISOString(), FRESH_AT);
});

test("SQS redelivery is a duplicate: no second receipt, no double ingest", async () => {
  const file = "player_battlelog/with_boat_and_duel.json";
  const payload = await fixture(file);
  const result = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: meta[file].entity_key,
      payload,
      fetchedAt: FRESH_AT,
    }),
  );
  assert.equal(result.outcome, "duplicate");
  const receipts = (
    await ctx.db.query(`select count(*)::int n from api_receipt`)
  ).rows[0].n;
  assert.equal(receipts, 1);
});

test("rejected payload gets a receipt with errors; no projection; freshness NOT advanced", async () => {
  const clan = structuredClone(await fixture("clan/roster.json"));
  clan.members += 1; // corrupt: count mismatch
  const result = await processResult(
    ctx.db,
    message({
      endpoint: "clan",
      entityKey: "#J2RGCRVG",
      payload: clan,
      fetchedAt: "2026-09-03T15:00:00Z",
    }),
  );
  assert.equal(result.outcome, "rejected");
  assert.ok(result.errors.includes("members:count-mismatch"));
  const { rows } = await ctx.db.query(
    `select admission, admission_errors from api_receipt where endpoint = 'clan'`,
  );
  assert.equal(rows[0].admission, "rejected");
  assert.ok(rows[0].admission_errors.length > 0);
  const memberships = (
    await ctx.db.query(`select count(*)::int n from clan_membership`)
  ).rows[0].n;
  assert.equal(memberships, 0, "rejected payload mutated nothing");
  const ps = await ctx.db.query(
    `select 1 from poll_state where subject_tag = '#J2RGCRVG' and endpoint = 'clan'`,
  );
  assert.equal(ps.rows.length, 0, "freshness advances on admission only");
});

test("valid clan payload projects roster and advances freshness", async () => {
  const clan = await fixture("clan/roster.json");
  const result = await processResult(
    ctx.db,
    message({
      endpoint: "clan",
      entityKey: "#J2RGCRVG",
      payload: clan,
      fetchedAt: "2026-09-03T15:10:00Z",
    }),
  );
  assert.equal(result.outcome, "admitted");
  assert.equal(result.projection.members, 49);
  const ps = await ctx.db.query(
    `select 1 from poll_state where subject_tag = '#J2RGCRVG' and endpoint = 'clan'`,
  );
  assert.equal(ps.rows.length, 1);
});

test("unparseable body: rejected receipt, no payload row", async () => {
  const before = (await ctx.db.query(`select count(*)::int n from api_payload`))
    .rows[0].n;
  const result = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: "#20JJJ2CCRU",
      payload: "not json {{{",
      fetchedAt: "2026-09-03T15:20:00Z",
    }),
  );
  assert.equal(result.outcome, "rejected");
  assert.ok(result.errors.includes("body:unparseable"));
  const after = (await ctx.db.query(`select count(*)::int n from api_payload`))
    .rows[0].n;
  assert.equal(after, before, "no payload row for unparseable bodies");
});

test("fetch_error writes nothing durable", async () => {
  const receiptsBefore = (
    await ctx.db.query(`select count(*)::int n from api_receipt`)
  ).rows[0].n;
  const result = await processResult(ctx.db, {
    v: 1,
    job: { endpoint: "player", entity_key: "#20JJJ2CCRU", lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: "2026-09-03T15:30:00Z",
    status: "error",
    error: { kind: "transport" },
  });
  assert.equal(result.outcome, "fetch_error");
  const receiptsAfter = (
    await ctx.db.query(`select count(*)::int n from api_receipt`)
  ).rows[0].n;
  assert.equal(receiptsAfter, receiptsBefore);
});

test("malformed message is bad_message (handler routes it to the DLQ path)", async () => {
  const result = await processResult(ctx.db, { v: 1, status: "ok" });
  assert.equal(result.outcome, "bad_message");
  assert.ok(result.errors.length > 0);
});

test("player profile message projects the v0 identity refresh", async () => {
  const profile = await fixture("player/profile.json");
  const result = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: meta["player/profile.json"].entity_key,
      payload: profile,
      fetchedAt: "2026-09-03T15:40:00Z",
    }),
  );
  assert.equal(result.outcome, "admitted");
  const { rows } = await ctx.db.query(
    `select name from player where player_tag = $1`,
    [meta["player/profile.json"].entity_key],
  );
  assert.equal(rows[0].name, profile.name);
});

test("gateway lifecycle at ingest: heartbeat/success stamped; revoked and unknown refused", async () => {
  const clan = await fixture("clan/roster.json");
  const msg = () =>
    message({
      endpoint: "clan",
      entityKey: meta["clan/roster.json"].entity_key,
      payload: clan,
      fetchedAt: new Date().toISOString(),
    });

  const ok = await processResult(ctx.db, msg());
  assert.equal(ok.outcome, "admitted");
  const { rows } = await ctx.db.query(
    `select last_heartbeat_at, last_success_at from gateway where gateway_id = $1`,
    [gatewayId],
  );
  assert.ok(rows[0].last_heartbeat_at, "any valid message proves liveness");
  assert.ok(rows[0].last_success_at, "admission stamps success");

  // Revocation is real: ingest stops listening the moment the row flips.
  await ctx.db.query(
    `update gateway set status = 'revoked' where gateway_id = $1`,
    [gatewayId],
  );
  const refused = await processResult(ctx.db, msg());
  assert.equal(refused.outcome, "gateway_refused");

  // Unknown ids die cleanly instead of throwing into the retry loop.
  const unknown = await processResult(ctx.db, {
    ...msg(),
    gateway_id: "not-a-gateway",
  });
  assert.equal(unknown.outcome, "gateway_refused");

  await ctx.db.query(
    `update gateway set status = 'active' where gateway_id = $1`,
    [gatewayId],
  );
});

test("replay guards: old payloads never regress freshness, yield, or identity", async () => {
  const profile = await fixture("player/profile.json");
  const tag = meta["player/profile.json"].entity_key;
  // Current state from earlier tests: last poll 2026-09-03T15:40:00Z.
  const before = await ctx.db.query(
    `select last_admitted_at from poll_state where subject_tag = $1 and endpoint = 'player'`,
    [tag],
  );
  const old = structuredClone(profile);
  old.name = "Ancient Name";
  const result = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: old,
      fetchedAt: "2026-07-15T12:00:00Z",
    }),
  );
  assert.equal(result.outcome, "admitted");

  // Freshness did not regress.
  const after = await ctx.db.query(
    `select last_admitted_at from poll_state where subject_tag = $1 and endpoint = 'player'`,
    [tag],
  );
  assert.equal(
    after.rows[0].last_admitted_at.toISOString(),
    before.rows[0].last_admitted_at.toISOString(),
  );

  // Identity did not regress; first_seen brackets backwards honestly.
  const p = await ctx.db.query(
    `select name, first_seen_at from player where player_tag = $1`,
    [tag],
  );
  assert.notEqual(p.rows[0].name, "Ancient Name");
  assert.ok(p.rows[0].first_seen_at.toISOString().startsWith("2026-07-15"));

  // A snapshot for the old day DID land (that's the point of the replay).
  const s = await ctx.db.query(
    `select 1 from player_snapshot_daily where player_tag = $1 and snapshot_date = '2026-07-15'`,
    [tag],
  );
  assert.equal(s.rows.length, 1);

  // Old battlelog is history, not activity: yield_bph stays untouched.
  await ctx.db.query(
    `insert into poll_state (subject_tag, endpoint, yield_bph)
     values ($1, 'player_battlelog', null)
     on conflict (subject_tag, endpoint) do update set yield_bph = null`,
    [meta["player_battlelog/with_path_of_legend.json"].entity_key],
  );
  const log = await fixture("player_battlelog/with_path_of_legend.json");
  const shifted = structuredClone(log).map((b, i) => ({
    ...b,
    battleTime: `20260710T${String(i % 24).padStart(2, "0")}0000.000Z`,
  }));
  const r2 = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: meta["player_battlelog/with_path_of_legend.json"].entity_key,
      payload: shifted,
      fetchedAt: "2026-07-10T12:00:00Z",
    }),
  );
  assert.equal(r2.outcome, "admitted");
  const h = await ctx.db.query(
    `select yield_bph from poll_state where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [meta["player_battlelog/with_path_of_legend.json"].entity_key],
  );
  assert.equal(h.rows[0].yield_bph, null, "replayed history is not activity");
});

test("gateway_sha on a result stamps the fleet-version column", async () => {
  const profile = await fixture("player/profile.json");
  const tag = meta["player/profile.json"].entity_key;
  const msg = message({
    endpoint: "player",
    entityKey: tag,
    payload: profile,
    fetchedAt: new Date().toISOString(),
  });
  msg.gateway_sha = "abc1234";
  const r = await processResult(ctx.db, msg);
  assert.equal(r.outcome, "admitted");
  const { rows } = await ctx.db.query(
    `select last_seen_sha from gateway where gateway_id = $1`,
    [gatewayId],
  );
  assert.equal(rows[0].last_seen_sha, "abc1234");
});

test("S3 archive: new content is put once, dedup refetch adds no object, put failure rolls back", async () => {
  const profile = await fixture("player/profile.json");
  const tag = meta["player/profile.json"].entity_key;
  const puts = [];
  const archive = {
    async put(key, body) {
      puts.push({ key, body });
    },
  };
  // Distinct content so this test owns its payload row.
  const shaped = { ...profile, trophies: (profile.trophies ?? 0) + 7 };
  const at = "2026-09-04T12:34:56Z";
  const r1 = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: shaped,
      fetchedAt: at,
    }),
    { archive },
  );
  assert.equal(r1.outcome, "admitted");
  assert.equal(puts.length, 1, "new content archived");
  assert.match(
    puts[0].key,
    /^payloads\/endpoint=player\/entity=[0-9A-Z]+\/dt=2026-09-04\/20260904T123456Z-[0-9a-f]{16}\.json\.gz$/,
    "hive-partitioned, content-addressed key",
  );
  assert.ok(typeof r1.timings.archive_ms === "number");

  // Same content, later fetch: dedup path, no new object.
  const r2 = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: shaped,
      fetchedAt: "2026-09-04T13:00:00Z",
    }),
    { archive },
  );
  assert.equal(r2.outcome, "admitted");
  assert.equal(puts.length, 1, "content-identical refetch adds no object");

  // Put failure: the whole message fails (SQS will retry) and nothing commits.
  const before = (await ctx.db.query(`select count(*)::int n from api_payload`))
    .rows[0].n;
  const broken = { ...profile, trophies: (profile.trophies ?? 0) + 8 };
  await assert.rejects(
    processResult(
      ctx.db,
      message({
        endpoint: "player",
        entityKey: tag,
        payload: broken,
        fetchedAt: "2026-09-04T14:00:00Z",
      }),
      {
        archive: {
          async put() {
            throw new Error("s3 unavailable");
          },
        },
      },
    ),
  );
  const after_ = (await ctx.db.query(`select count(*)::int n from api_payload`))
    .rows[0].n;
  assert.equal(after_, before, "no committed row without its S3 twin");
});

test("tenure stamps from the YearsPlayed badge; absent badge never clears it", async () => {
  const profile = await fixture("player/profile.json");
  const tag = meta["player/profile.json"].entity_key;
  const r = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: { ...profile, trophies: (profile.trophies ?? 0) + 21 },
      fetchedAt: new Date().toISOString(),
    }),
  );
  assert.equal(r.outcome, "admitted");
  const { rows } = await ctx.db.query(
    `select years_played, account_age_days from player where player_tag = $1`,
    [tag],
  );
  assert.equal(rows[0].years_played, 4, "badge level stamped");
  assert.equal(rows[0].account_age_days, 1712, "badge progress = account days");

  // A later payload WITHOUT the badge must not null out known tenure.
  const noBadge = {
    ...profile,
    trophies: (profile.trophies ?? 0) + 22,
    badges: [],
  };
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: noBadge,
      fetchedAt: new Date().toISOString(),
    }),
  );
  const { rows: after2 } = await ctx.db.query(
    `select years_played from player where player_tag = $1`,
    [tag],
  );
  assert.equal(
    after2[0].years_played,
    4,
    "absent badge = unknown, never a wipe",
  );
});

test("rankings payloads admit and accrete player identity (feedback #6)", async () => {
  const payload = {
    items: [
      { tag: "#99GU92P0", name: "Top One", rank: 1 },
      { tag: "#2PPLQQ", name: "Top Two", rank: 2 },
    ],
    paging: {},
  };
  const r = await processResult(
    ctx.db,
    message({
      endpoint: "rankings_players",
      entityKey: "global",
      payload,
      fetchedAt: new Date().toISOString(),
    }),
  );
  assert.equal(r.outcome, "admitted", JSON.stringify(r));
  assert.equal(r.projection.players, 2);
  const { rows } = await ctx.db.query(
    `select name from player where player_tag = '#99GU92P0'`,
  );
  assert.equal(rows[0].name, "Top One");
});

function crCompact(d) {
  return d
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace("Z", "Z");
}

test("capture audit: overlapping polls are gapless; a fully-rolled log flags a gap", async () => {
  const file = "player_battlelog/with_boat_and_duel.json";
  const log = await fixture(file);
  const tag = "#PQPQPQ99"; // fresh observer: no prior coverage from other tests
  const now = Date.now();
  const iso = (offsetMin, i) =>
    new Date(now - offsetMin * 60000 + i).toISOString();

  // First poll: history arriving, not audited.
  // Identity binding (sol-6 F4): a battlelog only admits when the
  // observer appears in every battle's team - stamp them in.
  const asObserver = (b) => ({
    ...b,
    team: [{ ...b.team[0], tag }, ...b.team.slice(1)],
  });
  const first = structuredClone(log).map((b, i) => ({
    ...asObserver(b),
    battleTime: crCompact(new Date(now - 120 * 60000 + i * 60000)),
  }));
  await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: tag,
      payload: first,
      fetchedAt: iso(100, 1),
    }),
  );
  let { rows } = await ctx.db.query(
    `select count(*)::int n from capture_audit where subject_tag = $1`,
    [tag],
  );
  assert.equal(rows[0].n, 0, "first poll is never audited");

  // Second poll overlaps (oldest battle already known): gapless.
  const second = structuredClone(first);
  await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: tag,
      payload: second,
      fetchedAt: iso(90, 2),
    }),
  );
  ({ rows } = await ctx.db.query(
    `select gap from capture_audit where subject_tag = $1 order by fetched_at`,
    [tag],
  ));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gap, false, "overlap = no gap");

  // Third poll: the log fully rolled - every battle new -> gap flagged.
  const rolled = structuredClone(log).map((b, i) => ({
    ...asObserver(b),
    battleTime: crCompact(new Date(now - 30 * 60000 + i * 60000)),
  }));
  await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: tag,
      payload: rolled,
      fetchedAt: iso(10, 3),
    }),
  );
  ({ rows } = await ctx.db.query(
    `select gap from capture_audit where subject_tag = $1 order by fetched_at`,
    [tag],
  ));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].gap, true, "fully-rolled log = potential gap");
});
