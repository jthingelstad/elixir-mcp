/**
 * elixir_timeline 3.0.0: items in order plus entries (review 2026-09-13, Part
 * III). The tool's window, bookmark, trimming and refusal behaviour; the
 * entries themselves are pinned in activity-entries.test.mjs.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestClanRoster } from "../../ingest/src/roster.mjs";
import { projectRiverRaceLog } from "../../ingest/src/war.mjs";
import { ingestBattlelog } from "../../ingest/src/battles.mjs";
import { projectPlayerSnapshot } from "../../ingest/src/snapshots.mjs";
import { emitEvent } from "../../ingest/src/events.mjs";
import {
  fixture,
  scratchDb,
  seedReceipt,
  trackClans,
} from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { storyId } from "../src/activity/entries.mjs";

/** A crossing battle as ROWS (0124: an event names its battle by id and
 *  the timeline describes it from the record): the observer on side 0
 *  and each opponent on side 1. */
async function seedCrossing(
  db,
  {
    battle_id,
    at,
    type = "PvP",
    observer,
    starting_trophies = null,
    crowns,
    crowns_against,
    trophy_change,
    opponents,
  },
) {
  const tc = type === "clanMate2v2" ? "pvp" : "pvp";
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class) values ($1, $2, $3, $4)
     on conflict do nothing`,
    [battle_id, at, type, tc],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, type, type_class, crowns, trophy_change, starting_trophies, outcome)
     values ($1, $2, $3, 0, $4, $5, $6, $7, $8, 'win') on conflict do nothing`,
    [
      battle_id,
      observer,
      at,
      type,
      tc,
      crowns,
      trophy_change,
      starting_trophies,
    ],
  );
  for (const o of opponents) {
    await db.query(
      `insert into player (player_tag, name) values ($1, $2)
       on conflict (player_tag) do update set name = coalesce(excluded.name, player.name)`,
      [o.player_tag, o.name ?? null],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, battle_time, side, type, type_class, crowns, starting_trophies, outcome)
       values ($1, $2, $3, 1, $4, $5, $6, $7, 'loss') on conflict do nothing`,
      [
        battle_id,
        o.player_tag,
        at,
        type,
        tc,
        crowns_against,
        o.starting_trophies ?? null,
      ],
    );
  }
}

const CLAN = "#J2RGCRVG";
const OBSERVER = "#0QG2JG928";
const PROFILE = "#0QRVVG22J";
let ctx;
let owner;
let invoke;

async function call(name, args = {}) {
  const { body, isError } = await invoke(name, args);
  return { body, isError };
}

before(async () => {
  ctx = await scratchDb("activity_tool");
  await trackClans(ctx.db, [CLAN]);
  const db = ctx.db;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS')`,
    [CLAN],
  );
  owner = (
    await db.query(
      `insert into account (email_hash, status, is_owner, timezone)
       values ('feed-owner', 'approved', true, 'America/Chicago') returning account_id`,
    )
  ).rows[0].account_id;
  await ingestClanRoster(db, {
    payload: await fixture("clan/roster.json"),
    observedAt: "2026-09-03T14:40:34Z",
  });
  await projectRiverRaceLog(db, {
    clanTag: CLAN,
    payload: await fixture("riverracelog/log.json"),
  });
  const receiptId = await seedReceipt(db, { entityKey: OBSERVER });
  await ingestBattlelog(db, {
    observerTag: OBSERVER,
    receiptId,
    payload: await fixture("player_battlelog/with_path_of_legend.json"),
  });
  // Captured minutes after play, as the collectors capture (Gym #211: a
  // battle learned more than a day after it was played is a late capture).
  await db.query(
    `update battle set created_at = battle_time + interval '5 minutes'`,
  );
  const profile = await fixture("player/profile.json");
  await projectPlayerSnapshot(db, {
    playerTag: PROFILE,
    payload: { ...profile, trophies: 13000, bestTrophies: 13000 },
    fetchedAt: "2026-09-02T12:00:00Z",
  });
  await projectPlayerSnapshot(db, {
    playerTag: PROFILE,
    payload: profile,
    fetchedAt: "2026-09-04T12:00:00Z",
  });
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'unverified', true, 'primary', true), ($1, $3, 'unverified', false, 'friend', true)`,
    [owner, PROFILE, OBSERVER],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, notify) values ($1, $2, 'comprehensive', true)`,
    [owner, CLAN],
  );
  invoke = makeInvoker({
    db,
    account: { accountId: owner, isOwner: true, timezone: "America/Chicago" },
    registry: makeRegistry(),
  });
});

after(async () => ctx.drop());

test("a first read covers the last 24 hours: the clan always has an entry, silent players are quiet", async () => {
  const { body, isError } = await call("elixir_timeline", { mark_read: false });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.applied.window.source, "default");
  const span = Date.parse(body.window.to) - Date.parse(body.window.from);
  assert.ok(Math.abs(span - 86_400_000) < 5_000, "default window is a day");
  assert.equal(body.subjects, 3);
  assert.deepEqual(
    body.entries.map((e) => e.kind),
    ["clan_activity"],
    "the fixture battles were played long before the window: late captures, not activity",
  );
  assert.equal(body.quiet.length, 2);
  assert.ok(body.quiet.every((q) => Object.hasOwn(q, "days_since_poll")));
  assert.equal(body.read_to, null, "not marked, no pointer yet");
  assert.ok(Array.isArray(body.timeline), "the timeline rides every read");
  assert.equal(body.next_cursor, body.window.to);
  assert.equal(body.has_more, false);
  assert.ok(
    !("events" in body) && !("seen_through" in body),
    "the old shape is gone",
  );
});

test("from as a local date opens the window; every entry carries a summary and all its sections", async () => {
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-03",
    to: "2026-09-30",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.applied.window.source, "argument");
  assert.equal(body.entries.length, 3);
  const primary = body.entries.find((e) => e.subject_tag === PROFILE);
  assert.equal(primary.kind, "player_activity");
  assert.match(primary.summary, /13,000 → 13,621/);
  for (const k of [
    "battles",
    "trophies",
    "arena",
    "ranked",
    "collection",
    "badges",
    "clan",
    "war",
    "presence",
    "notables",
  ])
    assert.ok(Object.hasOwn(primary, k), `player section ${k}`);
  const clan = body.entries.find((e) => e.kind === "clan_activity");
  for (const k of [
    "activity",
    "roster",
    "war",
    "presence",
    "standouts",
    "donations",
  ])
    assert.ok(Object.hasOwn(clan, k), `clan section ${k}`);
  assert.match(clan.summary, /^POAP KINGS: /);
  assert.equal(body.meta.timezone_applied, "America/Chicago");
  assert.doesNotMatch(
    JSON.stringify(body.entries),
    /day_ends_at|closes_at/,
    "no clock in the feed",
  );
});

test("sections and verbosity trim the wire; an unknown section is refused", async () => {
  const trimmed = await call("elixir_timeline", {
    from: "2026-09-03",
    to: "2026-09-30",
    sections: ["battles", "roster"],
    mark_read: false,
  });
  assert.equal(trimmed.isError, false);
  const p = trimmed.body.entries.find((e) => e.subject_tag === PROFILE);
  assert.ok(Object.hasOwn(p, "battles") && !Object.hasOwn(p, "trophies"));
  assert.ok(Object.hasOwn(p, "summary") && Object.hasOwn(p, "notables"));
  const c = trimmed.body.entries.find((e) => e.kind === "clan_activity");
  assert.ok(Object.hasOwn(c, "roster") && !Object.hasOwn(c, "war"));

  const compact = await call("elixir_timeline", {
    from: "2026-09-03",
    to: "2026-09-30",
    verbosity: "compact",
    mark_read: false,
  });
  const cp = compact.body.entries.find((e) => e.subject_tag === PROFILE);
  assert.ok(!Object.hasOwn(cp, "battles") && Object.hasOwn(cp, "summary"));

  const bad = await call("elixir_timeline", { sections: ["nudges"] });
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error.code, "bad_request");
});

