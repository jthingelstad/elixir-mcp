/**
 * 0101: the battle stream asks for a profile the snapshot cannot vouch
 * for, and a moment is written once.
 *
 * The shape is x.x.hari.x.x's morning of 2026-09-15: a 06:07Z profile in
 * Executioner's Kitchen, the crossing at 06:46Z, a first Royal Crypt battle
 * as the LOWER side at 06:52Z (which vouches for nothing: the arena on a
 * battle is the higher side's), a trusted Royal Crypt battle at 08:11Z,
 * and the profile that finally said so at 14:27Z. Reproduced against the
 * real pipeline on a scratch database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { playerEvents } from "./event-rows.mjs";
import { gzipSync } from "node:zlib";
import { processResult } from "../src/pipeline.mjs";
import { refreshRequested } from "../../scheduler/src/plan.mjs";
import { fixture, scratchDb } from "./helpers.mjs";

let ctx;
let gatewayId;
let ladderEntry;
let rankedEntry;
let profileFixture;

const ME = "#PR0Y0Q2L";
const KITCHEN = { id: 54000013, name: "Executioner's Kitchen" };
const CRYPT = { id: 54000014, name: "Royal Crypt" };

function message({ endpoint, entityKey, payload, fetchedAt }) {
  return {
    v: 1,
    job: { endpoint, entity_key: entityKey, lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: fetchedAt,
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  };
}

/** A ladder battle from the observer's own log, at a time, in an arena,
 *  with both sides' starting trophies. */
function ladder({ at, arena, mine, theirs, opponent, name, result }) {
  const entry = structuredClone(ladderEntry);
  entry.battleTime = at;
  entry.arena = { ...arena, rawName: `Arena_${arena.id}` };
  entry.team[0].tag = ME;
  entry.team[0].name = "promo";
  entry.team[0].startingTrophies = mine;
  entry.opponent[0].tag = opponent;
  entry.opponent[0].name = name ?? "opp";
  entry.opponent[0].startingTrophies = theirs;
  // result: [myCrowns, theirCrowns, myChange]; the fixture's own is a
  // -3 loss. A gated loss on the floor carries no trophyChange at all.
  if (result) {
    const [crowns, against, change] = result;
    entry.team[0].crowns = crowns;
    entry.opponent[0].crowns = against;
    if (change === null) delete entry.team[0].trophyChange;
    else entry.team[0].trophyChange = change;
    entry.opponent[0].trophyChange = change === null ? -change : -change;
    if (change === null) delete entry.opponent[0].trophyChange;
  }
  return entry;
}

function profile({ arena, trophies, donations, bestTrophies, wins, league }) {
  const p = structuredClone(profileFixture);
  p.tag = ME;
  p.name = "promo";
  p.arena = { ...arena, rawName: `Arena_${arena.id}` };
  p.trophies = trophies;
  p.bestTrophies = bestTrophies ?? trophies;
  p.donations = donations ?? p.donations;
  if (wins !== undefined) p.wins = wins;
  if (league !== undefined)
    p.currentPathOfLegendSeasonResult = {
      leagueNumber: league,
      trophies: 0,
      rank: null,
    };
  return p;
}

/** A Path of Legends battle from the observer's own log: no trophies on
 *  the entry, the league it was played in stamped on it. */
function ranked({ at, league, tag, opponent, name, result }) {
  const entry = structuredClone(rankedEntry);
  entry.battleTime = at;
  entry.leagueNumber = league;
  entry.team[0].tag = tag;
  entry.team[0].name = "ranker";
  entry.opponent[0].tag = opponent;
  entry.opponent[0].name = name ?? "opp";
  const [crowns, against, change] = result;
  entry.team[0].crowns = crowns;
  entry.opponent[0].crowns = against;
  if (change === null) delete entry.team[0].trophyChange;
  else entry.team[0].trophyChange = change;
  return entry;
}

async function pollState() {
  const { rows } = await ctx.db.query(
    `select last_admitted_at, last_planned_at, refresh_requested_at, endpoint
     from poll_state where subject_tag = $1 and endpoint = 'player'`,
    [ME],
  );
  return rows[0];
}

