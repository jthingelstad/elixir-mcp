import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { projectPlayerSnapshot } from "../src/snapshots.mjs";
import { fixture, scratchDb, trackClans } from "./helpers.mjs";
import { playerEvents } from "./event-rows.mjs";
import { participationQueries } from "../../record/src/participation-sql.mjs";
import { evaluateAwards } from "@elixir-mcp/clan-engine";
import {
  member,
  participation,
  EXAMPLE_AWARDS,
  NOW,
} from "@elixir-mcp/clan-engine/fixtures";

let ctx;
let profile;
before(async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-05T12:00:00Z") });
  ctx = await scratchDb("reset_window");
  profile = await fixture("player/profile.json");
});
after(async () => {
  mock.timers.reset();
  await ctx?.drop();
});

test("auxiliary reset snapshots preserve counters and award input but emit no second reset", async () => {
  const tags = ["#P0YQ2L8", "#P0YQ2L9"];
  for (const tag of tags)
    await ctx.db.query(
      "insert into player(player_tag,name) values($1,'Example')",
      [tag],
    );
  // A real counter fall followed by an increasing poll in the season-roll
  // hour. The older game-day row remains high; it is not another reset.
  const polls = [
    ["2026-10-04T08:45:10Z", 52],
    ["2026-10-04T14:27:48Z", 60],
    ["2026-10-04T23:20:00Z", 60],
    ["2026-10-04T23:30:00Z", 4],
    ["2026-10-04T23:35:00Z", 4],
    ["2026-10-04T23:40:00Z", 5],
    ["2026-10-05T01:10:00Z", 5],
    ["2026-10-05T09:10:00Z", 9],
    ["2026-10-05T09:20:00Z", 12],
  ];
  for (const [fetchedAt, donations] of polls) {
    for (const [i, playerTag] of tags.entries()) {
      await projectPlayerSnapshot(ctx.db, {
        playerTag,
        payload: { ...profile, tag: playerTag, donations },
        fetchedAt,
        moments: i === 0,
      });
    }
  }
  const events = await playerEvents(
    ctx.db,
    "player_tag=$1 and event_type='donation_reset'",
    [tags[0]],
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload, {
    donations_before: 60,
    donations_after: 4,
  });
  assert.equal(events[0].window_end.toISOString(), "2026-10-04T23:30:00.000Z");
  assert.equal(
    (await playerEvents(ctx.db, "player_tag=$1", [tags[1]])).length,
    0,
  );
  const snapshots = async (tag) =>
    (
      await ctx.db.query(
        "select * from player_snapshot_daily where player_tag=$1 order by snapshot_date,snapshot_kind",
        [tag],
      )
    ).rows.map(({ player_tag: _tag, created_at: _created, ...row }) => row);
  const recorded = await snapshots(tags[0]);
  assert.deepEqual(
    recorded,
    await snapshots(tags[1]),
    "moment emission does not change any snapshot field",
  );
  assert.deepEqual(
    recorded.map((r) => [r.snapshot_kind, r.donations]),
    [
      ["daily", 52],
      ["daily", 12],
      ["pre_reset", 60],
      ["season_roll", 12],
    ],
  );
  const query = participationQueries({
    clanTag: "#CLAN",
    tags,
    from: "2026-09-28",
    rankedTypes: [],
  }).find((q) => q.name === "donations_by_week");
  const rows = (await ctx.db.query(query.text, query.values)).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.donations),
    [60, 60],
    "participation keeps the captured weekly high-water mark",
  );
  const awards = (donations) =>
    evaluateAwards({
      participation: participation([
        member("#EXAMPLE", { donations: Array(6).fill(donations) }),
      ]),
      config: EXAMPLE_AWARDS,
      now: NOW,
      grants: [],
      config_version: 1,
    });
  assert.deepEqual(
    awards(rows[0].donations),
    awards(rows[1].donations),
    "awards see identical snapshot-derived evidence",
  );
});

// The clan roster writes the same shared `donations` column the profile
// does, at its own cadence. Codex on #261: a roster poll that saw the
// weekly reset first overwrote the counter without a moment, so the next
// profile poll compared low with low and the week's reset was lost.
const RESET_CLAN = "#2PP0V9YY";
const rosterOf = (members) => ({
  tag: RESET_CLAN,
  name: "Reset Clan",
  memberList: members.map(([tag, donations], i) => ({
    tag,
    name: `M${i}`,
    role: "member",
    trophies: 6000,
    arena: { id: 54000050, name: "Legendary Arena" },
    clanRank: i + 1,
    previousClanRank: i + 1,
    donations,
    donationsReceived: 0,
  })),
});

async function resetsOf(tag) {
  return playerEvents(ctx.db, "player_tag=$1 and event_type='donation_reset'", [
    tag,
  ]);
}

