import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestBattlelog, canonicalizeBattle } from "../src/battles.mjs";
import { canonicalBattleTime } from "../src/battle-time.mjs";
import { fixture, fixtureMeta, scratchDb, seedReceipt } from "./helpers.mjs";

let ctx;
let receiptId;
let meta;

before(async () => {
  ctx = await scratchDb("battles");
  receiptId = await seedReceipt(ctx.db);
  meta = await fixtureMeta();
});

after(async () => ctx.drop());

test("canonical battle time is pinned", () => {
  assert.equal(
    canonicalBattleTime("20260903T081553.000Z"),
    "2026-09-03T08:15:53Z",
  );
  assert.throws(() => canonicalBattleTime("2026-09-03T08:15:53Z"));
});

test("boat + duel log ingests; duel is ONE battle with rounds", async () => {
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const observer = meta["player_battlelog/with_boat_and_duel.json"].entity_key;
  const result = await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: log,
  });
  assert.equal(result.battlesSeen, log.length);
  assert.ok(result.battlesInserted > 0);

  const { rows: duels } = await ctx.db.query(
    `select bp.deck_hash,
            (select count(distinct pc.round)::int from battle_participant_card pc
              where pc.battle_id = bp.battle_id and pc.player_tag = bp.player_tag) as rounds
     from battle b
     join battle_participant bp on bp.battle_id = b.battle_id
     where b.type like 'riverRaceDuel%'`,
  );
  assert.ok(duels.length >= 2, "duel participants present");
  for (const d of duels) {
    assert.ok(d.rounds >= 2, "duel stores each round's cards");
    assert.equal(d.deck_hash, null, "duel has no single deck identity");
  }

  const { rows: boats } = await ctx.db.query(
    `select type_class from battle where type like 'boatBattle%'`,
  );
  assert.ok(boats.length > 0);
  assert.ok(boats.every((b) => b.type_class === "boat"));
});

test("re-ingest is idempotent", async () => {
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const observer = meta["player_battlelog/with_boat_and_duel.json"].entity_key;
  const beforeCount = (await ctx.db.query("select count(*)::int n from battle"))
    .rows[0].n;
  const result = await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: log,
  });
  assert.equal(result.battlesInserted, 0);
  const afterCount = (await ctx.db.query("select count(*)::int n from battle"))
    .rows[0].n;
  assert.equal(afterCount, beforeCount);
});

test("re-ingest WRITES nothing: no new tuple versions, no rollup pairs", async () => {
  // xmin is the transaction that wrote the row version; an unchanged
  // resubmission must leave every xmin where it was. Before 2026-09-11
  // the enrich upsert rewrote every conflicting row (~8 writes per real
  // insert), and the rollup refresh rebuilt every pair in the payload.
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const observer = meta["player_battlelog/with_boat_and_duel.json"].entity_key;
  const versions = async () =>
    (
      await ctx.db.query(`
        select 'b' as t, battle_id as k, xmin::text as v from battle
        union all
        select 'p', battle_id || '|' || player_tag, xmin::text from battle_participant
        union all
        select 'pl', player_tag, xmin::text from player
        order by 1, 2`)
    ).rows;
  const before = await versions();
  const result = await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: log,
  });
  assert.deepEqual(await versions(), before, "no row version moved");
  assert.deepEqual(result.affectedPairs, [], "nothing to roll up");
});

test("second observer dedupes to the same battles and writes no observation rows", async () => {
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const beforeCount = (await ctx.db.query("select count(*)::int n from battle"))
    .rows[0].n;
  const result = await ingestBattlelog(ctx.db, {
    observerTag: "#2PP0V90Y",
    receiptId,
    payload: log,
  });
  assert.equal(result.battlesInserted, 0, "same battles, no new rows");
  const afterCount = (await ctx.db.query("select count(*)::int n from battle"))
    .rows[0].n;
  assert.equal(afterCount, beforeCount);
  // Two observers delivered the same battles; the battles themselves are
  // unchanged (battle_observation retired 2026-09-12, dropped in 0094).
});

