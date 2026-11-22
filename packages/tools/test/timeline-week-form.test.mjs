/**
 * week_form (15.3.0): a closed game week's win rate beside the four game
 * weeks before it, in one mode, told on a followed player's timeline when
 * it rose at least ten points (WEEK_FORM_RISE) with both sides at
 * FORM_MIN_BATTLES decided battles. Stats' "This week vs your last 4",
 * as a moment.
 *
 * - The numbers are battles_performance's own for the same two windows
 *   (reconciled below through the registered tool).
 * - Only a rise; a step down, a rise under ten points, a side under the
 *   minimum and a week whose end is outside the window say nothing.
 * - Boat defenses never count; a boat attack is a battle, never decided.
 * - Several modes qualifying in one week: one item, the mode with the
 *   most decided battles in the week.
 * - Never on a clan's timeline.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import {
  buildTimeline,
  timelineNews,
  weekFormStarts,
} from "../src/activity/entries.mjs";
import { missingFacts } from "../src/activity/schemas.mjs";

// Invented tags (docs/invented-tags.json).
const CLAN = "#0CUVR298";
const PIP = "#0CUVR29P"; // Trophy Road up 17 points, Ranked up 20 on fewer battles
const ASH = "#0CUVR29Q"; // Clan Wars up 20, with boat attacks and defenses
const ROWAN = "#0CUVR29L"; // up 8.8 points: under the rise
const ELM = "#0CUVR29Y"; // nine decided battles in the week: under the minimum
const FEN = "#0CUVR292"; // a drop

const H = 3_600_000;
const DAY = 24 * H;
const WEEK = 7 * DAY;
// The game week Monday 2026-11-09 10:00Z to Monday 2026-11-16 10:00Z, and
// the four game weeks before it from 2026-10-12 10:00Z.
const START = Date.parse("2026-11-09T10:00:00Z");
const END = START + WEEK;
const iso = (ms) => new Date(ms).toISOString();

const registry = makeRegistry();
let ctx;
let db;
let account;
let n = 0;

/** `count` battles for `tag` from `fromMs`, an hour apart, `wins` of them
 *  won and the rest lost. `type` PvP (Trophy Road), pathOfLegend
 *  (Ranked), riverRacePvP (Clan Wars); `boat` 'attacker' or 'defender'
 *  writes a boat battle on that side instead. */
