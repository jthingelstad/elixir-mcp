/**
 * The control next to the number (3.13.0; feedback #54, #55, #58, #59,
 * #60). One synthetic player reproduces the 2026-09-18 session: a ladder
 * deck at 42% against opponents 0.7 levels down, a war deck at 79%
 * against opponents 1.6 levels down, an arena change with a trophy floor
 * arriving on the same day, and a days-window that clips the first ISO
 * week. Every tool that served one of those numbers now serves the fact
 * that makes it interpretable, and the guard note fires on the confound.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { seedDeck, seedPlayedDeck } from "./deck-rows.mjs";
import { refreshDailyRollups } from "../../ingest/src/rollups.mjs";
import {
  modeSplit,
  singlePlayerNote,
  colosseumMix,
  zeroSeriesNote,
  coverageBasis,
} from "../src/controls.mjs";

let scratch;
let account;
const registry = makeRegistry();
// Tags use the game's own alphabet (0289PYLQGRJCUV): the player table
// checks it.
const F = "#2PYLQG0";
// The second scored player (#62): three months whose LATER step carries
// the arena crossing, so a guard that stops at the first hit misses it.
const G = "#2PYLQG8";
const OPPONENTS = [..."289PYLQGRJ"].map((c) => `#2PYLQGC${c}`);
const call = (name, args = {}) =>
  registry.invoke(name, { db: scratch.db, account }, args);

const DECK_A = Array.from({ length: 8 }, (_, i) => ({
  id: 26000000 + i,
  level: 16,
}));
const DECK_B = Array.from({ length: 8 }, (_, i) => ({
  id: 26000010 + i,
  level: 15,
}));
const DECK_OPP = Array.from({ length: 8 }, (_, i) => ({
  id: 26000020 + i,
  level: 15,
}));

let n = 0;
/** One head-to-head battle, F (or `who`) on side 0, with both decks as rows. */
async function battle({
  who = F,
  at,
  type,
  arena,
  outcome,
  myDeck,
  myLevel,
  oppLevel,
  starting = null,
  trophyChange = null,
  myLeak = null,
  oppLeak = null,
  gameMode = type === "PvP" ? "Ladder" : "CW_Battle_1v1",
}) {
  const id = `ctrl-${String(++n).padStart(4, "0")}`;
  const opp = OPPONENTS[n % OPPONENTS.length];
  await scratch.db.query(
    `insert into battle (battle_id,battle_time,type,type_class,game_mode_name,arena,arena_id)
     values ($1,$2::timestamptz,$3,'pvp',$4,$5,$6)`,
    [id, at, type, gameMode, arena.name, arena.id],
  );
  const myHash = await seedDeck(scratch.db, { battle_time: at, cards: myDeck });
  const oppHash = await seedDeck(scratch.db, {
    battle_time: at,
    cards: DECK_OPP,
  });
  await scratch.db.query(
    `insert into battle_participant
       (battle_id,player_tag,side,outcome,battle_time,type,type_class,deck_hash,deck_avg_level,
        opp_deck_avg_level,starting_trophies,trophy_change,elixir_leaked,crowns)
     values ($1,$2,0,$3,$4::timestamptz,$5,'pvp',$6,$7,$14,$8,$9,$10,1),
            ($1,$11,1,$12,$4::timestamptz,$5,'pvp',$13,$14,$7,$8,null,$15,1)`,
    [
      id,
      who,
      outcome,
      at,
      type,
      myHash,
      myLevel,
      starting,
      trophyChange,
      myLeak,
      opp,
      outcome === "win" ? "loss" : "win",
      oppHash,
      oppLevel,
      oppLeak,
    ],
  );
  await seedPlayedDeck(scratch.db, {
    battle_id: id,
    player_tag: who,
    battle_time: at,
    cards: myDeck,
  });
  await seedPlayedDeck(scratch.db, {
    battle_id: id,
    player_tag: opp,
    battle_time: at,
    cards: DECK_OPP,
  });
  return id;
}