test("mark_read moves the bookmark to the window end; the next read resumes there; timeline_pending follows it", async () => {
  // A subject with an admission a second ago: the hint counts it while
  // unbookmarked. (A second, not now(): the bookmark is the window end at
  // millisecond precision and the admission stamp has microseconds.)
  await ctx.db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ($1, 'player_battlelog', now() - interval '1 second')
     on conflict (subject_tag, endpoint)
     do update set last_admitted_at = now() - interval '1 second'`,
    [OBSERVER],
  );
  const before = await call("game_clock", {});
  assert.ok(
    before.body.meta.timeline_pending >= 1,
    "never marked: the subject counts",
  );

  const to = new Date().toISOString();
  const read = await call("elixir_timeline", {
    from: "2026-09-03",
    to,
    basis: "observed",
  });
  assert.equal(read.isError, false);
  assert.equal(read.body.read_to, read.body.window.to);
  const { rows } = await ctx.db.query(
    `select activity_seen_at from account where account_id = $1`,
    [owner],
  );
  assert.equal(rows[0].activity_seen_at.toISOString(), read.body.window.to);

  const after = await call("game_clock", {});
  assert.equal(
    after.body.meta.timeline_pending,
    0,
    "marked past the admission",
  );

  const resumed = await call("elixir_timeline", { mark_read: false });
  assert.equal(resumed.body.applied.window.source, "pointer");
  assert.equal(resumed.body.window.from, read.body.window.to);
});

test("3.18.0: a named reader keeps its own pointer; the account's is untouched; timeline_pending counts against the oldest named pointer", async () => {
  // The account pointer stands at the previous test's window end. A
  // consumer naming itself starts with no pointer of its own (a 24-hour
  // default), marks, and resumes from its own mark; the account column
  // does not move.
  const { rows: acctBefore } = await ctx.db.query(
    `select activity_seen_at from account where account_id = $1`,
    [owner],
  );
  const first = await call("elixir_timeline", {
    reader: "editor",
    mark_read: false,
  });
  assert.equal(first.isError, false, JSON.stringify(first.body));
  assert.equal(first.body.applied.window.source, "default");
  assert.equal(first.body.applied.reader, "editor");
  assert.equal(first.body.read_to, null, "this reader has not marked yet");

  const to = new Date().toISOString();
  const marked = await call("elixir_timeline", {
    reader: "editor",
    from: "2026-09-03",
    to,
  });
  assert.equal(marked.body.read_to, marked.body.window.to);
  const { rows: readers } = await ctx.db.query(
    `select reader, read_to from timeline_reader where account_id = $1`,
    [owner],
  );
  assert.deepEqual(
    readers.map((r) => [r.reader, r.read_to.toISOString()]),
    [["editor", marked.body.window.to]],
  );
  const { rows: acctAfter } = await ctx.db.query(
    `select activity_seen_at from account where account_id = $1`,
    [owner],
  );
  assert.equal(
    acctAfter[0].activity_seen_at.toISOString(),
    acctBefore[0].activity_seen_at.toISOString(),
    "the account's unnamed pointer did not move",
  );
  const resumed = await call("elixir_timeline", {
    reader: "editor",
    mark_read: false,
  });
  assert.equal(resumed.body.applied.window.source, "pointer");
  assert.equal(resumed.body.window.from, marked.body.window.to);

  // A second reader is its own: no pointer yet, and the hint counts
  // against the OLDEST named pointer, so an admission after the older
  // reader's mark is pending even though the newer reader has read past it.
  const other = await call("elixir_timeline", {
    reader: "poll-lane",
    mark_read: false,
  });
  assert.equal(other.body.read_to, null);
  await ctx.db.query(
    `update timeline_reader set read_to = now() - interval '2 days' where reader = 'editor'`,
  );
  await ctx.db.query(
    `insert into timeline_reader (account_id, reader, read_to) values ($1, 'poll-lane', now())`,
    [owner],
  );
  await ctx.db.query(
    `update poll_state set last_admitted_at = now() - interval '1 day'
      where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [OBSERVER],
  );
  const clock = await call("game_clock", {});
  assert.ok(
    clock.body.meta.timeline_pending >= 1,
    "pending against the oldest named pointer (editor, 2 days back)",
  );
  await call("elixir_timeline", { reader: "editor", days: 1 });
  const clockAfter = await call("game_clock", {});
  assert.equal(
    clockAfter.body.meta.timeline_pending,
    0,
    "the oldest reader has read",
  );

  // A reader that has not marked for 30 days no longer holds the hint.
  await ctx.db.query(
    `update timeline_reader set read_to = now() - interval '40 days', updated_at = now() - interval '31 days' where reader = 'poll-lane'`,
  );
  const stale = await call("game_clock", {});
  assert.equal(stale.body.meta.timeline_pending, 0, "a dead reader is ignored");

  const bad = await call("elixir_timeline", { reader: "Not Valid!" });
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error.code, "bad_request");
});

test("a window longer than 30 days is capped and says so; from after to is refused", async () => {
  const capped = await call("elixir_timeline", {
    from: "2026-01-01",
    mark_read: false,
  });
  assert.equal(capped.isError, false);
  const span =
    Date.parse(capped.body.window.to) - Date.parse(capped.body.window.from);
  assert.ok(Math.abs(span - 30 * 86_400_000) < 5_000);
  assert.match(capped.body.notes.join(" "), /capped at 30 days/);

  const bad = await call("elixir_timeline", {
    from: "2026-09-10T00:00:00Z",
    to: "2026-09-09T00:00:00Z",
  });
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error.code, "bad_request");
});

test("the timeline: battle sessions break on a 30-minute gap, items are newest first with text, sections filter items", async () => {
  // A closed window: an open one ends now, and the 30-day cap moved its
  // start past the 09-01 pair on 2026-10-01 (the fixture ends 09-20).
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-01",
    to: "2026-09-30",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const sessions = body.timeline.filter((it) =>
    ["battle_session", "session_standout"].includes(it.kind),
  );
  // The fixture log: two battles on 09-01 21:56/21:59, then 09-02 runs with
  // gaps of 42+ minutes between 08:08 and 08:50, 09:08 and 10:34, 10:49 and
  // 11:51, 11:51 and 17:46, 18:33 and 19:20, then one on 09-03: eight
  // sessions of one player. The 08:50 sitting is also a clan standout,
  // and one story is one item (11.8.0, #374): the standout's telling.
  assert.equal(sessions.length, 8, JSON.stringify(sessions.map((s) => s.at)));
  assert.equal(new Set(sessions.map((s) => s.id)).size, 8);
  assert.ok(sessions.every((s) => s.subject_tag === OBSERVER));
  assert.ok(
    sessions.every((s) =>
      /played \d+ battles?( in one session)? /.test(s.text),
    ),
  );
  // Newest first, a newsfeed (7.0.0): the 09-01 pair is last.
  const first = sessions.at(-1);
  assert.equal(first.facts.battles, 2);
  assert.equal(first.section, "battles");
  // By sort_at: a sitting sorts at its last battle (11.8.0).
  const ats = body.timeline.map((it) => it.sort_at);
  assert.deepEqual(ats, [...ats].sort().reverse(), "newest first");
  assert.ok(
    body.timeline.every(
      (it) => typeof it.text === "string" && it.text.length > 0,
    ),
  );

  const rosterOnly = await call("elixir_timeline", {
    from: "2026-09-01",
    to: "2026-09-30",
    sections: ["roster"],
    mark_read: false,
  });
  assert.ok(rosterOnly.body.timeline.every((it) => it.section === "roster"));
  assert.ok(
    !rosterOnly.body.timeline.some((it) => it.kind === "battle_session"),
  );
});