async function events(type) {
  return playerEvents(ctx.db, "player_tag = $1 and event_type = $2", [
    ME,
    type,
  ]);
}

// Fresh enough for the activity signals: the guard is 24h from now, and
// the scenario has to be a real morning with real gaps between polls.
const day = new Date(Date.now() - 12 * 3600_000).toISOString().slice(0, 10);
const at = (hhmmss) => `${day}T${hhmmss}Z`;
const logAt = (hhmmss) => `${day.replaceAll("-", "")}T${hhmmss}.000Z`;

before(async () => {
  ctx = await scratchDb("profile_refresh");
  const {
    rows: [account],
  } = await ctx.db.query(
    `insert into account (email_hash, status, is_owner, role) values ('refresh-owner', 'approved', true, 'owner')
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'refresh-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  gatewayId = gw.gateway_id;
  const log = await fixture("player_battlelog/with_path_of_legend.json");
  ladderEntry = log.find((b) => b.type === "PvP");
  rankedEntry = log.find((b) => b.type === "pathOfLegend");
  profileFixture = await fixture("player/profile.json");
  // The planner only sees a player somebody records.
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'promo')`,
    [ME],
  );
  await ctx.db.query(
    `insert into recording (subject_type, subject_tag, status, scope, requested_by)
     values ('player', $1, 'active', 'comprehensive', $2)`,
    [ME, account.account_id],
  );
  await ctx.db.query(
    `insert into poll_state (subject_tag, endpoint) values ($1, 'player'), ($1, 'player_battlelog')`,
    [ME],
  );
});

after(async () => ctx.drop());

test("a profile in the old arena, then a log whose only new-arena battle was as the lower side: nothing asked", async () => {
  const first = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: ME,
      payload: profile({
        arena: KITCHEN,
        trophies: 5854,
        donations: 40,
        wins: 10998,
      }),
      fetchedAt: at("06:07:49"),
    }),
  );
  assert.equal(first.outcome, "admitted", JSON.stringify(first.errors));
  assert.equal(
    (await events("arena_changed")).length,
    0,
    "first sight emits nothing",
  );

  const morning = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: ME,
      payload: [
        ladder({
          at: logAt("065220"),
          arena: CRYPT,
          mine: 6000,
          theirs: 6015,
          opponent: "#0PP0000Q",
          result: [0, 3, null],
        }),
        ladder({
          at: logAt("064632"),
          arena: KITCHEN,
          mine: 5970,
          theirs: 5976,
          opponent: "#0PP0000L",
          name: "Jotaro",
          result: [3, 0, 30],
        }),
        ladder({
          at: logAt("063902"),
          arena: KITCHEN,
          mine: 5940,
          theirs: 5940,
          opponent: "#0PP00000",
          result: [2, 1, 30],
        }),
      ],
      fetchedAt: at("07:00:00"),
    }),
  );
  assert.equal(morning.outcome, "admitted", JSON.stringify(morning.errors));
  assert.deepEqual(
    morning.projection.arenaEvidence,
    { arena: KITCHEN.name, battle_time: at("06:39:02") },
    "the newest battle the observer entered with at least the opponent's trophies",
  );
  assert.equal(morning.projection.profileRefreshRequested, false);
  assert.equal(
    (await pollState()).refresh_requested_at,
    null,
    "a Royal Crypt battle as the lower side is the opponent's arena, not ours",
  );
});

