/**
 * An opened session as the website draws it (2026-11-13): the page of a
 * sitting's games newest first, with the deck each was played with, a
 * 2v2's teammate and a duel's games, read in a fixed number of statements
 * however many games the page holds. An agent's read (no `detail`) is the
 * shape it always was.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  buildTimeline,
  subjectsFor,
  readTimelineEvidence,
} from "../src/activity/entries.mjs";
import { seedDeck, seedPlayedDeck } from "./deck-rows.mjs";

// Made-up tags: this repository is public.
const ME = "#0QJ29VYL";
const MATE = "#0VY8RUJ2";
const FOE = "#0P2GQ28C";
const FOE2 = "#0LCJ2Y8U";
const NICK = "A Nickname Only Its Author Sees";
const FROM = Date.parse("2026-11-03T18:00:00Z");
const at = (n) => new Date(FROM + n * 60000).toISOString();
const id = (n) => `detail-${String(n).padStart(3, "0")}`;
const CARDS_A = [
  26000021, 26000010, 26000030, 28000000, 26000038, 27000000, 26000014,
  28000011,
].map((c, i) => ({ id: c, name: `Card A${i}` }));
const CARDS_B = [
  26000004, 26000003, 26000017, 26000012, 26000018, 26000000, 28000008,
  27000002,
].map((c, i) => ({ id: c, name: `Card B${i}` }));

let scratch, db, owner;
const GAMES = 26; // past one page of 25

async function participant(battle, tag, side, minute, extra = {}) {
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, battle_time, side, type, type_class, crowns,
        trophy_change, outcome, deck_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      battle,
      tag,
      at(minute),
      side,
      extra.type ?? "PvP",
      extra.type_class ?? "pvp",
      extra.crowns ?? null,
      extra.trophy_change ?? null,
      extra.outcome ?? null,
      extra.deck_hash ?? null,
    ],
  );
}

before(async () => {
  scratch = await scratchDb("timeline_evidence_detail");
  db = scratch.db;
  for (const [tag, name] of [
    [ME, "Juniper"],
    [MATE, "Hazel"],
    [FOE, "<b>Rowan</b>"],
    [FOE2, "Larch"],
  ])
    await db.query("insert into player (player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
  owner = (
    await db.query(
      "insert into account (email_hash,status,timezone) values ('detail-owner','approved','UTC') returning account_id",
    )
  ).rows[0].account_id;
  await db.query(
    "insert into claim (account_id,player_tag,status,notify) values ($1,$2,'unverified',true)",
    [owner, ME],
  );
  await db.query(
    "insert into player_nickname (account_id, player_tag, nickname) values ($1,$2,$3)",
    [owner, FOE, NICK],
  );
  const hashA = await seedDeck(db, { battle_time: at(0), cards: CARDS_A });
  const hashB = await seedDeck(db, { battle_time: at(0), cards: CARDS_B });
  // 1v1s: the first 20 with deck A, then deck B.
  for (let n = 1; n <= GAMES - 2; n++) {
    const b = id(n);
    await db.query(
      "insert into battle (battle_id,battle_time,type,type_class,created_at) values ($1,$2,'PvP','pvp',$3)",
      [b, at(n), at(n + 1)],
    );
    const win = n % 3 !== 0;
    const hash = n <= 20 ? hashA : hashB;
    await participant(b, ME, 0, n, {
      crowns: win ? 2 : 0,
      outcome: win ? "win" : "loss",
      trophy_change: win ? 30 : -29,
      deck_hash: hash,
    });
    await seedPlayedDeck(db, {
      battle_id: b,
      player_tag: ME,
      cards: n <= 20 ? CARDS_A : CARDS_B,
    });
    await participant(b, FOE, 1, n, { crowns: win ? 1 : 2 });
  }
  // A 2v2: a teammate beside, two on the other side.
  const two = id(GAMES - 1);
  await db.query(
    "insert into battle (battle_id,battle_time,type,type_class,created_at) values ($1,$2,'clanMate2v2','pvp',$3)",
    [two, at(GAMES - 1), at(GAMES)],
  );
  await participant(two, ME, 0, GAMES - 1, {
    type: "clanMate2v2",
    crowns: 1,
    outcome: "win",
  });
  await participant(two, MATE, 0, GAMES - 1, {
    type: "clanMate2v2",
    crowns: 1,
  });
  await participant(two, FOE, 1, GAMES - 1, { type: "clanMate2v2", crowns: 0 });
  await participant(two, FOE2, 1, GAMES - 1, {
    type: "clanMate2v2",
    crowns: 0,
  });
  // A duel of three games, the last level on crowns.
  const duel = id(GAMES);
  await db.query(
    "insert into battle (battle_id,battle_time,type,type_class,created_at) values ($1,$2,'riverRaceDuel','pvp',$3)",
    [duel, at(GAMES), at(GAMES + 1)],
  );
  await participant(duel, ME, 0, GAMES, {
    type: "riverRaceDuel",
    type_class: "pvp",
    crowns: 3,
    outcome: "win",
  });
  await participant(duel, FOE2, 1, GAMES, {
    type: "riverRaceDuel",
    type_class: "pvp",
    crowns: 3,
  });
  for (const [tag, crowns] of [
    [ME, [1, 0, 2]],
    [FOE2, [0, 1, 2]],
  ])
    for (const [i, c] of crowns.entries())
      await db.query(
        "insert into battle_participant_round (battle_id, player_tag, round, crowns) values ($1,$2,$3,$4)",
        [duel, tag, i + 1, c],
      );
});
after(async () => scratch.drop());

async function sitting() {
  const built = await buildTimeline(db, await subjectsFor(db, owner), {
    fromMs: FROM,
    toMs: FROM + 3 * 3600_000,
    accountId: owner,
    timezone: "UTC",
    interactive: true,
  });
  const item = built.timeline.find((x) => x.kind === "battle_session");
  assert.ok(item, JSON.stringify(built.timeline.map((x) => x.kind)));
  assert.equal(item.evidence.count, GAMES);
  return item;
}

/** A client that counts the statements a read sends. */
function counting() {
  const sent = [];
  return {
    sent,
    db: {
      query: (text, params) => {
        sent.push(typeof text === "string" ? text : text.text);
        return db.query(text, params);
      },
    },
  };
}

