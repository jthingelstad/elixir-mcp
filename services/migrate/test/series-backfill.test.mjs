/**
 * The archive backfill over a scratch database and an in-memory
 * archive: each lane walks its admitted receipts in order through the
 * projector's series half, commits per batch, advances its cursor, and
 * a rerun writes nothing; the self census reads it back.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { archiveKey, processResult } from "../../ingest/src/pipeline.mjs";
import { payloadHash } from "../../ingest/src/hash.mjs";
import {
  seriesBackfill,
  seriesCensusSelf,
  raceWeekRepair,
} from "../src/ops-series.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_backfill_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let gatewayId;
const archive = new Map(); // key -> gzip
const keysByEntity = new Map(); // endpoint/entity -> Map(hash16 -> key)

const fixture = async (rel) =>
  JSON.parse(await readFile(path.join(repoRoot, "fixtures", rel), "utf8"));

/** A receipt as the collector door would have left it: the receipt row,
 *  the archived object under the first fetch of that content. */
async function admitted(endpoint, entityKey, payload, fetchedAt) {
  const hash = payloadHash(payload);
  const key = archiveKey(
    endpoint,
    entityKey,
    new Date(fetchedAt).toISOString(),
    hash,
  );
  if (!archive.has(key))
    archive.set(key, gzipSync(Buffer.from(JSON.stringify(payload))));
  const id = `${endpoint}/${entityKey}`;
  if (!keysByEntity.has(id)) keysByEntity.set(id, new Map());
  if (!keysByEntity.get(id).has(hash.slice(0, 16)))
    keysByEntity.get(id).set(hash.slice(0, 16), key);
  const {
    rows: [r],
  } = await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ($1, $2, $3, $4, $5, 'admitted') returning receipt_id`,
    [endpoint, entityKey, fetchedAt, hash, gatewayId],
  );
  return r.receipt_id;
}

const deps = {
  getObject: async (key) => {
    const body = archive.get(key);
    if (!body) throw new Error(`no object ${key}`);
    return body;
  },
  listKeys: async (endpoint, entity) =>
    keysByEntity.get(`${endpoint}/${entity}`) ?? new Map(),
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const {
    rows: [account],
  } = await db.query(
    `insert into account (email_hash, status, is_owner, role) values ('bf-owner', 'approved', true, 'owner')
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'bf-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
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

test("clan lane: receipt-ordered, batched, resumable; a day's last receipt wins; a rerun writes nothing", async () => {
  const roster = await fixture("clan/roster.json");
  const clanTag = "#J2RGCRVG";
  // Three rosters on one game day (the last should win), one the next
  // day, and one old daily roster from March with fewer fields.
  const later = structuredClone(roster);
  later.clanScore += 10;
  later.memberList[0].trophies += 5;
  await admitted("clan", clanTag, roster, "2026-09-03T11:00:00Z");
  await admitted("clan", clanTag, later, "2026-09-03T15:00:00Z");
  await admitted("clan", clanTag, roster, "2026-09-03T13:00:00Z"); // out of order, older
  await admitted("clan", clanTag, later, "2026-09-04T11:00:00Z");
  const march = {
    tag: clanTag,
    name: "POAP KINGS",
    memberList: roster.memberList
      .slice(0, 5)
      .map((m) => ({ tag: m.tag, name: m.name, role: m.role })),
  };
  await admitted("clan", clanTag, march, "2026-03-12T02:21:45Z");

  const runs = [];
  for (;;) {
    const r = await seriesBackfill(
      DB_URL,
      { lane: "clan", batch: 2, budget_s: 60 },
      deps,
    );
    runs.push(r);
    if (r.done) break;
  }
  assert.equal(
    runs.length,
    1,
    "one invocation, three batches inside its budget",
  );
  assert.equal(runs[0].batches, 3);
  assert.equal(runs[0].receipts, 5);
  assert.equal(runs[0].objects_read, 3, "three distinct payloads");
  assert.equal(runs[0].cache_hits, 2);
  assert.equal(runs[0].missing_objects, 0);
  assert.ok(runs[0].rows_written > 0);
  assert.equal(runs[0].remaining, 0);
  assert.equal(runs[0].state.receipts_done, 5);
  assert.ok(runs[0].state.finished_at);

  const { rows: clanRows } = await db.query(
    `select day::text as day, clan_score, members, receipt_id from clan_snapshot_daily
     where clan_tag = $1 order by day`,
    [clanTag],
  );
  assert.deepEqual(
    clanRows.map((r) => [r.day, r.clan_score, r.members]),
    [
      ["2026-03-11", null, 5],
      ["2026-09-03", roster.clanScore + 10, roster.members],
      ["2026-09-04", roster.clanScore + 10, roster.members],
    ],
  );
  assert.ok(clanRows[1].receipt_id, "the day row carries its receipt");
  const {
    rows: [m0],
  } = await db.query(
    `select trophies, roster_observed_at from player_snapshot_daily
     where player_tag = $1 and snapshot_date = '2026-09-03' and snapshot_kind = 'daily'`,
    [roster.memberList[0].tag],
  );
  assert.equal(
    m0.trophies,
    roster.memberList[0].trophies + 5,
    "the 15:00Z observation wins over the 13:00Z one replayed after it",
  );
  assert.equal(m0.roster_observed_at.toISOString(), "2026-09-03T15:00:00.000Z");
  const {
    rows: [{ n }],
  } = await db.query(`select count(*)::int as n from player_event`);
  assert.equal(n, 0, "a replay writes no moments");

  const again = await seriesBackfill(
    DB_URL,
    { lane: "clan", batch: 200 },
    deps,
  );
  assert.equal(again.done, true);
  assert.equal(again.receipts, 0);
});

test("player lane fills the profile columns on an existing live row from the day's last receipt and writes nothing for earlier ones", async () => {
  const profile = await fixture("player/profile.json");
  const tag = profile.tag;
  // The live path wrote the day's row at 14:40:34Z (the fixture's own
  // fetch); the archive holds an earlier poll too.
  const message = {
    v: 1,
    job: { endpoint: "player", entity_key: tag, lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: "2026-09-03T14:40:34Z",
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(profile))).toString(
      "base64",
    ),
  };
  const live = await processResult(db, message);
  assert.equal(live.outcome, "admitted");
  await db.query(
    `update player_snapshot_daily set king_tower_level = null, total_donations = null
     where player_tag = $1`,
    [tag],
  );
  await db.query(`delete from player_progress_daily where player_tag = $1`, [
    tag,
  ]);
  const earlier = structuredClone(profile);
  earlier.trophies -= 40;
  await admitted("player", tag, earlier, "2026-09-03T11:00:00Z"); // same game day, earlier
  // The live receipt's object, as the door would have archived it.
  const hash = payloadHash(profile);
  const key = archiveKey("player", tag, "2026-09-03T14:40:34.000Z", hash);
  archive.set(key, gzipSync(Buffer.from(JSON.stringify(profile))));
  keysByEntity.set(
    `player/${tag}`,
    new Map([[hash.slice(0, 16), key], ...keysByEntity.get(`player/${tag}`)]),
  );

  const r = await seriesBackfill(DB_URL, { lane: "player", batch: 200 }, deps);
  assert.equal(r.done, true);
  assert.equal(r.receipts, 2);
  const {
    rows: [row],
  } = await db.query(
    `select trophies, king_tower_level, total_donations, profile_observed_at
     from player_snapshot_daily where player_tag = $1 and snapshot_date = '2026-09-03' and snapshot_kind = 'daily'`,
    [tag],
  );
  assert.equal(
    row.trophies,
    profile.trophies,
    "the 11:00Z receipt could not regress the 14:40Z row",
  );
  assert.equal(
    row.king_tower_level,
    profile.kingTowerLevel,
    "the new column filled from the day's last receipt",
  );
  assert.equal(row.total_donations, profile.totalDonations);
  assert.equal(
    row.profile_observed_at.toISOString(),
    "2026-09-03T14:40:34.000Z",
  );
  const { rows: progress } = await db.query(
    `select progress_key, day::text as day, snapshot_kind, trophies from player_progress_daily where player_tag = $1 order by 1, 2, 3`,
    [tag],
  );
  assert.equal(progress.length, 2, JSON.stringify(progress));
});

