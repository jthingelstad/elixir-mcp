/**
 * The daily rollup refresh is one statement over the sorted (player,
 * day) keys (review 2026-09-27 §2.5, §5.6): it locks rows in one fixed
 * order whatever order the observer's battles arrived in, rewrites only
 * rows whose numbers changed, and deletes rows the recomputation no
 * longer produces.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { processResult } from "../src/pipeline.mjs";
import { refreshDailyRollups } from "../src/rollups.mjs";
import { fixture, fixtureMeta, scratchDb } from "./helpers.mjs";

let ctx;
let tag;
let pairs;

const rows = async () =>
  (
    await ctx.db.query(
      `select player_tag, day::text, mode_group, game_mode_id, wins, losses,
              battles_captured, xmin::text as xmin
       from player_daily_battle_rollup where player_tag = $1
       order by day, mode_group, game_mode_id`,
      [tag],
    )
  ).rows;

before(async () => {
  ctx = await scratchDb("rollups");
  const {
    rows: [account],
  } = await ctx.db.query(
    `insert into account (email_hash, status, is_owner, role) values ('rollup-owner', 'approved', true, 'owner')
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'rollup-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  const file = "player_battlelog/with_path_of_legend.json";
  tag = (await fixtureMeta())[file].entity_key;
  const payload = await fixture(file);
  const r = await processResult(ctx.db, {
    v: 1,
    job: { endpoint: "player_battlelog", entity_key: tag, lane: "bulk" },
    gateway_id: gw.gateway_id,
    fetched_at: "2026-09-03T14:00:34Z",
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  });
  assert.equal(r.outcome, "admitted");
  const days = (
    await ctx.db.query(
      `select distinct day::text as day from player_daily_battle_rollup where player_tag = $1`,
      [tag],
    )
  ).rows.map((d) => d.day);
  assert.ok(days.length >= 2, "the fixture spans more than one day");
  pairs = days.map((day) => ({ playerTag: tag, day }));
});

after(async () => {
  await ctx?.drop();
});

test("one statement, whatever the number or order of the pairs", async () => {
  const queries = [];
  const spy = {
    query: (text, params) => {
      queries.push({ text, params });
      return ctx.db.query(text, params);
    },
  };
  await refreshDailyRollups(spy, [...pairs].reverse().concat(pairs));
  assert.equal(queries.length, 1, "one statement for every pair");
  const [tags, days] = queries[0].params;
  assert.equal(tags.length, pairs.length, "duplicate pairs collapse");
  const keys = tags.map((t, i) => `${t}|${days[i]}`);
  assert.deepEqual(keys, [...keys].sort(), "keys go in sorted");

  queries.length = 0;
  await refreshDailyRollups(spy, []);
  assert.equal(queries.length, 0, "nothing to refresh, no statement");
});

test("an unchanged recomputation rewrites nothing", async () => {
  const first = await rows();
  await refreshDailyRollups(ctx.db, pairs);
  const second = await rows();
  assert.deepEqual(
    second,
    first,
    "same rows, same xmin: IS DISTINCT FROM skipped every update",
  );
});

test("a drifted row is corrected and a row the battles no longer produce is deleted", async () => {
  const before_ = await rows();
  const victim = before_[0];
  await ctx.db.query(
    `update player_daily_battle_rollup set wins = wins + 5
     where player_tag = $1 and day = $2 and mode_group = $3 and game_mode_id = $4`,
    [tag, victim.day, victim.mode_group, victim.game_mode_id],
  );
  await ctx.db.query(
    `insert into player_daily_battle_rollup (player_tag, day, mode_group, game_mode_id, wins, battles_captured)
     values ($1, $2, 'casual', 999999, 3, 3)`,
    [tag, victim.day],
  );
  // A key outside the refreshed pairs is left alone.
  await ctx.db.query(
    `insert into player_daily_battle_rollup (player_tag, day, mode_group, game_mode_id, wins, battles_captured)
     values ($1, '2020-01-01', 'casual', 0, 1, 1)`,
    [tag],
  );
  await refreshDailyRollups(ctx.db, pairs);
  const after_ = (await rows()).filter((r) => r.day !== "2020-01-01");
  const strip = (list) => list.map(({ xmin: _x, ...rest }) => rest);
  assert.deepEqual(strip(after_), strip(before_));
  const untouched = (await rows()).filter((r) => r.day === "2020-01-01");
  assert.equal(untouched.length, 1, "only the refreshed keys are rebuilt");
});
