import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { processResult, stampBurst } from "../src/pipeline.mjs";
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
  observed,
  filtered,
}) {
  const m = {
    v: 1,
    job: { endpoint, entity_key: entityKey, lane },
    gateway_id: gatewayId,
    fetched_at: fetchedAt,
    status,
    ...(observed !== undefined ? { observed, filtered } : {}),
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
  const { rows: burst } = await ctx.db.query(
    `select burst_bph, burst_at from poll_state where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [observer],
  );
  assert.notEqual(
    burst[0].burst_bph,
    null,
    "a fresh admission stamps the burst signal",
  );
  assert.equal(burst[0].burst_at.toISOString(), FRESH_AT);
});

test("stampBurst: max battles in any 6h window over 14 days, as a per-hour rate", async () => {
  const tag = "#8P8YLQ";
  const asOf = "2026-09-09T12:00:00.000Z";
  await ctx.db.query(`insert into player (player_tag) values ($1)`, [tag]);
  await ctx.db.query(
    `insert into poll_state (subject_tag, endpoint) values ($1, 'player_battlelog')`,
    [tag],
  );
  const at = (hoursAgo) => new Date(Date.parse(asOf) - hoursAgo * 3600_000);
  // 12 battles inside two hours (the grinder shape), 3 spread a day earlier,
  // and one 20 days ago that must not count.
  const times = [
    ...Array.from({ length: 12 }, (_, i) => at(1 + i / 6)),
    at(30),
    at(31),
    at(32),
    at(20 * 24),
  ];
  for (const [i, t] of times.entries()) {
    const id = `burst-${i}`;
    await ctx.db.query(
      `insert into battle (battle_id, battle_time, type, type_class) values ($1, $2, 'PvP', 'pvp')`,
      [id, t],
    );
    await ctx.db.query(
      `insert into battle_participant (battle_id, player_tag, side, battle_time) values ($1, $2, 0, $3)`,
      [id, tag, t],
    );
  }
  await stampBurst(ctx.db, tag, asOf);
  const { rows } = await ctx.db.query(
    `select burst_bph, burst_at from poll_state where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [tag],
  );
  assert.equal(Number(rows[0].burst_bph), 2, "12 in a 6h window / 6 = 2 bph");
  assert.equal(rows[0].burst_at.toISOString(), asOf);
  // Bounded by the scheduler at 0.5 x 30 / 2 x 60 = 450 minutes.
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

test("a live roster stamps the clan cadence's inputs: liveliness now and membership churn", async () => {
  // Fresh fetch (within 24h) so the stamp applies; lastSeen is rewritten
  // relative to the fetch so the buckets are deterministic.
  const fetchedAt = new Date(Date.now() - 60_000).toISOString();
  const cr = (msAgo) =>
    new Date(Date.parse(fetchedAt) - msAgo)
      .toISOString()
      .replaceAll("-", "")
      .replaceAll(":", "");
  const clan = structuredClone(await fixture("clan/roster.json"));
  clan.tag = "#2GUY2";
  clan.memberList.forEach((m, i) => {
    // Five members in the game this hour, ten more today, the rest a week ago.
    m.lastSeen = cr(
      i < 5 ? 10 * 60_000 : i < 15 ? 5 * 3600_000 : 7 * 86_400_000,
    );
  });
  const r1 = await processResult(
    ctx.db,
    message({
      endpoint: "clan",
      entityKey: "#2GUY2",
      payload: clan,
      fetchedAt,
    }),
  );
  assert.equal(r1.outcome, "admitted", JSON.stringify(r1));
  assert.equal(r1.projection.activeNow, 5);
  assert.equal(r1.projection.seen24h, 15);
  let { rows } = await ctx.db.query(
    `select hint, yield_bph from poll_state where subject_tag = '#2GUY2' and endpoint = 'clan'`,
  );
  assert.equal(rows[0].hint, "active");
  assert.equal(rows[0].yield_bph, null, "no window yet, so no churn rate");

  // Two hours later: nobody this hour, two members left, one joined -
  // three events over the window, and the clan reads as idle.
  const later = new Date(Date.parse(fetchedAt) + 2 * 3600_000).toISOString();
  const next = structuredClone(clan);
  next.memberList.forEach((m) => {
    m.lastSeen = cr(-2 * 3600_000 + 3 * 3600_000); // an hour before `later`
  });
  next.memberList.splice(0, 2);
  next.memberList.push({
    ...clan.memberList[0],
    tag: "#2GUY2PY",
    name: "newcomer",
  });
  next.members = next.memberList.length;
  const r2 = await processResult(
    ctx.db,
    message({
      endpoint: "clan",
      entityKey: "#2GUY2",
      payload: next,
      fetchedAt: later,
    }),
  );
  assert.equal(r2.outcome, "admitted", JSON.stringify(r2));
  assert.equal(r2.projection.joined, 1);
  assert.equal(r2.projection.departed, 2);
  ({ rows } = await ctx.db.query(
    `select hint, yield_bph from poll_state where subject_tag = '#2GUY2' and endpoint = 'clan'`,
  ));
  assert.equal(rows[0].hint, "idle");
  assert.ok(
    Math.abs(Number(rows[0].yield_bph) - 1.5) < 0.01,
    `3 events over 2 hours = 1.5/h, got ${rows[0].yield_bph}`,
  );
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

/**
 * The board is recorded (0068): a snapshot per fetch that changed, a row
 * per place, and a presence that records the top-N for the season.
 */
test("a Path of Legends board is recorded as a snapshot, and its top-N become recorded players", async () => {
  // The global board records its top 200 (seeded); a scratch board with
  // a small record_top keeps the assertions readable.
  await ctx.db.query(
    `insert into ranking_board (board, location_key, label, location_kind, every_minutes, record_top, enabled)
     values ('pol', '57009999', 'Testland', 'country', 60, 2, true)
     on conflict (board, location_key) do update set record_top = 2`,
  );
  const at = (m) => new Date(Date.now() - m * 60000).toISOString();
  const board = (items) => ({ items, paging: {} });
  const first = board([
    {
      tag: "#99GU92P0",
      name: "Top One",
      rank: 1,
      eloRating: 2100,
      clan: { tag: "#GRGYQ0JU", name: "PTL Germany" },
    },
    {
      tag: "#2PPLQQ",
      name: "Top Two",
      rank: 2,
      eloRating: 2050,
      clan: { tag: "#GRGYQ0JU", name: "PTL Germany" },
    },
    { tag: "#8LR0P09LR", name: "Third", rank: 3, eloRating: 1990 },
  ]);

  const r1 = await processResult(
    ctx.db,
    message({
      endpoint: "rankings_pol",
      entityKey: "57009999",
      payload: first,
      fetchedAt: at(120),
    }),
  );
  assert.equal(r1.outcome, "admitted", JSON.stringify(r1));
  assert.equal(r1.projection.wrote, true);
  assert.equal(r1.projection.players, 3);
  assert.equal(
    r1.projection.presences_new,
    2,
    "only the top 2 are recorded on this board",
  );
  assert.equal(r1.projection.recordings_started, 2);

  const { rows: entries } = await ctx.db.query(
    `select e.rank, e.player_tag, e.rating, e.clan_tag from ranking_entry e
     join ranking_snapshot s using (snapshot_id)
     where s.board = 'pol' and s.location_key = '57009999' order by e.rank`,
  );
  assert.deepEqual(
    entries.map((e) => [e.rank, e.player_tag, e.rating, e.clan_tag]),
    [
      [1, "#99GU92P0", 2100, "#GRGYQ0JU"],
      [2, "#2PPLQQ", 2050, "#GRGYQ0JU"],
      [3, "#8LR0P09LR", 1990, null],
    ],
  );
  const { rows: rec } = await ctx.db.query(
    `select subject_tag, origin, scope from recording
     where subject_type = 'player' and subject_tag in ('#99GU92P0', '#2PPLQQ', '#8LR0P09LR') and status = 'active'
     order by subject_tag`,
  );
  assert.deepEqual(
    rec.map((x) => [x.subject_tag, x.origin, x.scope]),
    [
      ["#2PPLQQ", "ranking", "comprehensive"],
      ["#99GU92P0", "ranking", "comprehensive"],
    ],
    "the top two are recorded in full, by the ranking, not by anyone's claim",
  );

  // The same board an hour later writes NOTHING new: the snapshot is
  // confirmed, not duplicated.
  const r2 = await processResult(
    ctx.db,
    message({
      endpoint: "rankings_pol",
      entityKey: "57009999",
      payload: first,
      fetchedAt: at(60),
    }),
  );
  assert.equal(r2.outcome, "admitted");
  assert.equal(r2.projection.wrote, false);
  const { rows: snaps } = await ctx.db.query(
    `select count(*)::int as n, max(last_confirmed_at) > min(observed_at) as confirmed_later
     from ranking_snapshot where board = 'pol' and location_key = '57009999'`,
  );
  assert.equal(snaps[0].n, 1);
  assert.equal(snaps[0].confirmed_later, true);

  // A movement writes a second snapshot; a rename alone would not have.
  // Top Two drops to #3: still recorded — presence is sticky for the season.
  const moved = board([
    {
      tag: "#99GU92P0",
      name: "Top One",
      rank: 1,
      eloRating: 2120,
      clan: { tag: "#GRGYQ0JU", name: "PTL Germany" },
    },
    { tag: "#8LR0P09LR", name: "Third", rank: 2, eloRating: 2060 },
    {
      tag: "#2PPLQQ",
      name: "Top Two",
      rank: 3,
      eloRating: 2040,
      clan: { tag: "#GRGYQ0JU", name: "PTL Germany" },
    },
  ]);
  const r3 = await processResult(
    ctx.db,
    message({
      endpoint: "rankings_pol",
      entityKey: "57009999",
      payload: moved,
      fetchedAt: at(1),
    }),
  );
  assert.equal(r3.projection.wrote, true);
  assert.equal(r3.projection.presences_new, 1, "Third entered the top 2");
  const { rows: still } = await ctx.db.query(
    `select count(*)::int as n from recording
     where subject_tag = '#2PPLQQ' and status = 'active'`,
  );
  assert.equal(still[0].n, 1, "dropping to #3 does not stop the record");
  const { rows: presence } = await ctx.db.query(
    `select best_rank, sticky_until > now() + interval '1 day' as sticky from ranking_presence
     where player_tag = '#2PPLQQ' and board = 'pol' and location_key = '57009999'`,
  );
  assert.equal(presence[0].best_rank, 2);
  assert.equal(presence[0].sticky, true);
});

test("a board admission stamps poll_state under the board's own key, so the planner sees it fetched", async () => {
  // The leak: normalizeTag('global') is null, so nothing was stamped and
  // every board was starved on every tick (~1,500 fetches/hour, 04:19Z
  // 2026-09-11). The scheduler seeds poll_state with the location_key;
  // admission must write the very same string.
  await ctx.db.query(
    `insert into poll_state (subject_tag, endpoint) values ('global', 'rankings_pol')
     on conflict do nothing`,
  );
  const r = await processResult(
    ctx.db,
    message({
      endpoint: "rankings_pol",
      entityKey: "global",
      payload: {
        items: [
          { tag: "#99GU92P0", name: "Top One", rank: 1, eloRating: 2100 },
        ],
        paging: {},
      },
      fetchedAt: new Date().toISOString(),
    }),
  );
  assert.equal(r.outcome, "admitted", JSON.stringify(r));
  const { rows } = await ctx.db.query(
    `select last_admitted_at from poll_state where subject_tag = 'global' and endpoint = 'rankings_pol'`,
  );
  assert.ok(
    rows[0]?.last_admitted_at,
    "the board's freshness advanced on admission",
  );
});

test("a board with a cursor past our limit is recorded as truncated", async () => {
  const r = await processResult(
    ctx.db,
    message({
      endpoint: "rankings_pol",
      entityKey: "57009998",
      payload: {
        items: [
          { tag: "#99GU92P0", name: "Top One", rank: 1, eloRating: 2100 },
        ],
        paging: { cursors: { after: "eyJwb3MiOjEwMDB9" } },
      },
      fetchedAt: new Date().toISOString(),
    }),
  );
  assert.equal(r.outcome, "admitted", JSON.stringify(r));
  assert.equal(r.projection.truncated, true);
  // An unknown location is remembered, not scheduled.
  const { rows } = await ctx.db.query(
    `select enabled, record_top from ranking_board where board = 'pol' and location_key = '57009998'`,
  );
  assert.deepEqual(rows[0], { enabled: false, record_top: 0 });
});

test("a season's final is filed under the game clock's season, with the API's month beside it (0070)", async () => {
  const final = (name, rating) => ({
    items: [{ tag: "#99GU92P0", name, rank: 1, eloRating: rating }],
    paging: {},
  });
  // The planner keys the job by the API's month.
  const r1 = await processResult(
    ctx.db,
    message({
      endpoint: "rankings_pol_season",
      entityKey: "2026-08",
      payload: final("Flash Light", 4121),
      fetchedAt: "2026-09-11T05:00:00Z",
    }),
  );
  assert.equal(r1.outcome, "admitted", JSON.stringify(r1));
  // A hand live_fetch by the numeric form files under the SAME season:
  // 143 is 2026-08's position in the API's list, not a season number.
  const r2 = await processResult(
    ctx.db,
    message({
      endpoint: "rankings_pol_season",
      entityKey: "143",
      payload: final("Flash Light", 4121),
      fetchedAt: "2026-09-11T06:00:00Z",
    }),
  );
  assert.equal(r2.outcome, "admitted", JSON.stringify(r2));
  assert.equal(
    r2.projection.wrote,
    false,
    "the same final, confirmed not twinned",
  );
  const { rows } = await ctx.db.query(
    `select season_id, season_month, entries from ranking_snapshot
     where board = 'pol_final' and season_month = '2026-08'`,
  );
  assert.deepEqual(rows, [
    { season_id: "135", season_month: "2026-08", entries: 1 },
  ]);
  // The Pass's own "Season 87" is no season the API knows.
  const r3 = await processResult(
    ctx.db,
    message({
      endpoint: "rankings_pol_season",
      entityKey: "87",
      payload: final("nobody", 1),
      fetchedAt: "2026-09-11T06:00:00Z",
    }),
  );
  assert.equal(r3.projection?.projected, "none", JSON.stringify(r3));
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

  // A collector that filtered under the lease's mark submits only the
  // new battles plus its counts; the verdict comes from the counts.
  // Some dropped: the log overlapped what we had - no gap.
  const newer = structuredClone(log)
    .slice(0, 3)
    .map((b, i) => ({
      ...asObserver(b),
      battleTime: crCompact(new Date(now + 10 * 60000 + i * 60000)),
    }));
  const r4 = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: tag,
      payload: newer,
      fetchedAt: iso(4, 4),
      observed: 25,
      filtered: 22,
    }),
  );
  assert.equal(r4.outcome, "admitted", JSON.stringify(r4));
  assert.equal(r4.projection.battlesSeen, 25, "the collector's count");
  assert.equal(r4.projection.battlesInserted, 3);
  // Nothing dropped from a full log: nothing was as old as the mark.
  const rolledAgain = structuredClone(log).map((b, i) => ({
    ...asObserver(b),
    battleTime: crCompact(new Date(now + 20 * 60000 + i * 1000)),
  }));
  await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: tag,
      payload: rolledAgain,
      fetchedAt: iso(2, 5),
      observed: 25,
      filtered: 0,
    }),
  );
  // No new battles at all: an empty body, counts say 25 seen, 25 known.
  const r6 = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: tag,
      payload: [],
      fetchedAt: iso(1, 6),
      observed: 25,
      filtered: 25,
    }),
  );
  assert.equal(r6.outcome, "admitted");
  assert.equal(r6.projection.battlesInserted, 0);
  const { rows: receipts } = await ctx.db.query(
    `select observed, filtered from api_receipt
     where endpoint = 'player_battlelog' and entity_key = $1 order by fetched_at`,
    [tag],
  );
  assert.deepEqual(
    receipts.map((r) => [r.observed, r.filtered]),
    [
      [null, null],
      [null, null],
      [null, null],
      [25, 22],
      [25, 0],
      [25, 25],
    ],
    "the counts are the receipt's record of what the poll found (0074)",
  );
  ({ rows } = await ctx.db.query(
    `select gap from capture_audit where subject_tag = $1 order by fetched_at`,
    [tag],
  ));
  assert.deepEqual(
    rows.map((r) => r.gap),
    [false, true, false, true, false],
    "filtered>0 = overlap; filtered=0 on a full log = gap; nothing new = no gap",
  );
});