test("the first trusted battle in the new arena asks for the profile once; the planner owes it; admission serves it", async () => {
  const trusted = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: ME,
      payload: [
        ladder({
          at: logAt("081125"),
          arena: CRYPT,
          mine: 6000,
          theirs: 6000,
          opponent: "#0PP0000R",
          result: [3, 1, 30],
        }),
        ladder({
          at: logAt("065220"),
          arena: CRYPT,
          mine: 6000,
          theirs: 6015,
          opponent: "#0PP0000Q",
          result: [0, 3, null],
        }),
      ],
      fetchedAt: at("08:20:32"),
    }),
  );
  assert.equal(trusted.outcome, "admitted");
  assert.deepEqual(trusted.projection.arenaEvidence, {
    arena: CRYPT.name,
    battle_time: at("08:11:25"),
  });
  assert.equal(trusted.projection.profileRefreshRequested, true);
  let state = await pollState();
  assert.equal(state.refresh_requested_at.toISOString(), at("08:20:32.000"));

  // The planner's view: the profile was admitted two hours ago, nowhere
  // near its eight-hour cadence, and it is owed now.
  assert.equal(
    refreshRequested(
      { ...state, endpoint: "player" },
      new Date(at("08:21:00")),
    ),
    true,
  );

  // The same log again: nothing inserted, nothing vouched for, stamp kept.
  const again = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: ME,
      payload: [
        ladder({
          at: logAt("081125"),
          arena: CRYPT,
          mine: 6000,
          theirs: 6000,
          opponent: "#0PP0000R",
          result: [3, 1, 30],
        }),
      ],
      fetchedAt: at("08:40:00"),
    }),
  );
  assert.equal(again.projection.arenaEvidence, null);
  assert.equal(again.projection.profileRefreshRequested, undefined);
  state = await pollState();
  assert.equal(state.refresh_requested_at.toISOString(), at("08:20:32.000"));

  // The profile arrives and names the arena: one moment, and the request
  // is served by the admission itself.
  const served = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: ME,
      payload: profile({
        arena: CRYPT,
        trophies: 6030,
        donations: 52,
        wins: 11001,
      }),
      fetchedAt: at("08:45:10"),
    }),
  );
  assert.equal(served.outcome, "admitted");
  state = await pollState();
  assert.equal(state.last_admitted_at.toISOString(), at("08:45:10.000"));
  assert.equal(
    refreshRequested(
      { ...state, endpoint: "player" },
      new Date(at("09:00:00")),
    ),
    false,
    "an admission past the stamp is the answer",
  );
  const moved = await events("arena_changed");
  assert.equal(moved.length, 1);
  // The moment names the battle whose win reached the floor: the 06:46
  // Kitchen-labelled win over a Kitchen opponent (5,970 +30 = 6,000), NOT
  // the later win over a Royal Crypt opponent. The floor came from the
  // player's own gated loss at 06:52 (6,000, no trophy change); the only
  // Royal Crypt snapshot (this poll, 6,030) would have put it too high.
  assert.deepEqual(moved[0].payload, {
    from: KITCHEN.id,
    to: CRYPT.id,
    to_name: CRYPT.name,
    promoted_by: {
      battle_id: moved[0].payload.promoted_by.battle_id,
      battle_time: at("06:46:32.000"),
      type: "PvP",
      opponent: {
        player_tag: "#0PP0000L",
        name: "Jotaro",
        starting_trophies: 5976,
      },
      crowns: 3,
      crowns_against: 0,
      trophy_change: 30,
      trophies_after: 6000,
      arena_floor: 6000,
    },
  });
  assert.equal(moved[0].timing, "exact");
  assert.equal(moved[0].occurred_at.toISOString(), at("06:46:32.000"));
  assert.equal(moved[0].window_start.toISOString(), at("06:07:49.000"));
  assert.equal(moved[0].window_end.toISOString(), at("08:45:10.000"));

  // The same win crossed the 6,000 best-trophies band (5,854 -> 6,030).
  const best = await events("best_trophies_band");
  assert.equal(best.length, 1);
  assert.equal(best[0].payload.best, 6030);
  assert.equal(best[0].payload.band, 6000);
  assert.equal(best[0].payload.crossed_by.battle_time, at("06:46:32.000"));
  assert.equal(best[0].payload.crossed_by.opponent.name, "Jotaro");
  assert.equal(best[0].timing, "exact");

  // Career wins 10,998 -> 11,001: three wins in the window (06:39, 06:46,
  // 08:11) reconcile with the counter, so the 11,000th is the second.
  const wins = await events("career_wins_step");
  assert.equal(wins.length, 1);
  assert.equal(wins[0].payload.step, 11000);
  assert.equal(wins[0].payload.crossed_by.battle_time, at("06:46:32.000"));
  assert.equal(wins[0].occurred_at.toISOString(), at("06:46:32.000"));
});

