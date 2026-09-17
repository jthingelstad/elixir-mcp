import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { projectClanSeries, projectPlayerProgress } from "../src/series.mjs";
import { projectPlayerSnapshot } from "../src/snapshots.mjs";
import { projectRiverRace, projectRiverRaceLog } from "../src/war.mjs";
import { processResult } from "../src/pipeline.mjs";
import { fixture, fixtureMeta, scratchDb } from "./helpers.mjs";

let ctx;
let meta;
let gatewayId;

before(async () => {
  ctx = await scratchDb("series");
  meta = await fixtureMeta();
  const {
    rows: [account],
  } = await ctx.db.query(
    `insert into account (email_hash, status, is_owner, role) values ('series-owner', 'approved', true, 'owner')
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'series-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  gatewayId = gw.gateway_id;
});
after(async () => ctx.drop());

const CLAN = "#2PP0V9YY";
function roster({ at, members }) {
  return {
    tag: CLAN,
    name: "Series Clan",
    type: "inviteOnly",
    description: "d",
    badgeId: 16000001,
    clanScore: 50000,
    clanWarTrophies: 900,
    location: { id: 57000006, name: "International", isCountry: false },
    requiredTrophies: 5000,
    donationsPerWeek: 1200,
    members: members.length,
    memberList: members.map((m, i) => ({
      tag: m.tag,
      name: m.name ?? `M${i}`,
      role: "member",
      lastSeen: m.lastSeen ?? at.replace(/[-:]/g, "").replace("Z", ".000Z"),
      expLevel: 0,
      trophies: m.trophies ?? 6000,
      arena: { id: 54000050, name: "Legendary Arena", rawName: "Arena_L" },
      clanRank: i + 1,
      previousClanRank: i + 1,
      donations: m.donations ?? 10,
      donationsReceived: m.received ?? 5,
      clanChestPoints: 0,
    })),
  };
}
const A = "#2PP0V9QP";
const B = "#2PP0V9UP";
const seen = (at) => at.replace(/[-:]/g, "").replace("Z", ".000Z");
const iso = (at) => new Date(at).toISOString();

async function memberRow(tag, day, kind = "daily") {
  const { rows } = await ctx.db.query(
    `select trophies, donations, donations_received, arena_id, clan_tag, clan_rank,
            previous_clan_rank, game_last_seen_at, observed_at, profile_observed_at,
            wins, king_tower_level, source
     from player_snapshot_daily
     where player_tag = $1 and snapshot_date = $2 and snapshot_kind = $3`,
    [tag, day, kind],
  );
  return rows[0] ?? null;
}
async function clanRow(day, kind = "daily") {
  const { rows } = await ctx.db.query(
    `select clan_score, members, donations_per_week, observed_at, type, location_id, receipt_id
     from clan_snapshot_daily where clan_tag = $1 and day = $2 and snapshot_kind = $3`,
    [CLAN, day, kind],
  );
  return rows[0] ?? null;
}

test("projectClanSeries: the four-poll guard on the clan row and the members' rows; the hour rule for lastSeen", async () => {
  const at1 = "2026-09-16T12:00:00Z"; // game day 2026-09-16
  const first = await projectClanSeries(ctx.db, {
    payload: roster({ at: at1, members: [{ tag: A }, { tag: B }] }),
    observedAt: at1,
    receiptId: null,
  });
  assert.equal(first.day, "2026-09-16");
  assert.equal(first.clanRow, 1);
  assert.equal(first.membersMoved, 2);
  assert.equal(first.facts, 1 + 1 + 2, "clan state + clan row + two members");
  assert.deepEqual(await clanRow("2026-09-16"), {
    clan_score: 50000,
    members: 2,
    donations_per_week: 1200,
    observed_at: new Date(at1),
    type: "inviteOnly",
    location_id: 57000006,
    receipt_id: null,
  });
  const a1 = await memberRow(A, "2026-09-16");
  assert.equal(a1.trophies, 6000);
  assert.equal(a1.clan_tag, CLAN);
  assert.equal(a1.clan_rank, 1);
  assert.equal(a1.profile_observed_at, null, "no profile has written this row");
  assert.equal(a1.wins, null);
  assert.equal(a1.source, "api");
  const {
    rows: [{ t }],
  } = await ctx.db.query(`select type as t from clan where clan_tag = $1`, [
    CLAN,
  ]);
  assert.equal(t, "inviteOnly", "the clan's state landed on the clan row");

  // Identical repeat fifteen minutes later: nothing (the members'
  // lastSeen moved fifteen minutes, under the hour rule).
  const at2 = "2026-09-16T12:15:00Z";
  const repeat = await projectClanSeries(ctx.db, {
    payload: roster({
      at: at2,
      members: [
        { tag: A, lastSeen: seen("2026-09-16T12:10:00Z") },
        { tag: B, lastSeen: seen("2026-09-16T12:10:00Z") },
      ],
    }),
    observedAt: at2,
  });
  assert.equal(repeat.facts, 0);
  assert.equal(
    (await memberRow(A, "2026-09-16")).observed_at.toISOString(),
    iso(at1),
  );

  // A moved value writes: A's trophies; B's lastSeen an hour past.
  const at3 = "2026-09-16T13:05:00Z";
  const moved = await projectClanSeries(ctx.db, {
    payload: roster({
      at: at3,
      members: [
        { tag: A, trophies: 6030, lastSeen: seen("2026-09-16T12:10:00Z") },
        { tag: B, lastSeen: seen("2026-09-16T13:04:00Z") },
      ],
    }),
    observedAt: at3,
  });
  assert.equal(moved.clanRow, 0, "the clan's numbers did not move");
  assert.equal(moved.membersMoved, 2);
  assert.equal((await memberRow(A, "2026-09-16")).trophies, 6030);
  assert.equal(
    (await memberRow(B, "2026-09-16")).game_last_seen_at.toISOString(),
    "2026-09-16T13:04:00.000Z",
  );

  // An older observation replayed writes nothing.
  const late = await projectClanSeries(ctx.db, {
    payload: roster({
      at: at2,
      members: [
        { tag: A, trophies: 5900 },
        { tag: B, trophies: 5900 },
      ],
    }),
    observedAt: at2,
  });
  assert.equal(late.facts, 0);
  assert.equal((await memberRow(A, "2026-09-16")).trophies, 6030);

  // The next game day is a new row even when nothing moved.
  const at4 = "2026-09-17T10:00:00Z";
  const nextDay = await projectClanSeries(ctx.db, {
    payload: roster({
      at: at4,
      members: [
        { tag: A, trophies: 6030, lastSeen: seen("2026-09-16T12:10:00Z") },
        { tag: B, lastSeen: seen("2026-09-16T13:04:00Z") },
      ],
    }),
    observedAt: at4,
  });
  assert.equal(nextDay.day, "2026-09-17");
  assert.equal(nextDay.clanRow, 1);
  assert.equal(nextDay.membersMoved, 2);
});

test("two writers on one row: a roster write after a profile write moves trophies and leaves wins and profile_observed_at alone; a stale profile poll cannot regress the roster's numbers", async () => {
  const P = "#2PP0V9CP";
  await ctx.db.query(`insert into player (player_tag) values ($1)`, [P]);
  const profile = (over) => ({
    tag: P,
    name: "Two Writers",
    trophies: 7000,
    bestTrophies: 7100,
    battleCount: 1000,
    wins: 12345,
    losses: 500,
    donations: 40,
    donationsReceived: 20,
    arena: { id: 54000050, name: "Legendary Arena" },
    kingTowerLevel: 15,
    totalDonations: 9000,
    challengeCardsWon: 10,
    challengeMaxWins: 2,
    tournamentCardsWon: 0,
    tournamentBattleCount: 3,
    warDayWins: 0,
    clanCardsCollected: 0,
    legacyTrophyRoadHighScore: 6500,
    ...over,
  });
  const t1 = "2026-09-16T19:00:00Z";
  const s1 = await projectPlayerSnapshot(ctx.db, {
    playerTag: P,
    payload: profile(),
    fetchedAt: t1,
  });
  assert.equal(s1.written, 1);
  assert.equal(s1.frozen, 1, "the frozen counters written once");
  let row = await memberRow(P, "2026-09-16");
  assert.equal(row.wins, 12345);
  assert.equal(row.king_tower_level, 15);
  assert.equal(row.profile_observed_at.toISOString(), iso(t1));
  assert.equal(row.observed_at.toISOString(), iso(t1));

  // The identical profile again: nothing, frozen counters included.
  const s2 = await projectPlayerSnapshot(ctx.db, {
    playerTag: P,
    payload: profile(),
    fetchedAt: "2026-09-16T19:10:00Z",
  });
  assert.equal(s2.written, 0);
  assert.equal(s2.frozen, 0);

  // A roster poll half an hour later: trophies move, wins do not, the
  // profile stamp stays.
  const t2 = "2026-09-16T19:30:00Z";
  await projectClanSeries(ctx.db, {
    payload: roster({ at: t2, members: [{ tag: P, trophies: 7060 }] }),
    observedAt: t2,
  });
  row = await memberRow(P, "2026-09-16");
  assert.equal(row.trophies, 7060);
  assert.equal(row.wins, 12345);
  assert.equal(row.observed_at.toISOString(), iso(t2));
  assert.equal(row.profile_observed_at.toISOString(), iso(t1));
  assert.equal(row.clan_tag, CLAN);

  // A profile poll observed BETWEEN the two (delayed): its lifetime
  // block is newer than the last profile write and lands; the shared
  // columns are older than the roster's and stay the roster's.
  const t15 = "2026-09-16T19:20:00Z";
  const s3 = await projectPlayerSnapshot(ctx.db, {
    playerTag: P,
    payload: profile({ wins: 12346, trophies: 7030 }),
    fetchedAt: t15,
  });
  assert.equal(s3.written, 1);
  row = await memberRow(P, "2026-09-16");
  assert.equal(row.wins, 12346);
  assert.equal(row.trophies, 7060, "the roster's fresher trophies stand");
  assert.equal(row.profile_observed_at.toISOString(), iso(t15));
  assert.equal(row.observed_at.toISOString(), iso(t2), "never regresses");

  // A profile poll older than the last profile write: nothing at all.
  const s4 = await projectPlayerSnapshot(ctx.db, {
    playerTag: P,
    payload: profile({ wins: 12000, trophies: 1 }),
    fetchedAt: "2026-09-16T18:00:00Z",
  });
  assert.equal(s4.written, 0);
  row = await memberRow(P, "2026-09-16");
  assert.equal(row.wins, 12346);
  assert.equal(row.trophies, 7060);
  const {
    rows: [frozen],
  } = await ctx.db.query(
    `select war_day_wins, clan_cards_collected, legacy_trophy_road_high_score from player where player_tag = $1`,
    [P],
  );
  assert.deepEqual(frozen, {
    war_day_wins: 0,
    clan_cards_collected: 0,
    legacy_trophy_road_high_score: 6500,
  });
});

test("the kinds: pre_reset and season_roll rows from the roster inside their windows, season_roll only for progress", async () => {
  // Sunday 2026-09-06 23:30Z: the hour before the Monday 00:10Z reset.
  const at = "2026-09-06T23:30:00Z";
  const r = await projectClanSeries(ctx.db, {
    payload: roster({ at, members: [{ tag: A, donations: 400 }] }),
    observedAt: at,
  });
  assert.deepEqual(Object.keys(r.extras), ["pre_reset"]);
  assert.equal(
    (await clanRow("2026-09-06", "pre_reset")).donations_per_week,
    1200,
  );
  assert.equal((await memberRow(A, "2026-09-06", "pre_reset")).donations, 400);
  // Monday 09:30Z: the hour before S135 rolls at 10:00Z, game day 09-06.
  const roll = "2026-09-07T09:30:00Z";
  const r2 = await projectClanSeries(ctx.db, {
    payload: roster({ at: roll, members: [{ tag: A, donations: 3 }] }),
    observedAt: roll,
  });
  assert.deepEqual(Object.keys(r2.extras), ["season_roll"]);
  assert.equal((await memberRow(A, "2026-09-06", "season_roll")).donations, 3);
  assert.equal((await memberRow(A, "2026-09-06", "daily")).donations, 3);
  assert.equal((await memberRow(A, "2026-09-06", "pre_reset")).donations, 400);

  const P = "#2PP0V9JP";
  await ctx.db.query(`insert into player (player_tag) values ($1)`, [P]);
  const payload = {
    progress: {
      "seasonal-trophy-road-202608": {
        arena: { id: 168000178 },
        trophies: 14000,
        bestTrophies: 0,
      },
    },
  };
  const p1 = await projectPlayerProgress(ctx.db, {
    playerTag: P,
    payload,
    observedAt: at,
  });
  assert.equal(p1.facts, 1, "no pre_reset kind on the progress series");
  const p2 = await projectPlayerProgress(ctx.db, {
    playerTag: P,
    payload,
    observedAt: roll,
  });
  assert.equal(p2.facts, 1, "the season_roll row; the daily row did not move");
  const { rows } = await ctx.db.query(
    `select snapshot_kind, day::text as day from player_progress_daily where player_tag = $1 order by 1`,
    [P],
  );
  assert.deepEqual(rows, [
    { snapshot_kind: "daily", day: "2026-09-06" },
    { snapshot_kind: "season_roll", day: "2026-09-06" },
  ]);
});

test("projectPlayerProgress: the zero-bucket rule, the empty key, the four-poll guard", async () => {
  const P = "#2PP0V9GP";
  await ctx.db.query(`insert into player (player_tag) values ($1)`, [P]);
  const payload = (over = {}) => ({
    progress: {
      "": { arena: { id: 168000050 }, trophies: 0, bestTrophies: 0 },
      "2v2League_202609": {
        arena: { id: 168000193 },
        trophies: 0,
        bestTrophies: 0,
      },
      AutoChess_2026_Season_11: {
        arena: { id: 168000180 },
        trophies: 120,
        bestTrophies: 140,
      },
      "seasonal-trophy-road-202609": {
        arena: { id: 168000195 },
        trophies: 14000,
        bestTrophies: 0,
      },
      ...over,
    },
  });
  const t1 = "2026-09-16T12:00:00Z";
  const first = await projectPlayerProgress(ctx.db, {
    playerTag: P,
    payload: payload(),
    observedAt: t1,
  });
  assert.equal(
    first.keys,
    2,
    "two buckets carry a value; two zero buckets write no row",
  );
  assert.equal(first.rows, 2);
  const keys = async () =>
    (
      await ctx.db.query(
        `select progress_key, trophies, best_trophies, observed_at from player_progress_daily
         where player_tag = $1 and day = '2026-09-16' order by progress_key`,
        [P],
      )
    ).rows;
  assert.deepEqual(
    (await keys()).map((r) => [r.progress_key, r.trophies, r.best_trophies]),
    [
      ["AutoChess_2026_Season_11", 120, 140],
      ["seasonal-trophy-road-202609", 14000, 0],
    ],
  );
  const repeat = await projectPlayerProgress(ctx.db, {
    playerTag: P,
    payload: payload(),
    observedAt: "2026-09-16T20:00:00Z",
  });
  assert.equal(repeat.rows, 0);
  // The empty key now carries a value: it is a row, under its own key.
  const moved = await projectPlayerProgress(ctx.db, {
    playerTag: P,
    payload: payload({
      "": { arena: { id: 168000050 }, trophies: 30, bestTrophies: 30 },
      AutoChess_2026_Season_11: {
        arena: { id: 168000180 },
        trophies: 150,
        bestTrophies: 150,
      },
    }),
    observedAt: "2026-09-16T21:00:00Z",
  });
  assert.equal(moved.rows, 2);
  assert.deepEqual(
    (await keys()).map((r) => [r.progress_key, r.trophies]),
    [
      ["", 30],
      ["AutoChess_2026_Season_11", 150],
      ["seasonal-trophy-road-202609", 14000],
    ],
  );
  const {
    rows: [empty],
  } = await ctx.db.query(
    `select mode, season_month from mode_season where progress_key = ''`,
  );
  assert.deepEqual(empty, { mode: "AutoChess", season_month: null });
  const stale = await projectPlayerProgress(ctx.db, {
    playerTag: P,
    payload: payload({
      AutoChess_2026_Season_11: {
        arena: { id: 168000180 },
        trophies: 1,
        bestTrophies: 1,
      },
    }),
    observedAt: "2026-09-16T15:00:00Z",
  });
  assert.equal(stale.rows, 0);
  assert.equal(
    (await keys()).find((r) => r.progress_key === "AutoChess_2026_Season_11")
      .trophies,
    150,
  );
});

test("through processResult: a roster fixture writes the clan row and every member's row; a profile fixture writes progress, the lifetime columns and the previous season's final", async () => {
  const message = ({ endpoint, entityKey, payload, fetchedAt }) => ({
    v: 1,
    job: { endpoint, entity_key: entityKey, lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: fetchedAt,
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  });
  const clan = await fixture("clan/roster.json");
  const clanTag = meta["clan/roster.json"].entity_key;
  const r = await processResult(
    ctx.db,
    message({
      endpoint: "clan",
      entityKey: clanTag,
      payload: clan,
      fetchedAt: "2026-09-03T14:40:34Z",
    }),
  );
  assert.equal(r.outcome, "admitted");
  assert.equal(r.projection.series.membersMoved, clan.memberList.length);
  assert.ok(
    r.projection.facts >= clan.memberList.length + 1,
    "a first roster is worth every member and the clan row",
  );
  const {
    rows: [c],
  } = await ctx.db.query(
    `select clan_score, members, receipt_id from clan_snapshot_daily where clan_tag = $1 and day = '2026-09-03'`,
    [clanTag],
  );
  assert.equal(c.clan_score, clan.clanScore);
  assert.equal(c.members, clan.members);
  assert.equal(c.receipt_id, r.receiptId, "the clan row carries its receipt");
  const {
    rows: [{ n, with_arena }],
  } = await ctx.db.query(
    `select count(*)::int as n, count(arena_id)::int as with_arena from player_snapshot_daily
     where clan_tag = $1 and snapshot_date = '2026-09-03'`,
    [clanTag],
  );
  assert.equal(n, clan.memberList.length);
  assert.equal(with_arena, clan.memberList.length);
  const {
    rows: [{ facts }],
  } = await ctx.db.query(
    `select new_facts as facts from api_receipt where receipt_id = $1`,
    [r.receiptId],
  );
  assert.equal(facts, r.projection.facts);

  const profile = await fixture("player/profile.json");
  const tag = meta["player/profile.json"].entity_key;
  const p = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: profile,
      fetchedAt: "2026-09-03T14:40:34Z",
    }),
  );
  assert.equal(p.outcome, "admitted");
  assert.equal(
    p.projection.progress.rows,
    2,
    "the two seasonal-road buckets at 14,000; three zero buckets write nothing",
  );
  const row = await memberRow(tag, "2026-09-03");
  assert.equal(row.king_tower_level, profile.kingTowerLevel);
  assert.equal(row.trophies, profile.trophies);
  assert.equal(
    row.clan_tag,
    clanTag,
    "the roster wrote this member's row first",
  );
  assert.equal(
    row.profile_observed_at.toISOString(),
    "2026-09-03T14:40:34.000Z",
  );
  const {
    rows: [pol],
  } = await ctx.db.query(
    `select season_month, league, trophies, rank from player_pol_season where player_tag = $1`,
    [tag],
  );
  // Read on 2026-09-03, inside the 2026-08 season: the last one to have
  // rolled is 2026-07 (ended 2026-08-03T10:00Z).
  assert.deepEqual(pol, {
    season_month: "2026-07",
    league: profile.lastPathOfLegendSeasonResult.leagueNumber,
    trophies: profile.lastPathOfLegendSeasonResult.trophies,
    rank: null,
  });
  const {
    rows: [frozen],
  } = await ctx.db.query(
    `select legacy_trophy_road_high_score from player where player_tag = $1`,
    [tag],
  );
  assert.equal(
    frozen.legacy_trophy_road_high_score,
    profile.legacyTrophyRoadHighScore,
  );
});

test("the race poll keeps the rivals' clanScore, repairPoints and badge, and the section's period logs once; the log fills war day 4 attendance", async () => {
  const race = structuredClone(await fixture("currentriverrace/war_day.json"));
  const clanTag = meta["currentriverrace/war_day.json"].entity_key;
  // The log first, so the live race has a season to infer from.
  const log = await fixture("riverracelog/log.json");
  await projectRiverRaceLog(ctx.db, { clanTag, payload: log });
  const nowMs = Date.parse("2026-08-31T08:00:00Z");
  const first = await projectRiverRace(ctx.db, {
    payload: race,
    fetchedAt: "2026-08-31T07:37:36Z",
    nowMs,
  });
  assert.equal(first.projected, "war");
  const rival = race.clans.find((c) => c.tag !== clanTag);
  const {
    rows: [wc],
  } = await ctx.db.query(
    `select clan_score, repair_points from war_week_clan
     where clan_tag = $1 and season_id = $2 and section_index = $3 and participant_clan_tag = $4`,
    [clanTag, first.seasonId, first.sectionIndex, rival.tag],
  );
  assert.equal(wc.clan_score, rival.clanScore);
  assert.equal(wc.repair_points, rival.repairPoints);
  const {
    rows: [badge],
  } = await ctx.db.query(`select badge_id from clan where clan_tag = $1`, [
    rival.tag,
  ]);
  assert.equal(badge.badge_id, rival.badgeId);
  const logsInSection = race.periodLogs.filter(
    (l) => Math.floor(l.periodIndex / 7) === race.sectionIndex,
  );
  const { rows: pl } = await ctx.db.query(
    `select period_index, count(*)::int as clans from war_period_log
     where clan_tag = $1 and season_id = $2 and section_index = $3
     group by 1 order by 1`,
    [clanTag, first.seasonId, first.sectionIndex],
  );
  assert.deepEqual(
    pl,
    logsInSection.map((l) => ({
      period_index: l.periodIndex,
      clans: l.items.length,
    })),
    "only this section's closed days; earlier sections name this bracket's clans and are not this bracket's days",
  );
  // The same poll again: fill-once, nothing written; a doctored later
  // poll cannot rewrite a closed day.
  const again = await projectRiverRace(ctx.db, {
    payload: race,
    fetchedAt: "2026-08-31T08:07:36Z",
    nowMs,
  });
  assert.equal(again.facts, 0);
  race.periodLogs[race.periodLogs.length - 1].items[0].pointsEarned = 1;
  await projectRiverRace(ctx.db, {
    payload: race,
    fetchedAt: "2026-08-31T08:37:36Z",
    nowMs,
  });
  const {
    rows: [kept],
  } = await ctx.db.query(
    `select points_earned from war_period_log
     where clan_tag = $1 and season_id = $2 and section_index = $3 and period_index = $4 and participant_clan_tag = $5`,
    [
      clanTag,
      first.seasonId,
      first.sectionIndex,
      race.periodLogs[race.periodLogs.length - 1].periodIndex,
      race.periodLogs[race.periodLogs.length - 1].items[0].clan.tag,
    ],
  );
  assert.notEqual(kept.points_earned, 1);

  // The closed log's decksUsedToday is war day 4's count.
  const doctored = structuredClone(log);
  const item = doctored.items[0];
  const ours = item.standings.find((s) => s.clan.tag === clanTag);
  ours.clan.participants[0].decksUsedToday = 3;
  const before = await projectRiverRaceLog(ctx.db, {
    clanTag,
    payload: doctored,
  });
  const {
    rows: [day4],
  } = await ctx.db.query(
    `select decks_used_today from war_attendance_day
     where clan_tag = $1 and season_id = $2 and section_index = $3 and war_day = 4 and player_tag = $4`,
    [clanTag, item.seasonId, item.sectionIndex, ours.clan.participants[0].tag],
  );
  assert.equal(day4.decks_used_today, 3);
  assert.ok(before.facts >= 1);
  const {
    rows: [std],
  } = await ctx.db.query(
    `select clan_score from war_week_clan
     where clan_tag = $1 and season_id = $2 and section_index = $3 and participant_clan_tag = $1`,
    [clanTag, item.seasonId, item.sectionIndex],
  );
  assert.equal(
    std.clan_score,
    ours.clan.clanScore,
    "the log's closing clanScore fills a null",
  );
});

test("a battle log writes the battle's own facts (0131) for new battles", async () => {
  const message = ({ endpoint, entityKey, payload, fetchedAt }) => ({
    v: 1,
    job: { endpoint, entity_key: entityKey, lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: fetchedAt,
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  });
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const tag = meta["player_battlelog/with_boat_and_duel.json"].entity_key;
  const r = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: tag,
      payload: log,
      fetchedAt: "2026-09-02T08:00:49Z",
    }),
  );
  assert.equal(r.outcome, "admitted");
  const {
    rows: [c],
  } = await ctx.db.query(
    `select count(*)::int as n, count(arena_id)::int as with_arena,
            count(deck_selection)::int as with_selection,
            count(is_ladder_tournament)::int as with_ladder_flag,
            count(boat_battle_side)::int as boat_sides,
            count(remaining_towers)::int as with_towers
     from battle`,
  );
  assert.ok(c.n > 0);
  const boats = log.filter((b) => typeof b.boatBattleSide === "string").length;
  assert.ok(c.with_arena > 0, "arena.id lands");
  assert.equal(c.with_selection, c.n, "every battle names its deck selection");
  assert.equal(c.with_ladder_flag, c.n);
  assert.ok(boats === 0 || c.boat_sides > 0, "boat battles keep their side");
  assert.ok(c.with_towers >= 0);
});

test("verification item 1: a roster older than the day's last profile poll still lands the clan and rank, never the trophies", async () => {
  const P = "#2PP0V9LP";
  await ctx.db.query(`insert into player (player_tag) values ($1)`, [P]);
  // The backfill's shape: the profile row exists from 14:00Z; the
  // roster observation being replayed is from earlier the same game
  // day (10:21Z; a 02:21Z roster is the day before on the 10:00Z grid).
  const profileAt = "2026-09-16T14:00:00Z";
  await projectPlayerSnapshot(ctx.db, {
    playerTag: P,
    payload: {
      tag: P,
      name: "Late Roster",
      trophies: 7100,
      wins: 10,
      battleCount: 20,
    },
    fetchedAt: profileAt,
  });
  const rosterAt = "2026-09-16T10:21:00Z";
  const r = await projectClanSeries(ctx.db, {
    payload: roster({ at: rosterAt, members: [{ tag: P, trophies: 7000 }] }),
    observedAt: rosterAt,
  });
  assert.equal(
    r.membersMoved,
    1,
    "the roster's own columns are new to the row",
  );
  let row = await ctx.db.query(
    `select trophies, clan_tag, clan_rank, observed_at, roster_observed_at, profile_observed_at, game_last_seen_at
     from player_snapshot_daily where player_tag = $1 and snapshot_date = '2026-09-16' and snapshot_kind = 'daily'`,
    [P],
  );
  row = row.rows[0];
  assert.equal(row.trophies, 7100, "the profile's fresher trophies stand");
  assert.equal(row.clan_tag, CLAN);
  assert.equal(row.clan_rank, 1);
  assert.equal(
    row.observed_at.toISOString(),
    iso(profileAt),
    "never regresses",
  );
  assert.equal(row.roster_observed_at.toISOString(), iso(rosterAt));
  assert.equal(row.profile_observed_at.toISOString(), iso(profileAt));
  // The same old roster again: nothing.
  const again = await projectClanSeries(ctx.db, {
    payload: roster({ at: rosterAt, members: [{ tag: P, trophies: 7000 }] }),
    observedAt: rosterAt,
  });
  assert.equal(again.membersMoved, 0);
  // An even older roster with a different rank: nothing (its stamp is
  // older than the roster's own).
  const older = await projectClanSeries(ctx.db, {
    payload: roster({
      at: "2026-09-16T10:05:00Z",
      members: [{ tag: B }, { tag: P }],
    }),
    observedAt: "2026-09-16T10:05:00Z",
  });
  const {
    rows: [kept],
  } = await ctx.db.query(
    `select clan_rank from player_snapshot_daily where player_tag = $1 and snapshot_date = '2026-09-16' and snapshot_kind = 'daily'`,
    [P],
  );
  assert.equal(kept.clan_rank, 1);
  assert.ok(older.membersMoved <= 1, "only B's new row");
});

test("verification item 4: the progress buckets name their side-mode arenas in the catalog", async () => {
  const P = "#2PP0V9RP";
  await ctx.db.query(`insert into player (player_tag) values ($1)`, [P]);
  await projectPlayerProgress(ctx.db, {
    playerTag: P,
    payload: {
      progress: {
        AutoChess_2026_Season_11: {
          arena: {
            id: 168000180,
            name: "Bronze I",
            rawName: "AutoChessArena1_2026_Season_11",
          },
          trophies: 5,
          bestTrophies: 5,
        },
        "2v2League_202609": {
          arena: { id: 168000193, name: "Casual" },
          trophies: 0,
          bestTrophies: 0,
        },
      },
    },
    observedAt: "2026-09-16T12:00:00Z",
  });
  const { rows } = await ctx.db.query(
    `select arena_id, name from arena where arena_id in (168000180, 168000193) order by 1`,
  );
  assert.deepEqual(rows, [
    { arena_id: 168000180, name: "Bronze I" },
    { arena_id: 168000193, name: "Casual" },
  ]);
});