test("decompression is bounded: a compression bomb is rejected as body:too_large with no payload row (issue #4)", async () => {
  const before = (await ctx.db.query(`select count(*)::int n from api_payload`))
    .rows[0].n;
  // 32 MiB of one byte gzips to a few KB: tiny on the wire, huge inflated.
  // (The bound rose to 16 MiB with 0069 so a 9,999-place season final,
  // ~1.5 MB raw, clears it with room; the bomb has to be past that.)
  const bomb = gzipSync(Buffer.alloc(32 * 1024 * 1024, 0x30)).toString(
    "base64",
  );
  assert.ok(bomb.length < 50_000, "the bomb is small on the wire");
  const result = await processResult(ctx.db, {
    v: 1,
    job: { endpoint: "player", entity_key: "#20JJJ2CCRU", lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: "2026-09-06T12:00:00Z",
    status: "ok",
    body_gzip_b64: bomb,
  });
  assert.equal(result.outcome, "rejected");
  assert.ok(result.errors.includes("body:too_large"));
  const after = (await ctx.db.query(`select count(*)::int n from api_payload`))
    .rows[0].n;
  assert.equal(after, before, "nothing inflated was stored");
  const { rows } = await ctx.db.query(
    `select admission from api_receipt
     where gateway_id = $1 and fetched_at = '2026-09-06T12:00:00Z'`,
    [gatewayId],
  );
  assert.equal(
    rows[0]?.admission,
    "rejected",
    "the attempt is an observable receipt",
  );
});

test("last_success_at is owned by admission: rejections, fetch errors, and re-deliveries never advance it; admitted and content-identical refetches do (issue #7)", async () => {
  await ctx.db.query(
    `update gateway set last_success_at = null where gateway_id = $1`,
    [gatewayId],
  );
  const success = async () =>
    (
      await ctx.db.query(
        `select last_success_at from gateway where gateway_id = $1`,
        [gatewayId],
      )
    ).rows[0].last_success_at;
  const clan = await fixture("clan/roster.json");
  const entityKey = meta["clan/roster.json"].entity_key;
  const at = (m) => `2026-09-06T12:0${m}:00Z`;

  await processResult(
    ctx.db,
    message({
      endpoint: "clan",
      entityKey,
      payload: "nope {{",
      fetchedAt: at(1),
    }),
  );
  assert.equal(await success(), null, "unparseable never counts");
  await processResult(
    ctx.db,
    message({
      endpoint: "clan",
      entityKey,
      payload: clan,
      fetchedAt: at(2),
      status: "error",
    }),
  );
  assert.equal(await success(), null, "a fetch error never counts");
  const rejected = await processResult(
    ctx.db,
    message({
      endpoint: "clan",
      entityKey,
      payload: { ...clan, members: (clan.members ?? 0) + 7 },
      fetchedAt: at(3),
    }),
  );
  assert.equal(rejected.outcome, "rejected");
  assert.equal(await success(), null, "a rejected payload is not a success");

  const admitted = await processResult(
    ctx.db,
    message({ endpoint: "clan", entityKey, payload: clan, fetchedAt: at(4) }),
  );
  assert.equal(admitted.outcome, "admitted");
  const t1 = await success();
  assert.ok(t1, "admission stamps success");

  const dup = await processResult(
    ctx.db,
    message({ endpoint: "clan", entityKey, payload: clan, fetchedAt: at(4) }),
  );
  assert.equal(dup.outcome, "duplicate");
  assert.equal(
    String(await success()),
    String(t1),
    "a re-delivery is not new work",
  );

  await new Promise((r) => setTimeout(r, 5));
  const again = await processResult(
    ctx.db,
    message({ endpoint: "clan", entityKey, payload: clan, fetchedAt: at(5) }),
  );
  assert.equal(again.outcome, "admitted");
  assert.ok(
    new Date(await success()) > new Date(t1),
    "a content-identical refetch is a real, successful fetch",
  );
});
