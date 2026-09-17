import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  seasonCalendar,
  warPeriods,
  ensureSeason,
  ensureSeasonsAround,
  seasonAt,
  seasonByKey,
  seasonCrossings,
  verifyWarSeason,
  seasonMismatchEmf,
  parseProgressKey,
  projectModeSeasons,
} from "../src/season.mjs";
import { projectRiverRaceLog } from "../src/war.mjs";
import { processResult } from "../src/pipeline.mjs";
import { fixture, scratchDb } from "./helpers.mjs";

let ctx;
const CLAN = "#J2RGCRVG";

before(async () => {
  ctx = await scratchDb("season");
  await ctx.db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);
});

after(async () => ctx.drop());

test("0104's seed is the calendar war-clock.mjs computes, row for row", async () => {
  const { rows } = await ctx.db.query(
    `select season_month, war_season_id, starts_at, ends_at, sections, colosseum_section
     from season order by season_month`,
  );
  assert.equal(rows.length, 9, "2026-02 .. 2026-10");
  for (const row of rows) {
    const calendar = seasonCalendar(row.season_month);
    assert.deepEqual(
      {
        ...row,
        starts_at: row.starts_at.toISOString(),
        ends_at: row.ends_at.toISOString(),
      },
      {
        ...calendar,
        starts_at: calendar.starts_at.toISOString(),
        ends_at: calendar.ends_at.toISOString(),
      },
      row.season_month,
    );
  }
  // The two anchors the review verified against riverracelog stamps.
  const s135 = rows.find((r) => r.war_season_id === 135);
  assert.equal(s135.season_month, "2026-08");
  assert.equal(s135.starts_at.toISOString(), "2026-08-03T10:00:00.000Z");
  assert.equal(s135.ends_at.toISOString(), "2026-09-07T10:00:00.000Z");
  assert.equal(s135.sections, 5);
  assert.equal(s135.colosseum_section, 4);
  const s134 = rows.find((r) => r.war_season_id === 134);
  assert.equal(s134.starts_at.toISOString(), "2026-07-06T10:00:00.000Z");
  assert.equal(s134.sections, 4);
});

test("0105's period seed is warPeriods() row for row, and ensureSeason writes both", async () => {
  const { rows } = await ctx.db.query(
    `select war_season_id, period_index, section_index, day_in_section, kind, war_day, starts_at, ends_at
     from war_period order by war_season_id, period_index`,
  );
  assert.equal(
    rows.length,
    6 * 28 + 3 * 35,
    "2026-02..10: six four-week, three five-week",
  );
  const { rows: seasons } = await ctx.db.query(
    `select season_month from season order by 1`,
  );
  const expected = seasons.flatMap((s) =>
    warPeriods(seasonCalendar(s.season_month)),
  );
  assert.equal(rows.length, expected.length);
  for (let i = 0; i < rows.length; i += 1) {
    assert.deepEqual(
      {
        ...rows[i],
        starts_at: rows[i].starts_at.toISOString(),
        ends_at: rows[i].ends_at.toISOString(),
      },
      {
        ...expected[i],
        starts_at: expected[i].starts_at.toISOString(),
        ends_at: expected[i].ends_at.toISOString(),
      },
      `period ${i}`,
    );
  }
  // S135's last section is colosseum on its war days, training on its
  // practice days; day rows are 24 hours on the grid, DST or not.
  const s135 = rows.filter((r) => r.war_season_id === 135);
  assert.equal(s135.length, 35);
  assert.deepEqual(
    s135.slice(28).map((r) => r.kind),
    [
      "training",
      "training",
      "training",
      "colosseum",
      "colosseum",
      "colosseum",
      "colosseum",
    ],
  );
  assert.equal(s135[34].ends_at.toISOString(), "2026-09-07T10:00:00.000Z");
  const s130 = rows.filter((r) => r.war_season_id === 130); // spans the March DST change
  assert.equal(s130.at(-1).ends_at.toISOString(), "2026-04-06T10:00:00.000Z");
});