test("a ranked promotion names the last win stamped with the old league; a loss there names nothing", async () => {
  const RANKER = "#PR0Y0Q2R";
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'ranker')`,
    [RANKER],
  );
  const profileFor = (league, fetchedAt) => {
    const p = profile({ arena: CRYPT, trophies: 6500, league });
    p.tag = RANKER;
    p.name = "ranker";
    return message({
      endpoint: "player",
      entityKey: RANKER,
      payload: p,
      fetchedAt,
    });
  };
  await processResult(ctx.db, profileFor(1, at("01:00:00")));
  // TDuck's shape: wins and losses in league 1, the promoting win at 04:34
  // stamped 1, the battles after it stamped 2.
  const pol = (hhmmss, league, opponent, result, name) =>
    ranked({ at: logAt(hhmmss), league, tag: RANKER, opponent, name, result });
  const log = [
    pol("050501", 2, "#0PP0000L", [0, 1, null]),
    pol("043450", 1, "#0PP0000U", [1, 0, 30], "XTRAXTOR"),
    pol("043137", 1, "#0PP0000R", [0, 1, null]),
    pol("042240", 1, "#0PP00000", [3, 0, 30]),
  ];
  const admitted = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: RANKER,
      payload: log,
      fetchedAt: at("05:06:00"),
    }),
  );
  assert.equal(admitted.outcome, "admitted", JSON.stringify(admitted.errors));
  await processResult(ctx.db, profileFor(2, at("05:07:46")));
  const rows = await playerEvents(
    ctx.db,
    "player_tag = $1 and event_type = 'ranked_promotion'",
    [RANKER],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].timing, "exact");
  assert.equal(rows[0].occurred_at.toISOString(), at("04:34:50.000"));
  assert.equal(rows[0].payload.from, 1);
  assert.equal(rows[0].payload.to, 2);
  assert.equal(rows[0].payload.promoted_by.opponent.name, "XTRAXTOR");
  assert.equal(rows[0].payload.promoted_by.crowns, 1);
  assert.equal(rows[0].payload.promoted_by.trophy_change, 30);
  assert.equal(
    rows[0].payload.promoted_by.trophies_after,
    undefined,
    "ranked carries no trophies",
  );

  // League 2 -> 3 with the last league-2 battle a loss: the crossing is
  // not in the record, and the moment says so by carrying no battle.
  await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: RANKER,
      payload: [pol("060000", 2, "#0PP0000L", [0, 2, null]), ...log],
      fetchedAt: at("06:01:00"),
    }),
  );
  await processResult(ctx.db, profileFor(3, at("07:00:00")));
  const again = await playerEvents(
    ctx.db,
    "player_tag = $1 and event_type = 'ranked_promotion'",
    [RANKER],
  );
  assert.equal(again.length, 2);
  assert.equal(again[1].timing, "estimated");
  assert.equal(again[1].occurred_at, null);
  assert.deepEqual(again[1].payload, { from: 2, to: 3 });
});

test("an arena move with no reachable floor or no crossing win in the window carries no battle and stays estimated", async () => {
  // A second player whose profile moves arena with no recorded battles in
  // between: nothing to name, and the moment says only what it knows.
  const OTHER = "#PR0Y0Q2Q";
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'other')`,
    [OTHER],
  );
  const profileFor = (arena, trophies, fetchedAt) => {
    const p = profile({ arena, trophies });
    p.tag = OTHER;
    p.name = "other";
    return message({
      endpoint: "player",
      entityKey: OTHER,
      payload: p,
      fetchedAt,
    });
  };
  await processResult(ctx.db, profileFor(KITCHEN, 5900, at("03:00:00")));
  const r = await processResult(
    ctx.db,
    profileFor(CRYPT, 6012, at("05:00:00")),
  );
  assert.equal(r.outcome, "admitted");
  const rows = await playerEvents(
    ctx.db,
    "player_tag = $1 and event_type = 'arena_changed'",
    [OTHER],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].timing, "estimated");
  assert.equal(rows[0].occurred_at, null);
  assert.deepEqual(rows[0].payload, {
    from: KITCHEN.id,
    to: CRYPT.id,
    to_name: CRYPT.name,
  });
});

