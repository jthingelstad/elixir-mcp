/**
 * A Ranked season's finish (0289, the owner 2026-11-17). The profile rolls
 * per player, hours after the season hour (cr-agent-api-docs players.md):
 * until the old month's seasonal-road bucket is gone, its
 * lastPathOfLegendSeasonResult is the season before. So a read that has
 * not rolled files nothing (the stale result this fixes), a rolled read
 * files the season and heals a row an unrolled read filed, and the moment
 * is said once, at the season's end, only for a player the record watched
 * through the season and who played Ranked in it.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureSeason } from "@elixir-mcp/record/season";
import { playerEvents } from "./event-rows.mjs";
import {
  profileRolledPast,
  projectPlayerSnapshot,
  rankedFinishAfterBattles,
} from "../src/snapshots.mjs";
import { scratchDb } from "./helpers.mjs";

let ctx;
before(async () => {
  ctx = await scratchDb("ranked_season");
  for (const m of ["2026-09", "2026-10", "2026-11"])
    await ensureSeason(ctx.db, m);
});
after(async () => ctx?.drop());

// Invented tags (docs/invented-tags.json).
const PIP = "#0QYPJ8G2";
const ASH = "#0LCRV2PQ";
const ROWAN = "#0GUJ9RY8";
const SAGE = "#0RJ2QC9P";
const FERN = "#0PLUG2V9";

// The 2026-10 season: 2026-10-05T10:00Z to 2026-11-02T10:00Z.
const ROAD = (...months) =>
  Object.fromEntries(
    months.map((m) => [
      `seasonal-trophy-road-${m}`,
      { trophies: 14000, bestTrophies: 0 },
    ]),
  );
/** Before the roll: October's bucket and November's both there. */
const UNROLLED = ROAD("202610", "202611");
/** After it: October's is gone. */
const ROLLED = ROAD("202611");

const profile = (tag, last, progress) => ({
  tag,
  name: "Pip",
  battleCount: 100,
  trophies: 6000,
  lastPathOfLegendSeasonResult: last,
  progress,
});

const read = (tag, at, last, progress) =>
  projectPlayerSnapshot(ctx.db, {
    playerTag: tag,
    payload: profile(tag, last, progress),
    fetchedAt: at,
  });

async function player(tag) {
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'Pip') on conflict do nothing`,
    [tag],
  );
}

const polRow = async (tag, month) =>
  (
    await ctx.db.query(
      `select league, trophies, rank from player_pol_season
        where player_tag = $1 and season_month = $2`,
      [tag, month],
    )
  ).rows[0] ?? null;

const finishes = (tag) =>
  playerEvents(
    ctx.db,
    "player_tag = $1 and event_type = 'ranked_season_finished'",
    [tag],
  );

const lg = (leagueNumber, trophies = 0, rank = null) => ({
  leagueNumber,
  trophies,
  rank,
});

async function rankedBattle(tag, at, createdAt = at) {
  const id = `ranked-${tag}-${at}`;
  await ctx.db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'pathOfLegend', 'pvp', $3)`,
    [id, at, createdAt],
  );
  await ctx.db.query(
    `insert into battle_participant (battle_id, player_tag, side, outcome, battle_time, type_class, type)
     values ($1, $2, 0, 'win', $3, 'pvp', 'pathOfLegend')`,
    [id, tag, at],
  );
}

test("rolled: the closed month's seasonal-road bucket is gone and a later one is there; anything else is not a roll", () => {
  assert.equal(profileRolledPast({ progress: ROLLED }, "2026-10"), true);
  assert.equal(profileRolledPast({ progress: UNROLLED }, "2026-10"), false);
  assert.equal(profileRolledPast({ progress: {} }, "2026-10"), false);
  assert.equal(profileRolledPast({}, "2026-10"), false);
  assert.equal(
    profileRolledPast(
      { progress: { "2v2League_202611": { trophies: 1 } } },
      "2026-10",
    ),
    false,
    "only the seasonal road's bucket says the roll",
  );
});

test("a read after the season hour that has not rolled files nothing: its last result is the season before", async () => {
  await player(PIP);
  // Watched through October.
  await read(PIP, "2026-10-20T12:00:00Z", lg(2), UNROLLED);
  // 11:00Z on 2 November: the season closed at 10:00Z, the profile has
  // not rolled, and its last result is still September's Master II.
  await read(PIP, "2026-11-02T11:00:00Z", lg(2), UNROLLED);
  assert.equal(await polRow(PIP, "2026-10"), null);
  assert.deepEqual(await finishes(PIP), []);
});