test("an arena move names the win that carried the player over the floor, at that battle's instant", async () => {
  // Written by ingest when the record holds the crossing (0102); the
  // timeline reads it as the item's instant and says who it was against.
  await seedCrossing(ctx.db, {
    battle_id: "x",
    at: "2026-09-02T06:46:32.000Z",
    observer: OBSERVER,
    starting_trophies: 5970,
    crowns: 3,
    crowns_against: 0,
    trophy_change: 30,
    opponents: [
      {
        player_tag: "#0UCRRQJCP",
        name: "Stoatling",
        starting_trophies: 5976,
      },
    ],
  });
  await emitEvent(ctx.db, "arena_changed", {
    tag: OBSERVER,
    windowStart: "2026-09-02T06:07:49Z",
    windowEnd: "2026-09-02T08:45:10Z",
    occurredAt: "2026-09-02T06:46:32Z",
    payload: {
      from: 54000013,
      to: 54000014,
      to_name: "Royal Crypt",
      promoted_by: {
        battle_id: "x",
        battle_time: "2026-09-02T06:46:32.000Z",
        type: "PvP",
        opponent: {
          player_tag: "#0UCRRQJCP",
          name: "Stoatling",
          starting_trophies: 5976,
        },
        crowns: 3,
        crowns_against: 0,
        trophy_change: 30,
        trophies_after: 6000,
        arena_floor: 6000,
      },
    },
  });
  await ctx.db.query(
    `insert into arena (arena_id, name, observed_at) values (54000013, 'Executioner''s Kitchen', now())
     on conflict do nothing`,
  );
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-02",
    to: "2026-09-03",
    sections: ["trophies"],
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const moved = body.timeline.find((it) => it.kind === "arena_changed");
  assert.ok(moved, JSON.stringify(body.timeline));
  assert.equal(
    moved.at,
    "2026-09-02T06:46:32.000Z",
    "the battle, not the poll",
  );
  assert.equal(moved.facts.promoted_by.opponent.name, "Stoatling");
  assert.equal(
    moved.text,
    "Toad Thistle ö🐉 moved to Royal Crypt from Executioner's Kitchen, on a 3-0 win over Stoatling (5,976), +30 to 6,000.",
  );
});

test("ranked, best-band and career-wins moments name their battle the same way", async () => {
  await seedCrossing(ctx.db, {
    battle_id: "y1",
    at: "2026-09-02T04:34:50.000Z",
    type: "pathOfLegend",
    observer: OBSERVER,
    crowns: 1,
    crowns_against: 0,
    trophy_change: 30,
    opponents: [{ player_tag: "#08GVJGV9", name: "Fern Vole" }],
  });
  await seedCrossing(ctx.db, {
    battle_id: "y2",
    at: "2026-09-02T04:40:00.000Z",
    observer: OBSERVER,
    starting_trophies: 5970,
    crowns: 3,
    crowns_against: 0,
    trophy_change: 30,
    opponents: [
      {
        player_tag: "#0UCRRQJCP",
        name: "Stoatling",
        starting_trophies: 5976,
      },
    ],
  });
  await seedCrossing(ctx.db, {
    battle_id: "y3",
    at: "2026-09-02T04:45:00.000Z",
    type: "clanMate2v2",
    observer: OBSERVER,
    crowns: 2,
    crowns_against: 1,
    trophy_change: null,
    opponents: [
      { player_tag: "#0CJ2Q", name: "Ann" },
      { player_tag: "#0UUL0", name: null },
    ],
  });
  const battle = (extra) => ({
    battle_id: "y1",
    battle_time: "2026-09-02T04:34:50.000Z",
    type: "pathOfLegend",
    opponent: {
      player_tag: "#08GVJGV9",
      name: "Fern Vole",
      starting_trophies: null,
    },
    crowns: 1,
    crowns_against: 0,
    trophy_change: 30,
    ...extra,
  });
  await emitEvent(ctx.db, "ranked_promotion", {
    tag: OBSERVER,
    windowStart: "2026-09-02T01:00:00Z",
    windowEnd: "2026-09-02T05:07:46Z",
    occurredAt: "2026-09-02T04:34:50Z",
    payload: { from: 1, to: 2, promoted_by: battle({}) },
  });
  await emitEvent(ctx.db, "best_trophies_band", {
    tag: OBSERVER,
    windowStart: "2026-09-02T01:00:00Z",
    windowEnd: "2026-09-02T05:07:46Z",
    occurredAt: "2026-09-02T04:40:00Z",
    payload: {
      best: 6087,
      band: 6000,
      crossed_by: battle({
        battle_id: "y2",
        battle_time: "2026-09-02T04:40:00.000Z",
        type: "PvP",
        opponent: {
          player_tag: "#0UCRRQJCP",
          name: "Stoatling",
          starting_trophies: 5976,
        },
        crowns: 3,
        trophies_after: 6000,
      }),
    },
  });
  await emitEvent(ctx.db, "career_wins_step", {
    tag: OBSERVER,
    windowStart: "2026-09-02T01:00:00Z",
    windowEnd: "2026-09-02T05:07:46Z",
    occurredAt: "2026-09-02T04:45:00Z",
    payload: {
      wins: 11001,
      step: 11000,
      crossed_by: battle({
        battle_id: "y3",
        battle_time: "2026-09-02T04:45:00.000Z",
        type: "clanMate2v2",
        opponent: null,
        opponents: [
          { player_tag: "#0CJ2Q", name: "Ann" },
          { player_tag: "#0UUL0", name: null },
        ],
        crowns: 2,
        crowns_against: 1,
        trophy_change: null,
      }),
    },
  });
  // The plain shape, still: a moment the record could not pin.
  await emitEvent(ctx.db, "career_wins_step", {
    tag: OBSERVER,
    windowStart: "2026-09-02T05:07:46Z",
    windowEnd: "2026-09-02T09:00:00Z",
    payload: { wins: 12003, step: 12000 },
  });
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-02",
    to: "2026-09-03",
    sections: ["ranked", "trophies", "battles"],
    // The moments are learned in this window; two happened the evening
    // before it (Chicago), so the window is by observation.
    basis: "observed",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const text = (kind) =>
    body.timeline.filter((it) => it.kind === kind).map((it) => it.text);
  assert.deepEqual(text("ranked_promotion"), [
    "Toad Thistle ö🐉 was promoted to Master II, on a 1-0 win over Fern Vole, +30.",
  ]);
  assert.deepEqual(text("best_trophies_band"), [
    // The best (6,087) came after the crossing battle (to 6,000), so
    // the crossing is told, then the peak (2026-10-11).
    "Toad Thistle ö🐉 passed 6,000 trophies for the first time, on a 3-0 win over Stoatling (5,976), +30 to 6,000, and went on to a best of 6,087.",
  ]);
  // Newest first (7.0.0).
  assert.deepEqual(text("career_wins_step"), [
    "Toad Thistle ö🐉 passed 12,003 career wins.",
    "Toad Thistle ö🐉 passed 11,001 career wins, the 11,000th, on a 2-1 win over Ann and #0UUL0.",
  ]);
});

test("days is sugar on the timeline too: an explicit window, not the pointer", async () => {
  const { body, isError } = await call("elixir_timeline", {
    days: 2,
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.applied.window.source, "argument");
  assert.ok(
    Math.abs(
      Date.parse(body.applied.window.from) - (Date.now() - 2 * 86_400_000),
    ) < 60_000,
    body.applied.window.from,
  );
});

test("3.9.0: a member's session is a clan standout once per rung, named, at the crossing battle; kinds filters items", async () => {
  // A clan member wins six in a row in one sitting (ladder, +30 each):
  // five of them learned by the first window, the sixth by the next.
  const { rows: mem } = await ctx.db.query(
    `select cm.player_tag, p.name from clan_membership cm join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null
      order by cm.player_tag limit 1`,
    [CLAN],
  );
  const member = mem[0];
  const base = Date.parse("2026-09-06T12:00:00Z");
  const mk = async (i, createdAt) => {
    const at = new Date(base + i * 4 * 60_000).toISOString();
    await ctx.db.query(
      `insert into battle (battle_id, battle_time, type, type_class, created_at)
       values ($1, $2, 'PvP', 'pvp', $3)`,
      [`so-${i}`, at, createdAt],
    );
    await ctx.db.query(
      `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, trophy_change, clan_tag, type, type_class)
       values ($1, $2, $3, 0, 'win', 30, $4, 'PvP', 'pvp')`,
      [`so-${i}`, member.player_tag, at, CLAN],
    );
  };
  for (let i = 0; i < 5; i++) await mk(i, "2026-09-06T12:30:00Z");
  await mk(5, "2026-09-06T12:40:00Z");

  const first = await call("elixir_timeline", {
    from: "2026-09-06T12:20:00Z",
    to: "2026-09-06T12:35:00Z",
    kinds: ["session_standout"],
    basis: "observed",
    mark_read: false,
  });
  assert.equal(first.isError, false, JSON.stringify(first.body));
  assert.deepEqual(first.body.applied.kinds, ["session_standout"]);
  assert.equal(
    first.body.timeline.length,
    1,
    JSON.stringify(first.body.timeline),
  );
  const item = first.body.timeline[0];
  assert.equal(
    item.subject_tag,
    CLAN,
    "a member's session on the clan's timeline",
  );
  assert.equal(item.section, "standouts");
  assert.equal(item.facts.name, member.name, "the member is named");
  assert.equal(item.facts.won, 5);
  assert.equal(item.facts.won_in_a_row, 5);
  assert.equal(item.facts.trophy_net, 150);
  assert.deepEqual(item.facts.newly, ["won_in_a_row>=5", "trophy_net>=150"]);
  assert.equal(
    item.at,
    new Date(base + 4 * 4 * 60_000).toISOString(),
    "the crossing battle's instant",
  );
  // 11.8.0: sort_at is the sitting's last battle; each rung names the
  // battle that crossed it and the value there.
  assert.equal(item.sort_at, new Date(base + 4 * 4 * 60_000).toISOString());
  assert.deepEqual(
    item.facts.crossings.map((c) => [c.rung, c.value, c.at]),
    [
      ["won_in_a_row>=5", 5, new Date(base + 4 * 4 * 60_000).toISOString()],
      ["trophy_net>=150", 150, new Date(base + 4 * 4 * 60_000).toISOString()],
    ],
  );
  assert.match(
    item.text,
    /played 5 battles in one session \(5W-0L; 5 Trophy Road, \+150 trophies, 5 wins in a row\), still going\.$/,
  );
  const clanEntry = first.body.entries.find((e) => e.kind === "clan_activity");
  assert.equal(clanEntry.standouts.sessions.items.length, 1);
  assert.deepEqual(clanEntry.standouts.session_rungs.won_in_a_row, [5, 10, 20]);

  // The next window learns the sixth win: no new rung, so no item — a
  // session is never re-reported.
  const next = await call("elixir_timeline", {
    from: "2026-09-06T12:35:00Z",
    to: "2026-09-06T12:45:00Z",
    kinds: ["session_standout"],
    basis: "observed",
    mark_read: false,
  });
  assert.equal(
    next.body.timeline.length,
    0,
    JSON.stringify(next.body.timeline),
  );

  const bad = await call("elixir_timeline", {
    kinds: ["nope"],
    mark_read: false,
  });
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error.code, "bad_request");
});