test("2v2 battles carry four participants, symmetrically", async () => {
  const log = await fixture("player_battlelog/with_clanmate_2v2.json");
  const observer = meta["player_battlelog/with_clanmate_2v2.json"].entity_key;
  await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: log,
  });
  const { rows } = await ctx.db.query(
    `select b.battle_id, count(*)::int participants,
            count(*) filter (where bp.side = 0)::int team,
            count(*) filter (where bp.side = 1)::int opp
     from battle b join battle_participant bp on bp.battle_id = b.battle_id
     where b.type = 'clanMate2v2' group by b.battle_id`,
  );
  assert.ok(rows.length > 0, "2v2 battles ingested");
  for (const r of rows) {
    assert.equal(r.participants, 4);
    assert.equal(r.team, 2);
    assert.equal(r.opp, 2);
  }
});

test("outcome precedence invariants hold across every ingested row", async () => {
  const { rows } = await ctx.db.query(
    `select b.type_class, bp.trophy_change, bp.outcome,
            (select o.trophy_change from battle_participant o
              where o.battle_id = bp.battle_id and o.side <> bp.side
              limit 1) as other_change
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id`,
  );
  assert.ok(rows.length > 50);
  for (const r of rows) {
    assert.ok(["win", "loss", "draw", "unresolved"].includes(r.outcome));
    if (
      r.type_class === "pvp" &&
      r.trophy_change !== null &&
      r.trophy_change !== 0 &&
      // The sign is a verdict only where the two sides moved opposite
      // ways; a Path of Legends draw moves both down (see below).
      r.other_change !== null &&
      Math.sign(r.other_change) !== Math.sign(r.trophy_change)
    ) {
      assert.equal(r.outcome, r.trophy_change > 0 ? "win" : "loss");
    }
  }
});

// The raw API can hand back a battle both sides LOST: Path of Legends
// penalises both players for a draw, and the payload behind this shape was
// read on 2026-09-22 (team crowns 3 king 0 trophyChange -15; opponent
// crowns 3 king 0 trophyChange -14). Reading each side's sign alone made
// the record say both players lost, which the game cannot produce.
test("a Path of Legends draw that penalises BOTH players is a draw, not two losses", async () => {
  const log = await fixture("player_battlelog/with_path_of_legend.json");
  const source =
    log.find((b) => b.type === "pathOfLegend") ??
    log.find((b) => b.type === "PvP") ??
    log[0];
  const entry = structuredClone(source);
  entry.battleTime = "20260914T130806.000Z";
  entry.team[0].crowns = 3;
  entry.team[0].trophyChange = -15;
  entry.opponent[0].crowns = 3;
  entry.opponent[0].trophyChange = -14;
  await ingestBattlelog(ctx.db, {
    observerTag: entry.team[0].tag,
    receiptId,
    payload: [entry],
  });
  const { battle } = canonicalizeBattle(entry);
  const { rows } = await ctx.db.query(
    `select player_tag, outcome, trophy_change from battle_participant
      where battle_id = $1 order by player_tag`,
    [battle.battle_id],
  );
  assert.equal(rows.length, 2, "both participants recorded");
  for (const r of rows)
    assert.equal(
      r.outcome,
      "draw",
      `${r.player_tag} at ${r.trophy_change} must not read as a loss`,
    );
});