test("the website's page is newest first, with decks, a teammate and a duel's games", async () => {
  const item = await sitting();
  const page = await readTimelineEvidence(db, item, {
    expectedVersion: item.evidence.version,
    detail: true,
  });
  assert.equal(page.order, "newest_first");
  assert.equal(page.battles.length, 25);
  assert.deepEqual(
    page.battles.slice(0, 3).map((b) => b.battle_id),
    [id(GAMES), id(GAMES - 1), id(GAMES - 2)],
  );
  const [duel, two, last] = page.battles;
  assert.deepEqual(duel.games, [
    { round: 1, crowns: 1, against: 0, outcome: "win" },
    { round: 2, crowns: 0, against: 1, outcome: "loss" },
    // Level on crowns: the tiebreak is the towers', which this read
    // leaves to the battle page rather than guess.
    { round: 3, crowns: 2, against: 2, outcome: null },
  ]);
  assert.equal(duel.deck, undefined, "no deck row kept for a duel");
  assert.deepEqual(two.teammates, [{ player_tag: MATE, name: "Hazel" }]);
  assert.deepEqual(
    two.opponents.map((o) => o.player_tag).sort(),
    [FOE, FOE2].sort(),
  );
  assert.equal(page.decks.length, 2);
  assert.equal(page.decks[last.deck].cards.length, 8);
  const ids = (d) => d.cards.map((c) => c.id).sort();
  assert.deepEqual(ids(page.decks[last.deck]), CARDS_B.map((c) => c.id).sort());
  assert.deepEqual(
    ids(page.decks[page.battles.at(-1).deck]),
    CARDS_A.map((c) => c.id).sort(),
  );
  assert.ok(page.decks.every((d) => "label" in d));
  // Game names only: a nickname is its account's own.
  assert.ok(!JSON.stringify(page).includes(NICK));
  assert.equal(page.next_offset, 25);
  const older = await readTimelineEvidence(db, item, {
    offset: 25,
    expectedVersion: item.evidence.version,
    detail: true,
  });
  assert.deepEqual(
    older.battles.map((b) => b.battle_id),
    [id(1)],
  );
  assert.equal(older.next_offset, null);
});

test("the opened session's read is a fixed number of statements, however many games", async () => {
  const item = await sitting();
  const full = counting();
  await readTimelineEvidence(full.db, item, {
    expectedVersion: item.evidence.version,
    detail: true,
  });
  const one = counting();
  await readTimelineEvidence(one.db, item, {
    offset: 25,
    expectedVersion: item.evidence.version,
    detail: true,
  });
  // The page, its links, its opponents, its decks and teammates and
  // games, and the decks' names: five, never one a game. The archetype
  // vocabulary is cached per client, and the web's client is leased per
  // request, so a cold read adds its four: nine in all.
  const budget = 9;
  assert.ok(full.sent.length <= budget, full.sent.join("\n---\n"));
  assert.equal(full.sent.length, one.sent.length, "25 games cost what 1 does");
  // Scoped by battle ids and the one player: never a batch of players.
  assert.ok(
    full.sent.every((q) => !/player_tag\s*=\s*any\(/i.test(q)),
    "no per-player batch",
  );
});

test("an agent's read keeps its played order and its shape", async () => {
  const item = await sitting();
  const page = await readTimelineEvidence(db, item, {
    expectedVersion: item.evidence.version,
  });
  assert.equal(page.battles[0].battle_id, id(1));
  assert.equal(page.order, undefined);
  assert.equal(page.decks, undefined);
  assert.ok(page.battles.every((b) => !("deck" in b) && !("games" in b)));
});