test("3.9.0: a badge or card moment keeps the member's name; the badge's is under badge/card; badge items only at a rung", async () => {
  const { rows: mem } = await ctx.db.query(
    `select cm.player_tag, p.name from clan_membership cm join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null
      order by cm.player_tag desc limit 1`,
    [CLAN],
  );
  const member = mem[0];
  const write = (type, payload, minute) =>
    emitEvent(ctx.db, type, {
      tag: member.player_tag,
      windowStart: `2026-09-08T10:${minute}:00Z`,
      windowEnd: `2026-09-08T10:${minute}:30Z`,
      payload,
    });
  await write(
    "badge_earned",
    { name: "MasteryHog", level: 4, prior_level: 3, max_level: 10 },
    "01",
  );
  await write(
    "badge_earned",
    { name: "MasteryHog", level: 5, prior_level: 4, max_level: 10 },
    "02",
  );
  await write(
    "badge_earned",
    { name: "Played2Years", level: 2, prior_level: 1, max_level: 2 },
    "03",
  );
  await ctx.db.query(
    `insert into card (card_id, name, kind, rarity) values (26000029, 'Lava Hound', 'card', 'legendary')
     on conflict (card_id) do nothing`,
  );
  await write(
    "card_unlocked",
    { name: "Lava Hound", rarity: "legendary", card_id: 26000029 },
    "04",
  );
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-08T10:00:00Z",
    to: "2026-09-08T11:00:00Z",
    kinds: ["badge_earned", "card_unlocked"],
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const badges = body.timeline.filter((it) => it.kind === "badge_earned");
  assert.deepEqual(
    badges.map((b) => [b.facts.badge, b.facts.level]),
    // Newest first (7.0.0).
    [
      ["Played2Years", 2],
      ["MasteryHog", 5],
    ],
    "level 4 is texture; level 5 and a final level are moments",
  );
  assert.ok(badges.every((b) => b.facts.name === member.name));
  // badge stays the identifier; badge_label and the text are the badge
  // as a player says it (badge-names.mjs).
  const hog = badges.find((b) => b.facts.badge === "MasteryHog");
  assert.equal(hog.facts.badge_label, "Hog Mastery");
  assert.equal(hog.text, `${member.name} took Hog Mastery to level 5.`);
  const card = body.timeline.find((it) => it.kind === "card_unlocked");
  assert.equal(card.facts.card, "Lava Hound");
  assert.equal(card.facts.name, member.name);
  assert.equal(card.text, `${member.name} unlocked Lava Hound.`);
  // The entry still counts every level-up.
  const clanEntry = body.entries.find((e) => e.kind === "clan_activity");
  const counted = clanEntry.standouts.badges.find(
    (b) => b.tag === member.player_tag,
  );
  assert.equal(counted.count, 3);
});

// #110: an Evolution or Hero unlock is a named moment in the collection
// section, and on its own it is news: the player has an entry, not a line
// in quiet.
test("9.14.0: a form unlock is an item and the only news a player needs", async () => {
  await ctx.db.query(
    `insert into card (card_id, name, kind, rarity) values (26000011, 'Valkyrie', 'card', 'rare')
     on conflict (card_id) do nothing`,
  );
  await emitEvent(ctx.db, "card_form_unlocked", {
    tag: PROFILE,
    windowEnd: "2026-09-20T10:05:00Z",
    payload: { card_id: 26000011, name: "Valkyrie", form: "hero" },
  });
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-20T10:00:00Z",
    to: "2026-09-20T11:00:00Z",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const item = body.timeline.find(
    (it) => it.kind === "card_form_unlocked" && it.subject_tag === PROFILE,
  );
  assert.ok(item, JSON.stringify(body.timeline));
  assert.equal(item.section, "collection");
  assert.deepEqual(
    [item.facts.card, item.facts.card_id, item.facts.form],
    ["Valkyrie", 26000011, "hero"],
  );
  assert.equal(item.observed_at, "2026-09-20T10:05:00.000Z");
  assert.match(item.text, /unlocked Hero Valkyrie\.$/);
  const entry = body.entries.find((e) => e.subject_tag === PROFILE);
  assert.ok(entry, "a form unlock alone is not a quiet window");
  assert.deepEqual(entry.collection.forms_unlocked.items, ["Hero Valkyrie"]);
  assert.match(entry.summary, /unlocked Hero Valkyrie/);
  assert.ok(!body.quiet.some((q) => q.tag === PROFILE));
  // The ledger's start for this kind is said, pointing at the collection.
  assert.ok(
    body.notes.some((n) => n.includes("players_collection.forms_unlocked")),
  );
  // kinds filters to it.
  const only = await call("elixir_timeline", {
    from: "2026-09-20T10:00:00Z",
    to: "2026-09-20T11:00:00Z",
    kinds: ["card_form_unlocked"],
    mark_read: false,
  });
  assert.ok(only.body.timeline.length > 0);
  assert.ok(only.body.timeline.every((it) => it.kind === "card_form_unlocked"));
});