// The ordinary case keeps working: opposite signs still decide it.
test("opposite-signed trophy changes still decide the battle", async () => {
  const log = await fixture("player_battlelog/with_path_of_legend.json");
  const entry = structuredClone(
    log.find((b) => b.type === "pathOfLegend") ?? log[0],
  );
  entry.battleTime = "20260914T140806.000Z";
  entry.team[0].crowns = 1;
  entry.team[0].trophyChange = 30;
  entry.opponent[0].crowns = 1;
  entry.opponent[0].trophyChange = -28;
  await ingestBattlelog(ctx.db, {
    observerTag: entry.team[0].tag,
    receiptId,
    payload: [entry],
  });
  const { battle } = canonicalizeBattle(entry);
  const { rows } = await ctx.db.query(
    `select player_tag, outcome from battle_participant
      where battle_id = $1`,
    [battle.battle_id],
  );
  const outcomes = rows.map((r) => r.outcome).sort();
  assert.deepEqual(
    outcomes,
    ["loss", "win"],
    "equal crowns but opposite trophy signs is still decided",
  );
});

test("enrich-on-dedup fills missing fields and never overwrites", async () => {
  const log = await fixture("player_battlelog/with_path_of_legend.json");
  const observer = meta["player_battlelog/with_path_of_legend.json"].entity_key;
  const entry = structuredClone(log.find((b) => b.type === "PvP") ?? log[0]);

  // First observation arrives thin: no elixirLeaked anywhere.
  const thin = structuredClone(entry);
  for (const p of [...(thin.team ?? []), ...(thin.opponent ?? [])])
    delete p.elixirLeaked;
  await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: [thin],
  });

  const { battle } = canonicalizeBattle(entry);
  const q = `select elixir_leaked from battle_participant where battle_id = $1 and elixir_leaked is not null`;
  assert.equal(
    (await ctx.db.query(q, [battle.battle_id])).rows.length,
    0,
    "thin first",
  );

  // Full observation enriches the missing field.
  await ingestBattlelog(ctx.db, {
    observerTag: "#2PP0V90Y",
    receiptId,
    payload: [entry],
  });
  const enriched = (await ctx.db.query(q, [battle.battle_id])).rows.length;
  const hasLeak = [...(entry.team ?? []), ...(entry.opponent ?? [])].filter(
    (p) => p.elixirLeaked !== undefined,
  ).length;
  assert.equal(enriched, hasLeak, "missing fields filled by second observer");
});

test("empty battlelog is a clean no-op", async () => {
  const result = await ingestBattlelog(ctx.db, {
    observerTag: "#9JQ0U989",
    receiptId,
    payload: await fixture("player_battlelog/empty.json"),
  });
  assert.deepEqual(result, {
    battlesSeen: 0,
    battlesSkipped: 0,
    battlesInserted: 0,
    facts: 0,
    captureAudit: { audited: false, gap: false },
    arenaEvidence: null,
    affectedPairs: [],
  });
});

