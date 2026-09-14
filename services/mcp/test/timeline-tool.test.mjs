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
import { fixture, scratchDb, seedReceipt } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

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

test("the timeline: battle sessions break on a 30-minute gap, items are oldest first with text, sections filter items", async () => {
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
  const first = sessions[0];
  assert.equal(first.facts.battles, 2);
  assert.equal(first.section, "battles");
  const ats = body.timeline.map((it) => it.at);
  assert.deepEqual(ats, [...ats].sort(), "oldest first");
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