test("ensureSeasonsAround writes the running and next season, idempotently", async () => {
  const at = Date.UTC(2027, 2, 20); // 2027-03-20: no seeded row
  const current = await ensureSeasonsAround(ctx.db, at);
  assert.equal(current, "2027-03");
  const { rows } = await ctx.db.query(
    `select season_month, war_season_id from season where season_month >= '2027-03' order by 1`,
  );
  assert.deepEqual(rows, [
    { season_month: "2027-03", war_season_id: 142 },
    { season_month: "2027-04", war_season_id: 143 },
  ]);
  const { rows: periods } = await ctx.db.query(
    `select war_season_id, count(*)::int as n, min(starts_at) as s, max(ends_at) as e
     from war_period where war_season_id in (142, 143) group by 1 order by 1`,
  );
  assert.equal(periods.length, 2, "the periods came with the season");
  assert.equal(periods[0].s.toISOString(), "2027-03-01T10:00:00.000Z");
  assert.equal(periods[0].e.toISOString(), periods[1].s.toISOString());
  await ensureSeasonsAround(ctx.db, at);
  const { rows: again } = await ctx.db.query(
    `select count(*)::int as n from season where season_month >= '2027-03'`,
  );
  assert.equal(again[0].n, 2);
  // A pre-anchor month resolves too (a progress key can name one).
  const old = await ensureSeason(ctx.db, "2025-12");
  assert.equal(old.war_season_id, 127);
  assert.equal(old.starts_at.toISOString(), "2025-12-01T10:00:00.000Z");
});

test("seasonByKey: current, previous, the month, the war number; nothing else", async () => {
  const now = Date.UTC(2026, 8, 17, 12); // 2026-09-17
  assert.equal((await seasonAt(ctx.db, now)).season_month, "2026-09");
  assert.equal(
    (await seasonByKey(ctx.db, undefined, now)).season_month,
    "2026-09",
  );
  assert.equal(
    (await seasonByKey(ctx.db, "current", now)).season_month,
    "2026-09",
  );
  assert.equal(
    (await seasonByKey(ctx.db, "previous", now)).season_month,
    "2026-08",
  );
  assert.equal((await seasonByKey(ctx.db, "2026-05", now)).war_season_id, 132);
  assert.equal((await seasonByKey(ctx.db, 133, now)).season_month, "2026-06");
  assert.equal((await seasonByKey(ctx.db, "133", now)).season_month, "2026-06");
  assert.equal(await seasonByKey(ctx.db, "2019-01", now), null);
  assert.equal(await seasonByKey(ctx.db, 99, now), null);
  assert.equal(await seasonByKey(ctx.db, "Minion Academy", now), null);
  // The roll instant itself belongs to the new season (10:00Z inclusive).
  const roll = Date.UTC(2026, 8, 7, 10);
  assert.equal((await seasonAt(ctx.db, roll)).season_month, "2026-09");
  assert.equal((await seasonAt(ctx.db, roll - 1)).season_month, "2026-08");
});

test("seasonCrossings lists every boundary strictly inside the window", async () => {
  const crosses = await seasonCrossings(
    ctx.db,
    Date.UTC(2026, 7, 20),
    Date.UTC(2026, 8, 17),
  );
  assert.deepEqual(crosses, [
    {
      kind: "season",
      at: "2026-09-07T10:00:00.000Z",
      from_season: { month: "2026-08", war: 135 },
      to_season: { month: "2026-09", war: 136 },
    },
  ]);
  // A window that starts on the roll does not cross it.
  assert.deepEqual(
    await seasonCrossings(
      ctx.db,
      Date.UTC(2026, 8, 7, 10),
      Date.UTC(2026, 8, 17),
    ),
    [],
  );
  const two = await seasonCrossings(
    ctx.db,
    Date.UTC(2026, 6, 1),
    Date.UTC(2026, 8, 17),
  );
  assert.deepEqual(
    two.map((c) => c.to_season.war),
    [134, 135, 136],
  );
});

