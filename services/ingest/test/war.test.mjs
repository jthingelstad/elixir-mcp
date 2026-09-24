import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { clanEvents } from "./event-rows.mjs";
import { projectRiverRace, raceSeasonFor } from "../src/war.mjs";
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
  // A recent first sight of the week is the bracket being observed: one
  // ledger row naming the four rivals; not for a payload a day old.
  const bracket = await clanEvents(
    ctx.db,
    "clan_tag = $1 and event_type = 'bracket_observed'",
    [CLAN],
  );
  assert.equal(bracket.length, 0, "an old fetchedAt writes no bracket row");
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
    `select count(*)::int n, max(fame)::int top,
            max(period_points)::int as top_period_points
     from war_week_clan
     where clan_tag = $1 and season_id = 135 and section_index = 3`,
    [CLAN],
  );
  assert.equal(standings[0].n, war.clans.length, "all race clans recorded");
  assert.ok(standings[0].top > 0, "boat fame recorded at clan level");
  assert.equal(
    standings[0].top_period_points,
    Math.max(...war.clans.map((clan) => clan.periodPoints ?? 0)),
    "the current day's period points stay distinct from banked fame",
  );

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

test("re-ingest of the same race WRITES nothing: no tuple version moves", async () => {
  // xmin is the transaction that wrote the row version. A race is
  // observed dozens of times a day; before 2026-09-11 every unchanged
  // MAX-merge rewrote its row (war_participation 145k updates on 12.7k
  // inserts, war_attendance_day 80k on 2.7k).
  const war = await fixture("currentriverrace/war_day.json");
  const first = await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    fetchedAt: "2026-08-30T07:50:00Z",
  });
  assert.equal(first.projected, "war");
  const versions = async () =>
    (
      await ctx.db.query(
        `
        select 'wp' as t, player_tag as k, xmin::text as v from war_participation where clan_tag = $1
        union all
        select 'wa', war_day || '|' || player_tag, xmin::text from war_attendance_day where clan_tag = $1
        union all
        select 'wc', participant_clan_tag, xmin::text from war_week_clan where clan_tag = $1
        union all
        select 'ww', season_id || '|' || section_index, xmin::text from war_week where clan_tag = $1
        union all
        select 'pl', player_tag, xmin::text from player
        order by 1, 2`,
        [CLAN],
      )
    ).rows;
  const before = await versions();
  assert.ok(
    before.some((r) => r.t === "wp"),
    "participation rows exist",
  );
  const again = await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    fetchedAt: "2026-08-30T07:55:00Z",
  });
  assert.equal(again.members, first.members);
  assert.deepEqual(await versions(), before, "no row version moved");
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

test("period points follow the newest observation across a day reset", async () => {
  const newer = structuredClone(await fixture("currentriverrace/war_day.json"));
  newer.clans[0].periodPoints = 25;
  await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: newer,
    fetchedAt: "2026-08-31T08:00:00Z",
  });
  const stale = structuredClone(newer);
  stale.clans[0].periodPoints = 900;
  await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: stale,
    fetchedAt: "2026-08-31T07:59:00Z",
  });
  const { rows } = await ctx.db.query(
    `select period_points from war_week_clan
     where clan_tag = $1 and season_id = 135 and section_index = 3
       and participant_clan_tag = $2`,
    [CLAN, newer.clans[0].tag],
  );
  assert.equal(
    rows[0].period_points,
    25,
    "a newer reset can lower the day score; stale delivery cannot restore it",
  );
});