test("race lane resolves the week from the calendar and writes the rivals and period logs, never events", async () => {
  const race = await fixture("currentriverrace/war_day.json");
  const clanTag = race.clan.tag;
  await admitted("currentriverrace", clanTag, race, "2026-08-31T07:37:36Z");
  // A stand-by payload: section 4 of the old season read after the roll.
  const standby = structuredClone(race);
  standby.sectionIndex = 4;
  standby.periodIndex = 34;
  standby.periodLogs = race.periodLogs.map((l) => ({
    ...l,
    periodIndex: l.periodIndex + 7,
  }));
  await admitted("currentriverrace", clanTag, standby, "2026-09-07T10:05:00Z");
  // A mid-season Monday in the slot band: the next week's race is open
  // (section 1, period 7) while the calendar says section 0 until
  // 10:00Z. The current season, the payload's section - never the
  // season before (the phantom-rivals bug of 2026-09-17).
  const slotBand = structuredClone(race);
  slotBand.sectionIndex = 1;
  slotBand.periodIndex = 7;
  slotBand.periodLogs = [];
  slotBand.clans = race.clans.map((c, i) => ({
    ...c,
    tag: i === 0 ? clanTag : `#2PP0V9${["QP", "UP", "CP", "JP"][i - 1]}`,
    fame: 0,
    periodPoints: 0,
  }));
  slotBand.clan = { ...race.clan, fame: 0, periodPoints: 0 };
  await admitted("currentriverrace", clanTag, slotBand, "2026-09-14T09:57:54Z");
  // And one the calendar cannot place: section 3 on a section-0 day.
  const stray = structuredClone(slotBand);
  stray.sectionIndex = 3;
  stray.periodIndex = 21;
  await admitted("currentriverrace", clanTag, stray, "2026-09-08T12:00:00Z");
  const before = (await db.query(`select count(*)::int as n from clan_event`))
    .rows[0].n;
  const r = await seriesBackfill(DB_URL, { lane: "race", batch: 200 }, deps);
  assert.equal(r.done, true);
  assert.equal(r.receipts, 4);
  assert.equal(
    r.unresolved_season,
    1,
    "the stray poll is counted, never filed",
  );
  const { rows: weeks } = await db.query(
    `select season_id, section_index from war_week where clan_tag = $1 order by 1, 2`,
    [clanTag],
  );
  assert.deepEqual(
    weeks.map((w) => [w.season_id, w.section_index]),
    [
      [135, 3],
      [135, 4],
      [136, 1],
    ],
    "2026-08-31 is S135 section 3; the stand-by read on 09-07 10:05Z is S135 section 4; the slot-band read on 09-14 09:57Z is S136 section 1",
  );
  const {
    rows: [phantoms],
  } = await db.query(
    `select count(*)::int as n from war_week_clan
      where clan_tag = $1 and season_id = 135 and section_index = 1`,
    [clanTag],
  );
  assert.equal(
    phantoms.n,
    0,
    "nothing filed under the previous season's week 1",
  );
  const {
    rows: [{ rivals, logs }],
  } = await db.query(
    `select (select count(*)::int from war_week_clan where clan_tag = $1 and clan_score is not null) as rivals,
            (select count(*)::int from war_period_log where clan_tag = $1) as logs`,
    [clanTag],
  );
  assert.equal(rivals, 15, "five clans in each of the three weeks");
  assert.ok(logs > 0);
  const after = (await db.query(`select count(*)::int as n from clan_event`))
    .rows[0].n;
  assert.equal(after, before, "no events from the race lane");
});