test("the high-water mark: a live poll drops every battle its log already delivered before touching a table, and a full log past the mark is a gap", async () => {
  // A fresh observer with a log shifted into its own time range, so no
  // battle here collides with the fixtures' other observers.
  const base = await fixture("player_battlelog/with_boat_and_duel.json");
  const observer = "#PY2029";
  const shift = (log, hours) =>
    log.map((e) => {
      const t = new Date(
        canonicalBattleTime(e.battleTime).replace("Z", ".000Z"),
      );
      t.setUTCFullYear(2031);
      t.setUTCHours(t.getUTCHours() + hours);
      const iso = t.toISOString().replace(/[-:]/g, "").replace(".000", ".000");
      const team = e.team.map((p, i) =>
        i === 0 ? { ...p, tag: observer } : p,
      );
      return { ...e, battleTime: iso, team };
    });
  const log = shift(base, 0);
  const poll = (payload, highWater) =>
    ingestBattlelog(ctx.db, {
      observerTag: observer,
      receiptId,
      payload,
      highWater,
    });

  // First live poll: no mark yet, everything inserts, nothing skipped,
  // and the mark lands on the newest battle.
  const first = await poll(log, true);
  assert.equal(first.battlesSkipped, 0);
  assert.ok(first.battlesInserted > 0);
  assert.deepEqual(first.captureAudit, { audited: false, gap: false });
  const { rows: mark } = await ctx.db.query(
    `select battle_time from battlelog_high_water where observer_tag = $1`,
    [observer],
  );
  assert.equal(mark.length, 1);

  // Second live poll of the same log: every battle is at or before the
  // mark - skipped before any table is touched, no gap.
  const second = await poll(log, true);
  assert.equal(second.battlesSkipped, log.length, "all skipped");
  assert.equal(second.battlesInserted, 0);
  assert.deepEqual(second.captureAudit, { audited: true, gap: false });
  assert.deepEqual(second.affectedPairs, []);

  // A log whose OLDEST battle is newer than the mark has rolled past
  // battles this observer never delivered: audited as a gap.
  const later = shift(base, 24 * 30);
  const third = await poll(later, true);
  assert.equal(third.battlesSkipped, 0);
  assert.deepEqual(third.captureAudit, { audited: true, gap: true });

  // Replayed history: the mark is neither consulted nor moved - an old
  // payload that the mark would have dropped still records.
  const older = shift(base, -24 * 30);
  const replay = await poll(older, false);
  assert.equal(replay.battlesSkipped, 0);
  assert.ok(replay.battlesInserted > 0, "history still lands");
  const { rows: after } = await ctx.db.query(
    `select battle_time from battlelog_high_water where observer_tag = $1`,
    [observer],
  );
  assert.ok(
    after[0].battle_time > mark[0].battle_time,
    "the mark moved forward with the later log, and not back with the replay",
  );
});

