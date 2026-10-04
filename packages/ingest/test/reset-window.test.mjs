import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { projectPlayerSnapshot } from "../src/snapshots.mjs";
import { fixture, scratchDb } from "./helpers.mjs";
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
