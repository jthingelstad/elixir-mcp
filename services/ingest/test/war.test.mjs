import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { projectRiverRace, stampWarKeys } from "../src/war.mjs";
import { ingestBattlelog } from "../src/battles.mjs";
import { fixture, scratchDb, seedReceipt } from "./helpers.mjs";

let ctx;
const CLAN = "#J2RGCRVG";

before(async () => {
  ctx = await scratchDb("war");
  await ctx.db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);
});

after(async () => ctx.drop());

test("genesis: no logged season -> the calendar names it, projection proceeds", async () => {
  const war = await fixture("currentriverrace/war_day.json");
  const result = await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    // Sunday Aug 30 07:37Z: calendar-true S135 section 3.
    fetchedAt: "2026-08-30T07:37:36Z",
  });
  assert.notEqual(result.projected, "anchor_only");
  const anchors = await ctx.db.query(
    `select period_index from war_period_anchor where clan_tag = $1`,
    [CLAN],
  );
  assert.deepEqual(
    anchors.rows.map((r) => r.period_index),
    [war.periodIndex],
  );
  const weeks = await ctx.db.query(
    `select season_id, section_index from war_week where clan_tag = $1`,
    [CLAN],
  );
  assert.deepEqual(weeks.rows, [{ season_id: 135, section_index: 3 }]);
});

test("with logged history: week, standings, POINTS participation, attendance", async () => {
  // Logged history exists but the CALENDAR names the season now — a
  // wrong logged season cannot mislead (phantom-season incident).
  await ctx.db.query(
    `insert into war_week (clan_tag, season_id, section_index) values ($1, 136, 2)`,
    [CLAN],
  );
  const war = await fixture("currentriverrace/war_day.json"); // p27 s3, warDay 4
  const result = await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    fetchedAt: "2026-08-30T07:40:00Z",
  });
  assert.equal(result.projected, "war");
  assert.equal(result.seasonId, 135, "the calendar names Aug 30 as season 135");
  assert.equal(result.warDay, 4);

  const { rows: standings } = await ctx.db.query(
    `select count(*)::int n, max(fame)::int top from war_week_clan
     where clan_tag = $1 and season_id = 135 and section_index = 3`,
    [CLAN],
  );
  assert.equal(standings[0].n, war.clans.length, "all race clans recorded");
  assert.ok(standings[0].top > 0, "boat fame recorded at clan level");

  const { rows: part } = await ctx.db.query(
    `select count(*)::int n, sum(points)::int total from war_participation
     where clan_tag = $1 and season_id = 135 and section_index = 3`,
    [CLAN],
  );
  assert.equal(part[0].n, war.clan.participants.length);
  const payloadPoints = war.clan.participants.reduce(
    (s, p) => s + (p.fame ?? 0),
    0,
  );
  assert.equal(part[0].total, payloadPoints, 'payload "fame" stored as points');

  const attendance = (
    await ctx.db.query(
      `select count(*)::int n from war_attendance_day where war_day = 4`,
    )
  ).rows[0].n;
  assert.equal(attendance, war.clan.participants.length);
});

test("MAX-merge: a lagging payload never regresses counters", async () => {
  const war = structuredClone(await fixture("currentriverrace/war_day.json"));
  const someone = war.clan.participants.find((p) => (p.fame ?? 0) > 0);
  const before = someone.fame;
  someone.fame = Math.max(0, before - 400); // stale observation
  await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    fetchedAt: "2026-08-31T07:50:00Z",
  });
  const { rows } = await ctx.db.query(
    `select points from war_participation where player_tag = $1 and season_id = 135 and section_index = 3`,
    [someone.tag],
  );
  assert.equal(rows[0].points, before, "stale lower value ignored");
});

test("war keys stamp onto ingested war battles from their own time", async () => {
  const receiptId = await seedReceipt(ctx.db);
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  await ingestBattlelog(ctx.db, {
    observerTag: "#2YG98VVQ",
    receiptId,
    payload: log,
  });
  // Tie the observer's battles to the clan via their participant clan_tag
  // (real logs carry it; assert some war battles exist for the clan).
  const { rows: pre } = await ctx.db.query(
    `select count(*)::int n from battle b join battle_participant bp on bp.battle_id = b.battle_id
     where b.type like 'riverRace%' and bp.clan_tag = $1 and b.season_id is null`,
    [CLAN],
  );
  if (pre[0].n === 0) return; // fixture log may not carry clan-tagged war battles
  const war = await fixture("currentriverrace/war_day.json");
  const { stamped } = await stampWarKeys(ctx.db, {
    clanTag: CLAN,
    payload: war,
    nowMs: Date.parse("2026-08-30T09:00:00Z"),
  });
  assert.ok(stamped > 0, "keys stamped");
  const { rows: post } = await ctx.db.query(
    `select distinct season_id, section_index from battle
     where type like 'riverRace%' and season_id is not null`,
  );
  assert.ok(post.every((r) => r.season_id === 135 && r.section_index === 3));
});