async function battles(tag, fromMs, count, wins, { type = "PvP", boat } = {}) {
  for (let i = 0; i < count; i += 1) {
    const id = `wf-${String(++n).padStart(4, "0")}`;
    const at = iso(fromMs + i * H);
    const t = boat ? "boatBattle" : type;
    const cls = boat ? "boat" : "pvp";
    await db.query(
      `insert into battle (battle_id, battle_time, created_at, type, type_class, boat_battle_side)
       values ($1, $2, $2, $3, $4, $5)`,
      [id, at, t, cls, boat ?? null],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, clan_tag, side, outcome, battle_time, type, type_class)
       values ($1, $2, $3, 0, $4, $5, $6, $7)`,
      [id, tag, CLAN, i < wins ? "win" : "loss", at, t, cls],
    );
  }
}

/** The four weeks before: `count` battles spread over them. */
const previous = (tag, count, wins, opts) =>
  battles(tag, START - 4 * WEEK + DAY, count, wins, opts);
/** The week itself. */
const week = (tag, count, wins, opts) =>
  battles(tag, START + DAY, count, wins, opts);

before(async () => {
  ctx = await scratchDb("timeline_week_form");
  db = ctx.db;
  await db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await db.query(
    "insert into account (email_hash,status) values ('week-form','approved') returning account_id",
  );
  account = {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Ember Hall')`,
    [CLAN],
  );
  for (const [tag, name] of [
    [PIP, "Pip"],
    [ASH, "Ash"],
    [ROWAN, "Rowan"],
    [ELM, "Elm"],
    [FEN, "Fen"],
  ]) {
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
       values ($1, $2, 'member', $3)`,
      [CLAN, tag, iso(START - 60 * DAY)],
    );
    await db.query(
      "insert into recording (subject_type,subject_tag,requested_by) values ('player',$1,$2)",
      [tag, account.accountId],
    );
  }
  // Pip: Trophy Road 50% (20) then 66.7% (12); Ranked 40% (20) then 60%
  // (10). Both rise; Trophy Road has the more decided battles.
  await previous(PIP, 20, 10);
  await week(PIP, 12, 8);
  await previous(PIP, 20, 8, { type: "pathOfLegend" });
  await week(PIP, 10, 6, { type: "pathOfLegend" });
  // Ash: Clan Wars 50% (10) then 70% (10), plus two boat attacks won and
  // three boat defenses lost in the week: the attacks are battles and
  // wins, never decided; the defenses are not Ash's battles at all.
  await previous(ASH, 10, 5, { type: "riverRacePvP" });
  await week(ASH, 10, 7, { type: "riverRacePvP" });
  await battles(ASH, START + 2 * DAY, 2, 2, { boat: "attacker" });
  await battles(ASH, START + 3 * DAY, 3, 0, { boat: "defender" });
  // Rowan: 50% then 10 of 17 (58.8%), 8.8 points.
  await previous(ROWAN, 20, 10);
  await week(ROWAN, 17, 10);
  // Elm: nine wins from nine in the week, under the minimum.
  await previous(ELM, 20, 10);
  await week(ELM, 9, 9);
  // Fen: 50% then 25%.
  await previous(FEN, 20, 10);
  await week(FEN, 12, 3);
});
after(async () => ctx?.drop());

const friend = (tag) => ({ kind: "player", tag, relationship: "friend" });
const read = (subjects, fromMs = END - DAY, toMs = END + DAY) =>
  buildTimeline(db, subjects, { fromMs, toMs });
const forms = (timeline) => timeline.filter((i) => i.kind === "week_form");

test("a window closes the game weeks whose Monday 10:00Z end it holds", () => {
  assert.deepEqual(weekFormStarts(END - DAY, END + DAY), [START]);
  // The end itself is in (from, to]; a window starting at it is not.
  assert.deepEqual(weekFormStarts(END - H, END), [START]);
  assert.deepEqual(weekFormStarts(END, END + 6 * DAY), []);
  assert.deepEqual(weekFormStarts(END - 8 * DAY, END), [START - WEEK, START]);
});

test("a qualifying week is one item, its facts battles_performance's, its story the week's", async () => {
  const { timeline } = await read([friend(PIP)]);
  const items = forms(timeline);
  assert.equal(items.length, 1, "one item for the week");
  const [f] = items;
  assert.equal(f.subject_tag, PIP);
  assert.equal(f.section, "battles");
  assert.equal(f.at, iso(END));
  assert.equal(f.schema, "week_form/1");
  assert.deepEqual(missingFacts(f), []);
  // Trophy Road: more decided battles in the week than Ranked's ten.
  assert.equal(f.facts.mode, "ladder");
  assert.deepEqual(f.facts.week, {
    from: iso(START),
    to: iso(END),
    battles: 12,
    decided_battles: 12,
    wins: 8,
    losses: 4,
    win_rate: 0.667,
  });
  assert.deepEqual(f.facts.previous, {
    from: iso(START - 4 * WEEK),
    to: iso(START),
    weeks: 4,
    decided_battles: 20,
    win_rate: 0.5,
  });
  assert.equal(
    f.text,
    "Pip won 67% of 12 Trophy Road battles in the week to Nov 16, up from 50% over the 4 weeks before.",
  );
  // The story is the player's week: the same id on every read of it.
  const again = forms((await read([friend(PIP)], END - H, END)).timeline);
  assert.equal(again[0].id, f.id);
});

test("the item's numbers reconcile with battles_performance's window and compare_window", async () => {
  for (const tag of [PIP, ASH]) {
    const [f] = forms((await read([friend(tag)])).timeline);
    const perf = await registry.invoke(
      "battles_performance",
      { db, account },
      {
        player_tag: tag,
        mode: f.facts.mode,
        from: f.facts.week.from,
        to: f.facts.week.to,
        compare_from: f.facts.previous.from,
        compare_to: f.facts.previous.to,
      },
    );
    const out = perf.structuredContent ?? perf;
    for (const k of [
      "battles",
      "decided_battles",
      "wins",
      "losses",
      "win_rate",
    ])
      assert.equal(f.facts.week[k], out.window[k], `${tag} week ${k}`);
    for (const k of ["decided_battles", "win_rate"])
      assert.equal(
        f.facts.previous[k],
        out.compare_window[k],
        `${tag} previous ${k}`,
      );
  }
});

test("boat defenses never count; boat attacks are battles, never decided", async () => {
  const [f] = forms((await read([friend(ASH)])).timeline);
  assert.equal(f.facts.mode, "war");
  assert.equal(f.facts.week.battles, 12, "ten 1v1s and two attacks");
  assert.equal(f.facts.week.wins, 9);
  assert.equal(f.facts.week.losses, 3, "the defenses' losses are not Ash's");
  assert.equal(f.facts.week.decided_battles, 10);
  assert.equal(f.facts.week.win_rate, 0.7);
  assert.match(f.text, /^Ash won 70% of 10 Clan Wars battles/);
});

test("a rise under ten points, a side under the minimum and a drop say nothing", async () => {
  for (const tag of [ROWAN, ELM, FEN])
    assert.deepEqual(forms((await read([friend(tag)])).timeline), [], tag);
});

test("a window that holds no week's end says nothing, and runs no week_form read", async () => {
  const queries = [];
  const spy = {
    query: (sql, params) => {
      queries.push(String(sql));
      return db.query(sql, params);
    },
  };
  const { timeline } = await buildTimeline(spy, [friend(PIP)], {
    fromMs: END,
    toMs: END + 2 * DAY,
  });
  assert.deepEqual(forms(timeline), []);
  assert.ok(
    !queries.some((q) =>
      q.includes("floor(extract(epoch from (bp.battle_time"),
    ),
    "no week_form query",
  );
});

test("one week_form query a read, batched or alone", async () => {
  const count = async (subjects) => {
    let k = 0;
    const spy = {
      query: (sql, params) => {
        if (String(sql).includes("floor(extract(epoch from (bp.battle_time"))
          k += 1;
        return db.query(sql, params);
      },
    };
    const out = await buildTimeline(spy, subjects, {
      fromMs: END - DAY,
      toMs: END + DAY,
    });
    return { k, out };
  };
  const alone = await count([friend(PIP)]);
  assert.equal(alone.k, 1);
  const all = await count([PIP, ASH, ROWAN, ELM, FEN].map(friend));
  assert.equal(all.k, 1, "one statement for the whole batch");
  assert.deepEqual(
    forms(all.out.timeline)
      .map((i) => i.subject_tag)
      .sort(),
    [ASH, PIP].sort(),
  );
});

test("never on a clan's timeline", async () => {
  const { timeline } = await read([
    { kind: "clan", tag: CLAN, scope: "comprehensive" },
  ]);
  assert.deepEqual(forms(timeline), []);
});

test("the news check builds a window that closes a week, and skips one that does not", async () => {
  const kinds = ["week_form"];
  const closes = await timelineNews(db, [friend(PIP)], {
    fromMs: END - DAY,
    toMs: END + DAY,
    kinds,
  });
  assert.equal(closes.sources.player_week_form, true);
  const open = await timelineNews(db, [friend(PIP)], {
    fromMs: END,
    toMs: END + DAY,
    kinds,
  });
  assert.equal(open.any, false);
});