test("a later poll the same day does not re-emit the moment, and a fall in the weekly counter resets once", async () => {
  const later = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: ME,
      payload: profile({ arena: CRYPT, trophies: 6087, donations: 60 }),
      fetchedAt: at("14:27:48"),
    }),
  );
  assert.equal(later.outcome, "admitted");
  assert.equal(
    (await events("arena_changed")).length,
    1,
    "the day row was rewritten; the moment was not",
  );
  assert.equal(
    (await pollState()).refresh_requested_at.toISOString(),
    at("08:20:32.000"),
  );

  // Monday-shaped: the counter falls, once, and the next poll that day
  // compares against the post-reset row, not yesterday's.
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const [hhmmss, donations] of [
    ["01:10:00", 4],
    ["09:10:00", 9],
  ]) {
    const r = await processResult(
      ctx.db,
      message({
        endpoint: "player",
        entityKey: ME,
        payload: profile({ arena: CRYPT, trophies: 6087, donations }),
        fetchedAt: `${nextDay}T${hhmmss}Z`,
      }),
    );
    assert.equal(r.outcome, "admitted");
  }
  const resets = await events("donation_reset");
  assert.equal(resets.length, 1);
  assert.deepEqual(resets[0].payload, {
    donations_before: 60,
    donations_after: 4,
  });
  assert.equal(resets[0].window_start.toISOString(), at("14:27:48.000"));
});

test("verification item 2: the roster that sees the arena move emits arena_changed at its own cadence; the profile after it emits nothing more and owes no refresh", async () => {
  // The state at the end of the tests above: the profile's latest arena
  // is Royal Crypt. The member's own log first carries a win reaching
  // the next arena's floor, then a roster places them in that arena
  // before any profile poll does.
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const NEXT = { id: 54000015, name: "Silent Sanctuary" };
  await ctx.db.query(
    `update poll_state set refresh_requested_at = null where subject_tag = $1 and endpoint = 'player'`,
    [ME],
  );
  const before = (await events("arena_changed")).length;
  const log = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: ME,
      payload: [
        ladder({
          at: `${nextDay.replaceAll("-", "")}T093000.000Z`,
          arena: NEXT,
          mine: 6470,
          theirs: 6500,
          opponent: "#0PP0000V",
          result: [3, 0, 30],
        }),
      ],
      fetchedAt: `${nextDay}T09:35:00Z`,
    }),
  );
  assert.equal(log.outcome, "admitted");
  const { projectClanSeries } = await import("../src/series.mjs");
  const receiptId = await (async () => {
    const { rows } = await ctx.db.query(
      `select receipt_id from api_receipt order by receipt_id desc limit 1`,
    );
    return rows[0].receipt_id;
  })();
  const r = await projectClanSeries(ctx.db, {
    payload: {
      tag: "#2PP0V9YY",
      name: "Refresh Clan",
      memberList: [
        {
          tag: ME,
          name: "promo",
          role: "member",
          trophies: 6500,
          arena: { ...NEXT, rawName: "Arena_15" },
          clanRank: 1,
          previousClanRank: 1,
          donations: 9,
          donationsReceived: 0,
          lastSeen: `${nextDay.replaceAll("-", "")}T093000.000Z`,
        },
      ],
    },
    observedAt: `${nextDay}T09:40:00Z`,
    receiptId,
  });
  assert.equal(r.arenaMoments, 1);
  const moments = await events("arena_changed");
  assert.equal(moments.length, before + 1, "the roster wrote the moment");
  const moment = moments[moments.length - 1];
  assert.equal(moment.payload.to, NEXT.id);
  assert.equal(moment.payload.to_name, NEXT.name);
  assert.equal(moment.payload.from, CRYPT.id);
  assert.equal(
    moment.payload.promoted_by?.trophies_after,
    6500,
    "the crossing battle from the record, as the profile path names it",
  );
  // A later battle in the new arena owes no profile poll: the record
  // already holds the arena.
  const later = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: ME,
      payload: [
        ladder({
          at: `${nextDay.replaceAll("-", "")}T095000.000Z`,
          arena: NEXT,
          mine: 6500,
          theirs: 6500,
          opponent: "#0PP0000U",
          result: [3, 0, 30],
        }),
      ],
      fetchedAt: `${nextDay}T10:00:00Z`,
    }),
  );
  assert.equal(later.projection.profileRefreshRequested, false);
  // The profile catching up: no second moment.
  const prof = await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: ME,
      payload: profile({ arena: NEXT, trophies: 6530, donations: 9 }),
      fetchedAt: `${nextDay}T12:00:00Z`,
    }),
  );
  assert.equal(prof.outcome, "admitted");
  assert.equal((await events("arena_changed")).length, before + 1);
});