test("battle lane fills the ten columns where null and the self census reads every lane back", async () => {
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const tag = "#2YG98VVQ";
  // Ingest the log live with the columns nulled afterwards (the rows as
  // they were before 0131), then walk its receipt.
  const message = {
    v: 1,
    job: { endpoint: "player_battlelog", entity_key: tag, lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: "2026-09-02T08:00:49Z",
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(log))).toString(
      "base64",
    ),
  };
  const live = await processResult(db, message);
  assert.equal(live.outcome, "admitted");
  await db.query(
    `update battle set arena_id = null, deck_selection = null, is_ladder_tournament = null,
       is_hosted_match = null, boat_battle_side = null, remaining_towers = null`,
  );
  const hash = payloadHash(log);
  const key = archiveKey(
    "player_battlelog",
    tag,
    "2026-09-02T08:00:49.000Z",
    hash,
  );
  archive.set(key, gzipSync(Buffer.from(JSON.stringify(log))));
  keysByEntity.set(
    `player_battlelog/${tag}`,
    new Map([[hash.slice(0, 16), key]]),
  );
  const before = await seriesCensusSelf(DB_URL, {});
  assert.ok(before.battle.without_facts > 0);
  const r = await seriesBackfill(DB_URL, { lane: "battle", batch: 200 }, deps);
  assert.equal(r.done, true);
  assert.equal(r.receipts, 1);
  assert.ok(r.rows_written > 0);
  const census = await seriesCensusSelf(DB_URL, { since: "2026-03-12" });
  assert.equal(census.battle.without_facts, 0);
  assert.equal(census.clan.missing_clan_row, 0);
  assert.equal(census.clan.missing_member_rows, 0);
  assert.equal(census.clan.clan_days, 3);
  assert.equal(census.player.missing_profile_row, 0);
  assert.deepEqual(
    census.lanes.map((l) => [l.lane, l.finished_at !== null]),
    [
      ["battle", true],
      ["clan", true],
      ["player", true],
      ["race", true],
    ],
  );
});

