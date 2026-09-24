/**
 * Activity entries (review 2026-09-13, Parts II/III): one row per subject
 * since the reader's cursor, sections always present, facts named, no
 * instruction and no clock inside.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestClanRoster } from "../../ingest/src/roster.mjs";
import { projectRiverRaceLog } from "../../ingest/src/war.mjs";
import { ingestBattlelog } from "../../ingest/src/battles.mjs";
import { projectPlayerSnapshot } from "../../ingest/src/snapshots.mjs";
import { fixture, scratchDb, seedReceipt } from "../../ingest/test/helpers.mjs";
import {
  buildPlayerEntry,
  buildClanEntry,
  buildEntries,
  capTimeline,
  subjectsFor,
} from "../src/activity/entries.mjs";

const CLAN = "#J2RGCRVG";
const OBSERVER = "#UVQ8RJYG9"; // the battlelog fixture's own player
const PROFILE = "#JYRQ8U92C"; // the profile fixture's player
const FROM = Date.parse("2026-09-03T00:00:00Z");
let ctx;
let owner;
let roster;

before(async () => {
  ctx = await scratchDb("activity");
  const db = ctx.db;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS')`,
    [CLAN],
  );
  owner = (
    await db.query(
      `insert into account (email_hash, status, is_owner, timezone)
       values ('act-owner', 'approved', true, 'America/Chicago') returning account_id`,
    )
  ).rows[0].account_id;
  roster = await fixture("clan/roster.json");
  await ingestClanRoster(db, {
    payload: roster,
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
});

after(async () => ctx.drop());

const SECTIONS_PLAYER = [
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
];
const SECTIONS_CLAN = [
  "activity",
  "roster",
  "war",
  "presence",
  "standouts",
  "donations",
];

test("a player entry is a diff of state plus the battles the record learned", async () => {
  const toMs = Date.now();
  const { entry: e } = await buildPlayerEntry(ctx.db, {
    tag: PROFILE,
    relationship: "primary",
    fromMs: FROM,
    toMs,
    timezone: "America/Chicago",
  });
  for (const k of SECTIONS_PLAYER)
    assert.ok(Object.hasOwn(e, k), `section ${k} always present`);
  assert.equal(e.kind, "player_activity");
  assert.equal(e.trophies.from, 13000);
  assert.equal(e.trophies.to, 13621);
  assert.equal(e.trophies.new_best, true);
  assert.ok(
    e.notables.some(
      (n) => n.kind === "best_trophies_band" && n.value === 13772,
    ),
    "13000 -> 13772 crosses a 500 band",
  );
  assert.match(e.summary, /sikander sidhu/);
  assert.match(e.summary, /13,000 → 13,621/);
  assert.match(e.summary, /new best 13,772/);
  assert.doesNotMatch(
    e.summary,
    /should|must|kick|nudge/i,
    "no instruction in a summary",
  );
});

test("battles the record learned in the window are counted; late captures set aside", async () => {
  const toMs = Date.now();
  const { entry: e } = await buildPlayerEntry(ctx.db, {
    tag: OBSERVER,
    relationship: "friend",
    fromMs: FROM,
    toMs,
  });
  const recorded = (
    await ctx.db.query(
      `select count(distinct battle_id)::int as n from battle_participant where player_tag = $1`,
      [OBSERVER],
    )
  ).rows[0].n;
  assert.ok(recorded >= 25, "the fixture log lands as distinct battles");
  // Every recorded battle is counted exactly once: narrated when played
  // within a day of the window, otherwise as a late capture.
  assert.equal(e.battles.played + e.battles.late_captures, recorded);
  assert.ok(e.battles.played >= 25);
  assert.ok(
    e.battles.by_mode.ranked > 0,
    "pathOfLegend battles group as ranked",
  );
  assert.equal(
    e.battles.won + e.battles.lost + e.battles.drawn,
    e.battles.played,
  );
  assert.ok(e.presence.last_battle_at, "presence knows the last battle");
  assert.match(
    e.summary,
    new RegExp(`${e.battles.played} battles in \\d+ sessions since`),
  );

  // A window that opens after the battles were PLAYED but before the record
  // LEARNED them: they count once, as late captures, and are not narrated.
  const { entry: late } = await buildPlayerEntry(ctx.db, {
    tag: OBSERVER,
    fromMs: toMs - 60_000,
    toMs,
  });
  assert.equal(late.battles.played, 0);
  assert.equal(late.battles.late_captures, recorded);
  assert.match(late.summary, /no recorded battles since/);
});

test("a clan entry names roster moves from the ledger, war state, presence and standouts", async () => {
  // A roster change inside the window: one leaves, one joins.
  const next = structuredClone(roster);
  const [gone] = next.memberList.splice(5, 1);
  next.memberList.push({
    ...gone,
    tag: "#8PYLQGRJC",
    name: "Newcomer",
    role: "member",
  });
  await ingestClanRoster(ctx.db, {
    payload: next,
    observedAt: "2026-09-05T10:00:00Z",
  });
  const toMs = Date.now();
  const { entry: e } = await buildClanEntry(ctx.db, {
    tag: CLAN,
    scope: "comprehensive",
    fromMs: FROM,
    toMs,
  });
  for (const k of SECTIONS_CLAN)
    assert.ok(Object.hasOwn(e, k), `section ${k} always present`);
  assert.equal(e.kind, "clan_activity");
  assert.equal(e.roster.size.to, 49);
  assert.equal(e.roster.joined.items.length, 1);
  assert.equal(e.roster.joined.items[0].name, "Newcomer");
  assert.equal(e.roster.left.items.length, 1);
  assert.equal(e.roster.left.items[0].tag, gone.tag);
  assert.equal(e.roster.left.items[0].name, gone.name, "the leaver is named");
  assert.equal(e.roster.left.items[0].tenure_days, 1);
  assert.ok(e.activity.battles > 0, "battles played while in the clan");
  assert.equal(e.activity.basis, "recorded");
  // The war section is the calendar's week at the window's end (#166);
  // the fixture's race is S134, long closed, so today's week has no race
  // in the record: no fame, never S134's under today's label.
  assert.ok(e.war, "a clan entry has a war section");
  assert.notEqual(e.war.season_id, 134, "not the old week's race");
  assert.equal(e.war.fame, null);
  assert.ok(e.standouts.most_battles.some((m) => m.tag === OBSERVER));
  assert.ok(
    e.presence.never_recorded > 40,
    "a fixture roster is mostly unrecorded",
  );
  assert.deepEqual(e.presence.rungs_days, [5, 10, 20]);
  assert.match(e.summary, /POAP KINGS: /);
  assert.match(e.summary, /joined: Newcomer/);
  assert.match(
    e.summary,
    new RegExp(`left: ${gone.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  assert.doesNotMatch(
    JSON.stringify(e),
    /"day_ends_at"|"closes_at"/,
    "no clock inside an entry",
  );
});

test("an activity-scope clan entry does not claim battle facts it does not record", async () => {
  const { entry: e } = await buildClanEntry(ctx.db, {
    tag: CLAN,
    scope: "activity",
    fromMs: FROM,
    toMs: Date.now(),
  });
  assert.equal(e.activity.battles, null);
  assert.match(e.activity.basis, /activity scope/);
  assert.equal(e.standouts, null);
  assert.equal(e.presence.quiet_crossed, null);
  assert.match(e.summary, /roster and war only/);
});

test("the feed: subjects from claims and clans; silent players go to quiet, not to an entry", async () => {
  const subjects = await subjectsFor(ctx.db, owner);
  assert.deepEqual(
    subjects.map((s) => `${s.kind}:${s.tag}`),
    [`player:${PROFILE}`, `player:${OBSERVER}`, `clan:${CLAN}`],
  );
  const toMs = Date.now();
  const feed = await buildEntries(ctx.db, subjects, {
    fromMs: FROM,
    toMs,
    timezone: "America/Chicago",
  });
  assert.equal(feed.entries.length, 3);
  // A window in which the primary did nothing: it moves to quiet.
  const later = await buildEntries(ctx.db, subjects, {
    fromMs: toMs - 60_000,
    toMs,
  });
  const kinds = later.entries.map((e) => e.kind);
  assert.ok(kinds.includes("clan_activity"), "a clan always gets an entry");
  assert.ok(
    later.quiet.some((q) => q.tag === PROFILE),
    "the silent primary is listed as quiet",
  );
  assert.ok(later.quiet.every((q) => Object.hasOwn(q, "days_since_poll")));
});

test("the clan entry's war day is the calendar's at the window's end, whatever the anchor says", async () => {
  // war_period, not war_period_anchor, answers "which day is it" (this
  // session): a training day and a war day, pinned at fixed instants
  // so both branches run whatever day the suite runs on. S136 opened
  // 2026-09-07 10:00Z: period 1 is a training day, period 4 is war day 2.
  await ctx.db.query("delete from war_period_anchor where clan_tag = $1", [
    CLAN,
  ]);
  const at = (iso) => Date.parse(iso);
  const training = await buildClanEntry(ctx.db, {
    tag: CLAN,
    scope: "comprehensive",
    fromMs: at("2026-09-08T00:00:00Z"),
    toMs: at("2026-09-08T12:00:00Z"),
  });
  assert.equal(training.entry.war.day_kind, "training");
  assert.equal(training.entry.war.war_day, null);
  assert.equal(training.entry.war.decks, null);
  const war = await buildClanEntry(ctx.db, {
    tag: CLAN,
    scope: "comprehensive",
    fromMs: at("2026-09-11T00:00:00Z"),
    toMs: at("2026-09-11T12:00:00Z"),
  });
  assert.equal(war.entry.war.day_kind, "war");
  assert.equal(war.entry.war.war_day, 2);
  // A stale anchor for another period changes nothing.
  await ctx.db.query(
    `insert into war_period_anchor (clan_tag, period_index, first_observed_at)
     values ($1, 30, '2026-09-01T09:40:00Z') on conflict do nothing`,
    [CLAN],
  );
  const again = await buildClanEntry(ctx.db, {
    tag: CLAN,
    scope: "comprehensive",
    fromMs: at("2026-09-11T00:00:00Z"),
    toMs: at("2026-09-11T12:00:00Z"),
  });
  assert.equal(again.entry.war.war_day, 2);
});

test("the cap keeps the newest: the timeline is a newsfeed", () => {
  // Jamie, 2026-09-23 (contract 7.0.0): a window past the cap keeps its
  // newest items and counts the rest, so a reader catching up lands on
  // the present. Items arrive newest first.
  const items = Array.from({ length: 160 }, (_, i) => ({
    at: String(159 - i),
  }));
  const { kept, cut } = capTimeline(items);
  assert.equal(kept.length, 150);
  assert.equal(kept[0].at, "159");
  assert.equal(kept.at(-1).at, "10");
  assert.deepEqual(
    cut.map((it) => it.at),
    Array.from({ length: 10 }, (_, i) => String(9 - i)),
  );
  // Under the cap nothing is cut.
  assert.deepEqual(capTimeline(items.slice(0, 5)).cut, []);
});