// The owner, 2026-11-17: a badge's rung (written since 0286) is told; a day
// of one badge is one item at its latest level; a day of one player's
// Mastery badges is one item; a row from before 0286 keeps its rule.
test("13.5.0: badge rungs, one story per badge and per player's Mastery a day, the old rule for old rows", async () => {
  const { rows: mem } = await ctx.db.query(
    `select cm.player_tag, p.name from clan_membership cm join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null
      order by cm.player_tag asc limit 1`,
    [CLAN],
  );
  const member = mem[0];
  const write = (tag, payload, hour) =>
    emitEvent(ctx.db, "badge_earned", {
      tag,
      windowStart: `2026-09-22T${hour}:00:00Z`,
      windowEnd: `2026-09-22T${hour}:30:00Z`,
      payload,
    });
  for (const tag of [PROFILE, member.player_tag]) {
    // An old row (no rung): level 7 hides, as it always did.
    await write(
      tag,
      { name: "MasteryKnight", level: 7, prior_level: 6, max_level: 10 },
      "08",
    );
    // Two badges' worth of Mastery rungs, one of them crossed twice.
    await write(
      tag,
      { name: "MasteryHogRider", level: 6, prior_level: 3, rung: 5 },
      "09",
    );
    await write(
      tag,
      {
        name: "MasteryMinions",
        level: 5,
        prior_level: 4,
        max_level: 10,
        rung: 5,
      },
      "09",
    );
    await write(
      tag,
      { name: "MasteryHogRider", level: 10, prior_level: 9, rung: 10 },
      "11",
    );
    // A tiered badge levelled twice in the day: one item, its latest.
    await write(tag, { name: "2v2", level: 2, prior_level: 1, rung: 2 }, "09");
    await write(tag, { name: "2v2", level: 3, prior_level: 2, rung: 3 }, "11");
    await write(
      tag,
      { name: "YearsPlayed", level: 5, prior_level: 4, rung: 5 },
      "11",
    );
  }
  const read = (from, to) =>
    call("elixir_timeline", {
      from,
      to,
      kinds: ["badge_earned"],
      mark_read: false,
    });
  const { body, isError } = await read(
    "2026-09-22T00:00:00Z",
    "2026-09-22T23:00:00Z",
  );
  assert.equal(isError, false, JSON.stringify(body));
  for (const tag of [PROFILE, member.player_tag]) {
    const mine = body.timeline.filter(
      (it) => (it.facts.player_tag ?? it.subject_tag) === tag,
    );
    const said = mine.map((it) =>
      it.text.replace(/^.*? (?=(took|reached|earned|has played))/, ""),
    );
    assert.deepEqual(
      said.sort(),
      [
        "has played Clash Royale for 5 years.",
        "reached Mastery level 10 with 1 card and level 5 with 1 card.",
        "took 2v2 to level 3.",
      ].sort(),
      JSON.stringify(mine.map((it) => it.text)),
    );
    const mastery = mine.find((it) => Array.isArray(it.facts.badges));
    assert.equal(mastery.facts.badge_count, 2);
    assert.equal(mastery.facts.level, 10);
    assert.equal(mastery.facts.badge, "MasteryHogRider");
    // Every top-level badge fact is the top badge's own (Codex, #1103):
    // Hog Rider rose from 3 today, whichever row came last.
    assert.equal(mastery.facts.prior_level, 3);
    assert.equal("max_level" in mastery.facts, false);
    assert.equal(mastery.revision, 3, "three level-ups in the story");
    assert.equal(mastery.schema, "badge_earned/3");
    const two = mine.find((it) => it.facts.badge === "2v2");
    assert.equal(two.facts.prior_level, 1, "from the day's first level");
    assert.equal(two.revision, 2);
  }
  // The player's story and the member's are one story each, the same id
  // whatever the window holds of the day.
  const morning = await read("2026-09-22T00:00:00Z", "2026-09-22T10:00:00Z");
  const id = (b, tag) =>
    b.timeline.find(
      (it) =>
        (it.facts.player_tag ?? it.subject_tag) === tag &&
        Array.isArray(it.facts.badges),
    )?.id;
  assert.equal(
    id(morning.body, PROFILE),
    id(body, PROFILE),
    "a window over part of the day tells the same story",
  );
});

test("13.5.0: profile moments are items with their sentences", async () => {
  await ctx.db.query(
    `insert into card (card_id, name, kind, rarity) values (26000021, 'Hog Rider', 'card', 'rare')
     on conflict (card_id) do nothing`,
  );
  const write = (type, payload, minute) =>
    emitEvent(ctx.db, type, {
      tag: PROFILE,
      windowStart: "2026-09-23T09:00:00Z",
      windowEnd: `2026-09-23T10:${minute}:00Z`,
      payload,
    });
  await write(
    "card_maxed",
    { card_id: 26000021, name: "Hog Rider", rarity: "rare", level: 16 },
    "01",
  );
  await write("king_tower_leveled", { level: 15, prior_level: 14 }, "02");
  await write("challenge_best_run", { best: 9, best_before: 7 }, "03");
  await write(
    "twelve_win_run",
    { name: "Grand12Wins", runs: 6, runs_before: 5 },
    "04",
  );
  await write(
    "twelve_win_run",
    { name: "Classic12Wins", runs: 4, runs_before: 1 },
    "05",
  );
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-23T10:00:00Z",
    to: "2026-09-23T11:00:00Z",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  // PROFILE is also a member of the clan the account follows: one story,
  // told once, on whichever timeline serves it.
  const mine = body.timeline.filter(
    (it) => (it.facts.player_tag ?? it.subject_tag) === PROFILE,
  );
  const text = (kind, pick = () => true) =>
    mine
      .find((it) => it.kind === kind && pick(it))
      ?.text.replace(/^.*? (?=(maxed|reached|won))|^.*?(?='s best)/, "");
  assert.equal(text("card_maxed"), "maxed Hog Rider.");
  assert.equal(text("king_tower_leveled"), "reached King Tower level 15.");
  assert.equal(
    text("challenge_best_run"),
    "'s best challenge run is now 9 wins.",
  );
  assert.equal(
    text("twelve_win_run", (it) => it.facts.badge === "Grand12Wins"),
    "won 12 in Grand Challenge.",
  );
  assert.equal(
    text("twelve_win_run", (it) => it.facts.badge === "Classic12Wins"),
    "won 12 in Classic Challenge 3 times.",
  );
  // On a clan's timeline a member's moment is a standout; on the
  // player's own, its section (collection for a card or the King Tower,
  // battles for a challenge).
  const want = {
    card_maxed: "collection",
    king_tower_leveled: "collection",
    challenge_best_run: "battles",
    twelve_win_run: "battles",
  };
  for (const it of mine)
    assert.ok(
      [want[it.kind], "standouts"].includes(it.section),
      `${it.kind} in ${it.section}`,
    );
  assert.equal(mine.length, 5);
});

test("13.6.0: a deck switch is an item with its sentence, its decks by label and the deck row", async () => {
  await ctx.db.query(
    `insert into card (card_id, name, kind, rarity, elixir_cost) values (26000021, 'Hog Rider', 'card', 'rare', 4)
     on conflict (card_id) do nothing`,
  );
  for (const [hash, label] of [
    ["switch-hog", "Hog Rider cycle"],
    ["switch-golem", "Golem beatdown"],
  ])
    await ctx.db.query(
      `insert into deck (deck_hash, card_count, first_seen_at, last_seen_at,
                         archetype_family, archetype_label, card_ids, card_forms)
       values ($1, 8, '2026-09-01', '2026-09-24', 'cycle', $2, '{26000021}', '{0}')
       on conflict do nothing`,
      [hash, label],
    );
  await emitEvent(ctx.db, "deck_switched", {
    tag: PROFILE,
    windowStart: "2026-09-24T08:00:00Z",
    windowEnd: "2026-09-24T10:30:00Z",
    occurredAt: "2026-09-24T10:30:00Z",
    payload: {
      mode_group: "ladder",
      deck_hash: "switch-hog",
      prior_deck_hash: "switch-golem",
      battles: 5,
      wins: 3,
    },
  });
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-24T10:00:00Z",
    to: "2026-09-24T11:00:00Z",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const it = body.timeline.find(
    (x) =>
      x.kind === "deck_switched" &&
      (x.facts.player_tag ?? x.subject_tag) === PROFILE,
  );
  assert.ok(it, "the switch is an item");
  assert.equal(it.schema, "deck_switched/1");
  assert.equal(it.at, "2026-09-24T10:30:00.000Z");
  assert.ok(["battles", "standouts"].includes(it.section));
  assert.equal(it.facts.mode, "ladder");
  assert.equal(it.facts.deck, "Hog Rider cycle");
  assert.equal(it.facts.prior_deck, "Golem beatdown");
  assert.equal("deck_hash" in it.facts, false, "decks by label, never a hash");
  assert.match(
    it.text,
    / switched to Hog Rider cycle on Trophy Road: 5 battles, 3 wins\.$/,
  );
});

// The owner, 2026-11-17: "Pip finished the Ranked season in Master I."
// The league, a rating only in Ultimate Champion, never a rank; a
// player's own moment, never a clan's feed.
test("13.8.0: a Ranked season's finish is a player's item at the season's end; never on a clan's timeline", async () => {
  const { rows: mem } = await ctx.db.query(
    `select cm.player_tag from clan_membership cm join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null
        and cm.player_tag <> all($2::text[])
      order by cm.player_tag asc limit 1`,
    [CLAN, [PROFILE, OBSERVER]],
  );
  const finish = (tag, payload) =>
    emitEvent(ctx.db, "ranked_season_finished", {
      tag,
      windowStart: "2026-08-03T10:00:00Z",
      windowEnd: "2026-09-07T13:00:00Z",
      occurredAt: "2026-09-07T10:00:00Z",
      payload,
    });
  await finish(PROFILE, { season_month: "2026-08", league: 7, rating: 2345 });
  await finish(mem[0].player_tag, {
    season_month: "2026-08",
    league: 3,
    rating: null,
  });
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-07T09:00:00Z",
    to: "2026-09-07T14:00:00Z",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const mine = body.timeline.filter((x) => x.kind === "ranked_season_finished");
  assert.equal(
    mine.length,
    1,
    "the member's finish is not on the clan's timeline",
  );
  const [it] = mine;
  assert.equal(it.facts.player_tag ?? it.subject_tag, PROFILE);
  assert.ok(
    body.entries.some((e) => e.subject_tag === PROFILE),
    "a player whose window holds only the finish is not quiet",
  );
  assert.equal(it.schema, "ranked_season_finished/1");
  assert.equal(it.at, "2026-09-07T10:00:00.000Z");
  assert.equal(it.section, "ranked");
  assert.equal(it.facts.season, "2026-08");
  assert.equal(it.facts.league_name, "Ultimate Champion");
  assert.equal(it.facts.rating, 2345);
  assert.equal("rank" in it.facts, false, "never a global rank");
  assert.match(
    it.text,
    / finished the Ranked season in Ultimate Champion, rated 2,345\.$/,
  );
});

test("13.9.0: a first win with a new Evo is the member's item at the winning battle, named as its deck slot", async () => {
  const {
    rows: [won],
  } = await ctx.db.query(
    `select bp.battle_id, bp.battle_time from battle_participant bp
      where bp.player_tag = $1 and bp.outcome = 'win'
      order by bp.battle_time desc limit 1`,
    [OBSERVER],
  );
  const {
    rows: [card],
  } = await ctx.db.query(
    `select card_id, name from card where kind = 'card' and name is not null
      order by card_id limit 1`,
  );
  const at = won.battle_time.toISOString();
  await emitEvent(ctx.db, "card_first_win", {
    tag: OBSERVER,
    windowStart: new Date(won.battle_time.getTime() - 86_400_000).toISOString(),
    windowEnd: at,
    occurredAt: at,
    payload: {
      card_id: card.card_id,
      form: "evolution",
      battle_id: won.battle_id,
    },
  });
  const { body, isError } = await call("elixir_timeline", {
    from: new Date(won.battle_time.getTime() - 60_000).toISOString(),
    to: new Date(won.battle_time.getTime() + 60_000).toISOString(),
    mark_read: false,
    kinds: ["card_first_win"],
  });
  assert.equal(isError, false, JSON.stringify(body));
  const [it] = body.timeline.filter((x) => x.kind === "card_first_win");
  assert.ok(it, JSON.stringify(body.timeline.map((x) => x.kind)));
  assert.equal(it.schema, "card_first_win/1");
  assert.equal(it.at, at);
  assert.equal(it.section, "battles");
  assert.equal(it.facts.card, card.name);
  assert.equal(it.facts.card_id, card.card_id);
  assert.equal(it.facts.form, "evolution");
  assert.equal(it.facts.tower_troop, false);
  assert.equal(it.facts.battle_id, won.battle_id);
  assert.equal(
    it.text.endsWith(`won with Evo ${card.name} for the first time.`),
    true,
    it.text,
  );
});

test("player_tag keeps one member's items, before the cap; a bad tag is refused (7.1.5, Gym #253)", async () => {
  // A closed window: an open one is capped at 30 days before now, which
  // passed the fixture's September on 2026-10-24.
  const all = await call("elixir_timeline", {
    from: "2026-09-01",
    to: "2026-09-30",
    mark_read: false,
  });
  const mine = await call("elixir_timeline", {
    from: "2026-09-01",
    to: "2026-09-30",
    mark_read: false,
    player_tag: OBSERVER,
  });
  assert.equal(mine.isError, false, JSON.stringify(mine.body));
  assert.ok(mine.body.timeline.length > 0);
  assert.ok(
    mine.body.timeline.every(
      (it) => it.subject_tag === OBSERVER || it.facts?.player_tag === OBSERVER,
    ),
  );
  assert.ok(mine.body.timeline.length <= all.body.timeline.length);
  const bad = await call("elixir_timeline", {
    from: "2026-09-01",
    to: "2026-09-30",
    mark_read: false,
    player_tag: "#NOPE!!",
  });
  assert.equal(bad.isError, true);
});

/** One battle of a sitting, as rows: learned at `createdAt`. */
async function seedSittingBattle(
  db,
  { id, player, at, createdAt, outcome = "win", clanTag = null },
) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $3)`,
    [id, at, createdAt],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, trophy_change, clan_tag, type, type_class)
     values ($1, $2, $3, 0, $4, 0, $5, 'PvP', 'pvp')`,
    [id, player, at, outcome, clanTag],
  );
}