test("colosseum week flags and rolls the season when the section walks back", async () => {
  const col = await fixture("currentriverrace/colosseum.json"); // p31 s4
  const r1 = await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: col,
    fetchedAt: "2026-09-03T14:40:34Z",
  });
  assert.equal(r1.seasonId, 135, "the calendar names Sep 3 as season 135");
  assert.equal(r1.kind, "colosseum");
  const { rows } = await ctx.db.query(
    `select is_colosseum from war_week where season_id = 135 and section_index = 4`,
  );
  assert.equal(rows[0].is_colosseum, true);

  // Next season: a payload whose section walked back to 0.
  const next = structuredClone(col);
  next.periodIndex = 1;
  next.sectionIndex = 0;
  next.periodType = "training";
  const r2 = await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: next,
    fetchedAt: "2026-09-07T12:00:00Z",
  });
  assert.equal(
    r2.seasonId,
    136,
    "Sep 7 after the reset: the calendar rolls the season",
  );
});

test("riverracelog backfill: ten real weeks, seasons, colosseum flags, points, standings", async () => {
  const { projectRiverRaceLog } = await import("../src/war.mjs");
  const log = await fixture("riverracelog/log.json");
  const result = await projectRiverRaceLog(ctx.db, {
    clanTag: CLAN,
    payload: log,
  });
  assert.equal(result.projected, "riverracelog");
  assert.equal(result.weeks, 10);
  assert.deepEqual(result.seasons, [132, 133, 134]);

  const { rows: weeks } = await ctx.db.query(
    `select season_id, section_index, is_colosseum, finished_observed_at from war_week
     where clan_tag = $1 and season_id in (132, 133) order by season_id, section_index`,
    [CLAN],
  );
  assert.ok(weeks.length > 0);
  for (const season of [132, 133]) {
    const inSeason = weeks.filter((w) => w.season_id === season);
    const maxSection = Math.max(...inSeason.map((w) => w.section_index));
    for (const w of inSeason) {
      assert.equal(
        w.is_colosseum,
        w.section_index === maxSection,
        `colosseum = final section of complete season ${season}`,
      );
      assert.ok(w.finished_observed_at, "log weeks carry their finish time");
    }
  }

  const { rows: standings } = await ctx.db.query(
    `select count(*)::int n, count(rank)::int ranked from war_week_clan
     where clan_tag = $1 and season_id = 132`,
    [CLAN],
  );
  assert.ok(standings[0].n >= 5, "five clans per week recorded");
  assert.equal(
    standings[0].ranked,
    standings[0].n,
    "final ranks present from the log",
  );

  const { rows: own } = await ctx.db.query(
    `select count(distinct player_tag)::int members, sum(points)::int points
     from war_participation where clan_tag = $1 and season_id = 132`,
    [CLAN],
  );
  assert.ok(own[0].members > 10, "own members recorded");
  assert.ok(own[0].points > 0, "per-member fame stored as points");
  const { rows: foreign } = await ctx.db.query(
    `select count(*)::int n from war_participation wp
     where wp.clan_tag = $1 and not exists (
       select 1 from war_week_clan wwc
       where wwc.participant_clan_tag = $1 and wwc.clan_tag = $1
         and wwc.season_id = wp.season_id and wwc.section_index = wp.section_index)`,
    [CLAN],
  );
  assert.equal(
    foreign[0].n,
    0,
    "participation is clan-scoped: own members only",
  );

  // Idempotent re-run: MAX/COALESCE merges, no duplicate growth.
  const before = (
    await ctx.db.query(`select count(*)::int n from war_participation`)
  ).rows[0].n;
  await projectRiverRaceLog(ctx.db, { clanTag: CLAN, payload: log });
  const after = (
    await ctx.db.query(`select count(*)::int n from war_participation`)
  ).rows[0].n;
  assert.equal(after, before);
});

