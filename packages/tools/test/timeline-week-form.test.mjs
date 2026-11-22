/**
 * week_form (15.3.0): a closed game week's win rate beside the four game
 * weeks before it, in one mode, told on a followed player's timeline when
 * it rose at least ten points (WEEK_FORM_RISE) with both sides at
 * FORM_MIN_BATTLES decided battles. Stats' "This week vs your last 4",
 * as a moment, stored once a week (0311) and read by key.
 *
 * The writer (storeWeekForms):
 * - The numbers are battles_performance's own for the same two windows
 *   (reconciled below through the registered tool, at write time).
 * - Only a rise; a step down, a rise under ten points and a side under
 *   the minimum store nothing.
 * - Boat defenses never count; a boat attack is a battle, never decided.
 * - Several modes qualifying in one week: one row, the mode with the
 *   most decided battles in the week.
 * - Idempotent: a second run writes nothing and moves no computed_at; a
 *   battle learned after the grace changes nothing; a reading the week no
 *   longer gives goes.
 *
 * The reader: the stored row, as an item on a followed player's timeline
 * (never a clan's), one statement a read, batched or alone.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { buildTimeline, timelineNews } from "../src/activity/entries.mjs";
import {
  WEEK_FORM_GRACE_MS,
  storeWeekForms,
  weekFormDue,
} from "@elixir-mcp/record/week-form-store";
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
    // The writer reads the claimed players: the only way onto a Timeline.
    await db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship)
       values ($1, $2, 'unverified', false, 'friend')`,
      [account.accountId, tag],
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
  first = await storeWeekForms(db, START);
});
after(async () => ctx?.drop());

/** The first run's answer, and the stored rows by tag. */
let first;
const stored = async () => {
  const { rows } = await db.query(
    "select * from player_week_form order by player_tag, week_start",
  );
  return rows;
};
const row = async (tag) => (await stored()).find((r) => r.player_tag === tag);

const friend = (tag) => ({ kind: "player", tag, relationship: "friend" });
/** A read whose window holds the run (observed: what the record learned
 *  in it). */
const read = (
  subjects,
  { fromMs = Date.now() - DAY, toMs = Date.now() + DAY, basis } = {},
) => buildTimeline(db, subjects, { fromMs, toMs, ...(basis ? { basis } : {}) });
const forms = (timeline) => timeline.filter((i) => i.kind === "week_form");

test("a run writes the latest game week whose end and grace have passed", () => {
  assert.equal(weekFormDue(END + WEEK_FORM_GRACE_MS), START);
  assert.equal(weekFormDue(END + WEEK_FORM_GRACE_MS - 1), START - WEEK);
  assert.equal(weekFormDue(END + 6 * DAY), START);
  assert.equal(weekFormDue(END + WEEK + WEEK_FORM_GRACE_MS), START + WEEK);
});

test("the run stores one row for each qualifying player, and none for the rest", async () => {
  assert.equal(first.players, 5);
  assert.equal(first.readings, 2);
  assert.equal(first.written, 2);
  assert.equal(first.incomplete, false);
  assert.deepEqual(
    (await stored()).map((r) => r.player_tag),
    [PIP, ASH].sort(),
  );
});

test("several modes rose: the row is the one with the most decided battles", async () => {
  const r = await row(PIP);
  assert.equal(r.mode, "ladder", "Trophy Road's 12 over Ranked's 10");
  assert.equal(new Date(r.week_start).toISOString(), iso(START));
  assert.equal(r.week_battles, 12);
  assert.equal(r.week_decided, 12);
  assert.equal(r.week_wins, 8);
  assert.equal(r.week_losses, 4);
  assert.equal(Number(r.week_win_rate), 0.667);
  assert.equal(r.prev_decided, 20);
  assert.equal(Number(r.prev_win_rate), 0.5);
});

test("boat defenses never count; boat attacks are battles, never decided", async () => {
  const r = await row(ASH);
  assert.equal(r.mode, "war");
  assert.equal(r.week_battles, 12, "ten 1v1s and two attacks");
  assert.equal(r.week_wins, 9);
  assert.equal(r.week_losses, 3, "the defenses' losses are not Ash's");
  assert.equal(r.week_decided, 10);
  assert.equal(Number(r.week_win_rate), 0.7);
});

test("a rise under ten points, a side under the minimum and a drop store nothing", async () => {
  for (const tag of [ROWAN, ELM, FEN])
    assert.equal(await row(tag), undefined, tag);
});

test("the stored numbers reconcile with battles_performance's window and compare_window", async () => {
  for (const tag of [PIP, ASH]) {
    const r = await row(tag);
    const perf = await registry.invoke(
      "battles_performance",
      { db, account },
      {
        player_tag: tag,
        mode: r.mode,
        from: iso(START),
        to: iso(END),
        compare_from: iso(START - 4 * WEEK),
        compare_to: iso(START),
      },
    );
    const out = perf.structuredContent ?? perf;
    assert.equal(r.week_battles, out.window.battles, `${tag} battles`);
    assert.equal(r.week_decided, out.window.decided_battles, `${tag} decided`);
    assert.equal(r.week_wins, out.window.wins, `${tag} wins`);
    assert.equal(r.week_losses, out.window.losses, `${tag} losses`);
    assert.equal(Number(r.week_win_rate), out.window.win_rate, `${tag} rate`);
    assert.equal(
      r.prev_decided,
      out.compare_window.decided_battles,
      `${tag} previous decided`,
    );
    assert.equal(
      Number(r.prev_win_rate),
      out.compare_window.win_rate,
      `${tag} previous rate`,
    );
  }
});