test("9.15.0: one sitting read through overlapping windows is one story, its revision the battles so far (#111)", async () => {
  // Six battles four minutes apart; the first three learned at 12:10,
  // the rest at 12:30. The player path builds a session from the battles
  // a window learned, so the later window's session starts at battle 3.
  const base = Date.parse("2026-09-07T12:00:00Z");
  for (let i = 0; i < 6; i++)
    await seedSittingBattle(ctx.db, {
      id: `sit-${i}`,
      player: PROFILE,
      at: new Date(base + i * 4 * 60_000).toISOString(),
      createdAt: i < 3 ? "2026-09-07T12:10:00Z" : "2026-09-07T12:30:00Z",
    });
  const read = async (from, to) => {
    const { body, isError } = await call("elixir_timeline", {
      from,
      to,
      kinds: ["battle_session"],
      basis: "observed",
      mark_read: false,
    });
    assert.equal(isError, false, JSON.stringify(body));
    const mine = body.timeline.filter((it) => it.subject_tag === PROFILE);
    assert.equal(mine.length, 1, JSON.stringify(body.timeline));
    return mine[0];
  };
  const early = await read("2026-09-07T12:05:00Z", "2026-09-07T12:15:00Z");
  const late = await read("2026-09-07T12:20:00Z", "2026-09-07T12:35:00Z");
  const whole = await read("2026-09-07T12:05:00Z", "2026-09-07T12:35:00Z");
  assert.match(early.id, /^tl_[0-9a-f]{20}$/);
  assert.equal(early.facts.battles, 3);
  assert.equal(
    late.facts.started_at,
    new Date(base + 3 * 4 * 60_000).toISOString(),
    "the late window's session starts inside the sitting",
  );
  assert.equal(late.id, early.id, "the same sitting, the same story");
  assert.equal(whole.id, early.id);
  assert.equal(early.revision, 3);
  assert.equal(late.revision, 6, "grown: every battle from the first");
  assert.equal(whole.revision, 6);
  assert.equal(
    early.id,
    storyId("sitting", PROFILE, new Date(base).toISOString()),
    "anchored at the sitting's first battle",
  );
});