test("war battles resolve to their week and day by battle_time on the calendar (0105)", async () => {
  const receiptId = await seedReceipt(ctx.db);
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  await ingestBattlelog(ctx.db, {
    observerTag: "#2YG98VVQ",
    receiptId,
    payload: log,
  });
  // Nothing is stamped: every war battle in the log resolves by range,
  // war days to a war day and training-day battles to none.
  const { rows } = await ctx.db.query(
    `select b.type, p.war_season_id, p.section_index, p.war_day, p.kind,
            count(*)::int as battles
     from battle b
     left join war_period p on b.battle_time >= p.starts_at and b.battle_time < p.ends_at
     where b.type like 'riverRace%' or b.type = 'boatBattle'
     group by 1, 2, 3, 4, 5 order by 2, 3, 4, 1`,
  );
  assert.ok(rows.length > 0, "the fixture holds war battles");
  assert.ok(
    rows.every((r) => r.war_season_id !== null),
    "every war battle falls in a period",
  );
  assert.ok(
    rows.every(
      (r) => r.war_season_id === 135 && [2, 3, 4].includes(r.section_index),
    ),
    JSON.stringify(rows),
  );
  assert.ok(
    rows.every((r) => (r.war_day === null) === (r.kind === "training")),
  );
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

test("a boat battle resolves like any war battle: its day is its time", async () => {
  await ctx.db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ('r3-boat', '2026-08-30T08:00:00Z', 'boatBattle', 'boat')
     on conflict do nothing`,
  );
  await ctx.db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, clan_tag, type, type_class)
     values ('r3-boat', '#2YG98VVQ', '2026-08-30T08:00:00Z', 0, $1, 'boatBattle', 'boat')
     on conflict do nothing`,
    [CLAN],
  );
  // 08:00Z on Sunday Aug 30 is before the 10:00Z roll: war day 3 of
  // section 3, not day 4 (period 26, not 27).
  const { rows } = await ctx.db.query(
    `select p.war_season_id, p.section_index, p.war_day, p.period_index
     from battle_participant bp
     join war_period p on bp.battle_time >= p.starts_at and bp.battle_time < p.ends_at
     where bp.battle_id = 'r3-boat'`,
  );
  assert.deepEqual(rows, [
    { war_season_id: 135, section_index: 3, war_day: 3, period_index: 26 },
  ]);
});

test("riverrace deck deltas raise battlelog yield (raise-only, replay-guarded)", async () => {
  const war = structuredClone(await fixture("currentriverrace/war_day.json"));
  const member = war.clan.participants[0];
  const memberTag = member.tag.toUpperCase().replace("O", "0");
  await ctx.db.query(
    `insert into poll_state (subject_tag, endpoint, yield_bph)
     values ($1, 'player_battlelog', 0.01)
     on conflict (subject_tag, endpoint) do update set yield_bph = 0.01`,
    [memberTag],
  );
  await ctx.db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ($1, 'currentriverrace', now() - interval '30 minutes')
     on conflict (subject_tag, endpoint)
       do update set last_admitted_at = now() - interval '30 minutes'`,
    [CLAN],
  );

  // Baseline poll, then a poll showing 4 NEW war decks.
  member.decksUsed = 0;
  await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    fetchedAt: new Date(Date.now() - 60_000).toISOString(),
  });
  member.decksUsed = 4;
  const r = await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    fetchedAt: new Date().toISOString(),
  });
  assert.ok(r.battlers_signaled >= 1, "delta member signaled");
  const { rows } = await ctx.db.query(
    `select yield_bph::float as y from poll_state
     where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [memberTag],
  );
  assert.ok(rows[0].y > 1, `yield raised from 0.01, got ${rows[0].y}`);

  // Replayed history (old fetchedAt) must not touch the live signal.
  const before = rows[0].y;
  member.decksUsed = 8;
  await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: war,
    fetchedAt: "2026-07-05T12:00:00Z",
  });
  const { rows: after2 } = await ctx.db.query(
    `select yield_bph::float as y from poll_state
     where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [memberTag],
  );
  assert.equal(after2[0].y, before, "replay is history, not activity");
});

test("season rollover: a stale same-index anchor refreshes to the new observation", async () => {
  const clan = "#PYLQGR99";
  await ctx.db.query(`insert into clan (clan_tag) values ($1)`, [clan]);
  const war = await fixture("currentriverrace/war_day.json"); // periodIndex 27
  war.clan = { ...war.clan, tag: clan };

  // Last season observed this index five weeks ago (periodIndex resets
  // each season, so the key collides at rollover).
  const staleIso = new Date(Date.now() - 35 * 86400_000).toISOString();
  await ctx.db.query(
    `insert into war_period_anchor (clan_tag, period_index, first_observed_at)
     values ($1, $2, $3)`,
    [clan, war.periodIndex, staleIso],
  );

  const fresh = new Date(Date.now() - 3600_000).toISOString();
  const r = await projectRiverRace(ctx.db, {
    clanTag: clan,
    payload: war,
    fetchedAt: fresh,
  });
  assert.ok(r, "projected");
  const { rows } = await ctx.db.query(
    `select first_observed_at from war_period_anchor
     where clan_tag = $1 and period_index = $2`,
    [clan, war.periodIndex],
  );
  assert.equal(
    rows[0].first_observed_at.toISOString(),
    new Date(fresh).toISOString(),
    "anchor refreshed to the new season's observation",
  );

  // A same-season re-poll (minutes later) must NOT refresh or re-emit.
  const rePoll = await projectRiverRace(ctx.db, {
    clanTag: clan,
    payload: war,
    fetchedAt: new Date().toISOString(),
  });
  assert.ok(rePoll, "same-season anchor holds");

  // A replayed OLD payload can never walk the anchor backwards.
  const replayOld = await projectRiverRace(ctx.db, {
    clanTag: clan,
    payload: war,
    fetchedAt: staleIso,
  });
  assert.ok(replayOld);
  const { rows: after } = await ctx.db.query(
    `select first_observed_at from war_period_anchor
     where clan_tag = $1 and period_index = $2`,
    [clan, war.periodIndex],
  );
  assert.equal(
    after[0].first_observed_at.toISOString(),
    new Date(fresh).toISOString(),
    "replay is history, not a new period",
  );
});

test("bracket_observed: the first sight of a new week names its rivals, once", async () => {
  // Another clan meets the same week for the first time, with the
  // projector's clock set to the fixture's day so the sighting is news.
  const war = await fixture("currentriverrace/war_day.json");
  const OTHER = "#2PP0V8Y9";
  const swap = (c) => (c.tag === war.clan.tag ? { ...c, tag: OTHER } : c);
  const payload = {
    ...war,
    clan: { ...war.clan, tag: OTHER },
    clans: war.clans.map(swap),
  };
  const fetchedAt = "2026-08-30T07:41:00Z";
  const nowMs = Date.parse("2026-08-30T08:00:00Z");
  await projectRiverRace(ctx.db, { payload, fetchedAt, nowMs });
  await projectRiverRace(ctx.db, { payload, fetchedAt, nowMs });
  const rows = await clanEvents(
    ctx.db,
    "clan_tag = $1 and event_type = 'bracket_observed'",
    [OTHER],
  );
  assert.equal(rows.length, 1, "one row for the week, not one per poll");
  const p = rows[0].payload;
  assert.equal(p.rivals.length, 4);
  assert.ok(
    p.rivals.every((r) => r.tag !== CLAN && typeof r.recorded === "boolean"),
  );
  assert.ok(
    p.rivals.every((r) => r.name),
    "rivals are named from the war_week_clan rows",
  );
});

test("the close slot: a captured 09:57Z read of the next race keys to the CURRENT season", async () => {
  // fixtures/currentriverrace/slot_band.json is the archived POAP KINGS
  // read at 2026-09-14T09:57:54Z: sectionIndex 1, periodIndex 7, the
  // week-1 race already matched while the calendar says section 0 until
  // 10:00Z. The race lane's first rule filed this under S135 week 1
  // (2026-09-17); the live writer and the lane now share raceWeekFor.
  // Replayed under another clan tag so the shared scratch DB's POAP
  // KINGS rows (a real S135 week 1 among them, from the log) stay out
  // of the assertion.
  const captured = await fixture("currentriverrace/slot_band.json");
  const SLOT = "#2PP0V8YC";
  const swap = (c) => (c.tag === captured.clan.tag ? { ...c, tag: SLOT } : c);
  const payload = {
    ...captured,
    clan: { ...captured.clan, tag: SLOT },
    clans: captured.clans.map(swap),
  };
  assert.equal(payload.sectionIndex, 1);
  assert.equal(payload.periodIndex, 7);
  assert.equal(payload.seasonId, undefined, "live payloads carry no seasonId");
  const fetchedAt = "2026-09-14T09:57:54Z";
  const nowMs = Date.parse("2026-09-14T09:58:30Z");
  const result = await projectRiverRace(ctx.db, { payload, fetchedAt, nowMs });
  assert.equal(result.projected, "war");
  const { rows: weeks } = await ctx.db.query(
    `select season_id, section_index, started_observed_at from war_week where clan_tag = $1`,
    [SLOT],
  );
  assert.deepEqual(
    weeks.map((w) => [w.season_id, w.section_index]),
    [[136, 1]],
    "S136 week 1, nothing under S135",
  );
  assert.equal(
    weeks[0].started_observed_at.toISOString(),
    "2026-09-14T09:57:54.000Z",
  );
  const { rows: keyed } = await ctx.db.query(
    `select 'participation' as t, season_id, count(*)::int as n from war_participation where clan_tag = $1 group by 1, 2
     union all
     select 'standings', season_id, count(*)::int from war_week_clan where clan_tag = $1 group by 1, 2
     order by 1`,
    [SLOT],
  );
  assert.deepEqual(keyed, [
    { t: "participation", season_id: 136, n: payload.clan.participants.length },
    { t: "standings", season_id: 136, n: 5 },
  ]);
  const bracket = await clanEvents(
    ctx.db,
    "clan_tag = $1 and event_type = 'bracket_observed'",
    [SLOT],
  );
  assert.equal(bracket.length, 1);
  assert.equal(bracket[0].payload.season_id, 136);
  assert.equal(bracket[0].payload.section_index, 1);
  // The lane's rule is the same function, so it agrees on the capture.
  assert.deepEqual(raceSeasonFor({ payload: captured, fetchedAt }), {
    seasonId: 136,
    sectionIndex: 1,
  });
});

test("decks the counter rolled past land on the previous war day (the Gym's open question 2, 2026-09-21)", async () => {
  // Day 3's last poll sees a member at 10 decks, 3 of them today; day
  // 4's first poll sees 12 decks, 1 of them today. The extra one was
  // played late on day 3 after the poll: day 3's row becomes 4, day 4's
  // is 1, and by_day sums to the cumulative again.
  const day3 = structuredClone(await fixture("currentriverrace/war_day.json"));
  const member = day3.clan.participants[0];
  // The fixture is period 27 (war day 4); make it day 3 for the first poll.
  day3.periodIndex = 26;
  member.decksUsed = 10;
  member.decksUsedToday = 3;
  await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: day3,
    fetchedAt: "2026-08-30T08:30:00Z",
    nowMs: Date.parse("2026-08-30T08:30:00Z"),
  });
  const day4 = structuredClone(day3);
  day4.periodIndex = 27;
  day4.clan.participants[0].decksUsed = 12;
  day4.clan.participants[0].decksUsedToday = 1;
  await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: day4,
    fetchedAt: "2026-08-30T10:30:00Z",
    nowMs: Date.parse("2026-08-30T10:30:00Z"),
  });
  const { rows } = await ctx.db.query(
    `select war_day, decks_used_today from war_attendance_day
     where clan_tag = $1 and season_id = 135 and section_index = 3 and player_tag = $2
     order by war_day`,
    [CLAN, member.tag],
  );
  const byDay = Object.fromEntries(
    rows.map((r) => [r.war_day, r.decks_used_today]),
  );
  assert.equal(
    byDay[3],
    4,
    "the deck played after day 3's last poll lands on day 3",
  );
  assert.equal(byDay[4], 1, "today is today's");
  // A second poll on day 4 carries nothing more.
  const later = structuredClone(day4);
  later.clan.participants[0].decksUsed = 13;
  later.clan.participants[0].decksUsedToday = 2;
  await projectRiverRace(ctx.db, {
    clanTag: CLAN,
    payload: later,
    fetchedAt: "2026-08-30T12:30:00Z",
    nowMs: Date.parse("2026-08-30T12:30:00Z"),
  });
  const { rows: again } = await ctx.db.query(
    `select decks_used_today from war_attendance_day
     where clan_tag = $1 and season_id = 135 and section_index = 3 and player_tag = $2 and war_day = 3`,
    [CLAN, member.tag],
  );
  assert.equal(
    again[0].decks_used_today,
    4,
    "a poll inside a day never carries",
  );
});

test("training days record practice decks apart from war attendance (0167)", async () => {
  // Jamie 2026-09-24: decksUsedToday on a training day is kept too, in
  // its own table, so no war-day count changes meaning.
  const TRAIN_CLAN = "#2PYLQ8U9";
  await ctx.db.query(`insert into clan (clan_tag) values ($1)`, [TRAIN_CLAN]);
  const payload = await fixture("currentriverrace/training.json"); // p30 s4
  payload.clan.tag = TRAIN_CLAN;
  await projectRiverRace(ctx.db, {
    clanTag: TRAIN_CLAN,
    payload,
    fetchedAt: "2026-09-02T12:00:00Z",
  });
  const practiced = payload.clan.participants.filter(
    (p) => p.decksUsedToday > 0,
  );
  const { rows } = await ctx.db.query(
    `select training_day, player_tag, decks_used_today from war_training_day
      where clan_tag = $1 order by player_tag`,
    [TRAIN_CLAN],
  );
  assert.equal(
    rows.length,
    practiced.length,
    "one row per member who practiced",
  );
  assert.ok(
    rows.every((r) => r.training_day === (payload.periodIndex % 7) + 1),
  );
  const first = practiced[0];
  assert.equal(
    rows.find((r) => r.player_tag === first.tag).decks_used_today,
    first.decksUsedToday,
  );
  const { rows: att } = await ctx.db.query(
    `select count(*)::int n from war_attendance_day where clan_tag = $1`,
    [TRAIN_CLAN],
  );
  assert.equal(att[0].n, 0, "a training day writes no war attendance");

  // A lagging poll never lowers a count.
  const lagging = structuredClone(payload);
  for (const p of lagging.clan.participants) p.decksUsedToday = 0;
  await projectRiverRace(ctx.db, {
    clanTag: TRAIN_CLAN,
    payload: lagging,
    fetchedAt: "2026-09-02T12:30:00Z",
  });
  const { rows: after } = await ctx.db.query(
    `select sum(decks_used_today)::int n from war_training_day where clan_tag = $1`,
    [TRAIN_CLAN],
  );
  assert.equal(
    after[0].n,
    practiced.reduce((a, p) => a + p.decksUsedToday, 0),
  );
});
