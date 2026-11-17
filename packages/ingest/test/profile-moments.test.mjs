/**
 * Profile moments (0286, the owner 2026-11-17): a badge's rung, a 12-win
 * run, a King Tower level, a best challenge run and a maxed card are each
 * a change between two profile reads. The first read writes nothing, a
 * baseline the record holds as null writes nothing (a deploy onto
 * existing snapshots is silent), and only a real rise writes a row.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { playerEvents } from "./event-rows.mjs";
import {
  projectPlayerBadges,
  projectPlayerSnapshot,
} from "../src/snapshots.mjs";
import { projectPlayerCards } from "../src/cards.mjs";
import { scratchDb } from "./helpers.mjs";

let ctx;

before(async () => {
  ctx = await scratchDb("profile_moments");
});

after(async () => ctx.drop());

const PIP = "#0QYPJ8G2";
const ASH = "#0LCRV2PQ";
const ROWAN = "#0GUJ9RY8";
const SAGE = "#0RJ2QC9P";

async function player(tag) {
  await ctx.db.query(
    `insert into player (player_tag) values ($1) on conflict do nothing`,
    [tag],
  );
}

const badge = (name, level, progress = 0, maxLevel = 10) => ({
  name,
  level,
  maxLevel,
  progress,
  target: progress + 10,
});

const badges = (tag, list, at) =>
  projectPlayerBadges(ctx.db, {
    playerTag: tag,
    payload: { tag, badges: list },
    fetchedAt: at,
  });

const ofType = async (tag, type) =>
  playerEvents(ctx.db, "player_tag = $1 and event_type = $2", [tag, type]);

test("badges: the first read is silent; a Mastery level-up writes the rung it crossed, 3 to 6 crossing 5", async () => {
  await player(PIP);
  await badges(
    PIP,
    [
      badge("MasteryHogRider", 3),
      badge("MasteryKnight", 4),
      badge("2v2", 1, 0, 8),
      badge("BattleWins", 2, 0, 8),
    ],
    "2026-11-10T10:00:00Z",
  );
  assert.deepEqual(await ofType(PIP, "badge_earned"), [], "first read");

  await badges(
    PIP,
    [
      badge("MasteryHogRider", 6),
      badge("MasteryKnight", 4),
      badge("2v2", 2, 0, 8),
      badge("BattleWins", 3, 0, 8),
    ],
    "2026-11-11T10:00:00Z",
  );
  const rows = await ofType(PIP, "badge_earned");
  const byName = new Map(rows.map((r) => [r.payload.name, r]));
  // 3 to 6 crosses 5: the rung is 5, the level is what the game says.
  assert.equal(byName.get("MasteryHogRider").step, 5);
  assert.equal(byName.get("MasteryHogRider").payload.level, 6);
  // Any other tiered badge tells every level.
  assert.equal(byName.get("2v2").step, 2);
  // Battle Wins is a row (the ledger is lossless) but crosses no rung.
  assert.equal(byName.get("BattleWins").step, null);

  await badges(
    PIP,
    [
      badge("MasteryHogRider", 7),
      badge("MasteryKnight", 4),
      badge("2v2", 2, 0, 8),
      badge("BattleWins", 3, 0, 8),
    ],
    "2026-11-12T10:00:00Z",
  );
  const seven = (await ofType(PIP, "badge_earned")).find(
    (r) => r.payload.level === 7,
  );
  assert.equal(seven.step, null, "6 to 7 crosses no rung");
});

test("badges: a Mastery badge reaching its top level writes the top as its rung", async () => {
  await player(SAGE);
  await badges(SAGE, [badge("MasteryGoblins", 8)], "2026-11-10T10:00:00Z");
  await badges(SAGE, [badge("MasteryGoblins", 10)], "2026-11-11T10:00:00Z");
  const [row] = await ofType(SAGE, "badge_earned");
  assert.equal(row.step, 10);
});

test("12-win runs: the badge's progress rising is the run; first read and an unchanged count are silent", async () => {
  await player(ASH);
  await badges(
    ASH,
    [badge("Grand12Wins", 1, 3, 8), badge("MasteryKnight", 2)],
    "2026-11-10T10:00:00Z",
  );
  assert.deepEqual(await ofType(ASH, "twelve_win_run"), [], "first read");

  await badges(
    ASH,
    [badge("Grand12Wins", 1, 3, 8), badge("MasteryKnight", 3)],
    "2026-11-11T10:00:00Z",
  );
  assert.deepEqual(await ofType(ASH, "twelve_win_run"), [], "no rise");

  await badges(
    ASH,
    [badge("Grand12Wins", 1, 5, 8), badge("MasteryKnight", 3)],
    "2026-11-12T10:00:00Z",
  );
  const [run] = await ofType(ASH, "twelve_win_run");
  assert.deepEqual(run.payload, {
    name: "Grand12Wins",
    runs: 5,
    runs_before: 3,
  });

  // A 12-win badge new on a profile the record already holds: its first
  // run, with no count before it.
  await badges(
    ASH,
    [
      badge("Grand12Wins", 1, 5, 8),
      badge("MasteryKnight", 3),
      badge("Classic12Wins", 1, 1, 8),
    ],
    "2026-11-13T10:00:00Z",
  );
  const classic = (await ofType(ASH, "twelve_win_run")).find(
    (r) => r.payload.name === "Classic12Wins",
  );
  assert.equal(classic.payload.runs, 1);
  assert.equal(classic.payload.runs_before ?? null, null);
});

test("King Tower and best challenge run: a null baseline is silent (a deploy onto old snapshots), a rise is a row", async () => {
  await player(ROWAN);
  const profile = (king, best) => ({
    tag: ROWAN,
    name: "Rowan",
    battleCount: 100,
    trophies: 6000,
    ...(king === undefined ? {} : { kingTowerLevel: king }),
    ...(best === undefined ? {} : { challengeMaxWins: best }),
  });
  // A snapshot from before the record kept these: no baseline.
  await projectPlayerSnapshot(ctx.db, {
    playerTag: ROWAN,
    payload: profile(undefined, undefined),
    fetchedAt: "2026-11-08T10:00:00Z",
  });
  await projectPlayerSnapshot(ctx.db, {
    playerTag: ROWAN,
    payload: profile(14, 7),
    fetchedAt: "2026-11-09T10:00:00Z",
  });
  assert.deepEqual(await ofType(ROWAN, "king_tower_leveled"), []);
  assert.deepEqual(await ofType(ROWAN, "challenge_best_run"), []);

  // The same values again: nothing.
  await projectPlayerSnapshot(ctx.db, {
    playerTag: ROWAN,
    payload: profile(14, 7),
    fetchedAt: "2026-11-10T10:00:00Z",
  });
  assert.deepEqual(await ofType(ROWAN, "king_tower_leveled"), []);

  await projectPlayerSnapshot(ctx.db, {
    playerTag: ROWAN,
    payload: profile(15, 9),
    fetchedAt: "2026-11-11T10:00:00Z",
  });
  const [king] = await ofType(ROWAN, "king_tower_leveled");
  assert.deepEqual(king.payload, { level: 15, prior_level: 14 });
  const [best] = await ofType(ROWAN, "challenge_best_run");
  assert.deepEqual(best.payload, { best: 9, best_before: 7 });
  // Stamped at the read that saw it, after the read before it.
  assert.equal(king.window_end.toISOString(), "2026-11-11T10:00:00.000Z");
});

test("a maxed card: the level-up that reached the top, never a card first seen there", async () => {
  const tag = "#0PQ2VY";
  await player(tag);
  await ctx.db.query(
    `insert into card (card_id, name, kind, rarity, max_level)
     values (26000021, 'Hog Rider', 'card', 'rare', 14),
            (26000000, 'Knight', 'card', 'common', 16)
     on conflict (card_id) do nothing`,
  );
  const collection = (hog, knight) => ({
    tag,
    cards: [
      { id: 26000021, name: "Hog Rider", level: hog, maxLevel: 14, count: 0 },
      ...(knight === undefined
        ? []
        : [
            {
              id: 26000000,
              name: "Knight",
              level: knight,
              maxLevel: 16,
              count: 0,
            },
          ]),
    ],
  });
  await projectPlayerCards(ctx.db, {
    playerTag: tag,
    payload: collection(13),
    fetchedAt: "2026-11-10T10:00:00Z",
  });
  // Hog Rider (rare, maxLevel 14) to its top; Knight arrives already maxed.
  await projectPlayerCards(ctx.db, {
    playerTag: tag,
    payload: collection(14, 16),
    fetchedAt: "2026-11-11T10:00:00Z",
  });
  const rows = await ofType(tag, "card_maxed");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.card_id, 26000021);
  assert.equal(rows[0].payload.level, 16, "on the shown scale");
});