test("9.15.0: a standout crossing 20 then 40 battles keeps its id and raises its revision; the member's session shares it (#111)", async () => {
  const { rows: mem } = await ctx.db.query(
    `select cm.player_tag from clan_membership cm join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null
      order by cm.player_tag offset 1 limit 1`,
    [CLAN],
  );
  const member = mem[0].player_tag;
  // Forty battles a minute apart, alternating, so only the battles rung
  // is crossed: 0-19 learned at 13:25, 20-39 at 13:45.
  const base = Date.parse("2026-09-08T13:00:00Z");
  for (let i = 0; i < 40; i++)
    await seedSittingBattle(ctx.db, {
      id: `rung-${i}`,
      player: member,
      at: new Date(base + i * 60_000).toISOString(),
      createdAt: i < 20 ? "2026-09-08T13:25:00Z" : "2026-09-08T13:45:00Z",
      outcome: i % 2 ? "loss" : "win",
      clanTag: CLAN,
    });
  const standout = async (from, to) => {
    const { body } = await call("elixir_timeline", {
      from,
      to,
      kinds: ["session_standout"],
      basis: "observed",
      mark_read: false,
    });
    const found = body.timeline.filter((it) => it.facts.player_tag === member);
    assert.equal(found.length, 1, JSON.stringify(body.timeline));
    return found[0];
  };
  const twenty = await standout("2026-09-08T13:20:00Z", "2026-09-08T13:30:00Z");
  const forty = await standout("2026-09-08T13:40:00Z", "2026-09-08T13:50:00Z");
  assert.deepEqual(twenty.facts.newly, ["battles>=20"]);
  assert.deepEqual(forty.facts.newly, ["battles>=40"]);
  assert.equal(forty.id, twenty.id, "the same sitting, grown");
  assert.equal(twenty.revision, 20);
  assert.equal(forty.revision, 40);
  // A wider window that holds both crossings is the same story at 40.
  const both = await standout("2026-09-08T13:20:00Z", "2026-09-08T13:50:00Z");
  assert.equal(both.id, twenty.id);
  assert.equal(both.revision, 40);
  // The member's own session of that sitting is the same story, served
  // once (11.8.0, #374): the standout's telling, about both subjects.
  const { body } = await call("elixir_timeline", {
    from: "2026-09-08T13:40:00Z",
    to: "2026-09-08T13:50:00Z",
    kinds: ["battle_session", "session_standout"],
    player_tag: member,
    basis: "observed",
    mark_read: false,
  });
  const ofIt = body.timeline.filter((it) => it.id === twenty.id);
  assert.equal(ofIt.length, 1, JSON.stringify(body.timeline));
  assert.equal(ofIt[0].kind, "session_standout");
  assert.equal(ofIt[0].revision, 40);
  assert.deepEqual(
    ofIt[0].subjects.map((s) => [s.kind, s.tag]),
    [
      ["player", member],
      ["clan", CLAN],
    ],
  );
});

test("9.15.0: a duplicated ledger moment keeps one id whichever row a window holds; ledgers never collide (#111)", async () => {
  // The same promotion written by two polls of one day (feedback #48).
  for (const windowEnd of ["2026-09-09T07:22:00Z", "2026-09-09T16:22:00Z"])
    await emitEvent(ctx.db, "ranked_promotion", {
      tag: PROFILE,
      payload: { from: 1, to: 2 },
      windowEnd,
    });
  const promo = async (from, to) => {
    const { body } = await call("elixir_timeline", {
      from,
      to,
      kinds: ["ranked_promotion"],
      mark_read: false,
    });
    // On the clan's timeline, as the member's moment (a player whose
    // only news is a ledger moment is quiet on its own).
    const found = body.timeline.filter(
      (it) => it.subject_tag === PROFILE || it.facts.player_tag === PROFILE,
    );
    assert.equal(found.length, 1, JSON.stringify(body.timeline));
    return found[0];
  };
  const both = await promo("2026-09-09T00:00:00Z", "2026-09-10T00:00:00Z");
  const first = await promo("2026-09-09T07:00:00Z", "2026-09-09T08:00:00Z");
  const second = await promo("2026-09-09T16:00:00Z", "2026-09-09T17:00:00Z");
  const { rows: ids } = await ctx.db.query(
    `select min(event_id)::text as id from player_event
      where player_tag = $1 and event_type = 'ranked_promotion'
        and window_end::date = '2026-09-09'`,
    [PROFILE],
  );
  assert.equal(both.id, storyId("player_event", ids[0].id), "the lowest row");
  assert.equal(first.id, both.id);
  assert.equal(second.id, both.id, "the later row alone: the same story");
  assert.equal(both.revision, 1, "a moment never grows");

  // One sequence number in three ledgers: three stories.
  const n = 910_001;
  await ctx.db.query(
    `insert into player_event (event_id, player_tag, event_type, timing, window_start, window_end, league_from, league_to)
     overriding system value values ($1, $2, 'ranked_promotion', 'estimated', $3, $3, 2, 3)`,
    [n, PROFILE, "2026-09-11T10:00:00Z"],
  );
  await ctx.db.query(
    `insert into clan_event (event_id, clan_tag, event_type, timing, window_start, window_end, player_tag, role_before, role_after)
     overriding system value values ($1, $2, 'role_changed', 'estimated', $3, $3, $4, 'member', 'elder')`,
    [n, CLAN, "2026-09-11T10:00:00Z", PROFILE],
  );
  await ctx.db.query(
    `insert into account_event (event_id, account_id, kind, detail, created_at)
     overriding system value values ($1, $2, 'feedback_responded', '{}', $3)`,
    [n, owner, "2026-09-11T10:00:00Z"],
  );
  const { body } = await call("elixir_timeline", {
    from: "2026-09-11T09:00:00Z",
    to: "2026-09-11T11:00:00Z",
    kinds: [
      "ranked_promotion",
      "member_role_changed",
      "account_feedback_responded",
    ],
    mark_read: false,
  });
  const byKind = Object.fromEntries(body.timeline.map((it) => [it.kind, it]));
  assert.equal(
    byKind.ranked_promotion?.id,
    storyId("player_event", String(n)),
    JSON.stringify(body.timeline),
  );
  assert.equal(
    byKind.member_role_changed?.id,
    storyId("clan_event", String(n)),
  );
  assert.equal(
    byKind.account_feedback_responded?.id,
    storyId("account_event", String(n)),
  );
  assert.equal(
    new Set(body.timeline.map((it) => it.id)).size,
    body.timeline.length,
    "no two ledgers' rows share an id",
  );
  for (const it of body.timeline)
    assert.ok(!JSON.stringify(it).includes(String(n)), "no raw sequence");
});