test("the rolled read files the season and says it once, at the season's end, with the league and no rating below Ultimate Champion", async () => {
  await read(PIP, "2026-11-02T12:44:40Z", lg(5), ROLLED);
  assert.deepEqual(await polRow(PIP, "2026-10"), {
    league: 5,
    trophies: 0,
    rank: null,
  });
  await read(PIP, "2026-11-03T12:00:00Z", lg(5), ROLLED);
  const rows = await finishes(PIP);
  assert.equal(rows.length, 1, "said once");
  const [row] = rows;
  assert.deepEqual(row.payload, { season: "2026-10", league: 5, rating: null });
  assert.equal(row.timing, "exact");
  assert.equal(row.occurred_at.toISOString(), "2026-11-02T10:00:00.000Z");
  assert.equal(
    row.window_end.toISOString(),
    "2026-11-02T12:44:40.000Z",
    "observed at the read that saw the roll, so a poller past the season hour learns it",
  );
});

test("Ultimate Champion carries its rating; the global rank is never a fact", async () => {
  await player(ASH);
  await read(ASH, "2026-10-20T12:00:00Z", lg(7, 2100, 9), UNROLLED);
  await read(ASH, "2026-11-02T13:00:00Z", lg(7, 2345, 812), ROLLED);
  const [row] = await finishes(ASH);
  assert.deepEqual(row.payload, {
    season: "2026-10",
    league: 7,
    rating: 2345,
  });
  assert.equal((await polRow(ASH, "2026-10")).rank, 812, "the ledger keeps it");
});

test("Master I is said only when the record holds a Ranked battle in the season: 1 with 0 is also what sitting it out reads", async () => {
  await player(ROWAN);
  await player(SAGE);
  for (const tag of [ROWAN, SAGE])
    await read(tag, "2026-10-20T12:00:00Z", lg(1), UNROLLED);
  await rankedBattle(SAGE, "2026-10-21T18:00:00Z");
  for (const tag of [ROWAN, SAGE])
    await read(tag, "2026-11-02T14:00:00Z", lg(1), ROLLED);
  assert.deepEqual(await finishes(ROWAN), [], "no Ranked battle: silent");
  assert.ok(await polRow(ROWAN, "2026-10"), "the ledger row is still kept");
  const [row] = await finishes(SAGE);
  assert.deepEqual(row.payload, { season: "2026-10", league: 1, rating: null });
});

test("a new follow says nothing: no profile read before the season ended", async () => {
  await player(FERN);
  // First read the day after the roll; the row is filed, silently.
  await read(FERN, "2026-11-03T09:00:00Z", lg(6), ROLLED);
  assert.deepEqual(await polRow(FERN, "2026-10"), {
    league: 6,
    trophies: 0,
    rank: null,
  });
  assert.deepEqual(await finishes(FERN), []);
});

test("a row an unrolled read filed before the fix is corrected by the next rolled read, silently", async () => {
  const STALE = "#0GRJCUV";
  await player(STALE);
  await read(STALE, "2026-10-20T12:00:00Z", lg(2), UNROLLED);
  // What the old projector wrote at 10:30Z: September's result under October.
  await ctx.db.query(
    `insert into player_pol_season (player_tag, season_month, league, trophies, rank, observed_at)
     values ($1, '2026-10', 2, 0, null, '2026-11-02T10:30:00Z')`,
    [STALE],
  );
  await read(STALE, "2026-11-05T12:00:00Z", lg(4), ROLLED);
  assert.deepEqual(await polRow(STALE, "2026-10"), {
    league: 4,
    trophies: 0,
    rank: null,
  });
  assert.deepEqual(
    await finishes(STALE),
    [],
    "a correction is not a new finish: a deploy onto stale rows is silent",
  );
});

test("Master I whose Ranked battle the log delivers after the rolled read: the battle log says it then, once (Codex on #1111)", async () => {
  const LATE = "#0YRQJGCJL";
  await player(LATE);
  await read(LATE, "2026-10-20T12:00:00Z", lg(1), UNROLLED);
  await read(LATE, "2026-11-02T11:00:00Z", lg(1), ROLLED);
  assert.deepEqual(await finishes(LATE), [], "no Ranked battle yet: silent");
  // Played on 1 November, delivered on 3 November.
  await rankedBattle(LATE, "2026-11-01T20:00:00Z", "2026-11-03T08:00:00Z");
  const at = "2026-11-03T08:00:05Z";
  await rankedFinishAfterBattles(ctx.db, { playerTag: LATE, observedAt: at });
  await rankedFinishAfterBattles(ctx.db, { playerTag: LATE, observedAt: at });
  const rows = await finishes(LATE);
  assert.equal(rows.length, 1, "once");
  assert.equal(rows[0].occurred_at.toISOString(), "2026-11-02T10:00:00.000Z");
  assert.equal(rows[0].window_end.toISOString(), "2026-11-03T08:00:05.000Z");
});

test("a Ranked battle the record held before the filing never retries: a deploy over filed seasons is silent", async () => {
  // ROWAN: Master I, no battle, filed on 2 November. A battle that
  // reached the record before the filing is not a late delivery.
  await rankedBattle(ROWAN, "2026-10-22T18:00:00Z", "2026-10-22T18:01:00Z");
  await rankedFinishAfterBattles(ctx.db, {
    playerTag: ROWAN,
    observedAt: "2026-11-03T09:00:00Z",
  });
  assert.deepEqual(await finishes(ROWAN), []);
});