test("correction 2: the log catching up with a roster-written moment pins it once; a second delivery changes nothing", async () => {
  // The reverse of the test above: the roster sees the next arena
  // first (09:40), the log delivers the 09:30 crossing win at 09:55.
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const AFTER = { id: 54000016, name: "Dragon Spa" };
  const { projectClanSeries } = await import("../src/series.mjs");
  const { rows: rc } = await ctx.db.query(
    `select receipt_id from api_receipt order by receipt_id desc limit 1`,
  );
  const before = (await events("arena_changed")).length;
  // The roster's window starts at the member's latest observation, the
  // 12:00Z profile poll of the test above; use a later game-day roster.
  const dayAfter = new Date(Date.parse(`${nextDay}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const r = await projectClanSeries(ctx.db, {
    payload: {
      tag: "#2PP0V9YY",
      name: "Refresh Clan",
      memberList: [
        {
          tag: ME,
          name: "promo",
          role: "member",
          trophies: 7000,
          arena: { ...AFTER, rawName: "Arena_16" },
          clanRank: 1,
          previousClanRank: 1,
          donations: 9,
          donationsReceived: 0,
          lastSeen: `${dayAfter.replaceAll("-", "")}T093500.000Z`,
        },
      ],
    },
    observedAt: `${dayAfter}T09:40:00Z`,
    receiptId: rc[0].receipt_id,
  });
  assert.equal(r.arenaMoments, 1);
  let moments = await events("arena_changed");
  assert.equal(moments.length, before + 1);
  let moment = moments[moments.length - 1];
  assert.equal(moment.timing, "estimated");
  assert.equal(moment.payload.promoted_by, undefined, "no battle in hand yet");
  assert.equal(moment.battle_id, null);

  const log = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: ME,
      payload: [
        ladder({
          at: `${dayAfter.replaceAll("-", "")}T093000.000Z`,
          arena: AFTER,
          mine: 6970,
          theirs: 6970,
          opponent: "#0PP0000J",
          result: [3, 0, 30],
        }),
      ],
      fetchedAt: `${dayAfter}T09:55:00Z`,
    }),
  );
  assert.equal(log.outcome, "admitted", JSON.stringify(log.errors));
  assert.equal(log.projection.arenaEvidence?.arena, AFTER.name);
  assert.equal(log.projection.arenaMomentPinned, moment.event_id);
  moments = await events("arena_changed");
  assert.equal(moments.length, before + 1, "pinned, not re-emitted");
  moment = moments[moments.length - 1];
  assert.equal(moment.timing, "exact");
  assert.equal(moment.occurred_at.toISOString(), `${dayAfter}T09:30:00.000Z`);
  assert.equal(moment.payload.promoted_by?.trophies_after, 7000);
  assert.equal(moment.payload.promoted_by?.arena_floor, 7000);

  // A second delivery of the same log: duplicate battles, no evidence,
  // nothing changes.
  const again = await processResult(
    ctx.db,
    message({
      endpoint: "player_battlelog",
      entityKey: ME,
      payload: [
        ladder({
          at: `${dayAfter.replaceAll("-", "")}T093000.000Z`,
          arena: AFTER,
          mine: 6970,
          theirs: 6970,
          opponent: "#0PP0000J",
          result: [3, 0, 30],
        }),
      ],
      fetchedAt: `${dayAfter}T10:25:00Z`,
    }),
  );
  assert.equal(again.outcome, "admitted");
  assert.equal(again.projection.arenaMomentPinned ?? null, null);
  const after = await events("arena_changed");
  assert.equal(after.length, before + 1);
  assert.equal(
    after[after.length - 1].occurred_at.toISOString(),
    `${dayAfter}T09:30:00.000Z`,
  );
});