test("11.15.0, 2026-11-16: a ranked sitting's trophy_net is Trophy Road's alone; Ranked's unrated +30s are no net, and its climb is told", async () => {
  // A member wins five Ranked games in a row (+30 each, no rating): two
  // in Master III, then three in Champion. The streak rung makes it a
  // standout and Trophy Road does not move.
  const { rows: mem } = await ctx.db.query(
    `select cm.player_tag from clan_membership cm join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null
      order by cm.player_tag offset 1 limit 1`,
    [CLAN],
  );
  const tag = mem[0].player_tag;
  const base = Date.parse("2026-09-13T12:00:00Z");
  const mk = async (i, type, change, league = null) => {
    const at = new Date(base + i * 4 * 60_000).toISOString();
    await ctx.db.query(
      `insert into battle (battle_id, battle_time, type, type_class, created_at, league_number, deck_selection)
       values ($1, $2, $3, 'pvp', '2026-09-13T12:40:00Z', $4, 'collection')`,
      [`rk-${i}`, at, type, league],
    );
    await ctx.db.query(
      `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, trophy_change, clan_tag, type, type_class)
       values ($1, $2, $3, 0, 'win', $4, $5, $6, 'pvp')`,
      [`rk-${i}`, tag, at, change, CLAN, type],
    );
  };
  for (let i = 0; i < 5; i++) await mk(i, "pathOfLegend", 30, i < 2 ? 3 : 4);
  // One Trophy Road win after them: ladder keeps its own net.
  await mk(5, "PvP", 12);

  const { isError, body } = await call("elixir_timeline", {
    from: "2026-09-13T12:30:00Z",
    to: "2026-09-13T12:50:00Z",
    kinds: ["session_standout"],
    basis: "observed",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const item = body.timeline.find((it) => it.facts.player_tag === tag);
  assert.ok(item, JSON.stringify(body.timeline));
  assert.equal(item.schema, "session_standout/6");
  assert.equal(item.facts.trophy_net, 12, "Trophy Road's alone");
  assert.deepEqual(item.facts.trophy_net_by_mode, { ladder: 12 });
  assert.deepEqual(item.facts.ranked, {
    battles: 5,
    won: 5,
    lost: 0,
    league_from: 3,
    league_from_name: "Master III",
    league_to: 4,
    league_to_name: "Champion",
    promotions: [
      {
        from: 3,
        to: 4,
        from_name: "Master III",
        to_name: "Champion",
        battle_id: "rk-1",
        at: "2026-09-13T12:04:00.000Z",
      },
    ],
  });
  assert.match(item.text, /5 Ranked, 1 Trophy Road/);
  assert.match(item.text, /; climbed Master III to Champion/);
  assert.doesNotMatch(item.text, /Path of Legends/);
});

test("2026-11-16: an Ultimate Champion sitting carries its rating, and only rated changes are Ranked's net", async () => {
  const { rows: mem } = await ctx.db.query(
    `select cm.player_tag from clan_membership cm join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null
      order by cm.player_tag offset 2 limit 1`,
    [CLAN],
  );
  const tag = mem[0].player_tag;
  const base = Date.parse("2026-09-14T12:00:00Z");
  // Five wins in a row at Ultimate Champion: 1,850 up to 1,940.
  const changes = [20, 18, 17, 19, 16];
  let rating = 1850;
  for (const [i, change] of changes.entries()) {
    const at = new Date(base + i * 4 * 60_000).toISOString();
    await ctx.db.query(
      `insert into battle (battle_id, battle_time, type, type_class, created_at, league_number, deck_selection)
       values ($1, $2, 'pathOfLegend', 'pvp', '2026-09-14T12:40:00Z', 7, 'collection')`,
      [`uc-${i}`, at],
    );
    await ctx.db.query(
      `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, trophy_change, starting_trophies, clan_tag, type, type_class)
       values ($1, $2, $3, 0, 'win', $4, $5, $6, 'pathOfLegend', 'pvp')`,
      [`uc-${i}`, tag, at, change, rating, CLAN],
    );
    rating += change;
  }
  const { isError, body } = await call("elixir_timeline", {
    from: "2026-09-14T12:30:00Z",
    to: "2026-09-14T12:50:00Z",
    kinds: ["session_standout"],
    basis: "observed",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const item = body.timeline.find((it) => it.facts.player_tag === tag);
  assert.ok(item, JSON.stringify(body.timeline));
  assert.deepEqual(item.facts.trophy_net_by_mode, { ranked: 90 });
  assert.deepEqual(item.facts.ranked.rating, { from: 1850, to: 1940 });
  assert.deepEqual(item.facts.ranked.promotions, []);
  assert.match(item.text, /; Ultimate Champion, rating 1,850 to 1,940/);
});

test("2026-11-16: a 2v2 names the followed players met, never a stranger", async () => {
  const { rows: mem } = await ctx.db.query(
    `select cm.player_tag, p.name from clan_membership cm join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null
      order by cm.player_tag offset 3 limit 3`,
    [CLAN],
  );
  const [a, b, c] = mem;
  // An invented stranger: not recorded, in no followed clan.
  const stranger = "#0PLUG2V9";
  await ctx.db.query(
    `insert into player (player_tag, name) values ($1, 'Stranger Fern') on conflict do nothing`,
    [stranger],
  );
  const base = Date.parse("2026-09-15T12:00:00Z");
  for (let i = 0; i < 5; i++) {
    const at = new Date(base + i * 4 * 60_000).toISOString();
    const id = `tv-${i}`;
    await ctx.db.query(
      `insert into battle (battle_id, battle_time, type, type_class, created_at, deck_selection)
       values ($1, $2, 'clanMate2v2', 'pvp', '2026-09-15T12:40:00Z', 'collection')`,
      [id, at],
    );
    for (const [tag, side, outcome] of [
      [a.player_tag, 0, "win"],
      [b.player_tag, 0, "win"],
      [c.player_tag, 1, "loss"],
      [stranger, 1, "loss"],
    ])
      await ctx.db.query(
        `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, crowns, clan_tag, type, type_class)
         values ($1, $2, $3, $4, $5, $6, $7, 'clanMate2v2', 'pvp')`,
        [
          id,
          tag,
          at,
          side,
          outcome,
          outcome === "win" ? 2 : 1,
          side === 0 || tag === c.player_tag ? CLAN : null,
        ],
      );
  }
  const { isError, body } = await call("elixir_timeline", {
    from: "2026-09-15T12:30:00Z",
    to: "2026-09-15T12:50:00Z",
    kinds: ["session_standout"],
    basis: "observed",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const item = body.timeline.find((it) => it.facts.player_tag === a.player_tag);
  assert.ok(item, JSON.stringify(body.timeline));
  assert.deepEqual(
    item.facts.together,
    [
      { player_tag: b.player_tag, name: b.name, with: 5, against: 0 },
      { player_tag: c.player_tag, name: c.name, with: 0, against: 5 },
    ].sort((x, y) => x.player_tag.localeCompare(y.player_tag)),
  );
  assert.ok(!JSON.stringify(item).includes("Stranger Fern"));
  assert.ok(!JSON.stringify(item.facts.together).includes(stranger));
  assert.match(
    item.text,
    new RegExp(`with ${b.name} in 2v2, against ${c.name} \\(`),
  );
});

test("2026-11-16: a challenge is told as a run, with a one-line name; a drafted deck has no label", async () => {
  const { rows: mem } = await ctx.db.query(
    `select cm.player_tag from clan_membership cm join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null and p.name is not null
      order by cm.player_tag offset 6 limit 1`,
    [CLAN],
  );
  const tag = mem[0].player_tag;
  // A recorded deck with a label of its own, played as a draft hands it.
  const { rows: decks } = await ctx.db.query(
    `select deck_hash from battle_participant where deck_hash is not null limit 1`,
  );
  const drafted = decks[0].deck_hash;
  const CH = "#0Q2L8";
  const DR = "#0YY9P";
  await ctx.db.query(
    `insert into game_event (event_tag, title, first_seen_at, last_seen_at)
     values ($1, E'King of Cards\\nQuick Wit Challenge', '2026-09-16', '2026-09-17'),
            ($2, 'C.H.A.O.S Draft', '2026-09-16', '2026-09-17')
     on conflict do nothing`,
    [CH, DR],
  );
  const base = Date.parse("2026-09-16T12:00:00Z");
  const rows = [
    // The challenge: five wins (the counter 0 to 5), then a loss.
    ...[0, 1, 2, 3, 4].map((w) => [
      CH,
      "Challenge_AllCards_EventDeck_NoSet",
      "eventDeck",
      "win",
      1,
      w || null,
    ]),
    [CH, "Challenge_AllCards_EventDeck_NoSet", "eventDeck", "loss", null, 5],
    // A drafted battle: its deck is the draft's, not the player's.
    [DR, "Chaos_1v1_Draft", "draft", "win", null, null],
  ];
  for (const [i, [ev, mode, sel, outcome, change, st]] of rows.entries()) {
    const at = new Date(base + i * 4 * 60_000).toISOString();
    await ctx.db.query(
      `insert into battle (battle_id, battle_time, type, type_class, created_at, event_tag, game_mode_name, deck_selection)
       values ($1, $2, 'trail', 'pvp', '2026-09-16T12:40:00Z', $3, $4, $5)`,
      [`ev-${i}`, at, ev, mode, sel],
    );
    await ctx.db.query(
      `insert into battle_participant (battle_id, player_tag, battle_time, side, outcome, trophy_change, starting_trophies, clan_tag, type, type_class, deck_hash)
       values ($1, $2, $3, 0, $4, $5, $6, $7, 'trail', 'pvp', $8)`,
      [
        `ev-${i}`,
        tag,
        at,
        outcome,
        change,
        st,
        CLAN,
        sel === "draft" ? drafted : null,
      ],
    );
  }
  const { isError, body } = await call("elixir_timeline", {
    from: "2026-09-16T12:30:00Z",
    to: "2026-09-16T12:50:00Z",
    kinds: ["session_standout"],
    basis: "observed",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const item = body.timeline.find((it) => it.facts.player_tag === tag);
  assert.ok(item, JSON.stringify(body.timeline));
  assert.deepEqual(item.facts.events, [
    {
      event_tag: CH,
      name: "King of Cards Quick Wit Challenge",
      battles: 6,
      won: 5,
      lost: 1,
      game_mode: "Challenge_AllCards_EventDeck_NoSet",
      run_wins: 5,
    },
    {
      event_tag: DR,
      name: "C.H.A.O.S Draft",
      battles: 1,
      won: 1,
      lost: 0,
      game_mode: "Chaos_1v1_Draft",
      drawn_decks: true,
    },
  ]);
  assert.deepEqual(item.facts.decks, []);
  assert.deepEqual(item.facts.trophy_net_by_mode, {});
  assert.match(
    item.text,
    /in King of Cards Quick Wit Challenge \(5W-1L, up to 5 wins\), C\.H\.A\.O\.S Draft \(1W-0L, drafted decks\)/,
  );
  assert.ok(!item.text.includes("\n"));
});