// The 0011 display-level test replayed that migration's SQL against
// battle_participant.deck; the column left in 0097 (the levels live on
// battle_participant_card.level, pinned by deck-cards.test.mjs). Like
// 0012 below, the backfill ran once and history is immutable.
// The 0012 repair test (pre-cutoff raw decks convert once) is retired
// with 0094: it replayed the migration's SQL against the current schema,
// and that SQL reads battle_observation, which no longer exists. The
// repair ran once in production on 2026-09-04 and migration history is
// immutable; nothing left to guard.
test("battlelog participants stamp player names (fill nulls, never overwrite)", async () => {
  const payload = await fixture("player_battlelog/with_path_of_legend.json");
  const observer = meta["player_battlelog/with_path_of_legend.json"].entity_key;
  const named = payload
    .flatMap((e) => [...(e.team ?? []), ...(e.opponent ?? [])])
    .find(
      (p) =>
        p.tag &&
        p.name &&
        p.tag.toUpperCase().replace("O", "0") !== observer.toUpperCase(),
    );
  assert.ok(named, "fixture has a named participant");
  const namedTag = named.tag.toUpperCase().replace("O", "0");

  // Pre-set a DIFFERENT name for the observer: battlelog must not clobber it.
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'Authoritative Name')
     on conflict (player_tag) do update set name = 'Authoritative Name'`,
    [observer],
  );
  await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload,
  });
  const { rows } = await ctx.db.query(
    `select name from player where player_tag = $1`,
    [namedTag],
  );
  assert.equal(rows[0].name, named.name, "opponent name filled from battlelog");
  const { rows: obs } = await ctx.db.query(
    `select name from player where player_tag = $1`,
    [observer],
  );
  assert.equal(
    obs[0].name,
    "Authoritative Name",
    "existing name never overwritten",
  );
});

// 0151: the two fields the manifest named as Tier 2 and the record threw
// away. The duel one matters most - the public docs told players a duel's
// tower hitpoints "describe the final round only" and that it "has no
// differential", presenting a gap in the record as a property of duels.
test("0151: a duel's per-round results land, so round two can be answered", async () => {
  const log = await fixture("player_battlelog/with_boat_and_duel.json");
  const observer = meta["player_battlelog/with_boat_and_duel.json"].entity_key;
  await ingestBattlelog(ctx.db, {
    observerTag: observer,
    receiptId,
    payload: log,
  });

  const duel = log.find((e) =>
    [...(e.team ?? []), ...(e.opponent ?? [])].some((p) =>
      Array.isArray(p.rounds),
    ),
  );
  const { battle } = canonicalizeBattle(duel);
  const { rows } = await ctx.db.query(
    `select player_tag, round, crowns, king_tower_hp,
            princess_tower_hp_1, princess_tower_hp_2, elixir_leaked
       from battle_participant_round where battle_id = $1
      order by player_tag, round`,
    [battle.battle_id],
  );
  assert.equal(rows.length, 4, "two participants x two rounds");

  // Every round row reproduces the API's own numbers for that round.
  for (const side of ["team", "opponent"]) {
    for (const p of duel[side]) {
      p.rounds.forEach((r, i) => {
        const got = rows.find(
          (x) => x.player_tag === p.tag && x.round === i + 1,
        );
        assert.ok(got, `${p.tag} round ${i + 1} recorded`);
        assert.equal(got.crowns, r.crowns, `${p.tag} r${i + 1} crowns`);
        assert.equal(
          got.king_tower_hp,
          r.kingTowerHitPoints,
          `${p.tag} r${i + 1} king`,
        );
        assert.equal(
          Number(got.elixir_leaked),
          r.elixirLeaked,
          `${p.tag} r${i + 1} elixir`,
        );
      });
    }
  }

  // The thing the docs said could not be done: a per-round differential,
  // and a per-round result that the summed top-level crowns hide.
  const byRound = (tag, n) =>
    rows.find((x) => x.player_tag === tag && x.round === n);
  const t = duel.team[0].tag;
  const o = duel.opponent[0].tag;
  const r1 = { me: byRound(t, 1), opp: byRound(o, 1) };
  assert.notEqual(r1.me.crowns, null);
  assert.notEqual(r1.opp.crowns, null);
  assert.ok(
    Number(r1.me.elixir_leaked) - Number(r1.opp.elixir_leaked) !== 0,
    "round one has its own elixir differential",
  );
  // The round decks were already stored; the results now sit beside them
  // on the same round number.
  const { rows: cards } = await ctx.db.query(
    `select distinct round from battle_participant_card
      where battle_id = $1 and player_tag = $2 order by round`,
    [battle.battle_id, t],
  );
  assert.deepEqual(
    cards.map((c) => c.round),
    rows.filter((r) => r.player_tag === t).map((r) => r.round),
    "round decks and round results share their round numbers",
  );
  // used rides the round cards.
  const { rows: used } = await ctx.db.query(
    `select count(*)::int as n from battle_participant_card
      where battle_id = $1 and used is not null`,
    [battle.battle_id],
  );
  assert.ok(used[0].n > 0, "the API's per-round used flag is recorded");
});

test("0151: global_rank is recorded when the API reports one, null otherwise", async () => {
  const log = await fixture("player_battlelog/with_path_of_legend.json");
  const entry = structuredClone(
    log.find((b) => b.type === "pathOfLegend") ?? log[0],
  );
  entry.battleTime = "20260915T010203.000Z";
  entry.team[0].globalRank = 412;
  entry.opponent[0].globalRank = null;
  await ingestBattlelog(ctx.db, {
    observerTag: entry.team[0].tag,
    receiptId,
    payload: [entry],
  });
  const { battle } = canonicalizeBattle(entry);
  const { rows } = await ctx.db.query(
    `select player_tag, global_rank from battle_participant
      where battle_id = $1`,
    [battle.battle_id],
  );
  const ranked = rows.find((r) => r.player_tag === entry.team[0].tag);
  const unranked = rows.find((r) => r.player_tag === entry.opponent[0].tag);
  assert.equal(
    ranked.global_rank,
    412,
    "a globally ranked player keeps their rank",
  );
  assert.equal(
    unranked.global_rank,
    null,
    "an unranked opponent is null, not zero",
  );
});