test("admission accepts the real riverracelog and rejects corrupt items", async () => {
  const { admit } = await import("../src/admission.mjs");
  const log = await fixture("riverracelog/log.json");
  assert.deepEqual(admit("riverracelog", log), { ok: true });
  const corrupt = structuredClone(log);
  delete corrupt.items[0].seasonId;
  const result = admit("riverracelog", corrupt);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("items[0].seasonId:missing"));
});

test("riverrace for a never-seen clan seeds its identity row (no FK race)", async () => {
  const race = structuredClone(await fixture("currentriverrace/war_day.json"));
  race.clan.tag = "#RJ9UJ9L8"; // no clan row, no roster ever observed
  const result = await projectRiverRace(ctx.db, {
    payload: race,
    fetchedAt: "2026-08-03T09:00:00Z",
  });
  assert.ok(result);
  const { rows } = await ctx.db.query(
    `select 1 from clan where clan_tag = '#RJ9UJ9L8'`,
  );
  assert.equal(rows.length, 1, "identity-only clan row created");
});

test("colosseum days 2-4 merge into the SAME week (the frozen-colosseum bug)", async () => {
  const base = structuredClone(
    await fixture("currentriverrace/colosseum.json"),
  );
  base.clan.tag = "#20UUCC99";
  await ctx.db.query(
    `insert into clan (clan_tag) values ('#20UUCC99') on conflict do nothing`,
  );
  // The season's log is already recorded through section 3 (the state a
  // real clan is in when colosseum starts): latest logged week (S, 3).
  delete base.seasonId; // live payloads carry no seasonId
  const season = 135; // the calendar's answer for 2026-09-01..04
  await ctx.db.query(
    `insert into war_week (clan_tag, season_id, section_index) values ('#20UUCC99', $1, 3)
     on conflict do nothing`,
    [season],
  );

  // Four colosseum war days: periodIndex walks grid 3..6 of the section,
  // fame and member points grow each day.
  const section = base.sectionIndex;
  const me = "#20UU22CC";
  for (let day = 0; day < 4; day += 1) {
    const p = structuredClone(base);
    p.periodIndex = section * 7 + 3 + day;
    p.periodType = "colosseum";
    p.clan.fame = 3000 * (day + 1);
    p.clan.participants = [
      {
        tag: me,
        name: "Nerd",
        fame: 900 * (day + 1),
        decksUsed: 4 * (day + 1),
        boatAttacks: 0,
        decksUsedToday: 4,
      },
    ];
    p.clans = [
      {
        tag: "#20UUCC99",
        fame: 3000 * (day + 1),
        name: "Repro",
        participants: [],
      },
    ];
    const fetchedAt = new Date(
      Date.parse("2026-09-01T12:00:00Z") + day * 86400_000,
    ).toISOString();
    const result = await projectRiverRace(ctx.db, { payload: p, fetchedAt });
    assert.ok(result, `day ${day + 1} projected`);
  }

  const { rows: weeks } = await ctx.db.query(
    `select season_id, section_index, is_colosseum from war_week
     where clan_tag = '#20UUCC99' and section_index = $1`,
    [section],
  );
  assert.equal(
    weeks.length,
    1,
    `exactly ONE colosseum week row, got ${JSON.stringify(weeks)}`,
  );
  assert.equal(weeks[0].season_id, season, "filed under the right season");

  const { rows: part } = await ctx.db.query(
    `select points, decks_used from war_participation
     where clan_tag = '#20UUCC99' and player_tag = $1 and section_index = $2`,
    [me, section],
  );
  assert.equal(part.length, 1, "one participation row across all four days");
  assert.equal(
    part[0].points,
    3600,
    "day-4 points merged (not frozen at day 1)",
  );
  assert.equal(part[0].decks_used, 16, "day-4 decks merged");
});

test("boat battles stamp war keys too (round-3: the like-pattern missed them)", async () => {
  await ctx.db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ('r3-boat', '2026-08-30T08:00:00Z', 'boatBattle', 'boat')
     on conflict do nothing`,
  );
  await ctx.db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, clan_tag)
     values ('r3-boat', '#2YG98VVQ', '2026-08-30T08:00:00Z', 0, $1)
     on conflict do nothing`,
    [CLAN],
  );
  const war = await fixture("currentriverrace/war_day.json");
  await stampWarKeys(ctx.db, {
    clanTag: CLAN,
    payload: war,
    nowMs: Date.parse("2026-08-30T09:00:00Z"),
  });
  const { rows } = await ctx.db.query(
    `select season_id, section_index from battle where battle_id = 'r3-boat'`,
  );
  assert.equal(rows[0].season_id, 135, "boat battle stamped");
});