test("a second run writes nothing and moves no computed_at; batches give the same rows", async () => {
  const before = await stored();
  const again = await storeWeekForms(db, START);
  assert.equal(again.written, 0);
  assert.equal(again.removed, 0);
  assert.equal(again.readings, 2);
  const small = await storeWeekForms(db, START, { batch: 2 });
  assert.equal(small.players, 5);
  assert.equal(small.written, 0);
  assert.deepEqual(await stored(), before);
});

test("a run out of time stops between batches and says where; a run from there finishes", async () => {
  const stopped = await storeWeekForms(db, START, {
    batch: 2,
    remainingMs: () => 0,
  });
  assert.equal(stopped.incomplete, true);
  assert.equal(stopped.players, 0);
  let left = 2;
  const part = await storeWeekForms(db, START, {
    batch: 2,
    remainingMs: () => (left-- > 0 ? 120_000 : 0),
  });
  assert.equal(part.incomplete, true);
  assert.equal(part.players, 4);
  const rest = await storeWeekForms(db, START, { batch: 2, after: part.after });
  assert.equal(rest.incomplete, false);
  assert.equal(rest.players, 1);
  // With no deadline at all (outside a jobs run) the run never stops.
  const free = await storeWeekForms(db, START, { remainingMs: () => null });
  assert.equal(free.incomplete, false);
});

test("a battle learned after the week's grace never changes the reading", async () => {
  const before = await stored();
  const id = "wf-late";
  const at = iso(START + 2 * DAY);
  await db.query(
    `insert into battle (battle_id, battle_time, created_at, type, type_class)
     values ($1, $2, $3, 'PvP', 'pvp')`,
    [id, at, iso(END + WEEK_FORM_GRACE_MS + H)],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, clan_tag, side, outcome, battle_time, type, type_class)
     values ($1, $2, $3, 0, 'loss', $4, 'PvP', 'pvp')`,
    [id, PIP, CLAN, at],
  );
  try {
    const again = await storeWeekForms(db, START);
    assert.equal(again.written, 0);
    assert.deepEqual(await stored(), before);
  } finally {
    await db.query("delete from battle_participant where battle_id = $1", [id]);
    await db.query("delete from battle where battle_id = $1", [id]);
  }
});

test("a stored reading the week no longer gives goes", async () => {
  await db.query(
    `insert into player_week_form (player_tag, week_start, mode, week_battles, week_decided,
       week_wins, week_losses, week_win_rate, prev_decided, prev_win_rate)
     values ($1, $2, 'ladder', 12, 12, 9, 3, 0.75, 20, 0.5)`,
    [FEN, iso(START)],
  );
  const again = await storeWeekForms(db, START);
  assert.equal(again.removed, 1);
  assert.equal(await row(FEN), undefined);
});

test("the stored row is one item, its facts the row's, its story the week's", async () => {
  const r = await row(PIP);
  const { timeline } = await read([friend(PIP)]);
  const items = forms(timeline);
  assert.equal(items.length, 1, "one item for the week");
  const [f] = items;
  assert.equal(f.subject_tag, PIP);
  assert.equal(f.section, "battles");
  assert.equal(f.at, iso(END));
  assert.equal(f.observed_at, new Date(r.computed_at).toISOString());
  assert.equal(f.schema, "week_form/1");
  assert.deepEqual(missingFacts(f), []);
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
  // A window by when it happened holds the week's end: the same story.
  const occurred = forms(
    (
      await read([friend(PIP)], {
        fromMs: END - DAY,
        toMs: END + DAY,
        basis: "occurred",
      })
    ).timeline,
  );
  assert.equal(occurred.length, 1);
  assert.equal(occurred[0].id, f.id);
  const ash = forms((await read([friend(ASH)])).timeline);
  assert.match(ash[0].text, /^Ash won 70% of 10 Clan Wars battles/);
});

test("a window that holds neither the run nor the week's end says nothing", async () => {
  const learned = forms(
    (await read([friend(PIP)], { fromMs: END - DAY, toMs: END + DAY }))
      .timeline,
  );
  assert.deepEqual(learned, [], "observed: learned after this window");
  const later = forms(
    (
      await read([friend(PIP)], {
        fromMs: END + DAY,
        toMs: END + 2 * DAY,
        basis: "occurred",
      })
    ).timeline,
  );
  assert.deepEqual(later, [], "occurred: the week ended before this window");
});

test("one week_form read a timeline, batched or alone", async () => {
  const count = async (subjects) => {
    let k = 0;
    const spy = {
      query: (sql, params) => {
        if (String(sql).includes("from player_week_form f")) k += 1;
        return db.query(sql, params);
      },
    };
    const out = await buildTimeline(spy, subjects, {
      fromMs: Date.now() - DAY,
      toMs: Date.now() + DAY,
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

test("the news check builds a window the run wrote in, and skips one it did not", async () => {
  const kinds = ["week_form"];
  const wrote = await timelineNews(db, [friend(PIP)], {
    fromMs: Date.now() - DAY,
    toMs: Date.now() + DAY,
    kinds,
  });
  assert.equal(wrote.sources.player_week_form, true);
  const quiet = await timelineNews(db, [friend(PIP)], {
    fromMs: END - DAY,
    toMs: END + DAY,
    kinds,
  });
  assert.equal(quiet.any, false);
});
