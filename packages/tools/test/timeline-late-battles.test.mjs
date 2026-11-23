/**
 * A player's page tells the battles played in its window however late
 * Elixir learned them (buildTimeline's `lateBattles`, 2026-11-23,
 * docs/notes/2026-11-23-player-page-late-battles.md). Check for new battles
 * on a player nobody follows lands a log whose battles are all a day or
 * more old: every one a late capture, which a feed never narrates. With the
 * option the sitting is told at its played time, and its id, revision,
 * anchor and games agree; without it nothing is (the default every feed
 * keeps). A return is never judged from a late batch.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  buildTimeline,
  readTimelineEvidence,
  restoredItem,
  storedItem,
} from "../src/activity/entries.mjs";

// Made-up tag: this repository is public.
const TAG = "#0LCU2RY8";
const FOE = "#0LCU2RY9";
const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const FROM = NOW - 7 * DAY;
// The battle log read 46 hours after the sitting began.
const SITTING = NOW - 2 * DAY;
const LEARNED = SITTING + 46 * 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();
const id = (n) => `late-battle-${String(n).padStart(2, "0")}`;

let scratch, db;
async function battle(n, playedMs, learnedMs, { outcome, boat = null } = {}) {
  await db.query(
    `insert into battle(battle_id,battle_time,type,type_class,boat_battle_side,created_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      id(n),
      iso(playedMs),
      boat ? "boatBattle" : "PvP",
      boat ? "boat" : "pvp",
      boat,
      iso(learnedMs),
    ],
  );
  await db.query(
    `insert into battle_participant(battle_id,player_tag,battle_time,side,type,type_class,crowns,trophy_change,outcome)
     values ($1,$2,$3,0,$4,$5,$6,$7,$8)`,
    [
      id(n),
      TAG,
      iso(playedMs),
      boat ? "boatBattle" : "PvP",
      boat ? "boat" : "pvp",
      outcome === "win" ? 3 : 0,
      outcome === "win" ? 30 : -30,
      outcome,
    ],
  );
  await db.query(
    `insert into battle_participant(battle_id,player_tag,battle_time,side,type,type_class,crowns,outcome)
     values ($1,$2,$3,1,'PvP','pvp',$4,$5)`,
    [
      id(n),
      FOE,
      iso(playedMs),
      outcome === "win" ? 0 : 3,
      outcome === "win" ? "loss" : "win",
    ],
  );
}

before(async () => {
  scratch = await scratchDb("timeline_late_battles");
  db = scratch.db;
  await db.query(
    "insert into player(player_tag,name) values ($1,'Late Larch'),($2,'Foe Fir')",
    [TAG, FOE],
  );
  // A battle the record learned on time, twelve days before the sitting:
  // the gap before the late batch is not a return Elixir can vouch for.
  await battle(0, SITTING - 12 * DAY, SITTING - 12 * DAY + MIN, {
    outcome: "win",
  });
  // Four battles, five minutes apart, all learned 46 hours after the first.
  for (const [n, outcome] of ["win", "win", "loss", "win"].entries())
    await battle(n + 1, SITTING + n * 5 * MIN, LEARNED, { outcome });
  // An enemy attacking the player's boat is never their battle, late or not.
  await battle(9, SITTING + 7 * MIN, LEARNED, {
    outcome: "win",
    boat: "defender",
  });
});
after(async () => scratch?.drop());

const read = (opts = {}) =>
  buildTimeline(
    db,
    [{ kind: "player", tag: TAG, relationship: null, nickname: null }],
    {
      fromMs: FROM,
      toMs: NOW,
      timezone: "UTC",
      accountId: null,
      basis: "occurred",
      ...opts,
    },
  );

test("with lateBattles a late-captured sitting is told at its played time, whole", async () => {
  const built = await read({ lateBattles: true });
  const sittings = built.timeline.filter((it) => it.kind === "battle_session");
  assert.equal(sittings.length, 1, JSON.stringify(built.timeline));
  const [s] = sittings;
  assert.equal(s.at, iso(SITTING));
  assert.equal(s.facts.started_at, iso(SITTING));
  assert.equal(s.facts.ended_at, iso(SITTING + 15 * MIN));
  assert.equal(s.facts.battles, 4);
  assert.equal(s.facts.won, 3);
  assert.equal(s.facts.lost, 1);
  assert.equal(s.revision, 4);
  assert.equal(s.observed_at, iso(LEARNED));
  assert.equal(s.late, false);
  assert.equal(s.evidence.count, 4);
  assert.equal(s.evidence.from, iso(SITTING));
  assert.equal(s.evidence.completeness, "recorded_sitting");

  const [entry] = built.entries;
  assert.equal(entry.battles.played, 4);
  assert.equal(entry.battles.sessions, 1);
  assert.equal(entry.battles.late_captures, 0, "nothing is left out");
  // No return from a late batch: the twelve days before it may be battles
  // Elixir never read.
  assert.equal(entry.presence.returned_after_days, null);
  assert.ok(!built.timeline.some((it) => it.kind === "returned"));
  assert.ok(!entry.notables.some((n) => n.kind === "returned"));

  // Its games agree with it: the same four, in played order, at the same
  // version, and the boat defense is not one of them.
  const games = await readTimelineEvidence(db, s, {
    expectedVersion: s.evidence.version,
  });
  assert.ok(!games.error, JSON.stringify(games));
  assert.deepEqual(
    games.battles.map((b) => b.battle_id),
    [id(1), id(2), id(3), id(4)],
  );
  assert.equal(games.count, 4);

  // The source survives the stored form (the story store, Home's week).
  const back = restoredItem(JSON.parse(JSON.stringify(storedItem(s))));
  const again = await readTimelineEvidence(db, back, {
    expectedVersion: s.evidence.version,
  });
  assert.equal(again.battles.length, 4);

  // The same sitting read again through a narrower window is one story.
  const narrow = (
    await read({ lateBattles: true, fromMs: SITTING + 10 * MIN })
  ).timeline.find((it) => it.kind === "battle_session");
  assert.equal(narrow.id, s.id);
  assert.equal(narrow.revision, s.revision);
  assert.equal(narrow.evidence.version, s.evidence.version);
});

test("without lateBattles (every feed) the late sitting is counted, never told", async () => {
  const built = await read();
  assert.ok(
    !built.timeline.some((it) => it.kind === "battle_session"),
    JSON.stringify(built.timeline),
  );
  // The player's entry is quiet: a window of late captures holds no play.
  assert.equal(built.entries.length, 0);
  assert.equal(built.quiet.length, 1);

  // Nor does a poller's read of the window the log was learned in.
  const observed = await read({ basis: "observed" });
  assert.ok(!observed.timeline.some((it) => it.kind === "battle_session"));
});

test("a page's sitting item without its source flag reads only timely games", async () => {
  const s = (await read({ lateBattles: true })).timeline.find(
    (it) => it.kind === "battle_session",
  );
  // A source that lost its flag counts the sitting as a feed would: none
  // of its games, so the version no longer matches.
  const stored = storedItem(s);
  const source = { ...stored._evidence_source };
  delete source.late_battles;
  const bare = restoredItem({ ...stored, _evidence_source: source });
  assert.deepEqual(await readTimelineEvidence(db, bare), {
    error: "evidence_changed",
  });
});

test("a batched read with lateBattles tells what each player's own read tells", async () => {
  const subjects = [TAG, FOE].map((tag) => ({
    kind: "player",
    tag,
    relationship: null,
    nickname: null,
  }));
  const opts = {
    fromMs: FROM,
    toMs: NOW,
    timezone: "UTC",
    accountId: null,
    basis: "occurred",
    lateBattles: true,
  };
  const sittings = (built) =>
    built.timeline
      .filter((it) => it.kind === "battle_session")
      .map((it) => [it.subject_tag, it.id, it.revision, it.evidence.version])
      .sort((a, b) => a[0].localeCompare(b[0]));
  const batched = await buildTimeline(db, subjects, opts);
  const alone = await buildTimeline(db, subjects, {
    ...opts,
    batchPlayers: false,
  });
  assert.deepEqual(sittings(batched), sittings(alone));
  assert.equal(sittings(batched).length, 2);
  assert.deepEqual(
    batched.entries.map((e) => e.battles.late_captures),
    [0, 0],
  );
});
