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
import { fixture, scratchDb, seedReceipt } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

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
const OBSERVER = "#UVQ8RJYG9";
const PROFILE = "#JYRQ8U92C";
let ctx;
let owner;
let invoke;

async function call(name, args = {}) {
  const { body, isError } = await invoke(name, args);
  return { body, isError };
}

before(async () => {
  ctx = await scratchDb("activity_tool");
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
  const read = await call("elixir_timeline", { from: "2026-09-03", to });
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
  const { body, isError } = await call("elixir_timeline", {
    from: "2026-09-01",
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const sessions = body.timeline.filter((it) => it.kind === "battle_session");
  // The fixture log: two battles on 09-01 21:56/21:59, then 09-02 runs with
  // gaps of 42+ minutes between 08:08 and 08:50, 09:08 and 10:34, 10:49 and
  // 11:51, 11:51 and 17:46, 18:33 and 19:20, then one on 09-03: eight
  // sessions of one player.
  assert.equal(sessions.length, 8, JSON.stringify(sessions.map((s) => s.at)));
  assert.ok(sessions.every((s) => s.subject_tag === OBSERVER));
  assert.ok(
    sessions.every((s) => /played a session of \d+ battles?/.test(s.text)),
  );
  // Newest first, a newsfeed (7.0.0): the 09-01 pair is last.
  const first = sessions.at(-1);
  assert.equal(first.facts.battles, 2);
  assert.equal(first.section, "battles");
  const ats = body.timeline.map((it) => it.at);
  assert.deepEqual(ats, [...ats].sort().reverse(), "newest first");
  assert.ok(
    body.timeline.every(
      (it) => typeof it.text === "string" && it.text.length > 0,
    ),
  );

  const rosterOnly = await call("elixir_timeline", {
    from: "2026-09-01",
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
      { player_tag: "#VRL0QQVCP", name: "Jotaro", starting_trophies: 5976 },
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
          player_tag: "#VRL0QQVCP",
          name: "Jotaro",
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
  assert.equal(moved.facts.promoted_by.opponent.name, "Jotaro");
  assert.equal(
    moved.text,
    "Wed 01:46 AHMOメŞΛDØW moved to Royal Crypt from Executioner's Kitchen, on a 3-0 win over Jotaro (5,976), +30 to 6,000.",
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
    opponents: [{ player_tag: "#UYCL80G0", name: "XTRAXTOR" }],
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
      { player_tag: "#VRL0QQVCP", name: "Jotaro", starting_trophies: 5976 },
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
      { player_tag: "#2UUUU", name: "Ann" },
      { player_tag: "#2VVVV", name: null },
    ],
  });
  const battle = (extra) => ({
    battle_id: "y1",
    battle_time: "2026-09-02T04:34:50.000Z",
    type: "pathOfLegend",
    opponent: {
      player_tag: "#UYCL80G0",
      name: "XTRAXTOR",
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
          player_tag: "#VRL0QQVCP",
          name: "Jotaro",
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
          { player_tag: "#2UUUU", name: "Ann" },
          { player_tag: "#2VVVV", name: null },
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
    mark_read: false,
  });
  assert.equal(isError, false, JSON.stringify(body));
  const text = (kind) =>
    body.timeline.filter((it) => it.kind === kind).map((it) => it.text);
  assert.deepEqual(text("ranked_promotion"), [
    "Tue 23:34 AHMOメŞΛDØW was promoted to Master 2, on a 1-0 win over XTRAXTOR, +30.",
  ]);
  assert.deepEqual(text("best_trophies_band"), [
    "Tue 23:40 AHMOメŞΛDØW set a new best of 6,087 trophies, crossing 6,000, on a 3-0 win over Jotaro (5,976), +30 to 6,000.",
  ]);
  // Newest first (7.0.0).
  assert.deepEqual(text("career_wins_step"), [
    "Wed 04:00 AHMOメŞΛDØW passed 12,003 career wins.",
    "Tue 23:45 AHMOメŞΛDØW passed 11,001 career wins, the 11,000th, on a 2-1 win over Ann and #2VVVV.",
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
  assert.match(
    item.text,
    /played 5 battles in one sitting \(5W-0L; 5 ladder, \+150 trophies, 5 wins in a row\), still going\.$/,
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
  assert.equal(
    hog.text,
    `Tue 05:02 ${member.name} took Hog Mastery to level 5.`,
  );
  const card = body.timeline.find((it) => it.kind === "card_unlocked");
  assert.equal(card.facts.card, "Lava Hound");
  assert.equal(card.facts.name, member.name);
  assert.equal(card.text, `Tue 05:04 ${member.name} unlocked Lava Hound.`);
  // The entry still counts every level-up.
  const clanEntry = body.entries.find((e) => e.kind === "clan_activity");
  const counted = clanEntry.standouts.badges.find(
    (b) => b.tag === member.player_tag,
  );
  assert.equal(counted.count, 3);
});

test("player_tag keeps one member's items, before the cap; a bad tag is refused (7.1.5, Gym #253)", async () => {
  const all = await call("elixir_timeline", {
    from: "2026-09-01",
    mark_read: false,
  });
  const mine = await call("elixir_timeline", {
    from: "2026-09-01",
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
    mark_read: false,
    player_tag: "#NOPE!!",
  });
  assert.equal(bad.isError, true);
});