test("a roster poll that sees the reset first records it once; the profile polls after it do not repeat it", async () => {
  const { projectClanSeries } = await import("../src/series.mjs");
  const tag = "#P0YQ2LC";
  await ctx.db.query("insert into player(player_tag,name) values($1,'R')", [
    tag,
  ]);
  await trackClans(ctx.db, [RESET_CLAN]);
  const poll = (fetchedAt, donations) =>
    projectPlayerSnapshot(ctx.db, {
      playerTag: tag,
      payload: { ...profile, tag, donations },
      fetchedAt,
    });
  const roster = (observedAt, donations) =>
    projectClanSeries(ctx.db, {
      payload: rosterOf([[tag, donations]]),
      observedAt,
    });
  await poll("2026-10-04T14:27:48Z", 60);
  await roster("2026-10-04T23:20:00Z", 60);
  await roster("2026-10-04T23:32:00Z", 4);
  await poll("2026-10-04T23:40:00Z", 5);
  await roster("2026-10-04T23:50:00Z", 5);
  await poll("2026-10-05T01:10:00Z", 5);
  const events = await resetsOf(tag);
  assert.equal(events.length, 1, "the reset is on the ledger exactly once");
  assert.deepEqual(events[0].payload, {
    donations_before: 60,
    donations_after: 4,
  });
  assert.equal(
    events[0].window_start.toISOString(),
    "2026-10-04T23:20:00.000Z",
  );
  assert.equal(events[0].window_end.toISOString(), "2026-10-04T23:32:00.000Z");
});

test("a quiet clan's roster seeing the reset on the next game day is the one moment; the profile's older baseline does not repeat it", async () => {
  const { projectClanSeries } = await import("../src/series.mjs");
  const tag = "#P0YQ2LG";
  await ctx.db.query("insert into player(player_tag,name) values($1,'Q')", [
    tag,
  ]);
  // The last write on the old game day is before the reset; the next one
  // is the roster's, on a new game day's row of its own.
  await projectPlayerSnapshot(ctx.db, {
    playerTag: tag,
    payload: { ...profile, tag, donations: 60 },
    fetchedAt: "2026-10-04T22:00:00Z",
  });
  await projectClanSeries(ctx.db, {
    payload: rosterOf([[tag, 4]]),
    observedAt: "2026-10-05T10:30:00Z",
  });
  await projectPlayerSnapshot(ctx.db, {
    playerTag: tag,
    payload: { ...profile, tag, donations: 5 },
    fetchedAt: "2026-10-05T11:00:00Z",
  });
  const events = await resetsOf(tag);
  assert.equal(events.length, 1);
  assert.equal(
    events[0].window_start.toISOString(),
    "2026-10-04T22:00:00.000Z",
  );
  assert.equal(
    events[0].window_end.toISOString(),
    "2026-10-05T10:30:00.000Z",
    "the roster saw it first",
  );
});

test("late and replayed observations around a reset add no second moment", async () => {
  const { projectClanSeries } = await import("../src/series.mjs");
  const tag = "#P0YQ2LJ";
  await ctx.db.query("insert into player(player_tag,name) values($1,'L')", [
    tag,
  ]);
  const poll = (fetchedAt, donations) =>
    projectPlayerSnapshot(ctx.db, {
      playerTag: tag,
      payload: { ...profile, tag, donations },
      fetchedAt,
    });
  const roster = (observedAt, donations, moments = true) =>
    projectClanSeries(ctx.db, {
      payload: rosterOf([[tag, donations]]),
      observedAt,
      moments,
    });
  await poll("2026-10-03T20:00:00Z", 50);
  await poll("2026-10-04T14:00:00Z", 60);
  await roster("2026-10-04T23:45:00Z", 4);
  // A profile read from before the roster's, delivered after it: today's
  // row is newer than it, so its baseline is yesterday's 50.
  await poll("2026-10-04T23:40:00Z", 5);
  // A roster read from before the reset, delivered late.
  await roster("2026-10-04T23:10:00Z", 60);
  // A replay writes rows, never moments.
  await roster("2026-10-04T23:15:00Z", 2, false);
  const events = await resetsOf(tag);
  assert.equal(events.length, 1);
  assert.equal(events[0].window_end.toISOString(), "2026-10-04T23:45:00.000Z");
});

test("two transactions that see the same reset at once write one moment", async () => {
  // Codex on #461: a profile and a roster receipt on opposite sides of the
  // 10:00Z game-day boundary lock different daily rows, so without a lock
  // of its own each one's check ran before the other's insert committed.
  const { donationResetMoment } = await import("../src/snapshots.mjs");
  const pg = (await import("pg")).default;
  const tag = "#P0YQ2LL";
  await ctx.db.query("insert into player(player_tag,name) values($1,'C')", [
    tag,
  ]);
  const prior = {
    donations: 60,
    observed_at: new Date("2026-10-04T22:00:00Z"),
  };
  const [one, two] = [new pg.Client(ctx.url), new pg.Client(ctx.url)];
  await one.connect();
  await two.connect();
  try {
    await one.query("begin");
    assert.equal(
      await donationResetMoment(one, {
        playerTag: tag,
        prior,
        donations: 4,
        observedAt: "2026-10-05T09:59:00Z",
      }),
      true,
    );
    await two.query("begin");
    const second = donationResetMoment(two, {
      playerTag: tag,
      prior,
      donations: 4,
      observedAt: "2026-10-05T10:01:00Z",
    }).then(async (wrote) => {
      await two.query("commit");
      return wrote;
    });
    // The second waits for the first to commit, then finds its moment.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await one.query("commit");
    assert.equal(await second, false);
  } finally {
    await one.end();
    await two.end();
  }
  assert.equal((await resetsOf(tag)).length, 1);
});