test("the real riverracelog verifies three seasons and stamps each once", async () => {
  const log = await fixture("riverracelog/log.json");
  const result = await projectRiverRaceLog(ctx.db, {
    clanTag: CLAN,
    payload: log,
  });
  assert.equal(result.season_mismatches, undefined);
  const { rows } = await ctx.db.query(
    `select season_month, war_season_id, war_id_verified_at from season
     where war_id_verified_at is not null order by season_month`,
  );
  assert.deepEqual(
    rows.map((r) => [
      r.season_month,
      r.war_season_id,
      r.war_id_verified_at.toISOString(),
    ]),
    [
      // The stamp is the entry's own createdDate, the first seen per season.
      ["2026-05", 132, "2026-06-01T09:45:05.000Z"],
      ["2026-06", 133, "2026-07-06T09:37:03.000Z"],
      ["2026-07", 134, "2026-08-03T09:30:05.000Z"],
    ],
  );
  // closed_at (0105) is the entry's own createdDate, exact, per week.
  const { rows: closed } = await ctx.db.query(
    `select season_id, section_index, closed_at from war_week
     where clan_tag = $1 and season_id = 134 order by section_index`,
    [CLAN],
  );
  assert.deepEqual(
    closed.map((r) => [r.section_index, r.closed_at.toISOString()]),
    [
      [0, "2026-07-13T09:30:06.000Z"],
      [1, "2026-07-20T09:30:05.000Z"],
      [2, "2026-07-27T09:30:05.000Z"],
      [3, "2026-08-03T09:30:05.000Z"],
    ],
  );
  // Verified once: a later log with the same seasons moves nothing.
  await projectRiverRaceLog(ctx.db, { clanTag: CLAN, payload: log });
  const { rows: again } = await ctx.db.query(
    `select war_id_verified_at from season where season_month = '2026-07'`,
  );
  assert.equal(
    again[0].war_id_verified_at.toISOString(),
    "2026-08-03T09:30:05.000Z",
  );
});

test("a war id the calendar does not derive is a mismatch, never a relabel", async () => {
  const check = await verifyWarSeason(ctx.db, {
    warSeasonId: 999,
    closedAt: "2026-09-14T09:38:05.000Z",
  });
  assert.deepEqual(check, {
    status: "mismatch",
    season: "2026-09",
    expected: 136,
    got: 999,
  });
  const { rows } = await ctx.db.query(
    `select war_season_id, war_id_verified_at from season where season_month = '2026-09'`,
  );
  assert.deepEqual(rows, [{ war_season_id: 136, war_id_verified_at: null }]);
  const line = JSON.parse(seasonMismatchEmf({ ...check, clan_tag: CLAN }, 1));
  assert.equal(line._aws.CloudWatchMetrics[0].Namespace, "ElixirMCP/Record");
  assert.equal(
    line._aws.CloudWatchMetrics[0].Metrics[0].Name,
    "SeasonWarIdMismatch",
  );
  assert.equal(line.SeasonWarIdMismatch, 1);
  assert.equal(line.expected, 136);
  assert.equal(line.got, 999);
  // Before any row: unknown, not an alarm (the seed and the scheduler
  // make this unreachable for a week the API still serves).
  const none = await verifyWarSeason(ctx.db, {
    warSeasonId: 100,
    closedAt: "2020-01-06T09:30:00.000Z",
  });
  assert.equal(none.status, "unknown");
});