const MAGIC = { id: 54000141, name: "Magic Academy" };
const PIT = { id: 54000142, name: "Ultimate Clash Pit" };
const day = (iso, i, hours = 6) =>
  new Date(Date.parse(iso) + i * hours * 3600_000).toISOString();

before(async () => {
  scratch = await scratchDb("controls");
  await scratch.db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status) values ('controls','approved') returning account_id",
  );
  account = {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  for (const tag of [F, G, ...OPPONENTS])
    await scratch.db.query("insert into player (player_tag) values ($1)", [
      tag,
    ]);
  for (const tag of [F, G])
    await scratch.db.query(
      "insert into recording (subject_type,subject_tag,requested_by) values ('player',$1,$2)",
      [tag, account.accountId],
    );
  for (const a of [MAGIC, PIT])
    await scratch.db.query(
      "insert into arena (arena_id, name) values ($1, $2) on conflict do nothing",
      [a.id, a.name],
    );
  // The Pit's floor, as the record knows it: the lowest trophies any
  // snapshot ever showed there (0102).
  await scratch.db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, arena_id, trophies)
     values ($1, '2026-08-02', 'daily', $2, 12500), ($1, '2026-07-20', 'daily', $3, 12228)`,
    [F, PIT.id, MAGIC.id],
  );

  // July ladder in Magic Academy: 200 battles on deck A, 42% wins, F at
  // 16.00 against 15.30 (gap +0.70), 12,300 trophies. Two hundred so an
  // arena alone clears the curve floor (200 observations a bin).
  for (let i = 0; i < 200; i++)
    await battle({
      at: day("2026-07-20T00:00:00Z", i, 1),
      type: "PvP",
      arena: MAGIC,
      outcome: i % 100 < 42 ? "win" : "loss",
      myDeck: DECK_A,
      myLevel: 16.0,
      oppLevel: 15.3,
      starting: 12300,
      trophyChange: i % 100 < 42 ? 30 : -29,
    });
  // August ladder in the Pit: same deck, same gap, same 42%, higher pool.
  for (let i = 0; i < 200; i++)
    await battle({
      at: day("2026-08-05T00:00:00Z", i, 2.5),
      type: "PvP",
      arena: PIT,
      outcome: i % 100 < 42 ? "win" : "loss",
      myDeck: DECK_A,
      myLevel: 16.0,
      oppLevel: 15.3,
      starting: 12560,
      trophyChange: i % 100 < 42 ? 30 : -29,
    });
  // September war on deck B: 11-3 against opponents 1.62 levels down.
  for (let i = 0; i < 14; i++)
    await battle({
      at: day("2026-09-04T12:00:00Z", i, 12),
      type: "riverRacePvP",
      arena: PIT,
      outcome: i < 11 ? "win" : "loss",
      myDeck: DECK_B,
      myLevel: 15.12,
      oppLevel: 13.5,
    });
  // September ladder on the floor: two losses ON 12,500 (no trophyChange),
  // one clamped from 12,504, one full loss landing on it, a couple of wins.
  const septLadder = [
    ["loss", 12500, null, 17.96, 19.45],
    ["loss", 12500, null, 6.15, 7.96],
    ["loss", 12504, -4, 8.2, 1.53],
    ["loss", 12532, -32, 7.61, 0.21],
    ["win", 12500, 30, 0.0, 1.0],
    ["win", 12530, 31, null, null],
  ];
  for (const [
    i,
    [outcome, starting, change, myLeak, oppLeak],
  ] of septLadder.entries())
    await battle({
      at: day("2026-09-15T12:00:00Z", i, 8),
      type: "PvP",
      arena: PIT,
      outcome,
      myDeck: DECK_A,
      myLevel: 16.0,
      oppLevel: 15.3,
      starting,
      trophyChange: change,
      myLeak,
      oppLeak,
    });
  // A July duel for F (#63): one row for up to three games, no single
  // deck, so it has no deck_hash and sits outside battles_decks' rows.
  await scratch.db.query(
    `insert into battle (battle_id,battle_time,type,type_class,game_mode_name,arena,arena_id)
     values ('ctrl-duel','2026-07-25T12:00:00Z','riverRaceDuel','pvp','CW_Duel_1v1',$1,$2)`,
    [PIT.name, PIT.id],
  );
  // Both sides' leak counters are sums over the duel's two rounds
  // (#65: the differential of two multi-round sums is not a number).
  await scratch.db.query(
    `insert into battle_participant (battle_id,player_tag,side,outcome,battle_time,type,type_class,crowns,elixir_leaked)
     values ('ctrl-duel',$1,0,'loss','2026-07-25T12:00:00Z','riverRaceDuel','pvp',2,8.64),
            ('ctrl-duel',$2,1,'win','2026-07-25T12:00:00Z','riverRaceDuel','pvp',4,6.32)`,
    [F, OPPONENTS[0]],
  );
  await seedPlayedDeck(scratch.db, {
    battle_id: "ctrl-duel",
    player_tag: F,
    battle_time: "2026-07-25T12:00:00Z",
    rounds: [DECK_A, DECK_B],
  });

  // G's three ladder months at F's gap (+0.70, a populated bin): June in
  // Magic Academy at 11,972, July in Magic Academy at 12,300 (+328, a
  // trophies-only step), August in the Pit at 12,536 (the arena
  // crossing, on the LATER step). Twenty a month clears the monthly
  // floor; forty in the Pit so an arena_id read still scores.
  const gMonths = [
    ["2026-06-10T00:00:00Z", MAGIC, 11972, 20],
    ["2026-07-10T00:00:00Z", MAGIC, 12300, 20],
    ["2026-08-10T00:00:00Z", PIT, 12536, 40],
  ];
  for (const [start, arena, starting, count] of gMonths)
    for (let i = 0; i < count; i++)
      await battle({
        who: G,
        at: day(start, i, 6),
        type: "PvP",
        arena,
        outcome: i % 2 === 0 ? "win" : "loss",
        myDeck: DECK_A,
        myLevel: 16.0,
        oppLevel: 15.3,
        starting,
        trophyChange: i % 2 === 0 ? 30 : -29,
      });
});
after(async () => scratch.drop());

test("battles_decks: mode split and level gap beside the win rate, and the rows are marked not comparable (#54)", async () => {
  const res = await call("battles_decks", { player_tag: F, min_battles: 2 });
  assert.equal(res.decks.length, 2);
  const [hogs, mortar] = res.decks;
  assert.equal(hogs.modes.ladder.battles, 406);
  assert.equal(hogs.modes.war, undefined);
  assert.equal(hogs.dominant_mode, "ladder");
  assert.equal(hogs.dominant_mode_share, 1);
  assert.equal(hogs.mean_level_gap, 0.7);
  assert.equal(hogs.own_mean_level, 16);
  assert.equal(hogs.opponent_mean_level, 15.3);
  assert.equal(hogs.level_gap_battles, 406);
  assert.equal(mortar.modes.war.battles, 14);
  assert.equal(mortar.dominant_mode, "war");
  assert.equal(mortar.mean_level_gap, 1.62);
  assert.equal(mortar.win_rate, 0.786);
  assert.equal(res.comparable, false);
  const guard = res.notes[0];
  assert.match(guard, /NOT comparable/);
  assert.match(guard, /100% in ladder \(mean level gap \+0\.70\)/);
  assert.match(guard, /100% in war \(gap \+1\.62\)/);
  // Within one mode the guard is silent and the rows are comparable.
  const ladder = await call("battles_decks", { player_tag: F, mode: "ladder" });
  assert.equal(ladder.comparable, true);
  assert.ok(!ladder.notes.some((l) => /NOT comparable/.test(l)));
});

test("battles_cards: per-row modes and gap, the window's pooled split, and the pooled-mode guard (#54)", async () => {
  const res = await call("battles_cards", {
    player_tag: F,
    perspective: "opponent",
  });
  assert.equal(res.comparable, false);
  assert.equal(res.modes_in_window.ladder.battles, 406);
  assert.equal(res.modes_in_window.ladder.mean_level_gap, 0.7);
  assert.equal(res.modes_in_window.war.battles, 14);
  assert.equal(res.modes_in_window.war.mean_level_gap, 1.62);
  assert.match(res.notes[0], /Pooled across modes with different matchmaking/);
  assert.match(res.notes[0], /ladder 406 \(mean level gap \+0\.70\)/);
  const row = res.cards.find((c) => c.id === 26000020);
  assert.deepEqual(row.modes, { ladder: 406, war: 14 });
  // The pooled gap is the battle-weighted mean of the two modes' gaps.
  assert.ok(row.mean_level_gap > 0.7 && row.mean_level_gap < 0.8);
  const ladder = await call("battles_cards", {
    player_tag: F,
    perspective: "opponent",
    mode: "ladder",
  });
  assert.equal(ladder.comparable, true);
  assert.deepEqual(ladder.modes_in_window, {
    ladder: { battles: 406, mean_level_gap: 0.7 },
  });
});

test("battles_performance: the trophy floor is named and the note fires when a loss touched it (#59)", async () => {
  const res = await call("battles_performance", {
    player_tag: F,
    from: "2026-09-01",
    to: "2026-09-18",
  });
  assert.ok(res.trophy_floor, JSON.stringify(res));
  assert.equal(res.trophy_floor.floor, 12500);
  assert.deepEqual(res.trophy_floor.arena, PIT);
  assert.equal(res.trophy_floor.source, "losses_on_floor");
  assert.equal(res.trophy_floor.floored, true);
  assert.equal(res.trophy_floor.on_floor_losses, 2);
  assert.equal(res.trophy_floor.losses_landing_on_floor, 2);
  assert.equal(res.trophy_floor.ladder_battles, 6);
  assert.deepEqual(res.trophy_floor.trophy_range, {
    lowest: 12500,
    highest: 12561,
  });
  assert.match(
    res.notes[0],
    /stood on the 12,500 trophy floor \(Ultimate Clash Pit\)/,
  );
  assert.match(res.notes[0], /2 ladder losses ON the floor cost nothing/);
  // net_trophies is what the note warns about: +25 from four losses and
  // two wins, because two losses cost nothing.
  assert.equal(res.window.net_trophies, 25);

  // August: the arena's floor is known from the snapshots and never
  // touched, so the block says so and the note stays quiet.
  const aug = await call("battles_performance", {
    player_tag: F,
    from: "2026-08-01",
    to: "2026-08-31",
  });
  assert.equal(aug.trophy_floor.floor, 12500);
  assert.equal(aug.trophy_floor.source, "arena_snapshots");
  assert.equal(aug.trophy_floor.floored, false);
  assert.ok(!aug.notes.some((l) => /trophy floor/.test(l)));
  // A war-only read has no ladder battles and no block.
  const war = await call("battles_performance", { player_tag: F, mode: "war" });
  assert.equal(war.trophy_floor, undefined);
});

test("battles_performance group_by week: the bucket the window clips is marked partial with its span (#60)", async () => {
  const res = await call("battles_performance", {
    player_tag: F,
    from: "2026-08-19",
    to: "2026-08-31",
    group_by: "week",
  });
  const first = res.weekly[0];
  assert.equal(first.iso_week, "2026-W34");
  assert.equal(first.partial, true);
  assert.deepEqual(first.covers, {
    from: "2026-08-19T00:00:00.000Z",
    to: "2026-08-24T00:00:00.000Z",
  });
  // W35 (08-24 to 08-31) sits whole inside a window that covers the
  // whole of 08-31, so it is not marked.
  const last = res.weekly.at(-1);
  assert.equal(last.iso_week, "2026-W35");
  assert.equal(last.partial, undefined);
  assert.equal(last.covers, undefined);
  assert.match(res.notes[0], /Bucket 2026-W34 is partial/);
  // Ending inside a week marks the last bucket too.
  const clipped = await call("battles_performance", {
    player_tag: F,
    from: "2026-08-17",
    to: "2026-08-26T00:00:00Z",
    group_by: "week",
  });
  assert.equal(clipped.weekly[0].partial, undefined);
  assert.equal(clipped.weekly.at(-1).partial, true);
  assert.equal(clipped.weekly.at(-1).covers.to, "2026-08-26T00:00:00.000Z");
});

test("battles_query: elixir is one object with the caveat on it, the differential null on duels (#58, #65, #66)", async () => {
  const res = await call("battles_query", {
    player_tag: F,
    from: "2026-09-15",
    to: "2026-09-18",
    mode: "ladder",
  });
  assert.equal(res.battles.length, 6);
  // The arena's name and its id ride the row together (defect 4, 2026-09-19).
  assert.ok(
    res.battles.every(
      (b) =>
        b.arena.name === PIT.name &&
        b.arena.id === PIT.id &&
        !("arena_id" in b),
    ),
  );
  const standoff = res.battles.find((b) => b.me.elixir?.leaked === 17.96);
  assert.deepEqual(standoff.me.elixir, {
    leaked: 17.96,
    opponent_leaked: 19.45,
    differential: -1.49,
    rounds: 1,
    caveat: standoff.me.elixir.caveat,
  });
  assert.match(standoff.me.elixir.caveat, /Not a skill measure/);
  // The opponent carries its own counter and nothing of the other side.
  assert.equal(standoff.opponents[0].elixir.leaked, 19.45);
  assert.equal(standoff.opponents[0].elixir.opponent_leaked, null);
  assert.equal(standoff.opponents[0].elixir.differential, null);
  assert.ok(!("elixir_leaked" in standoff.me));
  assert.ok(!("elixir_leaked_differential" in standoff.me));
  const waste = res.battles.find((b) => b.me.elixir?.leaked === 7.61);
  assert.equal(waste.me.elixir.differential, 7.4);
  const unreported = res.battles.find((b) => b.me.elixir === null);
  assert.ok(unreported, "an unreported side is null, not an object");
  assert.equal(unreported.opponents[0].elixir, null);
  assert.ok(
    res.notes.some((l) => /neither as a skill measure/.test(l)),
    res.notes.join("\n"),
  );
  // A duel (#65): both counters sum across the rounds, the differential is
  // null, rounds says how many, and the duel note names the field.
  const duelRes = await call("battles_query", { battle_id: "ctrl-duel" });
  const duel = duelRes.battles[0];
  assert.equal(duel.type, "riverRaceDuel");
  assert.equal(duel.me.rounds_played, 2);
  assert.deepEqual(duel.me.elixir, {
    leaked: 8.64,
    opponent_leaked: 6.32,
    differential: null,
    rounds: 2,
    caveat: duel.me.elixir.caveat,
  });
  assert.equal(duel.opponents[0].elixir.leaked, 6.32);
  assert.equal(duel.opponents[0].elixir.rounds, null); // its rounds were not seeded
  assert.ok(
    duelRes.notes.some((l) =>
      /elixir\.leaked sums across rounds for both sides/.test(l),
    ),
    duelRes.notes.join("\n"),
  );
  // Two losses on the floor carry trophy_change null, and the note says why.
  assert.equal(
    res.battles.filter((b) => b.me.trophy_change === null).length,
    2,
  );
  assert.ok(
    res.notes.some((l) => /2 ladder losses carry trophy_change null/.test(l)),
    res.notes.join("\n"),
  );
  // Compact keeps the shape it had: no leak fields either side.
  const compact = await call("battles_query", {
    player_tag: F,
    from: "2026-09-15",
    to: "2026-09-18",
    verbosity: "compact",
  });
  assert.equal(compact.battles[0].me.elixir, undefined);
  assert.equal(compact.battles[0].opponents[0].elixir, undefined);
  assert.ok(!compact.notes.some((l) => /elixir is each/.test(l)));
});

test("battles_performance group_by week: trophy_mode_battles rides beside trophy_battles and the note names the floor weeks (#61)", async () => {
  const res = await call("battles_performance", {
    player_tag: F,
    from: "2026-09-01",
    to: "2026-09-18",
    group_by: "week",
  });
  const floorWeek = res.weekly.find((w) => w.iso_week === "2026-W38");
  assert.ok(floorWeek, JSON.stringify(res.weekly));
  // Six ladder battles, two of them losses ON the floor with no delta.
  assert.equal(floorWeek.trophy_mode_battles, 6);
  assert.equal(floorWeek.trophy_battles, 4);
  assert.equal(
    floorWeek.trophy_battles + res.trophy_floor.on_floor_losses,
    floorWeek.trophy_mode_battles,
  );
  const note = res.notes.find((l) => /with no reported trophy change/.test(l));
  assert.ok(note, JSON.stringify(res.notes));
  assert.match(
    note,
    /^Week 2026-W38 holds 2 trophy-mode battles with no reported trophy change/,
  );
  // A war week has no trophy-mode battles at all, and the count says so.
  const warWeek = res.weekly.find((w) => w.iso_week === "2026-W36");
  assert.equal(warWeek.trophy_mode_battles, 0);
  assert.equal(warWeek.trophy_battles, 0);
  // August: every ladder battle reported a delta, so the two counts agree
  // and the note stays quiet.
  const aug = await call("battles_performance", {
    player_tag: F,
    from: "2026-08-03",
    to: "2026-08-30",
    group_by: "week",
  });
  for (const w of aug.weekly)
    assert.equal(w.trophy_mode_battles, w.trophy_battles);
  assert.ok(!aug.notes.some((l) => /with no reported trophy change/.test(l)));
  // battles_trends carries the same pair on its weeks.
  const trends = await call("battles_trends", {
    segment: { player_tag: F },
    from: "2026-09-14",
    to: "2026-09-18",
    mode: "ladder",
  });
  const tw = trends.weeks.find((w) => w.iso_week === "2026-W38");
  assert.equal(tw.trophy_mode_battles, 6);
  assert.equal(tw.trophy_battles, 4);
  assert.ok(
    trends.notes.some((l) => /^Week 2026-W38 holds 2 trophy-mode/.test(l)),
  );
});

test("battles_decks: duels are itemized under excluded and the shares' denominator reconciles with battles_performance (#63)", async () => {
  const win = { player_tag: F, from: "2026-07-01", to: "2026-09-18" };
  const decks = await call("battles_decks", win);
  assert.deepEqual(decks.excluded, { duels: 1, no_deck: 0 });
  assert.equal(decks.total_battles_in_window, 420);
  const perf = await call("battles_performance", win);
  assert.equal(
    decks.total_battles_in_window +
      decks.excluded.duels +
      decks.excluded.no_deck,
    perf.window.battles,
  );
  assert.equal(perf.window.duel_battles, 1);
  const note = decks.notes.find((l) => /outside these rows/.test(l));
  assert.match(
    note,
    /^1 duel battle is outside these rows \(a duel has no single deck\); total_battles_in_window and share_of_battles are over the 420 head-to-head battles with a deck/,
  );
  // share_of_battles is over the deck-bearing battles, and says so.
  assert.equal(decks.decks[0].share_of_battles, Number((406 / 420).toFixed(3)));
  // A duel-free window: no exclusion, no note.
  const clean = await call("battles_decks", {
    player_tag: F,
    from: "2026-08-01",
    to: "2026-08-31",
  });
  assert.deepEqual(clean.excluded, { duels: 0, no_deck: 0 });
  assert.ok(!clean.notes.some((l) => /outside these rows/.test(l)));
});

test("controls.mjs (3.16.0): the rollup-shaped split, the single-player, colosseum, zero-series and coverage helpers", async () => {
  assert.deepEqual(
    modeSplit([
      { mode_group: "ladder", battles: 3, wins: 2, losses: 1 },
      { mode_group: "ladder", battles: "2", wins: "0", losses: "2" },
      { type: "riverRacePvP", battles: 1, wins: 1, losses: 0 },
    ]),
    {
      ladder: { battles: 5, wins: 2, losses: 3 },
      war: { battles: 1, wins: 1, losses: 0 },
    },
  );
  assert.equal(singlePlayerNote([{ players: 1 }, { players: 2 }]), null);
  assert.match(
    singlePlayerNote([{ players: 1 }, { players: 1 }]),
    /ONE player/,
  );
  assert.equal(singlePlayerNote([]), null);
  assert.deepEqual(
    colosseumMix([{ is_colosseum: true }, { is_colosseum: false }, {}]),
    { colosseum_races: 1, regular_races: 2 },
  );
  assert.equal(
    zeroSeriesNote(
      [{ rated_players: 0 }, { rated_players: 3 }],
      "rated_players",
    ),
    null,
  );
  assert.match(
    zeroSeriesNote(
      [{ rated_players: 0 }, { rated_players: 0 }],
      "rated_players",
    ),
    /nobody was rated/,
  );
  assert.equal(zeroSeriesNote([], "rated_players"), null);

  // coverageBasis: an activity-scope clan with one directly recorded member.
  const CLAN = "#2PYLQGCC";
  await scratch.db.query(
    "insert into clan (clan_tag) values ($1) on conflict do nothing",
    [CLAN],
  );
  await scratch.db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope) values ('clan', $1, $2, 'activity')`,
    [CLAN, account.accountId],
  );
  for (const tag of [F, OPPONENTS[0]])
    await scratch.db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role) values ($1, $2, now(), 'member')`,
      [CLAN, tag],
    );
  const activity = await coverageBasis(scratch.db, CLAN);
  assert.equal(activity.basis, "roster_and_war_only");
  assert.equal(
    activity.members.get(F).log_recorded,
    true,
    "F is recorded directly",
  );
  assert.match(activity.members.get(F).recorded_since, /^2026-07-20T/);
  assert.equal(activity.members.get(OPPONENTS[0]).log_recorded, false);
  await scratch.db.query(
    "update recording set scope = 'comprehensive' where subject_type = 'clan' and subject_tag = $1",
    [CLAN],
  );
  const deep = await coverageBasis(scratch.db, CLAN);
  assert.equal(deep.basis, "recorded");
  assert.equal(deep.members.get(OPPONENTS[0]).log_recorded, true);
  await scratch.db.query("delete from clan_membership where clan_tag = $1", [
    CLAN,
  ]);
});

test("players_summary: the window's mode split, the deck's modes and dominant mode, the floor (Phase 3 item 2)", async () => {
  // Fresh battles so the 30-day window holds them whatever the date: four
  // war wins on deck B, four ladder battles on deck A with two ON the
  // 12,500 floor.
  const recent = (i) =>
    new Date(Date.now() - (3 * 24 - i * 4) * 3600_000).toISOString();
  for (let i = 0; i < 4; i++)
    await battle({
      at: recent(i),
      type: "riverRacePvP",
      arena: PIT,
      outcome: "win",
      myDeck: DECK_B,
      myLevel: 15.12,
      oppLevel: 13.5,
    });
  for (const [i, [outcome, starting, change]] of [
    ["loss", 12500, null],
    ["loss", 12500, null],
    ["win", 12500, 30],
    ["loss", 12530, -30],
    // Fresh battles enough that deck A is the top deck whatever the
    // date: the fixed September ladder battles age out of the 30-day
    // window a day at a time (war deck B led 18-17 on 2026-09-24).
    ["win", 12500, 30],
    ["win", 12530, 30],
    ...Array.from({ length: 8 }, (_, k) => [
      k % 2 ? "loss" : "win",
      12600,
      k % 2 ? -30 : 30,
    ]),
  ].entries())
    await battle({
      at: recent(4 + i),
      type: "PvP",
      arena: PIT,
      outcome,
      myDeck: DECK_A,
      myLevel: 16.0,
      oppLevel: 15.3,
      starting,
      trophyChange: change,
    });
  const { rows: days } = await scratch.db.query(
    `select distinct to_char(battle_time at time zone 'UTC', 'YYYY-MM-DD') as day
       from battle_participant where player_tag = $1 and battle_time > now() - interval '31 days'`,
    [F],
  );
  await refreshDailyRollups(
    scratch.db,
    days.map((d) => ({ playerTag: F, day: d.day })),
  );
  const res = await call("players_summary", { player_tag: F });
  assert.ok(
    res.last_30_days.modes.war.battles >= 4,
    JSON.stringify(res.last_30_days),
  );
  assert.ok(res.last_30_days.modes.ladder.battles >= 4);
  assert.equal(res.trophy_floor.floored, true);
  assert.equal(res.trophy_floor.floor, 12500);
  assert.ok(res.trophy_floor.on_floor_losses >= 2);
  assert.ok(res.top_deck.modes, "the deck carries its split");
  assert.ok(res.top_deck.dominant_mode.mode);
  assert.ok(res.notes.some((l) => /trophy floor/.test(l)));
  // The best deck (war, 11-3 in September plus the four fresh wins) is
  // not the top deck (ladder): both carry modes and the clash note fires.
  assert.ok(res.best_deck, JSON.stringify(res));
  assert.equal(res.best_deck.dominant_mode.mode, "war");
  assert.equal(res.top_deck.dominant_mode.mode, "ladder");
  assert.ok(res.notes.some((l) => /NOT comparable across rows/.test(l)));
  // 3.17.0 (Phase 4 item 9): each deck carries the level gap it fought
  // at, so the note names real gaps (mean level +0.7 vs +1.62 here)
  // instead of "unknown".
  assert.equal(typeof res.top_deck.mean_level_gap, "number");
  assert.equal(typeof res.best_deck.mean_level_gap, "number");
  assert.ok(Math.abs(res.top_deck.mean_level_gap - 0.7) < 0.05);
  const clash = res.notes.find((l) => /NOT comparable across rows/.test(l));
  assert.ok(!/unknown/.test(clash), clash);
  assert.match(clash, /mean level gap \+0\.70.*gap \+1\.62/);
});

test("verbosity is accepted on every tool: a one-size tool answers in full and says so (2026-09-19)", async () => {
  // battles_decks declares no verbosity; the instructions call it the
  // one size control, so agents send it (four refusals in four days).
  const res = await call("battles_decks", {
    player_tag: F,
    from: "2026-09-15",
    to: "2026-09-18",
    verbosity: "compact",
  });
  assert.equal(res.applied.verbosity, "full");
  assert.ok(
    res.notes.some((l) =>
      /battles_decks has one size: verbosity 'compact' was accepted/.test(l),
    ),
    res.notes.join("\n"),
  );
  // 'full' on a one-size tool is silent: nothing to say.
  const full = await call("battles_decks", {
    player_tag: F,
    from: "2026-09-15",
    to: "2026-09-18",
    verbosity: "full",
  });
  assert.equal(full.applied.verbosity, "full");
  assert.ok(!full.notes.some((l) => /has one size/.test(l)));
  // The enum still holds.
  await assert.rejects(
    call("battles_decks", { player_tag: F, verbosity: "tiny" }),
    (e) =>
      e.code === "bad_request" &&
      /must be one of full, compact/.test(e.message),
  );
  // A tool that declares it is untouched: compact still drops.
  const compact = await call("battles_query", {
    player_tag: F,
    from: "2026-09-15",
    to: "2026-09-18",
    verbosity: "compact",
  });
  assert.equal(compact.applied.verbosity, "compact");
  assert.equal(compact.battles[0].me.deck, undefined);
});

test("battles_query: with_card and with_cards match a duel on its rounds' decks (feedback #363)", async () => {
  const win = {
    player_tag: F,
    from: "2026-07-25",
    to: "2026-07-26",
    game_mode: "duel",
  };
  const ids = (res) => res.battles.map((b) => b.battle_id);
  const one = await call("battles_query", { ...win, with_card: DECK_B[0].id });
  assert.ok(ids(one).includes("ctrl-duel"), "a card of round two");
  const same = await call("battles_query", {
    ...win,
    with_cards: [DECK_A[0].id, DECK_A[1].id],
  });
  assert.ok(ids(same).includes("ctrl-duel"), "two cards of one round");
  const split = await call("battles_query", {
    ...win,
    with_cards: [DECK_A[0].id, DECK_B[0].id],
  });
  assert.ok(
    !ids(split).includes("ctrl-duel"),
    "cards from two rounds are not one deck",
  );
});