test("race_week_repair: phantoms go, overwritten real rows are nulled, and a reset re-walk refills them", async () => {
  // What the first rule wrote: under S135 week 1 (a closed, logged
  // week), the new bracket's clans as phantoms and the observing clan's
  // own row stamped after the season's end.
  const clanTag = "#J2RGCRVG";
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index) values ($1, 135, 1) on conflict do nothing`,
    [clanTag],
  );
  await db.query(
    `insert into war_week_clan (clan_tag, season_id, section_index, participant_clan_tag, fame, rank,
       period_points, clan_score, period_points_observed_at)
     values ($1, 135, 1, $1, 9000, 1, 777, 52000, '2026-09-14T09:57:54Z'),
            ($1, 135, 1, '#2PP0V9QP', 0, null, 0, 1000, '2026-09-14T09:57:54Z'),
            ($1, 135, 1, '#2PP0V9UP', 0, null, 0, 1000, '2026-09-14T09:57:54Z')`,
    [clanTag],
  );
  const dry = await raceWeekRepair(DB_URL, {});
  assert.equal(dry.dry_run, true);
  assert.equal(dry.census.phantoms, 2);
  assert.equal(dry.census.overwritten, 1);
  assert.equal(dry.census.weeks, 1);
  const wet = await raceWeekRepair(DB_URL, { dry_run: false });
  assert.equal(wet.deleted, 2);
  assert.equal(wet.nulled, 1);
  const {
    rows: [own],
  } = await db.query(
    `select fame, rank, period_points, clan_score, period_points_observed_at from war_week_clan
      where clan_tag = $1 and season_id = 135 and section_index = 1 and participant_clan_tag = $1`,
    [clanTag],
  );
  assert.deepEqual(own, {
    fame: 9000,
    rank: 1,
    period_points: null,
    clan_score: null,
    period_points_observed_at: null,
  });
  const again = await raceWeekRepair(DB_URL, {});
  assert.equal(again.census.rows, 0);
  // The re-walk from receipt 0 refills the real weeks under the fixed rule.
  const rerun = await seriesBackfill(
    DB_URL,
    { lane: "race", batch: 200, reset: true },
    deps,
  );
  assert.equal(rerun.done, true);
  assert.equal(rerun.receipts, 4);
  assert.equal(rerun.state.receipts_done, 4);
});