test("through the pipeline, a mismatched log entry emits one EMF count and still projects", async () => {
  const {
    rows: [account],
  } = await ctx.db.query(
    `insert into account (email_hash, status, is_owner, role) values ('season-owner', 'approved', true, 'owner')
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'season-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  const log = await fixture("riverracelog/log.json");
  const doctored = {
    items: log.items.map((i) =>
      i.seasonId === 134 ? { ...i, seasonId: 234 } : i,
    ),
  };
  const lines = [];
  const outcome = await processResult(
    ctx.db,
    {
      v: 1,
      job: { endpoint: "riverracelog", entity_key: CLAN, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: "2026-08-04T12:00:00Z",
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(doctored))).toString(
        "base64",
      ),
    },
    { emitMetrics: (line) => lines.push(line) },
  );
  assert.equal(outcome.outcome, "admitted");
  assert.deepEqual(outcome.projection.season_mismatches, [
    {
      status: "mismatch",
      season: "2026-07",
      expected: 134,
      got: 234,
      clan_tag: CLAN,
    },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).SeasonWarIdMismatch, 1);
  // The war rows still key on the API's own number: the log is the
  // API's truth for its surface, the season row is the derivation.
  const { rows } = await ctx.db.query(
    `select count(*)::int as n from war_week where clan_tag = $1 and season_id = 234`,
    [CLAN],
  );
  assert.equal(rows[0].n, 4);
});

test("progress keys split the way the API spells them", () => {
  assert.deepEqual(parseProgressKey("2v2League_202609"), {
    progress_key: "2v2League_202609",
    mode: "2v2League",
    season_month: "2026-09",
  });
  assert.deepEqual(parseProgressKey("seasonal-trophy-road-202608"), {
    progress_key: "seasonal-trophy-road-202608",
    mode: "seasonal-trophy-road",
    season_month: "2026-08",
  });
  assert.deepEqual(parseProgressKey("AutoChess_2026_Season_11"), {
    progress_key: "AutoChess_2026_Season_11",
    mode: "AutoChess",
    season_month: null,
  });
  assert.equal(parseProgressKey(""), null);
  assert.deepEqual(parseProgressKey("Something_New"), {
    progress_key: "Something_New",
    mode: "Something_New",
    season_month: null,
  });
});

test("the profile's progress keys become mode_season rows, written once a day", async () => {
  const profile = await fixture("player/profile.json");
  const first = await projectModeSeasons(ctx.db, {
    payload: profile,
    fetchedAt: "2026-09-17T06:00:00Z",
  });
  assert.equal(first.keys, 4, "the empty key is not a season");
  assert.equal(first.changed, 4);
  const { rows } = await ctx.db.query(
    `select progress_key, mode, season_month from mode_season order by progress_key`,
  );
  assert.deepEqual(rows, [
    {
      progress_key: "2v2League_202609",
      mode: "2v2League",
      season_month: "2026-09",
    },
    {
      progress_key: "AutoChess_2026_Season_11",
      mode: "AutoChess",
      season_month: null,
    },
    {
      progress_key: "seasonal-trophy-road-202608",
      mode: "seasonal-trophy-road",
      season_month: "2026-08",
    },
    {
      progress_key: "seasonal-trophy-road-202609",
      mode: "seasonal-trophy-road",
      season_month: "2026-09",
    },
  ]);
  const sameDay = await projectModeSeasons(ctx.db, {
    payload: profile,
    fetchedAt: "2026-09-17T14:00:00Z",
  });
  assert.equal(sameDay.changed, 0);
  const { rows: unmoved } = await ctx.db.query(
    `select last_seen_at from mode_season where progress_key = '2v2League_202609'`,
  );
  assert.equal(
    unmoved[0].last_seen_at.toISOString(),
    "2026-09-17T06:00:00.000Z",
  );
  await projectModeSeasons(ctx.db, {
    payload: profile,
    fetchedAt: "2026-09-19T06:00:00Z",
  });
  const { rows: moved } = await ctx.db.query(
    `select last_seen_at from mode_season where progress_key = '2v2League_202609'`,
  );
  assert.equal(moved[0].last_seen_at.toISOString(), "2026-09-19T06:00:00.000Z");
});
